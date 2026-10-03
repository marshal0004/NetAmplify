// /home/z/my-project/netamplify-app/src-tauri/src/commands/webview_publish.rs
// NetAmplify — Tauri command for publishing to X/Reddit via WebView.
//
// THE TLS FINGERPRINT BYPASS: Instead of making the HTTP request from
// Node.js (OpenSSL → detected as bot), we open a hidden Tauri WebView
// on the platform's domain, inject JavaScript that calls fetch() to
// the platform's API (same-origin → no CORS), and capture the result
// via Tauri 2.0's on_navigation() callback.
//
// Architecture (Tauri 2.0 event-based pattern):
//   1. Rust opens a hidden WebView on https://x.com/home (or reddit.com)
//   2. The WebView shares the cookie jar from the previous auto-capture
//      login — so auth_token/ct0/token_v2/csrf_token are already present
//   3. Rust injects JavaScript via window.eval(js_code)
//   4. The JS calls fetch() to X's GraphQL / Reddit's /api/submit endpoint
//      (same-origin → cookies sent automatically → no CORS issue)
//   5. When the JS gets the result, it navigates to a custom URL:
//      http://publish-callback?success=true&id=123&url=https://...
//   6. Rust's on_navigation() handler intercepts this URL, parses the
//      query parameters, sends the result through a oneshot channel,
//      and cancels the navigation (returns false)
//   7. The async command resolves with the result + returns it to the frontend
//
// Why on_navigation() instead of eval() return value:
//   In Tauri 2.0, WebviewWindow::eval() returns Result<()> (unit type),
//   not the JS evaluation result. To get data back from the WebView, we
//   use the navigation interception pattern: the JS navigates to a
//   custom URL with the result encoded as query parameters, and Rust
//   catches it via on_navigation().

use crate::commands::CookieCaptureError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Listener};
use tokio::sync::oneshot;
use url::Url;

/// The request payload for publishing via WebView.
#[derive(Debug, Clone, Deserialize)]
pub struct WebViewPublishRequest {
    pub platform: String,
    pub cookies: HashMap<String, String>,
    pub formatted: FormattedPost,
    #[serde(default)]
    #[allow(dead_code)]
    pub jwt_token: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    pub post_target_id: Option<String>,
}

/// The formatted post content from the Format Engine.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FormattedPost {
    pub title: String,
    pub body: String,
    pub url: Option<String>,
    pub hashtags: Option<Vec<String>>,
    pub options: Option<HashMap<String, serde_json::Value>>,
}

/// The result of a publish via WebView.
#[derive(Debug, Clone, Serialize)]
pub struct WebViewPublishResult {
    pub id: String,
    pub url: String,
    pub success: bool,
    pub error: Option<String>,
}

/// The X (Twitter) public Bearer token (shipped in x.com's main.js bundle).
/// This is a PUBLIC value — not a secret. Every browser visiting x.com uses it.
const X_WEB_BEARER_TOKEN: &str =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuAhw6TZR0YwqHvQ%3D\
     JqGisW7eT0YmZKb1iVpPu5pFgCqVQUO5WnLhQaLvO4";

/// Timeout for the publish operation (30 seconds).
const PUBLISH_TIMEOUT_SECS: u64 = 30;

/// Wait time for the page to load before injecting JS (5 seconds).
const PAGE_LOAD_WAIT_MS: u64 = 5000;

/// Publish to X (Twitter) via a hidden WebView window.
///
/// This command bypasses the TLS fingerprint check by making the HTTP
/// request from inside a WebKitGTK WebView (real browser TLS fingerprint).
///
/// Flow:
///   1. Opens a hidden WebView on https://x.com/home
///   2. Sets the auth_token + ct0 cookies via document.cookie
///   3. Injects JS that calls fetch() to X's CreateTweet GraphQL endpoint
///   4. The JS navigates to http://publish-callback?result=<JSON>
///   5. Rust's on_navigation() handler catches this, parses the result
///   6. Returns the result to the frontend
#[tauri::command]
pub async fn publish_to_x_via_webview(
    app: AppHandle,
    request: WebViewPublishRequest,
) -> Result<WebViewPublishResult, CookieCaptureError> {
    log::info!("Publishing to X via WebView (TLS fingerprint bypass)...");

    // Cookies may be empty if called from the frontend (cookies are encrypted
    // on the backend). In that case, the WebView's cookie jar (from the
    // previous auto-capture login) has them. The JS code reads them from
    // document.cookie at runtime.
    let auth_token = request.cookies.get("auth_token").cloned().unwrap_or_default();
    let ct0 = request.cookies.get("ct0").cloned().unwrap_or_default();

    // Build the tweet text (same logic as the backend adapter)
    let tags_line = if let Some(hashtags) = &request.formatted.hashtags {
        if !hashtags.is_empty() {
            format!("\n{}", hashtags.iter().map(|t| format!("#{}", t)).collect::<Vec<_>>().join(" "))
        } else {
            String::new()
        }
    } else {
        String::new()
    };
    let url_line = request.formatted.url.as_ref()
        .map(|u| format!("\n{}", u))
        .unwrap_or_default();
    let tweet_text = format!("{}{}{}", request.formatted.body, url_line, tags_line);

    if tweet_text.is_empty() {
        return Ok(WebViewPublishResult {
            id: String::new(),
            url: String::new(),
            success: false,
            error: Some("Tweet text is empty".to_string()),
        });
    }
    if tweet_text.len() > 280 {
        return Ok(WebViewPublishResult {
            id: String::new(),
            url: String::new(),
            success: false,
            error: Some(format!("Tweet exceeds 280 chars (got {})", tweet_text.len())),
        });
    }

    // Build the JavaScript to execute inside the WebView.
    // The JS makes a fetch() to X's CreateTweet GraphQL endpoint (same-origin
    // on x.com → cookies sent automatically → no CORS). When done, it
    // navigates to http://publish-callback?result=<base64-encoded-JSON>
    // which Rust intercepts via on_navigation().
    let js_code = format!(
        r#"
        (async () => {{
            try {{
                const authToken = {auth_token_json};
                const ct0Value = {ct0_json};
                const tweetText = {tweet_text_json};
                const bearer = {bearer_json};

                // Set cookies explicitly IF provided (non-empty).
                // If empty, rely on the WebView's cookie jar from the
                // previous auto-capture login.
                if (authToken) {{
                    document.cookie = `auth_token=${{authToken}}; path=/; domain=.x.com; secure`;
                }}
                if (ct0Value) {{
                    document.cookie = `ct0=${{ct0Value}}; path=/; domain=.x.com; secure`;
                }}

                // Read ct0 from the cookie jar (needed for x-csrf-token header).
                // If it wasn't provided, it should be in document.cookie from
                // the previous login.
                const ct0 = ct0Value || document.cookie.match(/ct0=([^;]+)/)?.[1] || "";

                // Fetch the CreateTweet queryId from x.com's main.js bundle.
                // X rotates this with each web release (~weekly).
                const homeResp = await fetch("https://x.com/", {{
                    headers: {{ "user-agent": navigator.userAgent }}
                }});
                const homeHtml = await homeResp.text();
                const mainJsMatch = homeHtml.match(
                    /https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-z0-9]+\.js/
                );
                if (!mainJsMatch) {{
                    window.location.href = "http://publish-callback?error=" +
                        encodeURIComponent("Could not find main.js URL in x.com homepage");
                    return;
                }}

                const jsResp = await fetch(mainJsMatch[0]);
                const jsBody = await jsResp.text();
                const queryIdMatch = jsBody.match(
                    /queryId:"([A-Za-z0-9_-]+)".*?operationName:"CreateTweet"/
                );
                if (!queryIdMatch) {{
                    window.location.href = "http://publish-callback?error=" +
                        encodeURIComponent("Could not find CreateTweet queryId in main.js");
                    return;
                }}
                const queryId = queryIdMatch[1];

                // Make the CreateTweet request (same-origin → cookies sent automatically)
                const endpoint = `https://x.com/i/api/graphql/${{queryId}}/CreateTweet`;
                const payload = {{
                    variables: {{
                        tweet_text: tweetText,
                        dark_request: false,
                        media: {{ media_entities: [], possibly_sensitive: false }},
                        semantic_annotation_ids: [],
                    }},
                    features: {{
                        communities_web_enable_tweet_community_results_fetch: true,
                        c9s_tweet_anatomy_moderator_badge_enabled: true,
                        tweetypie_unmention_optimization_enabled: true,
                        responsive_web_edit_tweet_api_enabled: true,
                        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
                        view_counts_everywhere_api_enabled: true,
                        longform_notetweets_consumption_enabled: true,
                        responsive_web_twitter_article_tweet_consumption_enabled: true,
                        creator_subscriptions_quote_tweet_enabled: true,
                        longform_notetweets_rich_text_read_enabled: true,
                        longform_notetweets_inline_media_enabled: true,
                        rweb_video_timestamps_enabled: true,
                        rweb_tipjar_consumption_enabled: true,
                        responsive_web_graphql_exclude_directive_enabled: true,
                        verified_phone_label_enabled: false,
                        responsive_web_graphql_timeline_navigation_enabled: true,
                        responsive_web_enhance_cards_enabled: false,
                    }},
                }};

                const resp = await fetch(endpoint, {{
                    method: "POST",
                    headers: {{
                        "authorization": `Bearer ${{bearer}}`,
                        "x-csrf-token": ct0,
                        "x-twitter-auth-type": "OAuth2Session",
                        "x-twitter-active-user": "yes",
                        "content-type": "application/json",
                    }},
                    body: JSON.stringify(payload),
                    credentials: "include",
                }});

                const data = await resp.json();

                if (data.errors && data.errors.length > 0) {{
                    window.location.href = "http://publish-callback?error=" +
                        encodeURIComponent(data.errors[0].message);
                    return;
                }}

                const tweetId = data.data?.create_tweet?.tweet_results?.result?.rest_id;
                if (!tweetId) {{
                    window.location.href = "http://publish-callback?error=" +
                        encodeURIComponent("X returned success but no tweet ID");
                    return;
                }}

                const screenName = data.data?.create_tweet?.tweet_results?.result
                    ?.core?.user_results?.result?.legacy?.screen_name || "i";
                const tweetUrl = `https://x.com/${{screenName}}/status/${{tweetId}}`;

                window.location.href = "http://publish-callback?success=true&id=" +
                    encodeURIComponent(tweetId) + "&url=" + encodeURIComponent(tweetUrl);
            }} catch (e) {{
                window.location.href = "http://publish-callback?error=" +
                    encodeURIComponent(e.message || String(e));
            }}
        }})();
        "#,
        auth_token_json = serde_json::to_string(&auth_token).unwrap_or_else(|_| "\"\"".to_string()),
        ct0_json = serde_json::to_string(&ct0).unwrap_or_else(|_| "\"\"".to_string()),
        tweet_text_json = serde_json::to_string(&tweet_text).unwrap_or_else(|_| "\"\"".to_string()),
        bearer_json = serde_json::to_string(X_WEB_BEARER_TOKEN).unwrap_or_else(|_| "\"\"".to_string()),
    );

    execute_js_in_hidden_webview(
        &app,
        "https://x.com/home",
        &js_code,
        "x-publish",
    ).await
}

/// Publish to Reddit via a hidden WebView window.
#[tauri::command]
pub async fn publish_to_reddit_via_webview(
    app: AppHandle,
    request: WebViewPublishRequest,
) -> Result<WebViewPublishResult, CookieCaptureError> {
    log::info!("Publishing to Reddit via WebView (TLS fingerprint bypass)...");

    // NOTE: We deliberately do NOT use request.cookies here. The cookies
    // stored on the backend (encrypted) are STALE — they were captured at
    // login time, but Reddit rotates token_v2 + csrf_token on every page
    // load. The WebView's cookie jar (refreshed when we navigated to
    // reddit.com a moment ago) has the LIVE values. The fresh csrf_token
    // is read from the cookie jar in execute_js_in_hidden_webview() and
    // injected into the JS as __FRESH_CSRF_TOKEN__. The httpOnly token_v2
    // is sent automatically by the browser with credentials: "include".

    let subreddit = request.formatted.options.as_ref()
        .and_then(|o| o.get("subreddit"))
        .and_then(|v| v.as_str())
        .unwrap_or("test")
        .replace("r/", "");

    let is_link_post = request.formatted.url.is_some();
    let content = if is_link_post {
        request.formatted.url.clone().unwrap_or_default()
    } else {
        request.formatted.body.clone()
    };

    // Build the JS payload using XMLHttpRequest instead of fetch().
    // Why XHR: WebKitGTK's fetch() throws "The string did not match the
    // expected pattern" (DOMException SyntaxError) when a header value
    // contains a control char or when the request fails certain internal
    // validations. XHR uses a different code path that:
    //   - Doesn't throw DOMException SyntaxError on header issues
    //   - Reports failures via xhr.status / xhr.readyState (numeric, easy)
    //   - Sends cookies automatically when withCredentials = true
    // XHR also lets us capture the FULL response text + status code so
    // we can diagnose exactly what Reddit returned.
    let js_code = format!(
        r#"
        (async () => {{
            try {{
                const subreddit = {subreddit_json};
                const title = {title_json};
                const kind = "{kind}";
                const content = {content_json};
                const csrfToken = __FRESH_CSRF_TOKEN__;

                // Sanity: csrfToken must be a non-empty printable string.
                // WebKitGTK's fetch() throws "The string did not match the
                // expected pattern" if a header value contains a control
                // character. We strip any control chars here.
                const cleanCsrf = String(csrfToken || "")
                    .replace(/[\x00-\x1F\x7F]/g, "");
                if (cleanCsrf.length < 8) {{
                    window.location.href = "http://publish-callback/?error=" +
                        encodeURIComponent(
                            "csrf_token missing or too short (len=" +
                            cleanCsrf.length + ")"
                        );
                    return;
                }}

                // Build the URL-encoded body manually so we don't depend
                // on URLSearchParams (which can also throw DOMException
                // SyntaxError under WebKitGTK for non-string inputs).
                const enc = encodeURIComponent;
                const parts = [
                    "api_type=json",
                    "sr=" + enc(subreddit),
                    "title=" + enc(title),
                    "kind=" + enc(kind),
                ];
                if (kind === "link") {{
                    parts.push("url=" + enc(content));
                }} else {{
                    parts.push("text=" + enc(content));
                }}
                const body = parts.join("&");

                // Use XMLHttpRequest — more reliable than fetch() in WebKitGTK.
                // Async with explicit onload/onerror handlers so we capture
                // the exact response status + body.
                //
                // URL: We use /api/submit.json AND append Reddit's internal
                // query parameters (?app=reddit-web-v3&raw_json=1&ui_bot_mutation=false).
                // These are added by Reddit's own web app's JS — Reddit's WAF
                // may use them as a "is this a real request from reddit.com's
                // web app?" signal. Without them, the request looks like a
                // raw API call from a script, which trips the WAF.
                const xhr = new XMLHttpRequest();
                xhr.open("POST",
                    "https://www.reddit.com/api/submit.json"
                    + "?app=reddit-web-v3"
                    + "&raw_json=1"
                    + "&ui_bot_mutation=false",
                    true);
                xhr.withCredentials = true;

                // Set all the headers a real browser sends.
                //
                // We use Firefox UA (set on the WebView) — Firefox does NOT
                // send Client Hints (sec-ch-ua-*) headers, so the absence of
                // those headers is consistent with our UA.
                //
                // We DO set Sec-Fetch-* headers manually because WebKitGTK
                // may not auto-send them. These are NOT in the XHR "forbidden
                // header" list (per the Fetch standard), so we can set them.
                // If WebKitGTK blocks them silently, no harm done — they just
                // won't be present (same as if we didn't try).
                xhr.setRequestHeader("x-csrf-token", cleanCsrf);
                xhr.setRequestHeader("content-type",
                    "application/x-www-form-urlencoded");
                // Reddit's own web app sends this exact Accept value — match it.
                xhr.setRequestHeader("accept",
                    "application/json, text/plain, */*");
                xhr.setRequestHeader("accept-language", "en-US,en;q=0.9");
                // Sec-Fetch-* headers (help the WAF see this as a same-origin
                // browser navigation, not a script):
                xhr.setRequestHeader("sec-fetch-site", "same-origin");
                xhr.setRequestHeader("sec-fetch-mode", "cors");
                xhr.setRequestHeader("sec-fetch-dest", "empty");

                xhr.onload = function () {{
                    const raw = (xhr.responseText || "").substring(0, 1500);
                    const status = xhr.status;
                    // Pack both into the callback URL — Rust parses "raw"
                    // as JSON; if it's not JSON, we fall back to a status
                    // error message.
                    window.location.href =
                        "http://publish-callback/?raw=" + enc(raw) +
                        "&status=" + status;
                }};
                xhr.onerror = function () {{
                    window.location.href =
                        "http://publish-callback/?error=" +
                        enc("XHR network error (status=" + xhr.status +
                            ", readyState=" + xhr.readyState + ")");
                }};
                xhr.ontimeout = function () {{
                    window.location.href =
                        "http://publish-callback/?error=" +
                        enc("XHR timeout (status=" + xhr.status + ")");
                }};
                xhr.timeout = 20000;
                xhr.send(body);
            }} catch (e) {{
                window.location.href = "http://publish-callback/?error=" +
                    encodeURIComponent(
                        (e && e.name ? e.name + ": " : "") +
                        (e && e.message ? e.message : String(e)) +
                        (e && e.stack ? " | stack: " + e.stack.substring(0, 400) : "")
                    );
            }}
        }})();
        "#,
        subreddit_json = serde_json::to_string(&subreddit).unwrap_or_else(|_| "\"\"".to_string()),
        title_json = serde_json::to_string(&request.formatted.title).unwrap_or_else(|_| "\"\"".to_string()),
        kind = if is_link_post { "link" } else { "self" },
        content_json = serde_json::to_string(&content).unwrap_or_else(|_| "\"\"".to_string()),
    );

    execute_js_in_hidden_webview(
        &app,
        "https://www.reddit.com/",
        &js_code,
        "reddit-publish",
    ).await
}

/// Execute JavaScript in a hidden WebView and capture the result via
/// Tauri 2.0's on_navigation() callback.
///
/// This is the core function that makes the TLS fingerprint bypass work.
/// We open a hidden WebView on the platform's domain, inject JavaScript
/// that makes the fetch() request (same-origin → no CORS), and capture
/// the result when the JS navigates to http://publish-callback?...
///
/// The on_navigation() handler:
///   - Intercepts any navigation to http://publish-callback?...
///   - Parses the query parameters (success, id, url, error)
///   - Sends the result through a oneshot channel
///   - Returns false (cancels the navigation)
///   - All other navigations are allowed (returns true)
async fn execute_js_in_hidden_webview(
    app: &AppHandle,
    _url: &str,
    js_code: &str,
    window_label: &str,
) -> Result<WebViewPublishResult, CookieCaptureError> {
    // REUSE the hidden login window — it has all the httpOnly cookies.
    // Tauri 2.0 WebViews do NOT share cookie jars between windows.
    // Each window has its own cookie jar. So we MUST reuse the login window
    // (which was hidden, not closed) — its cookie jar has token_v2, auth_token, etc.
    //
    // To get the result back, we poll window.url() every 500ms.
    // The JS navigates to http://publish-callback?... when done.
    // We detect this URL change and parse the query params.

    let login_window_label = window_label.replace("-publish", "-login");

    let window = app.get_webview_window(&login_window_label)
        .ok_or_else(|| CookieCaptureError {
            code: "NO_WINDOW".to_string(),
            message: format!(
                "No hidden login window found for '{}'. Please run Auto-Capture first.",
                login_window_label
            ),
        })?;

    let _ = window.show();
    let _ = window.set_focus();
    log::info!("Reusing hidden login window '{}' for publishing", login_window_label);

    // The login window currently has reddit.com/login loaded (from auto-capture).
    // We need to navigate it to reddit.com (the homepage) so the fetch() to
    // /api/submit is same-origin. But we must NOT navigate to reddit.com/login
    // — that would show the login page again.
    //
    // Reddit's token_v2 refreshes automatically when the page loads (via
    // Set-Cookie headers from Reddit's web app). So navigating to reddit.com
    // will give us fresh cookies + the correct page context.
    //
    // For X (Twitter), navigate to x.com/home (same-origin as the API).
    let target_url = if login_window_label.starts_with("reddit") {
        "https://www.reddit.com/"
    } else {
        "https://x.com/home"
    };

    log::info!("Navigating to {} for cookie refresh + same-origin context", target_url);

    // Navigate to the target URL. We use eval() to set window.location.href.
    // The navigation will cause the page to reload, so we need to wait for
    // the new page to load before injecting the publish JS.
    window.eval(&format!("window.location.href = '{}';", target_url))
        .map_err(|e| CookieCaptureError {
            code: "JS_ERROR".to_string(),
            message: format!("Failed to navigate to {}: {}", target_url, e),
        })?;

    // Wait for the page to load + cookies to refresh.
    // Reddit/X web apps are heavy SPAs — give them 8 seconds to fully load.
    tokio::time::sleep(std::time::Duration::from_secs(8)).await;

    // IMPORTANT: After navigation, the page context changes. We need to verify
    // the window is still on the correct page before injecting JS.
    let current_url = window.url().map_err(|e| CookieCaptureError {
        code: "TAURI_ERROR".to_string(),
        message: format!("Failed to get window URL after navigation: {}", e),
    })?;

    log::info!("Window URL after refresh: {}", current_url);

    // If the URL still shows /login, it means the cookies were expired and
    // Reddit redirected to the login page. In this case, we can't publish.
    if current_url.path().contains("login") {
        return Err(CookieCaptureError {
            code: "SESSION_EXPIRED".to_string(),
            message: "Your Reddit/X session has expired. Please click 'Auto-Capture' again to log in.".to_string(),
        });
    }

    // Read the FRESH csrf_token from the WebView's cookie jar.
    // document.cookie can't read SameSite=Strict cookies on WebKitGTK,
    // so we read it from Rust via the Tauri cookie API.
    //
    // SANITIZE: Some Tauri 2.0 cookie store backends return values with
    // trailing NUL/control chars that cause WebKitGTK's fetch()/XHR
    // setRequestHeader() to throw "The string did not match the expected
    // pattern" (DOMException SyntaxError). Strip them here as a
    // defense-in-depth (the JS also strips them).
    let fresh_csrf_token = if login_window_label.starts_with("reddit") {
        let cookies = window.cookies().unwrap_or_default();
        let raw = cookies.iter()
            .find(|c| c.name() == "csrf_token")
            .map(|c| c.value().to_string())
            .unwrap_or_else(|| {
                log::warn!("csrf_token not found in cookie jar");
                String::new()
            });
        // Strip every char that is not a printable ASCII char (0x20-0x7E).
        // Reddit csrf_token is normally a 32-char alphanumeric string, so
        // this sanitization should be a no-op for valid cookies.
        let cleaned: String = raw.chars()
            .filter(|c| (*c as u32) >= 0x20 && (*c as u32) <= 0x7E)
            .collect();
        if cleaned != raw {
            log::warn!(
                "csrf_token sanitized: {} -> {} chars (removed {} non-printable chars)",
                raw.len(), cleaned.len(), raw.len() - cleaned.len()
            );
        }
        cleaned
    } else {
        String::new()
    };

    log::info!("Fresh csrf_token from cookie jar: {} chars", fresh_csrf_token.len());

    // Inject the publish JS with the fresh csrf_token
    let js_with_fresh_csrf = js_code.replace(
        "__FRESH_CSRF_TOKEN__",
        &format!("\"{}\"", fresh_csrf_token.replace('\\', "\\\\").replace('"', "\\\"")),
    );

    log::info!("Injecting publish JS into refreshed window");
    window.eval(&js_with_fresh_csrf)
        .map_err(|e| CookieCaptureError {
            code: "JS_ERROR".to_string(),
            message: format!("Failed to execute JavaScript: {}", e),
        })?;

    // Poll the URL every 500ms until we detect the callback URL or timeout
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(PUBLISH_TIMEOUT_SECS);
    let poll_interval = std::time::Duration::from_millis(500);

    loop {
        if start.elapsed() >= timeout {
            let _ = window.hide();
            return Err(CookieCaptureError {
                code: "TIMEOUT".to_string(),
                message: format!("Publish timed out after {} seconds", PUBLISH_TIMEOUT_SECS),
            });
        }

        // Check if the window was closed
        if app.get_webview_window(&login_window_label).is_none() {
            return Err(CookieCaptureError {
                code: "WINDOW_CLOSED".to_string(),
                message: "Login window was closed during publish.".to_string(),
            });
        }

        // Get the current URL
        let current_url = window.url().map_err(|e| CookieCaptureError {
            code: "TAURI_ERROR".to_string(),
            message: format!("Failed to get window URL: {}", e),
        })?;

        let url_str = current_url.as_str();

        // Check if the JS navigated to our callback URL
        if url_str.starts_with("http://publish-callback") {
            log::info!("Detected callback URL: {}", url_str);

            // Parse the query parameters
            let query: std::collections::HashMap<String, String> =
                current_url.query_pairs()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect();

            let _ = window.hide();

            // Check for error
            if let Some(error) = query.get("error") {
                return Ok(WebViewPublishResult {
                    id: String::new(),
                    url: String::new(),
                    success: false,
                    error: Some(error.clone()),
                });
            }

            // Check for raw response (XHR.onload fired — we got SOME response
            // from Reddit, possibly an error page or a JSON envelope).
            if let Some(raw) = query.get("raw") {
                let http_status: i32 = query.get("status")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);

                match serde_json::from_str::<serde_json::Value>(raw) {
                    Ok(data) => {
                        // Check for Reddit errors
                        if let Some(errors) = data.get("json").and_then(|j| j.get("errors")).and_then(|e| e.as_array()) {
                            if !errors.is_empty() {
                                let error_msg = errors[0].as_array()
                                    .and_then(|arr| arr.get(1))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Reddit rejected the post");
                                return Ok(WebViewPublishResult {
                                    id: String::new(),
                                    url: String::new(),
                                    success: false,
                                    error: Some(error_msg.to_string()),
                                });
                            }
                        }

                        // Extract post ID
                        let post_id = data.get("json")
                            .and_then(|j| j.get("data"))
                            .and_then(|d| d.get("id"))
                            .and_then(|i| i.as_str())
                            .map(|s| s.to_string())
                            .or_else(|| {
                                data.get("json")
                                    .and_then(|j| j.get("data"))
                                    .and_then(|d| d.get("name"))
                                    .and_then(|n| n.as_str())
                                    .map(|s| s.to_string())
                            });

                        if let Some(id) = post_id {
                            let url_val = data.get("json")
                                .and_then(|j| j.get("data"))
                                .and_then(|d| d.get("url"))
                                .and_then(|u| u.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| format!("https://www.reddit.com/comments/{}/", id));

                            return Ok(WebViewPublishResult {
                                id,
                                url: url_val,
                                success: true,
                                error: None,
                            });
                        }

                        // JSON parsed but no post ID — include HTTP status
                        // + the response body so the user can see what Reddit
                        // actually returned (very likely an auth error like
                        // "USER_REQUIRED" or a 403/429 page).
                        return Ok(WebViewPublishResult {
                            id: String::new(),
                            url: String::new(),
                            success: false,
                            error: Some(format!(
                                "Reddit HTTP {} — no post ID. Body: {}",
                                http_status,
                                &raw[..raw.len().min(400)]
                            )),
                        });
                    }
                    Err(e) => {
                        // Body wasn't JSON — usually means Reddit returned an
                        // HTML error page (403, 429, 503, or a WAF block).
                        // Surface the HTTP status + first 300 chars so the
                        // user can see what happened.
                        return Ok(WebViewPublishResult {
                            id: String::new(),
                            url: String::new(),
                            success: false,
                            error: Some(format!(
                                "Reddit HTTP {} — non-JSON response (parse: {}). Body: {}",
                                http_status, e, &raw[..raw.len().min(300)]
                            )),
                        });
                    }
                }
            }

            // Check for explicit success
            let success = query.get("success").map(|s| s == "true").unwrap_or(false);
            let id = query.get("id").cloned().unwrap_or_default();
            let url_val = query.get("url").cloned().unwrap_or_default();
            let error = query.get("error").cloned();

            return Ok(WebViewPublishResult {
                id,
                url: url_val,
                success,
                error,
            });
        }

        tokio::time::sleep(poll_interval).await;
    }
}

