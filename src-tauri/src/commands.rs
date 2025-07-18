use serde::{Deserialize, Serialize};
use url::Url;
use ssdp_client::{search, SearchTarget};
use futures_util::stream::StreamExt;
use std::time::Duration;
use once_cell::sync::Lazy;
use reqwest::Client;
use xml::reader::{EventReader, XmlEvent as Event};

/// Shared HTTP client for both discovery and commands
static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| Client::new());

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
    pub app_type: String,
    pub version: String,
    pub icon_url: Option<String>,
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

/// List installed apps on a Roku device
pub async fn list_roku_apps_impl(
    ip: String,
    port: u16,
) -> Result<Vec<RokuApp>, String> {
    let endpoint = format!("http://{}:{}/query/apps", ip, port);
    eprintln!("→ Roku apps URL: {}", endpoint);

    let resp = HTTP_CLIENT
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    eprintln!("← apps status: {}, body length: {}", status, body.len());

    if !status.is_success() {
        return Err(format!("Error {} from Roku: {}", status, body));
    }

    // Parse the XML response
    let mut apps = Vec::new();
    let mut current_app: Option<RokuApp> = None;
    let mut current_text = String::new();

    let reader = EventReader::from_str(&body);
    
    for event in reader {
        match event {
            Ok(Event::StartElement { name, attributes, .. }) => {
                if name.local_name == "app" {
                    let mut app = RokuApp {
                        id: String::new(),
                        name: String::new(),
                        app_type: String::new(),
                        version: String::new(),
                        icon_url: None,
                    };

                    // Extract attributes
                    for attr in attributes {
                        match attr.name.local_name.as_str() {
                            "id" => app.id = attr.value,
                            "type" => app.app_type = attr.value,
                            "version" => app.version = attr.value,
                            _ => {}
                        }
                    }

                    current_app = Some(app);
                }
                current_text.clear();
            }
            Ok(Event::Characters(text)) => {
                current_text.push_str(&text);
            }
            Ok(Event::EndElement { name }) => {
                if name.local_name == "app" {
                    if let Some(mut app) = current_app.take() {
                        app.name = current_text.trim().to_string();
                        
                        // Generate icon URL if available
                        if !app.id.is_empty() {
                            app.icon_url = Some(format!("http://{}:{}/query/icon/{}", ip, port, app.id));
                        }
                        
                        apps.push(app);
                    }
                }
                current_text.clear();
            }
            Ok(Event::EndDocument) => break,
            Err(e) => {
                eprintln!("⚠️ XML parsing error: {}", e);
                break;
            }
            _ => {}
        }
    }

    Ok(apps)
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
