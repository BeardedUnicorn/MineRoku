use futures_util::stream::StreamExt;
use once_cell::sync::Lazy;
use serde::Serialize;
use ssdp_client::{search, SearchTarget};
use std::{collections::{HashMap, HashSet}, sync::Mutex, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter};
use url::Url;
use chrono::Utc;
use crate::background::{cache_device_bg, DeviceCache as CacheDevice};

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
pub struct RokuDeviceEvent {
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub url: String,
}

// Track by USN: value is (ip, last_seen)
static LAST_SEEN: Lazy<Mutex<HashMap<String, (String, Instant)>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Run a single discovery cycle, emitting events and updating the cache.
pub async fn run_discovery_once(app: &AppHandle) -> Result<Vec<RokuDeviceEvent>, String> {
    let search_target = SearchTarget::Custom("roku".into(), "ecp".into());
    let _ = app.emit("discovery_cycle_start", &());

    log::info!("Starting SSDP discovery for Roku devices");
    log::info!("Search target: {:?}", search_target);

    // Use longer timeout on Android
    #[cfg(target_os = "android")]
    let search_timeout = Duration::from_secs(10);
    #[cfg(not(target_os = "android"))]
    let search_timeout = Duration::from_secs(3);

    log::info!("Using search timeout: {:?}", search_timeout);

    // Try SSDP discovery
    let mut responses = match search(&search_target, search_timeout, 5, Some(4)).await {
        Ok(s) => {
            log::info!("SSDP search initiated successfully");
            s
        }
        Err(e) => {
            log::error!("SSDP search initialization error: {}", e);
            let _ = app.emit("discovery_cycle_end", &());
            return Err(e.to_string());
        }
    };

    let mut seen_this_cycle: HashSet<String> = HashSet::new();
    let mut discovered: Vec<RokuDeviceEvent> = Vec::new();
    let mut response_count = 0;

    log::info!("Waiting for SSDP responses...");

    while let Some(resp_res) = responses.next().await {
        response_count += 1;
        log::info!("Processing SSDP response #{}", response_count);
        
        let resp = match resp_res {
            Ok(r) => {
                log::info!("Got valid SSDP response: ST={:?}, Location={}", r.search_target(), r.location());
                if r.search_target() == &search_target {
                    r
                } else {
                    log::warn!("Response has wrong search target, skipping");
                    continue;
                }
            }
            Err(e) => {
                log::warn!("SSDP response error: {}", e);
                continue;
            }
        };

        log::info!("Found Roku device at: {}", resp.location());

        let desc_url = match Url::parse(resp.location()) {
            Ok(u) => u,
            Err(e) => {
                log::warn!("Invalid SSDP LOCATION header '{}': {}", resp.location(), e);
                continue;
            }
        };
        let origin = desc_url.origin().ascii_serialization();
        let usn = resp.usn().to_string();
        let info_url = format!("{}/query/device-info", origin);

        log::info!("Fetching device info from: {}", info_url);

        // Fetch friendly name best-effort; fall back to origin.
        let friendly = match reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default()
            .get(&info_url)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let body = resp.text().await.unwrap_or_default();
                log::debug!("Device info response length: {} bytes", body.len());
                if let (Some(s), Some(e)) = (
                    body.find("<friendly-device-name>"),
                    body.find("</friendly-device-name>"),
                ) {
                    let s = s + "<friendly-device-name>".len();
                    let name = body[s..e].to_string();
                    log::info!("Extracted device name: {}", name);
                    name
                } else {
                    log::warn!("Could not find friendly-device-name in response");
                    origin.clone()
                }
            }
            Ok(resp) => {
                log::warn!("Device info request returned status: {}", resp.status());
                origin.clone()
            }
            Err(e) => {
                log::warn!("Failed to fetch device info from {}: {}", info_url, e);
                origin.clone()
            }
        };

        let ip = desc_url.host_str().unwrap_or_default().to_string();
        let port = desc_url.port_or_known_default().unwrap_or(8060);

        log::info!("Successfully discovered Roku device: '{}' at {}:{}", friendly, ip, port);

        let evt = RokuDeviceEvent { name: friendly, ip: ip.clone(), port, url: origin.clone() };
        discovered.push(evt.clone());
        let _ = app.emit("device_discovered", &evt);
        
        // Persist discovery to cache with last_seen
        match cache_device_bg(CacheDevice {
            name: evt.name.clone(),
            ip: evt.ip.clone(),
            port: evt.port,
            url: evt.url.clone(),
            last_seen: Utc::now().timestamp(),
        }).await {
            Ok(_) => log::debug!("Cached device: {}", evt.name),
            Err(e) => log::warn!("Failed to cache device: {}", e),
        }

        let now = Instant::now();
        seen_this_cycle.insert(usn.clone());
        LAST_SEEN.lock().unwrap().insert(usn, (ip.clone(), now));
    }

    log::info!("SSDP discovery complete. Found {} devices from {} responses", discovered.len(), response_count);

    if discovered.is_empty() && response_count == 0 {
        log::warn!("No SSDP responses received at all - possible network/multicast issue");
    }

    // Determine devices that have gone missing
    let cutoff = Instant::now() - Duration::from_secs(60);
    let mut to_remove: Vec<String> = vec![];
    let mut to_remove_usn: Vec<String> = vec![];
    {
        let map = LAST_SEEN.lock().unwrap();
        for (usn, (ip, last)) in map.iter() {
            if *last < cutoff && !seen_this_cycle.contains(usn) {
                to_remove.push(ip.clone());
                to_remove_usn.push(usn.clone());
            }
        }
    }
    
    if !to_remove.is_empty() {
        log::info!("Marking {} devices as lost", to_remove.len());
    }
    
    for ip in to_remove {
        let _ = app.emit("device_lost", &ip);
    }
    if !to_remove_usn.is_empty() {
        let mut map = LAST_SEEN.lock().unwrap();
        for usn in to_remove_usn { let _ = map.remove(&usn); }
    }

    let _ = app.emit("discovery_cycle_end", &());
    Ok(discovered)
}

pub fn start_background_discovery(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Give Android time to acquire multicast lock
        #[cfg(target_os = "android")]
        {
            log::info!("Android: Waiting 3 seconds for multicast lock acquisition...");
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
        
        log::info!("Starting initial device discovery");
        match run_discovery_once(&app).await {
            Ok(devices) => log::info!("Initial discovery found {} devices", devices.len()),
            Err(e) => log::error!("Initial discovery failed: {}", e),
        }
    });
}