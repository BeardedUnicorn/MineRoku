// src-tauri/src/lib.rs

// Make all functions and structs public
pub mod commands;

#[cfg(desktop)]
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::{image::Image, AppHandle, Manager};

use commands::{
    discover_roku_devices_impl, get_active_app_impl, get_app_icon_impl, launch_roku_app_impl,
    list_roku_apps_impl, open_popup_window_impl, send_roku_command_impl, ActiveAppInfo, RokuApp,
    RokuDevice,
};

use tauri::command;
use tauri_plugin_opener::init as opener;

#[command]
async fn discover_roku_devices() -> Result<Vec<RokuDevice>, String> {
    discover_roku_devices_impl().await
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

#[command]
fn open_popup_window(app: tauri::AppHandle) -> Result<(), String> {
    open_popup_window_impl(&app)
}

#[cfg(desktop)]
fn handle_tray_event(app: &AppHandle, event: TrayIconEvent) {
    if let TrayIconEvent::Click { button, .. } = event {
        if button == tauri::tray::MouseButton::Left {
            if let Some(main) = app.get_webview_window("main") {
                main.show().unwrap();
                main.set_focus().unwrap();
            }
        }
    }
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
            open_popup_window
        ]);

    #[cfg(desktop)]
    let builder = builder
        .setup(|app| {
            let icon = Image::from_bytes(include_bytes!("../../app-logo.png")).unwrap();
            TrayIconBuilder::new().icon(icon).build(app)?;
            Ok(())
        })
        .on_tray_icon_event(handle_tray_event);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
