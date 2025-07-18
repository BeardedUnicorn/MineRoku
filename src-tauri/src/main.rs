// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;
use roku_controller_lib::commands::{
    RokuDevice,
    RokuApp,
    discover_roku_devices_impl,
    list_roku_apps_impl,
    send_roku_command_impl,
    launch_roku_app_impl,
};
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
    command: String
) -> Result<String, String> {
    send_roku_command_impl(ip, port, command).await
}

#[command]
async fn launch_roku_app(
    ip: String,
    port: u16,
    app_id: String
) -> Result<String, String> {
    launch_roku_app_impl(ip, port, app_id).await
}

fn main() {
    tauri::Builder::default()
        .plugin(opener())
        .invoke_handler(tauri::generate_handler![
            discover_roku_devices,
            list_roku_apps,
            send_roku_command,
            launch_roku_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
