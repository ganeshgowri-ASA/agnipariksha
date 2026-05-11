#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod scpi_tcp;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            scpi_tcp::scpi_connect,
            scpi_tcp::scpi_send,
            scpi_tcp::scpi_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Agnipariksha");
}
