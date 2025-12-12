#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Initialize Android logging
    #[cfg(target_os = "android")]
    {
        android_logger::init_once(
            android_logger::Config::default()
                .with_max_level(log::LevelFilter::Debug)
                .with_tag("RokuRust"),
        );
        log::info!("Android logger initialized");
    }
    
    #[cfg(not(target_os = "android"))]
    env_logger::init();
    
    roku_controller_lib::run();
}