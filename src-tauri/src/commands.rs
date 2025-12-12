use base64::{engine::general_purpose, Engine as _};
use once_cell::sync::Lazy;
use reqwest::Client;
use roku::Device;
use crate::{background::{cache_app_list_bg, AppCache as CacheApp, get_icon_bg, cache_icon_bg}, background_discovery::run_discovery_once};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::AppHandle;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

/// Shared HTTP client for discovery and manual requests.
static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .pool_idle_timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| Client::new())
});

/// Basic in-memory cache for app icons.
static ICON_CACHE: Lazy<Mutex<HashMap<String, String>>> = Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RokuDevice {
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub url: String,
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

// Add this struct for the media player response
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

/// Get media player status with detailed logging
pub async fn get_media_player_impl(ip: String, port: u16) -> Result<MediaPlayerInfo, String> {
    log::info!("Fetching media player status from {}:{}", ip, port);
    
    // First, let's try a direct HTTP request to see the raw response
    let url = format!("http://{}:{}/query/media-player", ip, port);
    
    let response = HTTP_CLIENT
        .get(&url)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    let status = response.status();
    let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    
    log::info!("Media player response status: {}", status);
    log::info!("Media player raw XML response:\n{}", body);
    
    if !status.is_success() {
        return Err(format!("HTTP {} from Roku", status));
    }
    
    // Now try to parse it with the roku crate
    let base_url = format!("http://{}:{}", ip, port);
    let url = Url::parse(&base_url).map_err(|e| format!("Invalid URL: {}", e))?;
    let device = Device::new(url);

    match device.media_player().await {
        Ok(media_player) => {
            log::info!("Successfully parsed media player data");
            Ok(MediaPlayerInfo {
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
            })
        }
        Err(err) => {            
            log::warn!("Roku crate media-player parsing failed: {}", err);
            log::info!("Attempting manual XML parsing as fallback");
            parse_media_player_simple(&body)
        }
    }
}

// Add a simple fallback parser
fn parse_media_player_simple(xml: &str) -> Result<MediaPlayerInfo, String> {
    log::info!("Using simple XML parser for media-player response");
    
    // Extract state attribute
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
    
    // Extract error attribute
    let error = xml.contains("error=\"true\"");
    
    // Try to extract plugin info
    let plugin = if xml.contains("<plugin") {
        let mut plugin_info = PluginInfo {
            id: String::new(),
            name: String::new(),
            bandwidth: String::new(),
        };
        
        if let Some(line_start) = xml.find("<plugin") {
            if let Some(line_end) = xml[line_start..].find("/>") {
                let plugin_line = &xml[line_start..line_start + line_end];
                
                // Extract attributes
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
    
    // Try to extract format info
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
                
                // Extract attributes
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
    
    // Extract position
    let position = extract_element_text(xml, "position");
    
    // Extract duration
    let duration = extract_element_text(xml, "duration");
    
    // Extract is_live
    let is_live = extract_element_text(xml, "is_live")
        .map(|s| s == "true")
        .or_else(|| Some(false));
    
    // Extract runtime
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

// Helper function to extract element text
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

/// Discover Roku devices via SSDP with fallback to network scan.
pub async fn discover_roku_devices_impl(app: &AppHandle) -> Result<Vec<RokuDevice>, String> {
    // First try SSDP discovery
    let ssdp_result = run_discovery_once(app).await;
    
    let mut devices: Vec<RokuDevice> = match ssdp_result {
        Ok(discovered) => discovered
            .into_iter()
            .map(|d| RokuDevice { name: d.name, ip: d.ip, port: d.port, url: d.url })
            .collect(),
        Err(e) => {
            log::warn!("SSDP discovery failed: {}, trying fallback", e);
            Vec::new()
        }
    };

    // If SSDP found nothing, try network scan fallback
    if devices.is_empty() {
        log::info!("SSDP found no devices, attempting network scan fallback");
        if let Ok(fallback_devices) = scan_network_for_roku().await {
            devices = fallback_devices;
        }
    }

    Ok(devices)
}

/// Fallback: Scan common local network ranges for Roku devices
async fn scan_network_for_roku() -> Result<Vec<RokuDevice>, String> {
    let mut devices = Vec::new();
    
    // Try to determine local IP range
    let local_ip = get_local_ip().await;
    
    let ranges: Vec<String> = if let Some(ip) = local_ip {
        // Scan the /24 subnet of the local IP
        let parts: Vec<&str> = ip.split('.').collect();
        if parts.len() == 4 {
            let prefix = format!("{}.{}.{}", parts[0], parts[1], parts[2]);
            vec![prefix]
        } else {
            vec!["192.168.1".to_string(), "192.168.0".to_string(), "10.0.0".to_string()]
        }
    } else {
        // Common home network ranges
        vec!["192.168.1".to_string(), "192.168.0".to_string(), "10.0.0".to_string()]
    };

    log::info!("Scanning network ranges: {:?}", ranges);

    for range in ranges {
        // Scan in parallel batches
        let mut handles = Vec::new();
        
        for i in 1..=254u8 {
            let ip = format!("{}.{}", range, i);
            let handle = tokio::spawn(async move {
                check_roku_device(&ip).await
            });
            handles.push(handle);
            
            // Batch of 50 concurrent requests
            if handles.len() >= 50 {
                for handle in handles.drain(..) {
                    if let Ok(Some(device)) = handle.await {
                        return Ok(vec![device]); // Return first found device
                    }
                }
            }
        }
        
        // Check remaining handles
        for handle in handles {
            if let Ok(Some(device)) = handle.await {
                devices.push(device);
            }
        }
        
        if !devices.is_empty() {
            break; // Found devices in this range
        }
    }

    log::info!("Network scan found {} devices", devices.len());
    Ok(devices)
}

/// Check if a specific IP has a Roku device
async fn check_roku_device(ip: &str) -> Option<RokuDevice> {
    let url = format!("http://{}:8060/query/device-info", ip);
    
    let client = Client::builder()
        .timeout(Duration::from_millis(1000))
        .connect_timeout(Duration::from_millis(500))
        .build()
        .ok()?;
    
    let response = client.get(&url).send().await.ok()?;
    
    if !response.status().is_success() {
        return None;
    }
    
    let body = response.text().await.ok()?;
    
    // Check if it's a Roku device by looking for Roku-specific XML
    if !body.contains("<device-info>") {
        return None;
    }
    
    // Extract friendly name
    let name = if let (Some(start), Some(end)) = (
        body.find("<friendly-device-name>"),
        body.find("</friendly-device-name>"),
    ) {
        let start = start + "<friendly-device-name>".len();
        body[start..end].to_string()
    } else {
        format!("Roku ({})", ip)
    };
    
    log::info!("Found Roku device via network scan: {} at {}", name, ip);
    
    Some(RokuDevice {
        name,
        ip: ip.to_string(),
        port: 8060,
        url: format!("http://{}:8060", ip),
    })
}

/// Get local IP address
async fn get_local_ip() -> Option<String> {
    // Try to connect to a public IP to determine local interface
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
    
    // Handle 403 Forbidden specifically for app listing
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
    
    // Parse the XML response
    let apps = parse_apps_simple(&body);
    
    // Cache the apps if we got any
    if !apps.is_empty() {
        let cache_list: Vec<CacheApp> = apps
            .iter()
            .map(|a| CacheApp { 
                id: a.id.clone(), 
                name: a.name.clone(), 
                version: a.version.clone() 
            })
            .collect();
        let _ = cache_app_list_bg(ip.clone(), cache_list).await;
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

/// Send a single keypress using the `roku` crate.
pub async fn send_roku_command_impl(
    ip: String,
    port: u16,
    command: String,
) -> Result<String, String> {
    let keypress_url = format!("http://{}:{}/keypress/{}", ip, port, command);
    
    let response = match HTTP_CLIENT
        .post(&keypress_url)
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

/// Check if ECP is available on the device
#[allow(dead_code)]
pub async fn check_ecp_available(ip: &str, port: u16) -> Result<bool, String> {
    let url = format!("http://{}:{}/query/device-info", ip, port);
    
    let response = match HTTP_CLIENT
        .get(&url)
        .timeout(Duration::from_secs(3))
        .send()
        .await 
    {
        Ok(resp) => resp,
        Err(_) => return Ok(false),
    };
    
    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Ok(false);
    }
    
    Ok(response.status().is_success())
}

/// Launch an app using HTTP POST request.
pub async fn launch_roku_app_impl(ip: String, port: u16, app_id: String) -> Result<String, String> {
    let endpoint = format!("http://{}:{}/launch/{}", ip, port, app_id);

    let resp = HTTP_CLIENT
        .post(&endpoint)
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

    let active_app = device.active_app().await.map_err(|e| e.to_string())?;

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

    // 1) In-memory cache
    if let Some(cached) = { ICON_CACHE.lock().unwrap().get(&url).cloned() } {
        return Ok(cached);
    }

    // 2) Persistent cache (SQLite)
    if let Ok(Some(db_icon)) = get_icon_bg(ip.clone(), app_id.clone()).await {
        ICON_CACHE.lock().unwrap().insert(url.clone(), db_icon.clone());
        return Ok(db_icon);
    }

    // 3) Live fetch and persist
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
    let mime_type = "image/png"; // Assuming PNG, Roku uses PNG for icons
    let data_url = format!("data:{};base64,{}", mime_type, base64_icon);

    let _ = cache_icon_bg(ip, app_id, data_url.clone()).await;
    ICON_CACHE.lock().unwrap().insert(url, data_url.clone());

    Ok(data_url)
}

/// Create or show the remote popup window.
pub fn open_popup_window_impl(app: &AppHandle) -> Result<(), String> {
    // Popup windows don't make sense on mobile - just return Ok
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        return Ok(());
    }
    
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if let Some(window) = app.get_webview_window("remote_popup") {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        } else {
            WebviewWindowBuilder::new(app, "remote_popup", WebviewUrl::App("index.html".into()))
                .title("Roku Remote")
                .resizable(false)
                .inner_size(400.0, 700.0)
                .build()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

/// Test network connectivity on Android
#[tauri::command]
pub async fn test_network_connectivity() -> Result<String, String> {
    log::info!("Testing network connectivity...");
    
    // Test 1: Can we resolve DNS?
    match tokio::net::lookup_host("google.com:80").await {
        Ok(addrs) => {
            let addr_list: Vec<String> = addrs.map(|a| a.to_string()).collect();
            log::info!("DNS resolution successful: {:?}", addr_list);
        }
        Err(e) => {
            log::error!("DNS resolution failed: {}", e);
        }
    }
    
    // Test 2: Can we bind to a UDP socket?
    match tokio::net::UdpSocket::bind("0.0.0.0:0").await {
        Ok(socket) => {
            let local_addr = socket.local_addr().unwrap();
            log::info!("Successfully bound UDP socket to: {}", local_addr);
            
            // Test 3: Can we send to multicast address?
            let multicast_addr = "239.255.255.250:1900".parse::<std::net::SocketAddr>().unwrap();
            match socket.send_to(b"TEST", multicast_addr).await {
                Ok(bytes) => log::info!("Sent {} bytes to multicast address", bytes),
                Err(e) => log::error!("Failed to send to multicast: {}", e),
            }
        }
        Err(e) => {
            log::error!("Failed to bind UDP socket: {}", e);
        }
    }
    
    // Test 4: Direct HTTP to a known Roku (if you know the IP)
    // You can temporarily hardcode a known Roku IP here for testing
    // let test_ip = "192.168.0.123"; // Replace with your Roku's IP
    // let url = format!("http://{}:8060/query/device-info", test_ip);
    // match reqwest::get(&url).await {
    //     Ok(resp) => log::info!("Direct Roku connection: {}", resp.status()),
    //     Err(e) => log::error!("Direct Roku connection failed: {}", e),
    // }
    
    Ok("Network connectivity test completed - check logs".to_string())
}
