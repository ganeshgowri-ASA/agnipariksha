// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::time::Duration;

/// Open a raw TCP socket to a SCPI instrument (ITECH PV6000) and send a
/// single command. Used as a fallback path from the Next.js UI when the
/// FastAPI backend is offline.
///
/// - `cmd`: SCPI command string (e.g. `"*IDN?"`, `"VOLT 48"`).
/// - `ip`: Instrument IP (e.g. `"192.168.200.100"`).
/// - `port`: Instrument SCPI port (e.g. `30000`).
///
/// Returns the trimmed response for queries (commands ending in `?`),
/// or `"OK"` for set/write commands.
#[tauri::command]
fn scpi_send(cmd: String, ip: String, port: u16) -> Result<String, String> {
    let addr = format!("{}:{}", ip, port);
    let stream = TcpStream::connect_timeout(
        &addr
            .parse()
            .map_err(|e| format!("Invalid address {}: {}", addr, e))?,
        Duration::from_secs(3),
    )
    .map_err(|e| format!("Connection failed to {}: {}", addr, e))?;

    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok();

    let trimmed = cmd.trim_end();
    let payload = format!("{}\n", trimmed);
    (&stream)
        .write_all(payload.as_bytes())
        .map_err(|e| format!("Write error: {}", e))?;

    if trimmed.ends_with('?') {
        let mut reader = BufReader::new(&stream);
        let mut response = String::new();
        reader
            .read_line(&mut response)
            .map_err(|e| format!("Read error: {}", e))?;
        Ok(response.trim().to_string())
    } else {
        Ok("OK".to_string())
    }
}

/// Convenience wrapper: `*IDN?` against the configured instrument.
#[tauri::command]
fn get_device_identity(ip: String, port: u16) -> Result<String, String> {
    scpi_send("*IDN?".to_string(), ip, port)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![scpi_send, get_device_identity])
        .run(tauri::generate_context!())
        .expect("error while running Agnipariksha");
}
