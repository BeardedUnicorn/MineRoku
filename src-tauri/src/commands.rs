// src-tauri/src/commands.rs

use serde::{Deserialize, Serialize};
use url::Url;
use ssdp_client::{search, SearchTarget};
use futures_util::stream::StreamExt;
use std::time::Duration;
use once_cell::sync::Lazy;
use reqwest::Client;
use roku::{Device, Key};
use base64::{engine::general_purpose, Engine as _};

/// Shared HTTP client for discovery and manual requests.
static HTTP_CLIENT: Lazy<Client> = Lazy::new(Client::new);

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

/// Discover Roku devices via SSDP. This function is correct.
pub async fn discover_roku_devices_impl() -> Result<Vec<RokuDevice>, String> {
    // ... (This function is unchanged)
    let search_target = SearchTarget::Custom("roku".into(), "ecp".into());
    let mut responses = search(&search_target, Duration::from_secs(3), 2, None)
        .await
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(resp_res) = responses.next().await {
        let resp = match resp_res {
            Ok(r) if r.search_target() == &search_target => r,
            _ => continue,
        };
        let desc_url = match Url::parse(resp.location()) {
            Ok(u) => u,
            Err(e) => {
                eprintln!("⚠️ Invalid SSDP LOCATION header: {}", e);
                continue;
            }
        };
        let origin = desc_url.origin().ascii_serialization();
        let info_url = format!("{}/query/device-info", origin);
        let friendly = match HTTP_CLIENT.get(&info_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let body = resp.text().await.unwrap_or_default();
                if let (Some(start), Some(end)) = (
                    body.find("<friendly-device-name>"),
                    body.find("</friendly-device-name>"),
                ) {
                    let start = start + "<friendly-device-name>".len();
                    body[start..end].to_string()
                } else {
                    eprintln!("⚠️ No <friendlyDeviceName> in {}", info_url);
                    origin.clone()
                }
            }
            Ok(resp) => {
                eprintln!("⚠️ {} returned HTTP {}", info_url, resp.status());
                origin.clone()
            }
            Err(e) => {
                eprintln!("⚠️ Network error fetching {}: {}", info_url, e);
                origin.clone()
            }
        };
        let ip = desc_url.host_str().unwrap_or_default().to_string();
        let port = desc_url.port_or_known_default().unwrap_or(8060);
        out.push(RokuDevice {
            name: friendly,
            ip,
            port,
            url: origin.clone(),
        });
    }
    Ok(out)
}

/// List installed apps on a Roku device.
pub async fn list_roku_apps_impl(
    ip: String,
    port: u16,
) -> Result<Vec<RokuApp>, String> {
    let base_url = format!("http://{}:{}", ip, port);
    let url = Url::parse(&base_url).map_err(|e| e.to_string())?;
    let device = Device::new(url);

    let apps_from_crate = device.apps().await.map_err(|e| e.to_string())?;

    // CORRECTED: Handle Option types returned by the `roku` crate gracefully.
    // We use `filter_map` to iterate, ensuring we only include apps that have an ID,
    // as it is essential for launching and fetching icons.
    let apps = apps_from_crate.apps
        .into_iter()
        .filter_map(|app| {
            // If an app has no ID, we cannot use it. so we skip it.
            app.id.map(|id| RokuApp {
                id: id.clone(),
                name: app.name,
                // If version is not provided, use a default value.
                version: app.version.unwrap_or_else(|| "N/A".to_string()),
            })
        })
        .collect();
    
    Ok(apps)
}

/// Send a single keypress using the `roku` crate.
pub async fn send_roku_command_impl(
    ip: String,
    port: u16,
    command: String,
) -> Result<String, String> {
    let base_url = format!("http://{}:{}", ip, port);
    let url = Url::parse(&base_url).map_err(|e| e.to_string())?;
    let device = Device::new(url);

    let key = match command.to_lowercase().as_str() {
        "home"       => Key::Home, "rev"        => Key::Rev, "fwd"        => Key::Fwd,
        "play"       => Key::Play, "select"     => Key::Select, "left"       => Key::Left,
        "right"      => Key::Right, "down"       => Key::Down, "up"         => Key::Up,
        "back"       => Key::Back, "info"       => Key::Info, "backspace"  => Key::Backspace,
        "search"     => Key::Search, "enter"      => Key::Enter, "volumeup"   => Key::VolumeUp,
        "volumedown" => Key::VolumeDown, "volumemute" => Key::VolumeMute,
        other        => return Err(format!("Unknown command: {}", other)),
    };

    device.keypress(&key).await.map_err(|e| e.to_string())?;

    Ok(format!("Sent '{}' to {}:{}", command, ip, port))
}

/// Correctly implemented manual POST request for launching apps.
pub async fn launch_roku_app_impl(
    ip: String,
    port: u16,
    app_id: String,
) -> Result<String, String> {
    let endpoint = format!("http://{}:{}/launch/{}", ip, port, app_id);
    eprintln!("→ Roku launch URL: {}", endpoint);

    let resp = HTTP_CLIENT
        .post(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    let status = resp.status();
    let body   = resp.text().await.unwrap_or_default();
    eprintln!("← status: {}, body: {}", status, body);

    if status.is_success() {
        Ok(format!("Launched '{}' on {}:{} (status {})", app_id, ip, port, status))
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
    
    // CORRECTED: Handle the case where the active app is the home screen,
    // which may not have an ID. Default to "roku" for compatibility with the frontend.
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
    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Failed to fetch icon: {}", response.status()));
    }

    let image_bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let base64_icon = general_purpose::STANDARD.encode(&image_bytes);
    let mime_type = "image/png"; // Assuming PNG, Roku uses PNG for icons
    Ok(format!("data:{};base64,{}", mime_type, base64_icon))
}
