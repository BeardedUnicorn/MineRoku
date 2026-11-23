use base64::{engine::general_purpose, Engine as _};
use once_cell::sync::Lazy;
use reqwest::Client;
use roku::Device;
use crate::background::{
    cache_app_list_bg, cache_icon_bg, delete_device_bg, get_icon_bg, AppCache as CacheApp,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::AppHandle;
use url::Url;

/// Shared HTTP client for discovery and manual requests.
pub static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .pool_idle_timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| Client::new())
});

/// Short-timeout client for probing hosts during the subnet sweep.
static PROBE_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_millis(1000))
        .connect_timeout(Duration::from_millis(500))
        .build()
        .unwrap_or_else(|_| Client::new())
});

/// Basic in-memory cache for app icons, keyed by icon URL.
static ICON_CACHE: Lazy<Mutex<HashMap<String, String>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn icon_cache() -> std::sync::MutexGuard<'static, HashMap<String, String>> {
    ICON_CACHE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Builds `http://{ip}:{port}/{segments...}`, percent-encoding each segment.
fn ecp_url(ip: &str, port: u16, segments: &[&str]) -> Result<Url, String> {
    let mut url =
        Url::parse(&format!("http://{}:{}/", ip, port)).map_err(|e| format!("Invalid URL: {}", e))?;
    url.path_segments_mut()
        .map_err(|_| "Invalid URL".to_string())?
        .pop_if_empty()
        .extend(segments);
    Ok(url)
}

/// Forgets one device: its cache rows, cached icons, and discovery tracking. It will be listed
/// again if a later scan finds it.
pub async fn forget_device_impl(hardware_id: String) -> Result<(), String> {
    let ip = delete_device_bg(hardware_id.clone()).await?;
    crate::background_discovery::forget_last_seen(&hardware_id);
    if let Some(ip) = ip {
        let prefix = format!("http://{}:", ip);
        icon_cache().retain(|url, _| !url.starts_with(&prefix));
    }
    Ok(())
}

/// Drops every in-memory cache. Used alongside clearing the database.
pub fn clear_memory_caches() {
    icon_cache().clear();
    crate::background_discovery::clear_last_seen();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RokuDevice {
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub hardware_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RokuApp {
    pub id: String,
    pub name: String,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActiveAppInfo {
    pub name: String,
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaPlayerInfo {
    pub state: String,
    pub error: bool,
    pub plugin: Option<PluginInfo>,
    pub format: Option<FormatInfo>,
    pub position: Option<String>,
    pub duration: Option<String>,
    pub is_live: Option<bool>,
    pub runtime: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub bandwidth: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FormatInfo {
    pub audio: String,
    pub captions: String,
    pub container: String,
    pub drm: String,
    pub video: String,
    pub video_res: String,
}

/// Device info extracted from Roku's device-info endpoint
#[derive(Debug, Clone)]
pub struct DeviceInfoDetails {
    pub friendly_name: String,
    pub serial_number: String,
    pub ethernet_mac: Option<String>,
    pub wifi_mac: Option<String>,
    pub device_id: Option<String>,
}

/// Extract device info including hardware identifiers from a Roku device
pub async fn extract_device_info(ip: &str, port: u16) -> Result<DeviceInfoDetails, String> {
    let info_url = format!("http://{}:{}/query/device-info", ip, port);
    
    let response = HTTP_CLIENT
        .get(&info_url)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("HTTP {} from Roku", response.status()));
    }
    
    let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    
    let friendly_name = extract_element_text(&body, "friendly-device-name")
        .or_else(|| extract_element_text(&body, "user-device-name"))
        .unwrap_or_else(|| format!("Roku at {}", ip));
    
    let serial_number = extract_element_text(&body, "serial-number")
        .unwrap_or_default();
    
    let ethernet_mac = extract_element_text(&body, "ethernet-mac");
    let wifi_mac = extract_element_text(&body, "wifi-mac");
    let device_id = extract_element_text(&body, "device-id");
    
    Ok(DeviceInfoDetails {
        friendly_name,
        serial_number,
        ethernet_mac,
        wifi_mac,
        device_id,
    })
}

/// Generate a stable hardware ID from available device identifiers
pub fn generate_hardware_id(details: &DeviceInfoDetails) -> String {
    // Priority order: serial_number > device_id > ethernet_mac > wifi_mac
    if !details.serial_number.is_empty() {
        return format!("roku:{}", details.serial_number);
    }
    
    if let Some(ref device_id) = details.device_id {
        if !device_id.is_empty() {
            return format!("roku:{}", device_id);
        }
    }
    
    if let Some(ref ethernet_mac) = details.ethernet_mac {
        if !ethernet_mac.is_empty() {
            return format!("roku:eth:{}", ethernet_mac.replace(":", ""));
        }
    }
    
    if let Some(ref wifi_mac) = details.wifi_mac {
        if !wifi_mac.is_empty() {
            return format!("roku:wifi:{}", wifi_mac.replace(":", ""));
        }
    }
    
    // Fallback to a hash of available info
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let mut hasher = DefaultHasher::new();
    details.friendly_name.hash(&mut hasher);
    format!("roku:fallback:{:x}", hasher.finish())
}

/// Check if a Roku device is reachable
pub async fn check_device_connectivity_impl(ip: String, port: u16) -> Result<bool, String> {
    let url = format!("http://{}:{}/", ip, port);
    
    match HTTP_CLIENT
        .get(&url)
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        Ok(response) => Ok(response.status().is_success()),
        Err(_) => Ok(false),
    }
}

/// Get media player status.
pub async fn get_media_player_impl(ip: String, port: u16) -> Result<MediaPlayerInfo, String> {
    let url = format!("http://{}:{}/query/media-player", ip, port);

    let response = HTTP_CLIENT
        .get(&url)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();
    let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

    if !status.is_success() {
        return Err(format!("HTTP {} from Roku", status));
    }

    match roku::parse_media_player(&body) {
        Ok(media_player) => Ok(MediaPlayerInfo {
            state: media_player.state,
            error: media_player.error,
            plugin: media_player.plugin.map(|p| PluginInfo {
                id: p.id,
                name: p.name,
                bandwidth: p.bandwidth,
            }),
            format: media_player.format.map(|f| FormatInfo {
                audio: f.audio,
                captions: f.captions,
                container: f.container,
                drm: f.drm,
                video: f.video,
                video_res: f.video_res,
            }),
            position: media_player.position,
            duration: media_player.duration,
            is_live: media_player.is_live,
            runtime: media_player.runtime,
        }),
        Err(err) => {
            log::debug!("media-player parse failed ({}), using the simple parser", err);
            parse_media_player_simple(&body)
        }
    }
}

fn parse_media_player_simple(xml: &str) -> Result<MediaPlayerInfo, String> {
    let state = if let Some(start) = xml.find("state=\"") {
        let start = start + 7;
        if let Some(end) = xml[start..].find('"') {
            xml[start..start + end].to_string()
        } else {
            "unknown".to_string()
        }
    } else {
        "unknown".to_string()
    };
    
    let error = xml.contains("error=\"true\"");
    
    let plugin = if xml.contains("<plugin") {
        let mut plugin_info = PluginInfo {
            id: String::new(),
            name: String::new(),
            bandwidth: String::new(),
        };
        
        if let Some(line_start) = xml.find("<plugin") {
            if let Some(line_end) = xml[line_start..].find("/>") {
                let plugin_line = &xml[line_start..line_start + line_end];
                
                if let Some(id) = extract_attribute(plugin_line, "id") {
                    plugin_info.id = id;
                }
                if let Some(name) = extract_attribute(plugin_line, "name") {
                    plugin_info.name = name;
                }
                if let Some(bandwidth) = extract_attribute(plugin_line, "bandwidth") {
                    plugin_info.bandwidth = bandwidth;
                }
            }
        }
        
        Some(plugin_info)
    } else {
        None
    };
    
    let format = if xml.contains("<format") {
        let mut format_info = FormatInfo {
            audio: String::new(),
            captions: String::new(),
            container: String::new(),
            drm: String::new(),
            video: String::new(),
            video_res: String::new(),
        };
        
        if let Some(line_start) = xml.find("<format") {
            if let Some(line_end) = xml[line_start..].find("/>") {
                let format_line = &xml[line_start..line_start + line_end];
                
                if let Some(audio) = extract_attribute(format_line, "audio") {
                    format_info.audio = audio;
                }
                if let Some(captions) = extract_attribute(format_line, "captions") {
                    format_info.captions = captions;
                }
                if let Some(container) = extract_attribute(format_line, "container") {
                    format_info.container = container;
                }
                if let Some(drm) = extract_attribute(format_line, "drm") {
                    format_info.drm = drm;
                }
                if let Some(video) = extract_attribute(format_line, "video") {
                    format_info.video = video;
                }
                if let Some(video_res) = extract_attribute(format_line, "video_res") {
                    format_info.video_res = video_res;
                }
            }
        }
        
        Some(format_info)
    } else {
        None
    };
    
    let position = extract_element_text(xml, "position");
    let duration = extract_element_text(xml, "duration");
    let is_live = extract_element_text(xml, "is_live").map(|s| s == "true");
    let runtime = extract_element_text(xml, "runtime");
    
    Ok(MediaPlayerInfo {
        state,
        error,
        plugin,
        format,
        position,
        duration,
        is_live,
        runtime,
    })
}

fn extract_element_text(xml: &str, element: &str) -> Option<String> {
    let start_tag = format!("<{}>", element);
    let end_tag = format!("</{}>", element);
    
    if let Some(start) = xml.find(&start_tag) {
        let start = start + start_tag.len();
        if let Some(end) = xml[start..].find(&end_tag) {
            return Some(xml[start..start + end].trim().to_string());
        }
    }
    None
}

/// Discover Roku devices via SSDP; the discovery cycle itself falls back to a subnet sweep.
pub async fn discover_roku_devices_impl(app: &AppHandle) -> Result<Vec<RokuDevice>, String> {
    use crate::background_discovery::run_discovery_once;

    let discovered = run_discovery_once(app).await?;
    Ok(discovered
        .into_iter()
        .map(|d| RokuDevice {
            name: d.name,
            ip: d.ip,
            port: d.port,
            url: d.url,
            hardware_id: d.hardware_id,
        })
        .collect())
}

/// Fallback: Scan common local network ranges for Roku devices
pub async fn scan_network_for_roku() -> Result<Vec<RokuDevice>, String> {
    let mut devices = Vec::new();
    
    let local_ip = get_local_ip().await;
    
    let ranges: Vec<String> = if let Some(ip) = local_ip {
        let parts: Vec<&str> = ip.split('.').collect();
        if parts.len() == 4 {
            let prefix = format!("{}.{}.{}", parts[0], parts[1], parts[2]);
            vec![prefix]
        } else {
            vec!["192.168.1".to_string(), "192.168.0".to_string(), "10.0.0".to_string()]
        }
    } else {
        vec!["192.168.1".to_string(), "192.168.0".to_string(), "10.0.0".to_string()]
    };

    log::info!("Scanning network ranges: {:?}", ranges);

    for range in ranges {
        let mut handles = Vec::new();
        
        for i in 1..=254u8 {
            let ip = format!("{}.{}", range, i);
            let handle = tokio::spawn(async move {
                check_roku_device_with_hardware_id(&ip).await
            });
            handles.push(handle);
            
            if handles.len() >= 50 {
                for handle in handles.drain(..) {
                    if let Ok(Some(device)) = handle.await {
                        devices.push(device);
                    }
                }
            }
        }
        
        for handle in handles {
            if let Ok(Some(device)) = handle.await {
                devices.push(device);
            }
        }
        
        if !devices.is_empty() {
            break;
        }
    }

    log::info!("Network scan found {} devices", devices.len());
    Ok(devices)
}

async fn check_roku_device_with_hardware_id(ip: &str) -> Option<RokuDevice> {
    let test_url = format!("http://{}:8060/", ip);
    let response = PROBE_CLIENT.get(&test_url).send().await.ok()?;
    
    if !response.status().is_success() {
        return None;
    }
    
    match extract_device_info(ip, 8060).await {
        Ok(details) => {
            let hardware_id = generate_hardware_id(&details);
            
            log::info!("Found Roku device: {} at {} (hw_id: {})", 
                     details.friendly_name, ip, hardware_id);
            
            Some(RokuDevice {
                name: details.friendly_name,
                ip: ip.to_string(),
                port: 8060,
                url: format!("http://{}:8060", ip),
                hardware_id,
            })
        }
        Err(e) => {
            log::warn!("Failed to get device info for {}: {}", ip, e);
            None
        }
    }
}

async fn get_local_ip() -> Option<String> {
    let socket = tokio::net::UdpSocket::bind("0.0.0.0:0").await.ok()?;
    socket.connect("8.8.8.8:80").await.ok()?;
    let local_addr = socket.local_addr().ok()?;
    Some(local_addr.ip().to_string())
}

/// List installed apps on a Roku device
pub async fn list_roku_apps_impl(ip: String, port: u16) -> Result<Vec<RokuApp>, String> {
    let apps_url = format!("http://{}:{}/query/apps", ip, port);
    
    let response = match HTTP_CLIENT
        .get(&apps_url)
        .timeout(Duration::from_secs(5))
        .send()
        .await 
    {
        Ok(resp) => resp,
        Err(e) => {
            if e.is_timeout() {
                return Err("Request timed out".to_string());
            }
            return Err(format!("Network error: {}", e));
        }
    };
    
    let status = response.status();
    let body = match response.text().await {
        Ok(text) => text,
        Err(e) => return Err(format!("Failed to read response: {}", e)),
    };
    
    if status == reqwest::StatusCode::FORBIDDEN {
        return Err(
            "App listing is restricted on this Roku. \
            Go to Settings → System → Advanced system settings → \
            Control by mobile apps → Select 'Permissive' to allow app listing."
            .to_string()
        );
    }
    
    if !status.is_success() {
        return Err(format!("HTTP {} from Roku", status));
    }
    
    let apps = parse_apps_simple(&body);
    
    if !apps.is_empty() {
        let cache_list: Vec<CacheApp> = apps
            .iter()
            .map(|a| CacheApp { 
                id: a.id.clone(), 
                name: a.name.clone(), 
                version: a.version.clone() 
            })
            .collect();
        if let Err(e) = cache_app_list_bg(ip.clone(), cache_list).await {
            log::warn!("Failed to cache app list for {}: {}", ip, e);
        }
    }

    Ok(apps)
}

fn parse_apps_simple(xml: &str) -> Vec<RokuApp> {
    let mut apps = Vec::new();
    
    for line in xml.lines() {
        let line = line.trim();
        
        if line.starts_with("<app ") && line.contains("id=\"") {
            let id = extract_attribute(line, "id").unwrap_or_default();
            let version = extract_attribute(line, "version").unwrap_or_else(|| "N/A".to_string());
            
            let name = if let Some(start) = line.find('>') {
                let after_tag = &line[start + 1..];
                if let Some(end) = after_tag.find('<') {
                    after_tag[..end].trim().to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            };
            
            if !id.is_empty() && !name.is_empty() {
                apps.push(RokuApp { id, name, version });
            }
        }
    }
    
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

fn extract_attribute(line: &str, attr: &str) -> Option<String> {
    let pattern = format!("{}=\"", attr);
    if let Some(start) = line.find(&pattern) {
        let start = start + pattern.len();
        if let Some(end) = line[start..].find('"') {
            return Some(line[start..start + end].to_string());
        }
    }
    None
}

/// Send a single keypress
pub async fn send_roku_command_impl(
    ip: String,
    port: u16,
    command: String,
) -> Result<String, String> {
    let keypress_url = ecp_url(&ip, port, &["keypress", &command])?;

    let response = match HTTP_CLIENT
        .post(keypress_url)
        .timeout(Duration::from_secs(5))
        .send()
        .await 
    {
        Ok(resp) => resp,
        Err(e) => return Err(format!("Network error: {}", e)),
    };
    
    let status = response.status();
    
    if status == reqwest::StatusCode::FORBIDDEN {
        let body = response.text().await.unwrap_or_default();
        if body.contains("Limited mode") || body.contains("not allowed") {
            return Err("Roku is in Limited Mode. Enable 'Control by mobile apps' in Roku Settings → System → Advanced system settings".to_string());
        }
        return Err(format!("Access denied: {}", body));
    }
    
    if !status.is_success() {
        return Err(format!("Command failed with status: {}", status));
    }

    Ok(format!("Sent '{}' to {}:{}", command, ip, port))
}

/// Launch an app using HTTP POST request.
pub async fn launch_roku_app_impl(ip: String, port: u16, app_id: String) -> Result<String, String> {
    let endpoint = ecp_url(&ip, port, &["launch", &app_id])?;

    let resp = HTTP_CLIENT
        .post(endpoint)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    if status.is_success() {
        Ok(format!(
            "Launched '{}' on {}:{} (status {})",
            app_id, ip, port, status
        ))
    } else {
        Err(format!("Error {} from Roku: {}", status, body))
    }
}

/// Get the active app using the `roku` crate.
pub async fn get_active_app_impl(ip: String, port: u16) -> Result<ActiveAppInfo, String> {
    let base_url = format!("http://{}:{}", ip, port);
    let url = Url::parse(&base_url).map_err(|e| e.to_string())?;
    let device = Device::new(url);

    let active_app = device.active_app().await.map_err(|e| match &e {
        roku::Error::Request(req) => match req.status() {
            Some(status) => format!("HTTP {} from Roku", status),
            None => format!("Network error: {}", req),
        },
        _ => e.to_string(),
    })?;

    let app = active_app.app;
    let app_id = app.id.unwrap_or_else(|| "roku".to_string());

    let app_info = ActiveAppInfo {
        name: app.name,
        id: app_id,
    };

    Ok(app_info)
}

pub async fn get_app_icon_impl(ip: String, port: u16, app_id: String) -> Result<String, String> {
    let url = format!("http://{}:{}/query/icon/{}", ip, port, app_id);

    if let Some(cached) = { icon_cache().get(&url).cloned() } {
        return Ok(cached);
    }

    if let Ok(Some(db_icon)) = get_icon_bg(ip.clone(), app_id.clone()).await {
        icon_cache().insert(url.clone(), db_icon.clone());
        return Ok(db_icon);
    }

    let response = HTTP_CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Failed to fetch icon: {}", response.status()));
    }

    let image_bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let base64_icon = general_purpose::STANDARD.encode(&image_bytes);
    let mime_type = "image/png";
    let data_url = format!("data:{};base64,{}", mime_type, base64_icon);

    if let Err(e) = cache_icon_bg(ip, app_id, data_url.clone()).await {
        log::warn!("Failed to cache icon: {}", e);
    }
    icon_cache().insert(url, data_url.clone());

    Ok(data_url)
}

/// Test network connectivity on Android
#[tauri::command]
pub async fn test_network_connectivity() -> Result<String, String> {
    log::info!("Testing network connectivity...");
    
    match tokio::net::lookup_host("google.com:80").await {
        Ok(addrs) => {
            let addr_list: Vec<String> = addrs.map(|a| a.to_string()).collect();
            log::info!("DNS resolution successful: {:?}", addr_list);
        }
        Err(e) => {
            log::error!("DNS resolution failed: {}", e);
        }
    }
    
    match tokio::net::UdpSocket::bind("0.0.0.0:0").await {
        Ok(socket) => {
            log::info!("Successfully bound UDP socket to: {:?}", socket.local_addr());

            match socket.send_to(b"TEST", "239.255.255.250:1900").await {
                Ok(bytes) => log::info!("Sent {} bytes to multicast address", bytes),
                Err(e) => log::error!("Failed to send to multicast: {}", e),
            }
        }
        Err(e) => {
            log::error!("Failed to bind UDP socket: {}", e);
        }
    }
    
    Ok("Network connectivity test completed - check logs".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ecp_url_percent_encodes_segments() {
        let url = ecp_url("10.0.0.2", 8060, &["keypress", "Lit_a/b c?"]).unwrap();
        assert_eq!(url.as_str(), "http://10.0.0.2:8060/keypress/Lit_a%2Fb%20c%3F");
    }

    #[test]
    fn ecp_url_leaves_plain_keys_alone() {
        let url = ecp_url("10.0.0.2", 8060, &["keypress", "VolumeUp"]).unwrap();
        assert_eq!(url.as_str(), "http://10.0.0.2:8060/keypress/VolumeUp");
    }
}
