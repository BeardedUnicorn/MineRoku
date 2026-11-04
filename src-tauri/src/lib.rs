pub mod background;
pub mod background_discovery;
pub mod commands;

#[cfg(desktop)]
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::AppHandle;
use tauri::Manager;

use commands::{
    check_device_connectivity_impl, discover_roku_devices_impl, get_active_app_impl,
    get_app_icon_impl, get_media_player_impl, launch_roku_app_impl, list_roku_apps_impl,
    send_roku_command_impl, test_network_connectivity, ActiveAppInfo, MediaPlayerInfo, RokuApp,
    RokuDevice,
};

use background::init_background_tasks;
#[cfg(not(target_os = "android"))]
use background_discovery::start_background_discovery;
use tauri::command;
use tauri_plugin_opener::init as opener;

#[cfg(target_os = "android")]
mod android {
    use super::{get_app_icon_impl, send_roku_command_impl};
    use jni::errors::LogErrorAndDefault;
    use jni::objects::{JClass, JObject, JString};
    use jni::refs::Global;
    use jni::sys::{jboolean, jint};
    use jni::{jni_sig, jni_str, Env, EnvUnowned, JValue, JavaVM};
    use std::sync::{Arc, Mutex};

    /// The live `MainActivity`, registered by the activity itself. `ndk_context` can't supply it:
    /// since tao 0.37 it holds the Application context, which doesn't have the activity's methods.
    static CURRENT_ACTIVITY: Mutex<Option<Arc<Global<JObject<'static>>>>> = Mutex::new(None);

    fn with_activity<R>(
        f: impl FnOnce(&mut Env<'_>, &JObject<'_>) -> jni::errors::Result<R>,
    ) -> Result<R, String> {
        let activity = CURRENT_ACTIVITY
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or_else(|| "Android activity is not available".to_string())?;
        let context = ndk_context::android_context();
        let vm = unsafe { JavaVM::from_raw(context.vm().cast()) };
        vm.attach_current_thread(|env| f(env, activity.as_obj()))
            .map_err(|e: jni::errors::Error| e.to_string())
    }

    #[no_mangle]
    pub extern "system" fn Java_com_rokucontroller_remote_MainActivity_nativeOnActivityCreated<
        'caller,
    >(
        mut unowned_env: EnvUnowned<'caller>,
        activity: JObject<'caller>,
    ) {
        unowned_env
            .with_env(|env| -> jni::errors::Result<()> {
                let activity = env.new_global_ref(&activity)?;
                *CURRENT_ACTIVITY.lock().unwrap_or_else(|e| e.into_inner()) =
                    Some(Arc::new(activity));
                Ok(())
            })
            .resolve::<LogErrorAndDefault>()
    }

    #[no_mangle]
    pub extern "system" fn Java_com_rokucontroller_remote_MainActivity_nativeOnActivityDestroyed<
        'caller,
    >(
        mut unowned_env: EnvUnowned<'caller>,
        activity: JObject<'caller>,
    ) {
        unowned_env
            .with_env(|env| -> jni::errors::Result<()> {
                let mut current = CURRENT_ACTIVITY.lock().unwrap_or_else(|e| e.into_inner());
                // A replacement activity can be created before the old one is destroyed.
                let is_current = match current.as_ref() {
                    Some(held) => env.is_same_object(held.as_obj(), &activity)?,
                    None => false,
                };
                if is_current {
                    *current = None;
                }
                Ok(())
            })
            .resolve::<LogErrorAndDefault>()
    }

    pub(super) fn ensure_discovery_permissions() -> Result<bool, String> {
        with_activity(|env, activity| {
            env.call_method(
                activity,
                jni_str!("ensureDiscoveryPermissions"),
                jni_sig!("()Z"),
                &[],
            )?
            .z()
        })
    }

    pub(super) fn ensure_notification_permission() -> Result<bool, String> {
        with_activity(|env, activity| {
            env.call_method(
                activity,
                jni_str!("ensureNotificationPermission"),
                jni_sig!("()Z"),
                &[],
            )?
            .z()
        })
    }

    pub(super) fn acquire_discovery_locks() -> Result<(), String> {
        with_activity(|env, activity| {
            env.call_method(
                activity,
                jni_str!("acquireDiscoveryLocks"),
                jni_sig!("()V"),
                &[],
            )?;
            Ok(())
        })
    }

    pub(super) fn release_discovery_locks() -> Result<(), String> {
        with_activity(|env, activity| {
            env.call_method(
                activity,
                jni_str!("releaseDiscoveryLocks"),
                jni_sig!("()V"),
                &[],
            )?;
            Ok(())
        })
    }

    pub(super) fn update_media_notification(
        device_name: String,
        device_ip: String,
        device_port: u16,
        app_name: String,
        app_id: Option<String>,
        is_playing: bool,
    ) -> Result<(), String> {
        with_activity(|env, activity| {
            let j_device_name = env.new_string(&device_name)?;
            let j_device_ip = env.new_string(&device_ip)?;
            let j_app_name = env.new_string(&app_name)?;
            let j_app_id = env.new_string(app_id.as_deref().unwrap_or(""))?;

            env.call_method(
                activity,
                jni_str!("updateMediaSession"),
                jni_sig!("(Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;Ljava/lang/String;Z)V"),
                &[
                    JValue::Object(&j_device_name),
                    JValue::Object(&j_device_ip),
                    JValue::Int(device_port as i32),
                    JValue::Object(&j_app_name),
                    JValue::Object(&j_app_id),
                    JValue::Bool(is_playing),
                ],
            )?;

            Ok(())
        })
    }

    pub(super) fn hide_media_notification() -> Result<(), String> {
        with_activity(|env, activity| {
            env.call_method(
                activity,
                jni_str!("hideMediaNotification"),
                jni_sig!("()V"),
                &[],
            )?;
            Ok(())
        })
    }

    pub(super) fn open_app_settings() -> Result<(), String> {
        with_activity(|env, activity| {
            let package_name = env
                .call_method(
                    activity,
                    jni_str!("getPackageName"),
                    jni_sig!("()Ljava/lang/String;"),
                    &[],
                )?
                .l()?;
            let package_name = env
                .cast_local::<JString>(package_name)?
                .try_to_string(env)?;

            let action = env.new_string("android.settings.APPLICATION_DETAILS_SETTINGS")?;
            let intent = env.new_object(
                jni_str!("android/content/Intent"),
                jni_sig!("(Ljava/lang/String;)V"),
                &[JValue::Object(&action)],
            )?;

            let package_uri_value = env.new_string(format!("package:{package_name}"))?;
            let uri = env
                .call_static_method(
                    jni_str!("android/net/Uri"),
                    jni_str!("parse"),
                    jni_sig!("(Ljava/lang/String;)Landroid/net/Uri;"),
                    &[JValue::Object(&package_uri_value)],
                )?
                .l()?;

            env.call_method(
                &intent,
                jni_str!("setData"),
                jni_sig!("(Landroid/net/Uri;)Landroid/content/Intent;"),
                &[JValue::Object(&uri)],
            )?;

            env.call_method(
                activity,
                jni_str!("startActivity"),
                jni_sig!("(Landroid/content/Intent;)V"),
                &[JValue::Object(&intent)],
            )?;

            Ok(())
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_rokucontroller_remote_MediaSessionManager_nativeSendRokuCommand<
        'caller,
    >(
        mut unowned_env: EnvUnowned<'caller>,
        _class: JClass<'caller>,
        ip: JString<'caller>,
        port: jint,
        command: JString<'caller>,
    ) -> jboolean {
        unowned_env
            .with_env(|env| -> jni::errors::Result<jboolean> {
                let ip = ip.try_to_string(env)?;
                let command = command.try_to_string(env)?;

                let send_result = tauri::async_runtime::block_on(send_roku_command_impl(
                    ip,
                    port as u16,
                    command,
                ));

                Ok(send_result.is_ok())
            })
            .resolve::<LogErrorAndDefault>()
    }

    #[no_mangle]
    pub extern "system" fn Java_com_rokucontroller_remote_MediaSessionManager_nativeGetAppIconDataUrl<
        'caller,
    >(
        mut unowned_env: EnvUnowned<'caller>,
        _class: JClass<'caller>,
        ip: JString<'caller>,
        port: jint,
        app_id: JString<'caller>,
    ) -> JString<'caller> {
        unowned_env
            .with_env(|env| -> jni::errors::Result<JString<'caller>> {
                let ip = ip.try_to_string(env)?;
                let app_id = app_id.try_to_string(env)?;

                let data_url =
                    tauri::async_runtime::block_on(get_app_icon_impl(ip, port as u16, app_id))
                        .unwrap_or_default();

                env.new_string(data_url)
            })
            .resolve::<LogErrorAndDefault>()
    }
}

#[command]
async fn discover_roku_devices(app: tauri::AppHandle) -> Result<Vec<RokuDevice>, String> {
    #[cfg(target_os = "android")]
    {
        let has_permissions = android::ensure_discovery_permissions()?;
        if !has_permissions {
            return Err(
                "Discovery permissions are required. Grant permission and scan again.".to_string(),
            );
        }

        if let Err(e) = android::acquire_discovery_locks() {
            log::warn!("Failed to acquire Android discovery locks: {e}");
        }

        let result = discover_roku_devices_impl(&app).await;

        if let Err(e) = android::release_discovery_locks() {
            log::warn!("Failed to release Android discovery locks: {e}");
        }

        return result;
    }

    #[cfg(not(target_os = "android"))]
    {
        discover_roku_devices_impl(&app).await
    }
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
fn ensure_android_discovery_permissions() -> Result<bool, String> {
    android::ensure_discovery_permissions()
}

#[cfg(not(target_os = "android"))]
#[command]
fn ensure_android_discovery_permissions() -> Result<bool, String> {
    Ok(true)
}

#[cfg(target_os = "android")]
#[command]
fn ensure_android_notification_permission() -> Result<bool, String> {
    android::ensure_notification_permission()
}

#[cfg(not(target_os = "android"))]
#[command]
fn ensure_android_notification_permission() -> Result<bool, String> {
    Ok(true)
}

#[cfg(target_os = "android")]
#[command]
fn open_android_app_settings() -> Result<(), String> {
    android::open_app_settings()
}

#[cfg(not(target_os = "android"))]
#[command]
fn open_android_app_settings() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "android")]
#[command]
fn update_media_notification(
    _app: tauri::AppHandle,
    device_name: String,
    device_ip: String,
    device_port: u16,
    app_name: String,
    app_id: Option<String>,
    is_playing: bool,
) -> Result<(), String> {
    android::update_media_notification(
        device_name,
        device_ip,
        device_port,
        app_name,
        app_id,
        is_playing,
    )
}

#[cfg(not(target_os = "android"))]
#[command]
fn update_media_notification(
    _device_name: String,
    _device_ip: String,
    _device_port: u16,
    _app_name: String,
    _app_id: Option<String>,
    _is_playing: bool,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "android")]
#[command]
fn hide_media_notification() -> Result<(), String> {
    android::hide_media_notification()
}

#[cfg(not(target_os = "android"))]
#[command]
fn hide_media_notification() -> Result<(), String> {
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
        .map(|a| RokuApp {
            id: a.id,
            name: a.name,
            version: a.version,
        })
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
            ensure_android_discovery_permissions,
            ensure_android_notification_permission,
            open_android_app_settings,
            update_media_notification,
            hide_media_notification,
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

        #[cfg(not(target_os = "android"))]
        start_background_discovery(app.app_handle().clone());

        #[cfg(target_os = "android")]
        log::info!(
            "Android startup: automatic discovery disabled; waiting for user-triggered scan"
        );

        Ok(())
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
