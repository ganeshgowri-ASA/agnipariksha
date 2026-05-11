//! Native TCP SCPI driver for ITECH IT6000C
//! Handles raw socket communication from the Tauri desktop app

use std::net::TcpStream;
use std::io::{Write, BufRead, BufReader};
use std::time::Duration;
use std::sync::Mutex;
use tauri::State;

pub struct ScpiState(pub Mutex<Option<TcpStream>>);

#[tauri::command]
pub fn scpi_connect(
    host: String,
    port: u16,
    state: State<ScpiState>,
) -> Result<String, String> {
    let addr = format!("{}:{}", host, port);
    match TcpStream::connect(&addr) {
        Ok(stream) => {
            stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
            stream.set_write_timeout(Some(Duration::from_secs(5))).ok();
            let mut conn = state.0.lock().unwrap();
            *conn = Some(stream);
            Ok(format!("Connected to {}", addr))
        }
        Err(e) => Err(format!("Connection failed: {}", e))
    }
}

#[tauri::command]
pub fn scpi_send(
    command: String,
    state: State<ScpiState>,
) -> Result<String, String> {
    let mut conn = state.0.lock().unwrap();
    if let Some(ref mut stream) = *conn {
        let cmd = format!("{}\n", command);
        stream.write_all(cmd.as_bytes())
            .map_err(|e| format!("Write error: {}", e))?;
        
        if command.contains('?') {
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut response = String::new();
            reader.read_line(&mut response)
                .map_err(|e| format!("Read error: {}", e))?;
            Ok(response.trim().to_string())
        } else {
            Ok("OK".to_string())
        }
    } else {
        Err("Not connected".to_string())
    }
}

#[tauri::command]
pub fn scpi_disconnect(state: State<ScpiState>) -> Result<(), String> {
    let mut conn = state.0.lock().unwrap();
    // Send output off before disconnecting
    if let Some(ref mut stream) = *conn {
        let _ = stream.write_all(b"OUTP OFF\n");
    }
    *conn = None;
    Ok(())
}
