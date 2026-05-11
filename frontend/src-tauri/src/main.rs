// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::io::{Write, Read, BufRead, BufReader};
use std::time::Duration;

/// Send a raw SCPI command to ITECH PV6000 via TCP socket
/// Device: 192.168.200.100:30000
#[tauri::command]
fn scpi_command(command: String) -> Result<String, String> {
    let addr = "192.168.200.100:30000";
    let mut stream = TcpStream::connect(addr)
        .map_err(|e| format!("Connection failed to {}: {}", addr, e))?;
    
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok();
    
    let msg = format!("{}\n", command);
    stream.write_all(msg.as_bytes())
        .map_err(|e| format!("Write error: {}", e))?;
    
    // Only read response for query commands (ending with ?)
    if command.trim_end().ends_with('?') {
        let mut reader = BufReader::new(&stream);
        let mut response = String::new();
        reader.read_line(&mut response)
            .map_err(|e| format!("Read error: {}", e))?;
        Ok(response.trim().to_string())
    } else {
        Ok("OK".to_string())
    }
}

#[tauri::command]
fn get_device_identity() -> Result<String, String> {
    scpi_command("*IDN?".to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![scpi_command, get_device_identity])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
