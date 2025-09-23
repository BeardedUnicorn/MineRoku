use futures_util::stream::StreamExt;
use once_cell::sync::Lazy;
use serde::Serialize;
use ssdp_client::{search, SearchTarget};
use std::{collections::{HashMap, HashSet}, sync::Mutex, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter};
use url::Url;
use chrono::Utc;
use crate::background::{cache_device_bg, DeviceCache as CacheDevice};

#[derive(Debug, Clone, Serialize)]
pub struct RokuDeviceEvent {
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub url: String,
}

// Track by USN: value is (ip, last_seen)
static LAST_SEEN: Lazy<Mutex<HashMap<String, (String, Instant)>>> = Lazy::new(|| Mutex::new(HashMap::new()));

pub fn start_background_discovery(app: AppHandle) {
    // Spawn a repeating async task that scans and emits events.
    tauri::async_runtime::spawn(async move {
        let search_target = SearchTarget::Custom("roku".into(), "ecp".into());
        // Track devices discovered this cycle to detect offline ones later.
        loop {
            let _ = app.emit("discovery_cycle_start", &());

            // Run SSDP search for a short period with a couple of tries.
            let mut responses = match search(&search_target, Duration::from_secs(3), 2, None).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("SSDP search error: {}", e);
                    // Still sleep before retrying to avoid tight loop on error.
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    continue;
                }
            };

            let mut seen_this_cycle: HashSet<String> = HashSet::new();

            while let Some(resp_res) = responses.next().await {
                let Ok(resp) = resp_res else { continue };
                if resp.search_target() != &search_target { continue; }

                let desc_url = match Url::parse(resp.location()) {
                    Ok(u) => u,
                    Err(e) => {
                        eprintln!("Invalid SSDP LOCATION header: {}", e);
                        continue;
                    }
                };
                let origin = desc_url.origin().ascii_serialization();
                let usn = resp.usn().to_string();
                let info_url = format!("{}/query/device-info", origin);

                // Fetch friendly name best-effort; fall back to origin.
                let friendly = match reqwest::Client::new()
                    .get(&info_url)
                    .timeout(Duration::from_secs(3))
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => {
                        let body = resp.text().await.unwrap_or_default();
                        if let (Some(s), Some(e)) = (
                            body.find("<friendly-device-name>"),
                            body.find("</friendly-device-name>"),
                        ) {
                            let s = s + "<friendly-device-name>".len();
                            body[s..e].to_string()
                        } else {
                            origin.clone()
                        }
                    }
                    _ => origin.clone(),
                };

                let ip = desc_url.host_str().unwrap_or_default().to_string();
                let port = desc_url.port_or_known_default().unwrap_or(8060);

                let evt = RokuDeviceEvent { name: friendly, ip: ip.clone(), port, url: origin.clone() };
                let _ = app.emit("device_discovered", &evt);
                // Persist discovery to cache with last_seen
                let _ = cache_device_bg(CacheDevice {
                    name: evt.name.clone(),
                    ip: evt.ip.clone(),
                    port: evt.port,
                    url: evt.url.clone(),
                    last_seen: Utc::now().timestamp(),
                }).await;

                let now = Instant::now();
                seen_this_cycle.insert(usn.clone());
                LAST_SEEN.lock().unwrap().insert(usn, (ip.clone(), now));
            }

            // Determine devices that have gone missing. If a device hasn't been
            // seen for 2 full cycles (~> 60s), mark it lost.
            let cutoff = Instant::now() - Duration::from_secs(60);
            let mut to_remove: Vec<String> = vec![]; // IPs to mark lost
            let mut to_remove_usn: Vec<String> = vec![]; // USNs to drop from map
            {
                let map = LAST_SEEN.lock().unwrap();
                for (usn, (ip, last)) in map.iter() {
                    if *last < cutoff && !seen_this_cycle.contains(usn) {
                        to_remove.push(ip.clone());
                        to_remove_usn.push(usn.clone());
                    }
                }
            }
            for ip in to_remove {
                let _ = app.emit("device_lost", &ip);
            }
            if !to_remove_usn.is_empty() {
                let mut map = LAST_SEEN.lock().unwrap();
                for usn in to_remove_usn { let _ = map.remove(&usn); }
            }

            let _ = app.emit("discovery_cycle_end", &());
            // Wait before next cycle.
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}
