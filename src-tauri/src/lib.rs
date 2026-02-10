pub mod commands;
pub mod background;
pub mod background_discovery;

#[cfg(desktop)]
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::AppHandle;
use tauri::Manager;

use commands::{
    discover_roku_devices_impl, get_active_app_impl, get_app_icon_impl, launch_roku_app_impl,
    list_roku_apps_impl, send_roku_command_impl, test_network_connectivity, 
    ActiveAppInfo, RokuApp, get_media_player_impl, MediaPlayerInfo, RokuDevice,
    check_device_connectivity_impl,
};

use tauri::command;
use tauri_plugin_opener::init as opener;
use background_discovery::start_background_discovery;
use background::init_background_tasks;

#[command]
async fn discover_roku_devices(app: tauri::AppHandle) -> Result<Vec<RokuDevice>, String> {
    discover_roku_devices_impl(&app).await
}

#[command]
async fn check_device_connectivity(ip: String, port: u16) -> Result<bool, String> {
    check_device_connectivity_impl(ip, port).await
}

#[command]
async fn get_media_player(ip: String, port: u16) -> Result<MediaPlayerInfo, String> {
    get_media_player_impl(ip, port).await
}

#[command]
async fn list_roku_apps(ip: String, port: u16) -> Result<Vec<RokuApp>, String> {
    list_roku_apps_impl(ip, port).await
}

#[command]
async fn send_roku_command(ip: String, port: u16, command: String) -> Result<String, String> {
    send_roku_command_impl(ip, port, command).await
}

#[command]
async fn launch_roku_app(ip: String, port: u16, app_id: String) -> Result<String, String> {
    launch_roku_app_impl(ip, port, app_id).await
}

#[command]
async fn get_active_app(ip: String, port: u16) -> Result<ActiveAppInfo, String> {
    get_active_app_impl(ip, port).await
}

#[command]
async fn get_app_icon(ip: String, port: u16, app_id: String) -> Result<String, String> {
    get_app_icon_impl(ip, port, app_id).await
}

#[cfg(target_os = "android")]
#[command]
fn update_media_notification(
    _app: tauri::AppHandle,
    device_name: String,
    device_ip: String,
    device_port: u16,
    app_name: String,
    is_playing: bool,
    app_icon_url: Option<String>,
) -> Result<(), String> {
    use jni::objects::{JObject, JValue};
    use jni::JavaVM;
    
    let context = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    
    let j_device_name = env.new_string(&device_name).map_err(|e| e.to_string())?;
    let j_device_ip = env.new_string(&device_ip).map_err(|e| e.to_string())?;
    let j_app_name = env.new_string(&app_name).map_err(|e| e.to_string())?;
    let j_app_icon_url = if let Some(ref url) = app_icon_url {
        env.new_string(url).map_err(|e| e.to_string())?
    } else {
        env.new_string("").map_err(|e| e.to_string())?
    };
    
    let activity_obj = unsafe { JObject::from_raw(context.context() as jni::sys::jobject) };
    
    env.call_method(
        activity_obj,
        "updateMediaSession",
        "(Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;ZLjava/lang/String;)V",
        &[
            JValue::Object(&j_device_name),
            JValue::Object(&j_device_ip),
            JValue::Int(device_port as i32),
            JValue::Object(&j_app_name),
            JValue::Bool(if is_playing { 1 } else { 0 }),
            JValue::Object(&j_app_icon_url),
        ],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[command]
fn update_media_notification(
    _device_name: String,
    _device_ip: String,
    _device_port: u16,
    _app_name: String,
    _is_playing: bool,
    _app_icon_url: Option<String>,
) -> Result<(), String> {
    Ok(())
}

#[cfg(desktop)]
fn handle_tray_event(app: &AppHandle, event: TrayIconEvent) {
    if let TrayIconEvent::Click { button, .. } = event {
        if button == tauri::tray::MouseButton::Left {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
        }
    }
}

#[tauri::command]
async fn get_cached_devices() -> Result<Vec<RokuDevice>, String> {
    let cached = background::get_devices_bg().await?;
    Ok(cached
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

#[tauri::command]
async fn get_cached_apps(ip: String) -> Result<Vec<RokuApp>, String> {
    let cached = background::get_apps_bg(ip).await?;
    Ok(cached
        .into_iter()
        .map(|a| RokuApp { id: a.id, name: a.name, version: a.version })
        .collect())
}

#[tauri::command]
async fn clear_all_data() -> Result<(), String> {
    background::clear_all_data_bg().await
}

#[tauri::command]
async fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(opener())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            discover_roku_devices,
            list_roku_apps,
            send_roku_command,
            launch_roku_app,
            get_active_app,
            get_app_icon,
            get_media_player,
            test_network_connectivity,
            get_cached_devices,
            get_cached_apps,
            clear_all_data,
            restart_app,
            update_media_notification,
            check_device_connectivity
        ]);

    #[cfg(desktop)]
    let builder = builder
        .setup(|app| {
            let db_path = match app.path().app_data_dir() {
                Ok(p) => {
                    if let Err(e) = std::fs::create_dir_all(&p) {
                        eprintln!("Failed to create app data dir: {}", e);
                    }
                    p.join("roku_cache.db")
                }
                Err(e) => {
                    eprintln!("Failed to get app data dir: {}", e);
                    app.path()
                        .app_cache_dir()
                        .map(|p| p.join("roku_cache.db"))
                        .unwrap_or_else(|_| std::path::PathBuf::from("roku_cache.db"))
                }
            };
            if let Some(parent) = db_path.parent() { 
                let _ = std::fs::create_dir_all(parent); 
            }
            if let Err(e) = init_background_tasks(db_path.to_string_lossy().to_string()) {
                eprintln!("Failed to init cache DB: {}", e);
            }

            start_background_discovery(app.app_handle().clone());
            TrayIconBuilder::new().build(app)?;
            Ok(())
        })
        .on_tray_icon_event(handle_tray_event);

    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.setup(|app| {
        let db_path = app
            .path()
            .app_data_dir()
            .map(|p| p.join("roku_cache.db"))
            .unwrap_or_else(|_| std::path::PathBuf::from("roku_cache.db"));
        if let Some(parent) = db_path.parent() { 
            let _ = std::fs::create_dir_all(parent); 
        }
        if let Err(e) = init_background_tasks(db_path.to_string_lossy().to_string()) {
            eprintln!("Failed to init cache DB: {}", e);
        }
        start_background_discovery(app.app_handle().clone());
        Ok(())
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
