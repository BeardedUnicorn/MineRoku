use serde::{Deserialize, Serialize};
use url::Url;
use ssdp_client::{search, SearchTarget};
use futures_util::stream::StreamExt;
use std::time::Duration;
use once_cell::sync::Lazy;
use reqwest::Client;

/// Shared HTTP client for both discovery and commands
static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| Client::new());

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RokuDevice {
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub url: String,
}

/// Discover Roku devices via SSDP + manual device‐info fetch
pub async fn discover_roku_devices_impl() -> Result<Vec<RokuDevice>, String> {
    // 1) Define the SSDP target
    let search_target = SearchTarget::Custom("roku".into(), "ecp".into());

    // 2) Perform the search (3s timeout, 2 MX, no explicit retries)
    let mut responses = search(&search_target, Duration::from_secs(3), 2, None)
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    while let Some(resp_res) = responses.next().await {
        // Only handle responses matching our target
        let resp = match resp_res {
            Ok(r) if r.search_target() == &search_target => r,
            _ => continue,
        };

        // 3) Parse the LOCATION URL (usually ends in /description.xml)
        let desc_url = match Url::parse(resp.location()) {
            Ok(u) => u,
            Err(e) => {
                eprintln!("⚠️ Invalid SSDP LOCATION header: {}", e);
                continue;
            }
        };

        // 4) Build the origin (scheme + host + port)
        let origin = desc_url.origin().ascii_serialization();

        // 5) Fetch /query/device‑info and extract <friendlyDeviceName>
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

        // 6) Extract IP & port from the description URL
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

/// Send a single keypress to `/keypress/{KEY}`
pub async fn send_roku_command_impl(
    ip: String,
    port: u16,
    command: String,
) -> Result<String, String> {
    // Map to Roku‑exact casing
    let key_str = match command.to_lowercase().as_str() {
        "home"       => "Home",
        "rev"        => "Rev",
        "fwd"        => "Fwd",
        "play"       => "Play",
        "select"     => "Select",
        "left"       => "Left",
        "right"      => "Right",
        "down"       => "Down",
        "up"         => "Up",
        "back"       => "Back",
        "info"       => "Info",
        "backspace"  => "Backspace",
        "search"     => "Search",
        "enter"      => "Enter",
        other        => return Err(format!("Unknown command: {}", other)),
    };

    let endpoint = format!("http://{}:{}/keypress/{}", ip, port, key_str);
    eprintln!("→ Roku keypress URL: {}", endpoint);

    let resp = HTTP_CLIENT
        .post(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    let status = resp.status();
    let body   = resp.text().await.unwrap_or_default();
    eprintln!("← status: {}, body: {}", status, body);

    if status.is_success() {
        Ok(format!("Sent '{}' to {}:{} (status {})", key_str, ip, port, status))
    } else {
        Err(format!("Error {} from Roku: {}", status, body))
    }
}

/// Launch an app via `/launch/{APP_ID}`
pub async fn launch_roku_app_impl(
    ip: String,
    port: u16,
    app_id: String,
) -> Result<String, String> {
    let endpoint = format!("http://{}:{}/launch/{}", ip, port, app_id);
    eprintln!("→ Roku launch URL: {}", endpoint);

    let resp = HTTP_CLIENT
        .get(&endpoint)
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
