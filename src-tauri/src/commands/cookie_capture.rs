// /home/z/my-project/netamplify-app/src-tauri/src/commands/cookie_capture.rs
// NetAmplify — Tauri commands for capturing session cookies via native WebView.
//
// This is the CORE of the "zero copy-paste" UX. Instead of asking users to
// install a Chrome extension + manually copy cookies, we open a native
// Tauri WebView window to the platform's login page. The user logs in
// normally (types their username + password into the REAL platform form).
// After login, we read the cookies from the WebView's cookie jar —
// including httpOnly cookies that JavaScript cannot access.
//
// Per Tauri 2.0 API: `WebviewWindow::cookies()` returns all cookies
// from the WebView's cookie store, including httpOnly ones. This is
// a native API call, not a JavaScript injection — so httpOnly cookies
// are accessible.
//
// Flow:
//   1. Frontend calls `window.__TAURI__.invoke('capture_reddit_cookies')`
//   2. Tauri opens a new window to https://www.reddit.com/login
//   3. User logs in normally (Reddit sets token_v2, csrf_token, token cookies)
//   4. We poll WebviewWindow::cookies() every 2 seconds
//   5. When we detect the `token_v2` cookie → capture all cookies → close window
//   6. Return the cookies to the frontend
//   7. Frontend calls `proxy_cookie_connection` to send them to the local backend
//
// Timeout: 5 minutes (user might be slow typing their password)
// Cancellation: if the user closes the login window → return USER_CANCELLED

use crate::commands::{
    CookieCaptureError, CookieCaptureResult,
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use std::collections::HashMap;

/// Timeout for cookie capture: 5 minutes.
/// The user might be slow typing their password or doing 2FA.
const CAPTURE_TIMEOUT_SECS: u64 = 300;

/// Polling interval for checking cookies: 2 seconds.
/// Fast enough to feel instant, slow enough to not hammer the cookie API.
const POLL_INTERVAL_SECS: u64 = 2;

/// The cookie name used to detect a successful Reddit login.
/// When this cookie appears, the user has logged in successfully.
const REDDIT_LOGIN_COOKIE: &str = "token_v2";

/// The cookie name used to detect a successful X (Twitter) login.
const X_LOGIN_COOKIE: &str = "auth_token";

/// The cookies we need to extract from Reddit after login.
/// These are sent to the NestJS backend for encrypted storage.
const REDDIT_REQUIRED_COOKIES: &[&str] = &["token_v2", "csrf_token", "token"];

/// The cookies we need to extract from X after login.
const X_REQUIRED_COOKIES: &[&str] = &["auth_token", "ct0"];

/// Platform login URLs.
const REDDIT_LOGIN_URL: &str = "https://www.reddit.com/login";
const X_LOGIN_URL: &str = "https://x.com/i/flow/login";

/// Capture Reddit session cookies by opening a native login window.
///
/// This command:
///   1. Opens a Tauri WebView window to reddit.com/login
///   2. Polls the cookie jar every 2s for the `token_v2` cookie
///   3. When found, extracts token_v2 + csrf_token + token (if present)
///   4. Closes the login window
///   5. Returns the cookies as a HashMap
///
/// The frontend then calls `proxy_cookie_connection` to send these
/// cookies to the local NestJS backend, which validates them via
/// the RedditCookieAdapter and stores them encrypted (AES-256-GCM).
///
/// # Arguments
/// * `app` — The Tauri app handle (injected by Tauri)
///
/// # Returns
/// * `Ok(CookieCaptureResult)` — cookies + user identity on success
/// * `Err(CookieCaptureError)` — on timeout, user cancellation, or error
///
/// # Errors
/// - `USER_CANCELLED` — user closed the login window before logging in
/// - `TIMEOUT` — 5 minutes elapsed without detecting the login cookie
/// - `NO_COOKIES` — login succeeded but required cookies are missing
/// - `TAURI_ERROR` — failed to create the WebView window
#[tauri::command]
pub async fn capture_reddit_cookies(app: AppHandle) -> Result<CookieCaptureResult, CookieCaptureError> {
    capture_cookies_generic(
        &app,
        "reddit-login",
        "Log in to Reddit — NetAmplify",
        REDDIT_LOGIN_URL,
        REDDIT_LOGIN_COOKIE,
        REDDIT_REQUIRED_COOKIES,
        "REDDIT_COOKIE",
    )
    .await
}

/// Capture X (Twitter) session cookies by opening a native login window.
///
/// Same flow as `capture_reddit_cookies` but for x.com.
/// Detects the `auth_token` cookie (long-lived, ~1 year) which is
/// the primary auth cookie for X's internal API.
///
/// # Arguments
/// * `app` — The Tauri app handle (injected by Tauri)
///
/// # Returns
/// * `Ok(CookieCaptureResult)` — cookies + user identity on success
/// * `Err(CookieCaptureError)` — on timeout, user cancellation, or error
#[tauri::command]
pub async fn capture_x_cookies(app: AppHandle) -> Result<CookieCaptureResult, CookieCaptureError> {
    capture_cookies_generic(
        &app,
        "x-login",
        "Log in to X (Twitter) — NetAmplify",
        X_LOGIN_URL,
        X_LOGIN_COOKIE,
        X_REQUIRED_COOKIES,
        "TWITTER_COOKIE",
    )
    .await
}

/// Generic cookie capture function — used by both Reddit and X commands.
///
/// This is the shared implementation that:
///   1. Creates a WebView window with the given label + URL
///   2. Polls `WebviewWindow::cookies()` every 2s
///   3. When the `login_cookie` appears, extracts all required cookies
///   4. Closes the window + returns the result
///
/// # Arguments
/// * `app` — Tauri app handle
/// * `window_label` — unique label for the WebView window (e.g., "reddit-login")
/// * `window_title` — title bar text
/// * `login_url` — the platform's login page URL
/// * `login_cookie` — the cookie name that indicates successful login
/// * `required_cookies` — list of cookie names to extract after login
/// * `platform` — the NetAmplify platform identifier (e.g., "REDDIT_COOKIE")
pub async fn capture_cookies_generic(
    app: &AppHandle,
    window_label: &str,
    window_title: &str,
    login_url: &str,
    login_cookie: &str,
    required_cookies: &[&str],
    platform: &str,
) -> Result<CookieCaptureResult, CookieCaptureError> {
    // If a window with this label already exists (e.g., user clicked Connect twice),
    // focus it instead of creating a new one.
    if let Some(existing) = app.get_webview_window(window_label) {
        let _ = existing.set_focus();
        return Err(CookieCaptureError {
            code: "ALREADY_OPEN".to_string(),
            message: format!("A {} login window is already open. Please complete the login there.", platform),
        });
    }

    // Create the login window.
    // WebviewUrl::External takes a Url, not a &str
    let parsed_url = url::Url::parse(login_url).map_err(|e| CookieCaptureError {
        code: "TAURI_ERROR".to_string(),
        message: format!("Invalid login URL: {}", e),
    })?;
    let url = WebviewUrl::External(parsed_url);

    let login_window = WebviewWindowBuilder::new(app, window_label, url)
        .title(window_title)
        .inner_size(800.0, 700.0)
        .min_inner_size(400.0, 500.0)
        .center()  // Tauri 2.0 uses .center(), not .centered()
        .visible(true)
        .build()
        .map_err(|e| CookieCaptureError {
            code: "TAURI_ERROR".to_string(),
            message: format!("Failed to open login window: {}", e),
        })?;

    log::info!("Opened {} login window for cookie capture", platform);

    // Poll the cookie jar until we detect the login cookie or timeout.
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(CAPTURE_TIMEOUT_SECS);
    let poll_interval = std::time::Duration::from_secs(POLL_INTERVAL_SECS);

    loop {
        // Check if the window was closed by the user (cancellation).
        // Tauri 2.0: get_webview_window returns None if the window was closed.
        if app.get_webview_window(window_label).is_none() {
            log::info!("{} login window closed by user — cancelling capture", platform);
            return Err(CookieCaptureError {
                code: "USER_CANCELLED".to_string(),
                message: "Login window was closed before you logged in. Please try again and complete the login.".to_string(),
            });
        }

        // Check for timeout.
        if start.elapsed() >= timeout {
            log::warn!("{} cookie capture timed out after {} seconds", platform, CAPTURE_TIMEOUT_SECS);
            let _ = login_window.close();
            return Err(CookieCaptureError {
                code: "TIMEOUT".to_string(),
                message: format!("Login timed out after {} minutes. Please try again.", CAPTURE_TIMEOUT_SECS / 60),
            });
        }

        // Read the cookie jar from the WebView.
        // Tauri 2.0: cookies() returns Result directly (not async).
        let cookies = login_window.cookies()
            .map_err(|e| CookieCaptureError {
                code: "TAURI_ERROR".to_string(),
                message: format!("Failed to read cookies from login window: {}", e),
            })?;

        // Check if the login cookie is present (indicates successful login).
        let has_login_cookie = cookies.iter().any(|c| c.name() == login_cookie);

        if has_login_cookie {
            log::info!("Detected {} cookie — extracting all required cookies", login_cookie);

            // Build a map of all cookies (name → value) for the platform's domain.
            let mut cookie_map: HashMap<String, String> = HashMap::new();
            for cookie in &cookies {
                // Only capture cookies for the platform's domain (not third-party tracking cookies).
                let is_platform_domain = match platform {
                    "REDDIT_COOKIE" => {
                        cookie.domain().contains("reddit.com")
                    }
                    "TWITTER_COOKIE" => {
                        cookie.domain().contains("twitter.com")
                            || cookie.domain().contains("x.com")
                    }
                    _ => true,
                };

                if is_platform_domain {
                    cookie_map.insert(
                        cookie.name().to_string(),
                        cookie.value().to_string(),
                    );
                }
            }

            // Verify all required cookies are present.
            let mut missing: Vec<&str> = Vec::new();
            for &required in required_cookies {
                if !cookie_map.contains_key(required) {
                    // For Reddit, the legacy `token` cookie is optional.
                    if platform == "REDDIT_COOKIE" && required == "token" {
                        continue;
                    }
                    missing.push(required);
                }
            }

            if !missing.is_empty() {
                log::warn!("Login detected but missing required cookies: {:?}", missing);
                // Don't fail immediately — the cookies might appear on the next poll
                // (Reddit sometimes sets cookies with a slight delay after redirect).
                tokio::time::sleep(poll_interval).await;
                continue;
            }

            // Close the login window — we have what we need.
            let _ = login_window.close();

            // Determine the username from the cookie values.
            // For Reddit: we can decode the JWT's `lid` field.
            // For X: we don't have a username in the cookies; the backend
            // will fetch it via /1.1/account/verify_credentials.json.
            let (username, user_id) = extract_identity(platform, &cookie_map);

            let result = CookieCaptureResult {
                platform: platform.to_string(),
                cookies: cookie_map,
                username,
                user_id,
                captured_at: chrono::Utc::now().to_rfc3339(),
            };

            log::info!("Cookie capture successful for {}: user={}", platform, result.username);
            return Ok(result);
        }

        // Wait before the next poll.
        tokio::time::sleep(poll_interval).await;
    }
}

/// Extract the user's identity (username + user ID) from the captured cookies.
///
/// For Reddit: decodes the `token_v2` JWT's payload to read the `lid` field
///   (which contains the Reddit user ID, format: t2_xxxxx).
/// For X: returns empty strings — the backend will fetch the username
///   via /1.1/account/verify_credentials.json using the captured cookies.
///
/// # Arguments
/// * `platform` — "REDDIT_COOKIE" or "TWITTER_COOKIE"
/// * `cookies` — the captured cookie map
///
/// # Returns
/// * `(username, user_id)` — may be empty strings if not extractable from cookies alone
fn extract_identity(platform: &str, cookies: &HashMap<String, String>) -> (String, String) {
    match platform {
        "REDDIT_COOKIE" => {
            // The token_v2 JWT contains the user ID in the `lid` field.
            // We decode the payload (middle part of the JWT) as base64url + JSON.
            if let Some(token_v2) = cookies.get("token_v2") {
                if let Some(user_id) = decode_jwt_field(token_v2, "lid") {
                    return (format!("u/{}", user_id), user_id);
                }
            }
            (String::new(), String::new())
        }
        "TWITTER_COOKIE" => {
            // X's cookies don't contain the username directly.
            // The backend will fetch it via /1.1/account/verify_credentials.json.
            (String::new(), String::new())
        }
        _ => (String::new(), String::new()),
    }
}

/// Decode a JWT's payload (middle part) and extract a specific field.
///
/// JWTs are 3 base64url-encoded parts separated by dots: header.payload.signature
/// This function decodes the payload and extracts the value of the given field name.
///
/// # Arguments
/// * `jwt` — the full JWT string
/// * `field` — the field name to extract (e.g., "lid", "sub", "exp")
///
/// # Returns
/// * `Some(String)` — the field value if found
/// * `None` — if the JWT is malformed or the field doesn't exist
fn decode_jwt_field(jwt: &str, field: &str) -> Option<String> {
    let parts: Vec<&str> = jwt.split('.').collect();
    if parts.len() != 3 {
        return None;
    }

    // Decode the payload (parts[1]) as base64url.
    // JWT uses base64url (no padding), so we add padding if needed.
    let payload_b64 = parts[1];
    let padded = match payload_b64.len() % 4 {
        2 => format!("{}==", payload_b64),
        3 => format!("{}=", payload_b64),
        _ => payload_b64.to_string(),
    };

    let decoded = base64_decode(&padded).ok()?;
    let json: serde_json::Value = serde_json::from_slice(&decoded).ok()?;

    json.get(field)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Decode a base64 string (with padding) into raw bytes.
///
/// Uses a custom decoder to avoid adding the `base64` crate as a dependency
/// (keeping the dependency tree lean). Handles both standard and URL-safe
/// base64 alphabets.
///
/// # Errors
/// Returns `Err` if the input contains characters outside the base64 alphabet.
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