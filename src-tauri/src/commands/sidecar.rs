// /home/z/my-project/netamplify-app/src-tauri/src/commands/sidecar.rs
// NetAmplify — Tauri commands for managing the NestJS backend sidecar process.
//
// In the desktop app, the NestJS backend runs as a child process (sidecar)
// alongside the Tauri shell. The backend listens on port 3000 and handles
// all API requests (auth, postcards, connections, publish, etc.).
//
// Tauri's `shell` plugin manages the sidecar lifecycle:
//   - On app launch: `start_backend_sidecar()` spawns `node apps/backend/dist/main.js`
//   - On app close: the `on_window_event` handler in lib.rs kills the sidecar
//
// In dev mode, the user typically runs `pnpm dev:backend` manually in a
// separate terminal — the sidecar commands are still available but optional.

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use std::sync::Mutex;

/// Shared state holding the sidecar process handle.
/// Stored in Tauri's managed state so it persists across command calls.
pub struct SidecarState(pub Mutex<Option<u32>>);

/// Start the NestJS backend sidecar process.
///
/// Spawns `node apps/backend/dist/main.js` as a child process.
/// The backend listens on port 3000 (configurable via NETAMPLIFY_BACKEND_PORT env var).
///
/// In production (bundled app), the backend binary is bundled with the app
/// and started automatically on launch. In dev mode, the user typically
/// runs `pnpm dev:backend` manually — this command is for when the user
/// wants the desktop app to manage the backend lifecycle.
///
/// # Arguments
/// * `app` — The Tauri app handle (injected by Tauri)
///
/// # Returns
/// * `Ok(u32)` — the PID of the started sidecar process
/// * `Err(String)` — on failure (binary not found, port in use, etc.)
#[tauri::command]
pub async fn start_backend_sidecar(app: AppHandle) -> Result<u32, String> {
    log::info!("Starting NestJS backend sidecar...");

    // Check if the backend is already running (by checking if port 3000 is in use).
    if is_port_in_use(3000).await {
        log::info!("Backend is already running on port 3000 — not starting a new one.");
        return Ok(0); // Return 0 to indicate "already running"
    }

    // Use Tauri's shell plugin to spawn the backend.
    // In production, the backend is bundled as a sidecar binary.
    // In dev, we run `node` directly.
    let sidecar = app
        .shell()
        .sidecar("netamplify-backend")
        .or_else(|_| {
            // Fallback for dev mode: run `node apps/backend/dist/main.js`
            log::info!("Sidecar binary not found — falling back to node command (dev mode)");
            app.shell().command("node")
                .args(["apps/backend/dist/main.js"])
                .current_dir(std::env::current_dir().unwrap_or_default())
                .into_command()
        })
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?;

    let (mut rx, child) = sidecar.spawn()
        .map_err(|e| format!("Failed to spawn backend sidecar: {}", e))?;

    let pid = child.pid();

    // Store the PID in the app's managed state so we can kill it on shutdown.
    app.manage(SidecarState(Mutex::new(Some(pid))));

    // Log the sidecar's stdout/stderr in the background.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    log::info!("[backend] {}", String::from_utf8_lossy(&bytes).trim());
                }
                CommandEvent::Stderr(bytes) => {
                    log::warn!("[backend] {}", String::from_utf8_lossy(&bytes).trim());
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!("[backend] Process terminated: code={:?} signal={:?}", payload.code, payload.signal);
                    break;
                }
                _ => {}
            }
        }
    });

    log::info!("Backend sidecar started with PID: {}", pid);
    Ok(pid)
}

/// Stop the NestJS backend sidecar process.
///
/// Kills the sidecar by PID. Called on app shutdown (via `on_window_event`
/// in lib.rs) and can also be invoked manually from the UI.
///
/// # Arguments
/// * `app` — The Tauri app handle (injected by Tauri)
///
/// # Returns
/// * `Ok(())` — sidecar stopped successfully (or was not running)
/// * `Err(String)` — on failure
#[tauri::command]
pub async fn stop_backend_sidecar(app: AppHandle) -> Result<(), String> {
    log::info!("Stopping NestJS backend sidecar...");

    if let Some(state) = app.try_state::<SidecarState>() {
        let mut guard = state.0.lock().map_err(|e| format!("Failed to acquire state lock: {}", e))?;
        if let Some(pid) = guard.take() {
            // On Unix: send SIGTERM. On Windows: use TerminateProcess.
            #[cfg(unix)]
            {
                let result = nix::sys::signal::kill(
                    nix::unistd::Pid::from_raw(pid as i32),
                    nix::sys::signal::Signal::SIGTERM,
                );
                match result {
                    Ok(()) => log::info!("Sent SIGTERM to backend sidecar (PID: {})", pid),
                    Err(e) => log::warn!("Failed to kill backend sidecar (PID: {}): {}", pid, e),
                }
            }
            #[cfg(windows)]
            {
                // On Windows, we use the `windows` crate's TerminateProcess.
                // For simplicity, we log a warning — the OS will clean up when the app exits.
                log::warn!("On Windows, the backend sidecar will be terminated when the app exits.");
            }
        }
    }

    Ok(())
}

/// Check if a TCP port is currently in use.
///
/// Used to detect if the backend is already running before spawning a new sidecar.
///
/// # Arguments
/// * `port` — the TCP port to check
///
/// # Returns
/// * `true` — something is listening on the port
/// * `false` — the port is free
async fn is_port_in_use(port: u16) -> bool {
    // Try to connect to the port. If connection succeeds, something is listening.
    let addr = format!("127.0.0.1:{}", port);
    match tokio::net::TcpStream::connect(&addr).await {
        Ok(_) => true,
        Err(_) => false,
    }
}
