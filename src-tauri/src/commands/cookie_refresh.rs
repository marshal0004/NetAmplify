// /home/z/my-project/netamplify-app/src-tauri/src/commands/cookie_refresh.rs
// NetAmplify — Tauri commands for auto-refreshing expired session cookies.
//
// Reddit's `token_v2` cookie expires every 1-2 days. X's `auth_token`
// cookie lasts ~1 year. When a cookie expires, the publish worker gets
// a 401 from the platform API. Instead of asking the user to manually
// re-export cookies, we:
//
//   1. Re-open the platform's login page in a headless WebView
//   2. The platform sees the long-lived `token` cookie (Reddit, 6 months)
//      or the `auth_token` cookie (X, 1 year) and auto-logs in
//   3. The platform issues a fresh `token_v2` (Reddit) or keeps `auth_token` (X)
//   4. We capture the fresh cookies + send them to the backend
//
// This makes the UX feel like OAuth — the user logs in ONCE, and
// NetAmplify handles refreshes automatically in the background.
//
// When even the long-lived cookie expires (Reddit: 6 months, X: 1 year),
// the refresh fails → the frontend shows a "please re-login" banner.
// The user clicks it → logs in manually (3 seconds) → done for another
// 6 months / 1 year.

use crate::commands::{
    CookieCaptureError, CookieCaptureResult,
    cookie_capture::capture_cookies_generic,
    backend_url,
};
use tauri::AppHandle;

/// Check if a Reddit `token_v2` JWT has expired.
///
/// Decodes the JWT payload and checks the `exp` (expiry) field against
/// the current time. Returns true if the token has expired (or is about
/// to expire within the next hour — we refresh proactively).
///
/// # Arguments
/// * `token_v2` — the Reddit `token_v2` JWT string
///
/// # Returns
/// * `true` — the token has expired or will expire within 1 hour
/// * `false` — the token is still valid for at least 1 more hour
#[tauri::command]
pub async fn check_cookie_expiry(token: String) -> Result<bool, CookieCaptureError> {
    // JWT format: header.payload.signature
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err(CookieCaptureError {
            code: "INVALID_JWT".to_string(),
            message: "The provided token is not a valid JWT (expected 3 dot-separated parts)".to_string(),
        });
    }

    // Decode the payload (parts[1]) as base64url.
    let payload_b64 = parts[1];
    let padded = match payload_b64.len() % 4 {
        2 => format!("{}==", payload_b64),
        3 => format!("{}=", payload_b64),
        _ => payload_b64.to_string(),
    };

    let decoded = base64_decode(&padded).map_err(|e| CookieCaptureError {
        code: "INVALID_JWT".to_string(),
        message: format!("Failed to decode JWT payload: {}", e),
    })?;

    let json: serde_json::Value = serde_json::from_slice(&decoded).map_err(|e| CookieCaptureError {
        code: "INVALID_JWT".to_string(),
        message: format!("Failed to parse JWT payload as JSON: {}", e),
    })?;

    let exp = json.get("exp")
        .and_then(|v| v.as_f64())
        .ok_or_else(|| CookieCaptureError {
            code: "INVALID_JWT".to_string(),
            message: "JWT payload does not contain an 'exp' field".to_string(),
        })?;

    let now = current_timestamp_secs();
    let one_hour_from_now = now + 3600;

    // Refresh proactively if the token expires within 1 hour.
    Ok(exp < one_hour_from_now as f64)
}

/// Refresh Reddit cookies by re-opening the login window.
///
/// If the user's long-lived `token` cookie (6-month life) is still valid,
/// Reddit will auto-log them in when the WebView opens reddit.com — no
/// password entry required. We capture the fresh `token_v2` cookie
/// and return it.
///
/// If the long-lived `token` cookie has also expired, the user will see
/// the Reddit login form. They type their password → we capture the
/// fresh cookies. This happens at most once every 6 months.
///
/// # Arguments
/// * `app` — The Tauri app handle
///
/// # Returns
/// * `Ok(CookieCaptureResult)` — fresh cookies on success
/// * `Err(CookieCaptureError)` — on failure (user cancelled, timeout, etc.)
#[tauri::command]
pub async fn refresh_reddit_cookies(app: AppHandle) -> Result<CookieCaptureResult, CookieCaptureError> {
    log::info!("Starting Reddit cookie refresh...");

    // Re-use the same capture flow. If the long-lived `token` cookie is
    // still in the WebView's cookie jar (from the previous login), Reddit
    // will auto-login and issue a fresh `token_v2` without user interaction.
    //
    // If the `token` cookie has expired, the user will see the login form
    // and need to type their password. This is the "daily login" fallback
    // the user mentioned — takes ~3 seconds.
    let result = capture_cookies_generic(
        &app,
        "reddit-refresh",
        "Refreshing Reddit session — NetAmplify",
        "https://www.reddit.com/login",
        "token_v2",
        &["token_v2", "csrf_token", "token"],
        "REDDIT_COOKIE",
    )
    .await?;

    log::info!("Reddit cookie refresh successful — user: {}", result.username);
    Ok(result)
}

/// Refresh X (Twitter) cookies by re-opening the login window.
///
/// X's `auth_token` cookie lasts ~1 year, so refresh is rarely needed.
/// When it does expire, the user re-logs in (3 seconds) and we capture
/// fresh cookies.
///
/// # Arguments
/// * `app` — The Tauri app handle
///
/// # Returns
/// * `Ok(CookieCaptureResult)` — fresh cookies on success
/// * `Err(CookieCaptureError)` — on failure
#[tauri::command]
pub async fn refresh_x_cookies(app: AppHandle) -> Result<CookieCaptureResult, CookieCaptureError> {
    log::info!("Starting X cookie refresh...");

    let result = capture_cookies_generic(
        &app,
        "x-refresh",
        "Refreshing X (Twitter) session — NetAmplify",
        "https://x.com/i/flow/login",
        "auth_token",
        &["auth_token", "ct0"],
        "TWITTER_COOKIE",
    )
    .await?;

    log::info!("X cookie refresh successful");
    Ok(result)
}

/// Get the current Unix timestamp in seconds.
fn current_timestamp_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Decode a base64 string (with padding) into raw bytes.
/// Re-implemented here to avoid cross-module visibility issues.
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const STD_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const URL_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    let input: Vec<u8> = input.bytes().filter(|&b| b != b'=' && b != b'\n' && b != b'\r').collect();
    let mut output = Vec::with_capacity(input.len() * 3 / 4);

    for chunk in input.chunks(4) {
        let mut vals = [0u8; 4];
        for (i, &byte) in chunk.iter().enumerate() {
            vals[i] = if let Some(pos) = STD_ALPHABET.iter().position(|&b| b == byte) {
                pos as u8
            } else if let Some(pos) = URL_ALPHABET.iter().position(|&b| b == byte) {
                pos as u8
            } else {
                return Err(format!("Invalid base64 character: {}", byte as char));
            };
        }

        output.push((vals[0] << 2) | (vals[1] >> 4));
        if chunk.len() > 2 {
            output.push((vals[1] << 4) | (vals[2] >> 2));
        }
        if chunk.len() > 3 {
            output.push((vals[2] << 6) | vals[3]);
        }
    }

    Ok(output)
}

#[allow(unused_imports)]
use crate::commands::cookie_capture;
