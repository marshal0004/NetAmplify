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
//   1. Frontend calls `window.__TAURI__.invoke('capture_x_cookies')`
//   2. Tauri opens a new window to https://x.com/i/flow/login
//   3. User logs in normally (X sets auth_token, ct0 cookies)
//   4. We poll WebviewWindow::cookies() every 2 seconds
//   5. When we detect the `auth_token` cookie → capture all cookies → close window
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
use url::Url as UrlType;

/// Timeout for cookie capture: 5 minutes.
/// The user might be slow typing their password or doing 2FA.
const CAPTURE_TIMEOUT_SECS: u64 = 300;

/// Polling interval for checking cookies: 2 seconds.
/// Fast enough to feel instant, slow enough to not hammer the cookie API.
const POLL_INTERVAL_SECS: u64 = 2;

/// The cookie name used to detect a successful X (Twitter) login.
const X_LOGIN_COOKIE: &str = "auth_token";

/// The cookies we need to extract from X after login.
const X_REQUIRED_COOKIES: &[&str] = &["auth_token", "ct0"];

/// Platform login URLs.
const X_LOGIN_URL: &str = "https://x.com/i/flow/login";

/// Firefox on Windows User-Agent string.
///
/// WHY FIREFOX (not Chrome):
/// We previously tried Chrome's UA. Platform WAFs still blocked us with
/// HTTP 403 {"message":"Forbidden","error":403}. The reason: Chrome
/// automatically sends "Client Hints" headers (sec-ch-ua, sec-ch-ua-platform,
/// sec-ch-ua-mobile) with every request. WebKitGTK does NOT send these.
/// So our request said "I'm Chrome 130" via UA but lacked the matching
/// Client Hints headers — a classic spoofing detection signal.
///
/// Firefox does NOT send Client Hints headers. So if we claim to be
/// Firefox via UA, the absence of sec-ch-ua headers is consistent with
/// Firefox's real behavior, and the platform WAF can't detect the spoofing
/// via that signal.
///
/// This UA is set at the WebView level (via WebviewWindowBuilder::user_agent)
/// which affects:
///   - The initial page load (login form)
///   - All XHR/fetch requests made from injected JS (Test Publish)
///   - All sub-resource requests (CSS, JS, images)
const CHROME_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) \
     Gecko/20100101 Firefox/130.0";

/// Capture X (Twitter) session cookies by opening a native login window.
///
/// Opens a Tauri WebView window to x.com/i/flow/login and detects the
/// `auth_token` cookie (long-lived, ~1 year) which is the primary auth
/// cookie for X's internal API.
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

/// Generic cookie capture function — used by the X command.
///
/// This is the shared implementation that:
///   1. Creates a WebView window with the given label + URL
///   2. Polls `WebviewWindow::cookies()` every 2s
///   3. When the `login_cookie` appears, extracts all required cookies
///   4. Closes the window + returns the result
///
/// # Arguments
/// * `app` — Tauri app handle
/// * `window_label` — unique label for the WebView window (e.g., "x-login")
/// * `window_title` — title bar text
/// * `login_url` — the platform's login page URL
/// * `login_cookie` — the cookie name that indicates successful login
/// * `required_cookies` — list of cookie names to extract after login
/// * `platform` — the NetAmplify platform identifier (e.g., "TWITTER_COOKIE")
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
            // CRITICAL: Spoof Chrome's User-Agent. Without this, WebKitGTK sends
            // its own UA which X's WAF recognizes as non-browser and
            // returns HTTP 403 "forbidden" for /api/submit POSTs. This UA applies
            // to the initial page load AND all XHR/fetch calls from injected JS.
        .user_agent(CHROME_USER_AGENT)
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
            // CRITICAL: Verify the user has ACTUALLY logged in.
            // Some login pages set a cookie even before the user logs in
            // (e.g., an anonymous/guest token). If we capture it immediately,
            // we may get a guest token with no real session.
            //
            // Fix: Check if the URL has changed AWAY from the login page.
            // If still on /login, the user hasn't logged in yet — keep polling.
            let current_url = login_window.url().unwrap_or_else(|_| UrlType::parse("https://unknown.com/").unwrap());
            let url_str = current_url.as_str();

            let is_still_on_login_page = match platform {
                "TWITTER_COOKIE" => url_str.contains("/i/flow/login") || url_str.contains("/login"),
                _ => false,
            };

            if is_still_on_login_page {
                // The login cookie exists but we're still on the login page.
                // This means it's a guest/anonymous token, not a real login session.
                // Keep polling until the URL changes (user logs in → redirected to homepage).
                log::debug!("{} cookie detected but still on login page — waiting for actual login", platform);
                tokio::time::sleep(poll_interval).await;
                continue;
            }

            log::info!("Detected {} cookie + URL changed from login page — user is logged in", login_cookie);

            // Build a map of all cookies (name → value) for the platform's domain.
            let mut cookie_map: HashMap<String, String> = HashMap::new();
            for cookie in &cookies {
                // Only capture cookies for the platform's domain (not third-party tracking cookies).
                // cookie.domain() returns Option<&str>, so we use map().unwrap_or(false)
                let domain = cookie.domain().unwrap_or("");
                let is_platform_domain = match platform {
                    "TWITTER_COOKIE" => domain.contains("twitter.com") || domain.contains("x.com"),
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
                    missing.push(required);
                }
            }

            if !missing.is_empty() {
                log::warn!("Login detected but missing required cookies: {:?}", missing);
                // Don't fail immediately — the cookies might appear on the next poll
                // (the platform sometimes sets cookies with a slight delay after redirect).
                tokio::time::sleep(poll_interval).await;
                continue;
            }

            // HIDE the login window instead of closing it.
            // The window's cookie jar (including httpOnly cookies) is
            // preserved so we can reuse it for publishing
            // via the WebView publish command. If we close the window,
            // the cookie jar is destroyed and httpOnly cookies are lost
            // (they can't be re-set via JavaScript's document.cookie).
            let _ = login_window.hide();

            // Determine the username from the cookie values.
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
/// For X: returns empty strings — the backend will fetch the username
///   via /1.1/account/verify_credentials.json using the captured cookies.
///
/// # Arguments
/// * `platform` — "TWITTER_COOKIE"
/// * `cookies` — the captured cookie map (reserved for future platforms)
///
/// # Returns
/// * `(username, user_id)` — may be empty strings if not extractable from cookies alone
fn extract_identity(platform: &str, _cookies: &HashMap<String, String>) -> (String, String) {
    match platform {
        "TWITTER_COOKIE" => {
            // X's cookies don't contain the username directly.
            // The backend will fetch it via /1.1/account/verify_credentials.json.
            (String::new(), String::new())
        }
        _ => (String::new(), String::new()),
    }
}