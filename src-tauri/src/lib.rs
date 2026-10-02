// /home/z/my-project/netamplify-app/src-tauri/src/lib.rs
// NetAmplify — Tauri app library (registered commands + plugin wiring).
//
// Per Tauri 2.0 architecture: the `run()` function initializes the app,
// registers all Tauri commands (cookie capture, refresh, backend proxy),
// loads the frontend, and starts the NestJS sidecar.
//
// The frontend invokes these commands via `window.__TAURI__.invoke()`.
// Each command is a pure async function that returns serde_json::Value
// or a typed struct — no global mutable state.

mod commands;

use commands::{
    cookie_capture::{capture_x_cookies, capture_reddit_cookies},
    cookie_refresh::{refresh_reddit_cookies, refresh_x_cookies, check_cookie_expiry},
    backend_proxy::{proxy_cookie_connection, get_backend_health},
    sidecar::{start_backend_sidecar, stop_backend_sidecar},
    webview_publish::{publish_to_x_via_webview, publish_to_reddit_via_webview},
};

/// The local NestJS backend port. Must match `apps/backend/src/main.ts`.
const BACKEND_PORT: u16 = 3000;

/// The local frontend dev port. Must match `apps/frontend/vite.config.ts`.
const FRONTEND_DEV_PORT: u16 = 4200;

/// Tauri app entry point. Called by `main.rs`.
///
/// Initializes:
///   1. Logging (env_logger — respects RUST_LOG env var)
///   2. Tauri plugins (shell, http, dialog, process)
///   3. Tauri commands (cookie capture, refresh, backend proxy, sidecar)
///   4. On startup: starts the NestJS backend sidecar
///   5. On shutdown: kills the backend sidecar
///
/// In dev mode, the frontend is loaded from `http://localhost:4200`
/// (the Vite dev server). In production, it's loaded from the bundled
/// `apps/frontend/dist` directory.
pub fn run() {
    // Initialize logging — defaults to "info" level.
    // Users can set RUST_LOG=debug for verbose output.
    let _ = env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info")
    )
    .format_timestamp_secs()
    .try_init();

    log::info!("NetAmplify desktop app starting...");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            // Cookie capture commands — open native login windows + read cookies
            capture_reddit_cookies,
            capture_x_cookies,
            // Cookie refresh commands — auto-refresh expired tokens
            refresh_reddit_cookies,
            refresh_x_cookies,
            check_cookie_expiry,
            // Backend proxy — send captured cookies to local NestJS API
            proxy_cookie_connection,
            get_backend_health,
            // Sidecar management — start/stop the NestJS backend
            start_backend_sidecar,
            stop_backend_sidecar,
            // WebView publish — makes requests through WebKitGTK (bypasses TLS fingerprint)
            publish_to_x_via_webview,
            publish_to_reddit_via_webview,
        ])
        .setup(|app| {
            // On app launch: log the environment.
            log::info!("NetAmplify desktop app ready. Frontend: http://localhost:{}", FRONTEND_DEV_PORT);
            Ok(())
        })
        .on_window_event(|window, event| {
            // On app close: just log it (sidecar is managed separately).
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                log::info!("Window close requested: {}", window.label());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
