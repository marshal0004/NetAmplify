// /home/z/my-project/netamplify-app/src-tauri/src/commands/mod.rs
// NetAmplify — Tauri command modules.
//
// Each module groups related Tauri commands:
//   - cookie_capture: opens native login windows, reads cookies via
//     WebviewWindow::cookies() (includes httpOnly cookies)
//   - cookie_refresh: checks JWT expiry, re-opens login windows when needed
//   - backend_proxy: sends captured cookies to the local NestJS API via
//     HTTP POST (the backend encrypts + stores them)
//   - sidecar: starts/stops the NestJS backend process

pub mod cookie_capture;
pub mod cookie_refresh;
pub mod backend_proxy;
pub mod sidecar;
// TODO: webview_publish needs Tauri 2.0 event-based API rewrite
// (eval() returns () not Value — need to use app.listen() + JS emit)
// pub mod webview_publish;

/// The result of a successful cookie capture operation.
/// Returned to the frontend as JSON, then proxied to the NestJS backend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CookieCaptureResult {
    /// The platform identifier (e.g., "TWITTER_COOKIE", "REDDIT_COOKIE")
    pub platform: String,
    /// The captured cookies as a key-value map (cookie name → value)
    pub cookies: std::collections::HashMap<String, String>,
    /// The user's platform username (e.g., "@neerajrawatdev", "u/Marshal_The_dev0007")
    pub username: String,
    /// The user's platform account id (e.g., "t2_2bnj8pnm9a")
    pub user_id: String,
    /// ISO 8601 timestamp of when the cookies were captured
    pub captured_at: String,
}

/// The error returned when a cookie capture fails.
/// Serialized as JSON so the frontend can show a user-friendly error message.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CookieCaptureError {
    /// Error code: "USER_CANCELLED", "TIMEOUT", "NO_COOKIES", "BACKEND_ERROR", "TAURI_ERROR"
    pub code: String,
    /// Human-readable error message (shown in the UI)
    pub message: String,
}

impl From<String> for CookieCaptureError {
    fn from(msg: String) -> Self {
        CookieCaptureError {
            code: "TAURI_ERROR".to_string(),
            message: msg,
        }
    }
}

impl std::fmt::Display for CookieCaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for CookieCaptureError {}

/// Helper: get the local backend URL.
/// In dev: http://localhost:3000
/// In production (bundled): also http://localhost:3000 (the sidecar runs locally)
pub fn backend_url() -> String {
    let port = std::env::var("NETAMPLIFY_BACKEND_PORT")
        .unwrap_or_else(|_| "3000".to_string());
    format!("http://localhost:{}", port)
}
