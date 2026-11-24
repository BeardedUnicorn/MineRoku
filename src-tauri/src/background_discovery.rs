use futures_util::stream::StreamExt;
use once_cell::sync::Lazy;
use serde::Serialize;
use ssdp_client::{search, SearchTarget};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use url::Url;
use chrono::Utc;
use crate::background::{cache_device_bg, DeviceCache};
use crate::commands::{extract_device_info, generate_hardware_id, scan_network_for_roku};

#[cfg(target_os = "android")]
const SSDP_INITIAL_WAIT: Duration = Duration::from_secs(5);
#[cfg(not(target_os = "android"))]
const SSDP_INITIAL_WAIT: Duration = Duration::from_secs(2);

#[cfg(target_os = "android")]
const SSDP_FOLLOWUP_WAIT: Duration = Duration::from_secs(2);
#[cfg(not(target_os = "android"))]
const SSDP_FOLLOWUP_WAIT: Duration = Duration::from_millis(900);

#[cfg(target_os = "android")]
const SSDP_MX: usize = 4;
#[cfg(not(target_os = "android"))]
const SSDP_MX: usize = 2;

#[cfg(target_os = "macos")]
const LAN_UNREACHABLE_MESSAGE: &str = "Can't reach your local network. Make sure Roku Remote is \
     turned on in System Settings > Privacy & Security > Local Network, then scan again.";
#[cfg(not(target_os = "macos"))]
const LAN_UNREACHABLE_MESSAGE: &str = "Can't reach your local network. Make sure this device is \
     on the same network as your Roku, then scan again.";

#[derive(Debug, Clone, Serialize)]
pub struct RokuDeviceEvent {
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub hardware_id: String,
}

// Track devices by hardware ID: value is (device_info, last_seen)
static LAST_SEEN: Lazy<Mutex<HashMap<String, (RokuDeviceEvent, Instant)>>> = 
    Lazy::new(|| Mutex::new(HashMap::new()));

fn last_seen() -> std::sync::MutexGuard<'static, HashMap<String, (RokuDeviceEvent, Instant)>> {
    LAST_SEEN.lock().unwrap_or_else(|e| e.into_inner())
}

/// Stops tracking a device the user has forgotten, so no `device_lost` fires for it later.
pub fn forget_last_seen(hardware_id: &str) {
    last_seen().remove(hardware_id);
}

pub fn clear_last_seen() {
    last_seen().clear();
}

/// Announces a discovered device to the UI, tracks it, and persists it to the cache.
async fn record_discovered(app: &AppHandle, evt: &RokuDeviceEvent) {
    let _ = app.emit("device_discovered", evt);
    last_seen().insert(evt.hardware_id.clone(), (evt.clone(), Instant::now()));

    match cache_device_bg(DeviceCache {
        name: evt.name.clone(),
        ip: evt.ip.clone(),
        port: evt.port,
        url: evt.url.clone(),
        hardware_id: evt.hardware_id.clone(),
        last_seen: Utc::now().timestamp(),
    })
    .await
    {
        Ok(_) => log::debug!("Cached device: {}", evt.name),
        Err(e) => log::warn!("Failed to cache device: {}", e),
    }
}

type DiscoveryResult = Result<Vec<RokuDeviceEvent>, String>;

/// The most recent cycle's result, guarded so only one cycle runs at a time.
static DISCOVERY_RUN: Lazy<tokio::sync::Mutex<Option<DiscoveryResult>>> =
    Lazy::new(|| tokio::sync::Mutex::new(None));

/// Bumped (while holding `DISCOVERY_RUN`) each time a cycle finishes.
static DISCOVERY_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Runs a discovery cycle, or waits for the one already running and returns its result.
///
/// On desktop the `setup` hook and the frontend's first scan both start discovery at launch.
/// Two overlapping M-SEARCHes compete for the same replies, and a Roku may answer only one of
/// them in time, so the frontend got a partial list and marked the missing devices offline.
pub async fn run_discovery_once(app: &AppHandle) -> DiscoveryResult {
    let generation_before_wait = DISCOVERY_GENERATION.load(Ordering::SeqCst);
    let mut last_result = DISCOVERY_RUN.lock().await;
    if DISCOVERY_GENERATION.load(Ordering::SeqCst) != generation_before_wait {
        if let Some(result) = last_result.as_ref() {
            log::info!("Discovery cycle finished while waiting; sharing its result");
            return result.clone();
        }
    }

    let result = run_discovery_cycle(app).await;
    *last_result = Some(result.clone());
    DISCOVERY_GENERATION.fetch_add(1, Ordering::SeqCst);
    result
}

/// Run a single discovery cycle, collecting ALL devices found
async fn run_discovery_cycle(app: &AppHandle) -> DiscoveryResult {
    let search_target = SearchTarget::Custom("roku".into(), "ecp".into());
    let _ = app.emit("discovery_cycle_start", ());

    log::info!("Starting SSDP discovery for Roku devices");
    log::info!("Search target: {:?}", search_target);

    #[cfg(target_os = "android")]
    let search_timeout = Duration::from_secs(10);
    #[cfg(not(target_os = "android"))]
    let search_timeout = Duration::from_secs(5);

    log::info!("Using search timeout: {:?}", search_timeout);

    // A failed SSDP start (no multicast route, socket error) still gets the subnet sweep below.
    let mut ssdp_error = None;
    let mut responses = match search(&search_target, search_timeout, SSDP_MX, Some(4)).await {
        Ok(s) => {
            log::info!("SSDP search initiated successfully");
            Some(s)
        }
        Err(e) => {
            log::error!("SSDP search initialization error: {}", e);
            ssdp_error = Some(e);
            None
        }
    };

    let mut discovered_devices: Vec<RokuDeviceEvent> = Vec::new();
    let mut seen_hardware_ids: HashSet<String> = HashSet::new();
    let mut seen_endpoints: HashSet<(String, u16)> = HashSet::new();
    let mut response_count = 0;
    let mut next_wait_window = SSDP_INITIAL_WAIT;

    log::info!("Waiting for SSDP responses...");

    while let Some(responses) = responses.as_mut() {
        let next_item = tokio::time::timeout(next_wait_window, responses.next()).await;
        let resp_res = match next_item {
            Ok(Some(item)) => item,
            Ok(None) => {
                log::info!("SSDP response stream ended");
                break;
            }
            Err(_) => {
                log::info!(
                    "No SSDP responses for {:?}; ending this discovery cycle",
                    next_wait_window
                );
                break;
            }
        };

        response_count += 1;
        log::info!("Processing SSDP response #{}", response_count);
        
        let resp = match resp_res {
            Ok(r) => {
                log::info!("Got valid SSDP response: ST={:?}, Location={}", 
                         r.search_target(), r.location());
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

        let ip = desc_url.host_str().unwrap_or_default().to_string();
        let port = desc_url.port_or_known_default().unwrap_or(8060);

        if ip.is_empty() {
            log::warn!("SSDP response had empty host in LOCATION '{}'", resp.location());
            continue;
        }

        if !seen_endpoints.insert((ip.clone(), port)) {
            log::debug!("Skipping duplicate SSDP endpoint response for {}:{}", ip, port);
            continue;
        }

        log::info!("Fetching device info from: {}:{}", ip, port);

        match extract_device_info(&ip, port).await {
            Ok(details) => {
                let hardware_id = generate_hardware_id(&details);
                
                // Skip duplicates within this cycle
                if seen_hardware_ids.contains(&hardware_id) {
                    log::info!("Skipping duplicate device with hardware_id: {}", hardware_id);
                    continue;
                }
                
                seen_hardware_ids.insert(hardware_id.clone());
                
                let evt = RokuDeviceEvent {
                    name: details.friendly_name,
                    ip: ip.clone(),
                    port,
                    url: desc_url.origin().ascii_serialization(),
                    hardware_id: hardware_id.clone(),
                };
                
                log::info!("Discovered Roku device: '{}' at {}:{} (hw_id: {})", 
                         evt.name, evt.ip, evt.port, evt.hardware_id);
                
                discovered_devices.push(evt.clone());
                record_discovered(app, &evt).await;
            }
            Err(e) => {
                log::warn!("Failed to get device info for {}:{}: {}", ip, port, e);
            }
        }

        // After first response, keep a short quiet window to gather additional devices.
        next_wait_window = SSDP_FOLLOWUP_WAIT;
    }

    log::info!("SSDP discovery complete. Found {} unique devices from {} responses", 
              discovered_devices.len(), response_count);

    // If SSDP found nothing, try subnet scan fallback
    if discovered_devices.is_empty() && response_count == 0 {
        log::warn!("No SSDP responses received - trying subnet scan fallback");
        
        if let Ok(fallback_devices) = scan_network_for_roku().await {
            for device in fallback_devices {
                if !seen_hardware_ids.contains(&device.hardware_id) {
                    seen_hardware_ids.insert(device.hardware_id.clone());
                    
                    let evt = RokuDeviceEvent {
                        name: device.name,
                        ip: device.ip,
                        port: device.port,
                        url: device.url,
                        hardware_id: device.hardware_id.clone(),
                    };
                    
                    discovered_devices.push(evt.clone());
                    record_discovered(app, &evt).await;
                }
            }
        }
    }

    // Determine devices that have gone missing (by hardware ID)
    let stale_after = Duration::from_secs(60);
    let mut lost_hardware_ids: Vec<String> = vec![];
    {
        let map = last_seen();
        for (hw_id, (_device, last)) in map.iter() {
            if last.elapsed() > stale_after && !seen_hardware_ids.contains(hw_id) {
                lost_hardware_ids.push(hw_id.clone());
            }
        }
    }
    
    if !lost_hardware_ids.is_empty() {
        log::info!("Marking {} devices as lost", lost_hardware_ids.len());
        let mut map = last_seen();
        for hw_id in lost_hardware_ids {
            if let Some((device, _)) = map.remove(&hw_id) {
                let _ = app.emit("device_lost", &device);
            }
        }
    }

    let _ = app.emit("discovery_cycle_end", &discovered_devices);

    // The search never left this machine and the sweep reached nothing either: say so, rather
    // than "no devices found", which sends the user to check their Roku instead.
    if discovered_devices.is_empty() {
        if let Some(e) = ssdp_error {
            log::error!("Local network unreachable: {}", e);
            return Err(LAN_UNREACHABLE_MESSAGE.to_string());
        }
    }

    Ok(discovered_devices)
}

pub fn start_background_discovery(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
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
