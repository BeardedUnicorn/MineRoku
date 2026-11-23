#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Desktop entry point. Mobile builds enter through `roku_controller_lib::run` directly, which is
// where Android logging is set up.
fn main() {
    env_logger::init();
    roku_controller_lib::run();
}
