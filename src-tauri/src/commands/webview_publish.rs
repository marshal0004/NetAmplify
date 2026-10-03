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

    // Cookies may be empty — rely on WebView's cookie jar from previous login
    let token_v2 = request.cookies.get("token_v2").cloned().unwrap_or_default();
    let csrf_token = request.cookies.get("csrf_token").cloned().unwrap_or_default();
    let reddit_session = request.cookies.get("reddit_session").cloned().unwrap_or_default();

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

    let js_code = format!(
        r#"
        (async () => {{
            try {{
                const tokenV2 = {token_v2_json};
                const csrfTokenProvided = "{csrf_token}";
                const redditSession = {reddit_session_json};
                const subreddit = "{subreddit}";
                const title = {title_json};
                const kind = "{kind}";
                const content = {content_json};

                // Set non-httpOnly cookies explicitly (httpOnly cookies like
                // token_v2 CANNOT be set via document.cookie — they must
                // already be in the WebView's cookie jar from the auto-capture
                // login). Tauri WebViews share a single cookie jar, so the
                // cookies from the auto-capture window should be available.
                if (tokenV2) {{
                    // token_v2 is httpOnly — we can't set it via JS.
                    // We rely on the shared cookie jar from the auto-capture login.
                }}
                if (csrfTokenProvided) {{
                    document.cookie = `csrf_token=${{csrfTokenProvided}}; path=/; domain=.reddit.com; secure`;
                }}
                if (redditSession) {{
                    document.cookie = `reddit_session=${{redditSession}}; path=/; domain=.reddit.com; secure`;
                }}

                // Read csrf_token from cookie jar if not provided
                const csrfToken = csrfTokenProvided ||
                    document.cookie.match(/csrf_token=([^;]+)/)?.[1] || "";

                const formData = new URLSearchParams();
                formData.append("api_type", "json");
                formData.append("sr", subreddit);
                formData.append("title", title);
                formData.append("kind", kind);
                if (kind === "link") {{
                    formData.append("url", content);
                }} else {{
                    formData.append("text", content);
                }}

                // Make the request WITHOUT the Authorization header.
                // The httpOnly token_v2 cookie will be sent automatically
                // via credentials: "include" (from the shared cookie jar).
                // Adding the Authorization header without the matching
                // token_v2 cookie triggers Reddit's WAF (403 Forbidden).
                const resp = await fetch("https://www.reddit.com/api/submit", {{
                    method: "POST",
                    headers: {{
                        "x-csrf-token": csrfToken,
                        "content-type": "application/x-www-form-urlencoded",
                    }},
                    body: formData.toString(),
                    credentials: "include",
                }});

                const data = await resp.json();

                // Simple: just stringify the response and send it back.
                // We'll parse it on the Rust side to avoid JS complexity.
                const rawResponse = JSON.stringify(data).substring(0, 1500);
                window.location.href = "http://publish-callback?raw=" +
                    encodeURIComponent(rawResponse);
            }} catch (e) {{
                window.location.href = "http://publish-callback?error=" +
                    encodeURIComponent(e.message || String(e));
            }}
        }})();
        "#,
        token_v2_json = serde_json::to_string(&token_v2).unwrap_or_else(|_| "\"\"".to_string()),
        csrf_token = csrf_token,
        reddit_session_json = serde_json::to_string(&reddit_session).unwrap_or_else(|_| "\"\"".to_string()),
        subreddit = subreddit,
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
    url: &str,
    js_code: &str,
    window_label: &str,
) -> Result<WebViewPublishResult, CookieCaptureError> {
    // Create a NEW hidden WebView window with on_navigation callback.
    //
    // Tauri 2.0 WebViews share a single cookie jar (Soup session on Linux).
    // So the httpOnly cookies (token_v2, auth_token) from the auto-capture
    // login window ARE available in this new window — no need to reuse
    // the same window.
    //
    // The JS uses window.location.href = "http://publish-callback?..."
    // to send the result back. The on_navigation handler intercepts
    // this URL, parses the query params, and sends the result through
    // a oneshot channel.
    //
    // Note: __TAURI__.event.emit() does NOT work on external pages
    // (reddit.com, x.com) — the Tauri JS API is only injected on the
    // app's own pages (localhost:4200). So we MUST use navigation
    // interception, not Tauri events.

    // Close any existing window with this label
    if let Some(existing) = app.get_webview_window(window_label) {
        let _ = existing.close();
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    let (tx, rx) = oneshot::channel::<WebViewPublishResult>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let tx_clone = tx.clone();

    let parsed_url = Url::parse(url).map_err(|e| CookieCaptureError {
        code: "TAURI_ERROR".to_string(),
        message: format!("Invalid URL: {}", e),
    })?;

    let window = WebviewWindowBuilder::new(app, window_label, WebviewUrl::External(parsed_url))
        .title("NetAmplify — Publishing...")
        .inner_size(1.0, 1.0)
        .visible(false)
        .on_navigation(move |nav_url: &Url| {
            if nav_url.host_str() == Some("publish-callback") {
                let query: std::collections::HashMap<String, String> =
                    nav_url.query_pairs()
                        .map(|(k, v)| (k.to_string(), v.to_string()))
                        .collect();

                // Check for error
                if let Some(error) = query.get("error") {
                    let result = WebViewPublishResult {
                        id: String::new(),
                        url: String::new(),
                        success: false,
                        error: Some(error.clone()),
                    };
                    if let Some(sender) = tx_clone.lock().unwrap().take() {
                        let _ = sender.send(result);
                    }
                    return false;
                }

                // Check for raw response
                if let Some(raw) = query.get("raw") {
                    match serde_json::from_str::<serde_json::Value>(raw) {
                        Ok(data) => {
                            // Check for Reddit errors
                            if let Some(errors) = data.get("json").and_then(|j| j.get("errors")).and_then(|e| e.as_array()) {
                                if !errors.is_empty() {
                                    let error_msg = errors[0].as_array()
                                        .and_then(|arr| arr.get(1))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Reddit rejected the post");
                                    let result = WebViewPublishResult {
                                        id: String::new(),
                                        url: String::new(),
                                        success: false,
                                        error: Some(error_msg.to_string()),
                                    };
                                    if let Some(sender) = tx_clone.lock().unwrap().take() {
                                        let _ = sender.send(result);
                                    }
                                    return false;
                                }
                            }

                            // Try to extract post ID
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

                                let result = WebViewPublishResult {
                                    id,
                                    url: url_val,
                                    success: true,
                                    error: None,
                                };
                                if let Some(sender) = tx_clone.lock().unwrap().take() {
                                    let _ = sender.send(result);
                                }
                                return false;
                            }

                            // No post ID — return raw response as error
                            let result = WebViewPublishResult {
                                id: String::new(),
                                url: String::new(),
                                success: false,
                                error: Some(format!("No post ID in response: {}", &raw[..raw.len().min(300)])),
                            };
                            if let Some(sender) = tx_clone.lock().unwrap().take() {
                                let _ = sender.send(result);
                            }
                            return false;
                        }
                        Err(e) => {
                            let result = WebViewPublishResult {
                                id: String::new(),
                                url: String::new(),
                                success: false,
                                error: Some(format!("Parse error: {} — Raw: {}", e, &raw[..raw.len().min(200)])),
                            };
                            if let Some(sender) = tx_clone.lock().unwrap().take() {
                                let _ = sender.send(result);
                            }
                            return false;
                        }
                    }
                }

                // Check for explicit success/error
                let success = query.get("success").map(|s| s == "true").unwrap_or(false);
                let id = query.get("id").cloned().unwrap_or_default();
                let url_val = query.get("url").cloned().unwrap_or_default();
                let error = query.get("error").cloned();

                let result = WebViewPublishResult {
                    id,
                    url: url_val,
                    success,
                    error,
                };
                if let Some(sender) = tx_clone.lock().unwrap().take() {
                    let _ = sender.send(result);
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| CookieCaptureError {
            code: "TAURI_ERROR".to_string(),
            message: format!("Failed to create WebView window: {}", e),
        })?;

    log::info!("Opened hidden WebView on {} for publishing", url);

    // Wait for the page to load before injecting JS
    tokio::time::sleep(std::time::Duration::from_millis(PAGE_LOAD_WAIT_MS)).await;

    // Inject the JS
    window.eval(js_code)
        .map_err(|e| CookieCaptureError {
            code: "JS_ERROR".to_string(),
            message: format!("Failed to execute JavaScript: {}", e),
        })?;

    // Wait for the result (with timeout)
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(PUBLISH_TIMEOUT_SECS),
        rx,
    )
    .await
    .map_err(|_| CookieCaptureError {
        code: "TIMEOUT".to_string(),
        message: format!("Publish timed out after {} seconds", PUBLISH_TIMEOUT_SECS),
    })?
    .map_err(|e| CookieCaptureError {
        code: "CHANNEL_ERROR".to_string(),
        message: format!("Channel error: {}", e),
    })?;

    // Close the hidden WebView
    let _ = window.close();

    log::info!("Publish result: success={}, url={}", result.success, result.url);
    Ok(result)
}

