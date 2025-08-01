// src-tauri/src/lib.rs

// Make all functions and structs public
pub mod commands;

#[cfg(desktop)]
use tauri::tray::TrayIconEvent;
#[cfg(desktop)]
use tauri::{AppHandle, Manager, PhysicalPosition, WindowEvent};

use commands::{
    discover_roku_devices_impl, get_active_app_impl, launch_roku_app_impl, list_roku_apps_impl,
    send_roku_command_impl, ActiveAppInfo, RokuApp, RokuDevice, get_app_icon_impl
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
async fn send_roku_command(
    ip: String,
    port: u16,
    command: String,
) -> Result<String, String> {
    send_roku_command_impl(ip, port, command).await
}

#[command]
async fn launch_roku_app(
    ip: String,
    port: u16,
    app_id: String,
) -> Result<String, String> {
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

#[cfg(desktop)]
fn handle_tray_event(app: &AppHandle, event: TrayIconEvent) {
    if let Some(popup) = app.get_webview_window("remote_popup") {
        match event {
            TrayIconEvent::Click {
                button, position, ..
            } => {
                if button == tauri::tray::MouseButton::Left {
                    if popup.is_visible().unwrap_or(false) {
                        popup.hide().unwrap();
                    } else {
                        let window_size = popup.outer_size().unwrap();
                        let physical_pos = PhysicalPosition {
                            x: position.x as i32 - (window_size.width / 2) as i32,
                            y: position.y as i32 - window_size.height as i32,
                        };
                        popup.set_position(physical_pos).unwrap();
                        popup.show().unwrap();
                        popup.set_focus().unwrap();
                    }
                }
            }
            _ => {}
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
            get_app_icon
        ]);

    #[cfg(desktop)]
    let builder = builder
        .on_tray_icon_event(handle_tray_event)
        .on_window_event(|window, event| {
            if let WindowEvent::Focused(false) = event {
                if window.label() == "remote_popup" {
                    window.hide().unwrap();
                }
            }
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}