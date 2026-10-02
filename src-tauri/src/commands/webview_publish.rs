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
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
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

/// Wait time for the page to load before injecting JS (3 seconds).
const PAGE_LOAD_WAIT_MS: u64 = 3000;

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

                // Set cookies explicitly IF provided (non-empty).
                // If empty, rely on the WebView's cookie jar.
                if (tokenV2) {{
                    document.cookie = `token_v2=${{tokenV2}}; path=/; domain=.reddit.com; secure`;
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

                const resp = await fetch("https://www.reddit.com/api/submit", {{
                    method: "POST",
                    headers: {{
                        "authorization": `Bearer ${{tokenV2}}`,
                        "x-csrf-token": csrfToken,
                        "content-type": "application/x-www-form-urlencoded",
                    }},
                    body: formData.toString(),
                    credentials: "include",
                }});

                const data = await resp.json();

                if (data.json?.errors && data.json.errors.length > 0) {{
                    window.location.href = "http://publish-callback?error=" +
                        encodeURIComponent(data.json.errors[0][1] || "Reddit rejected the post");
                    return;
                }}

                // Reddit's /api/submit response shape varies:
                // Old Reddit: data.json.data.id, data.json.data.name, data.json.data.url
                // New Reddit: data.json.data.id, data.json.data.name
                // Sometimes: data.jquery?.[?]..[0]..
                // Try multiple paths to find the post ID
                let postId = null;
                let postName = null;
                let postUrl = null;

                // Path 1: data.json.data.id (standard)
                if (data.json?.data?.id) {{
                    postId = data.json.data.id;
                    postName = data.json.data.name || postId;
                    postUrl = data.json.data.url || `https://www.reddit.com/r/${{subreddit}}/comments/${{postId}}/`;
                }}

                // Path 2: data.jquery response (old format)
                if (!postId && data.jquery) {{
                    for (const entry of data.jquery) {{
                        if (Array.isArray(entry) && entry.length >= 4) {{
                            const inner = entry[3];
                            if (Array.isArray(inner) && inner.length > 0) {{
                                for (const item of inner) {{
                                    if (item?.data?.id) {{
                                        postId = item.data.id;
                                        postName = item.data.name || postId;
                                        postUrl = item.data.url || `https://www.reddit.com/r/${{subreddit}}/comments/${{postId}}/`;
                                        break;
                                    }}
                                }}
                            }}
                        }}
                        if (postId) break;
                    }}
                }}

                // Path 3: Check for redirect URL in the response
                if (!postId && data.json?.data?.redirect) {{
                    postUrl = data.json.data.redirect;
                    const match = postUrl.match(/comments\\/([a-z0-9]+)\\//);
                    if (match) postId = match[1];
                }}

                if (!postId) {{
                    // Log the full response for debugging
                    const debugJson = JSON.stringify(data).substring(0, 500);
                    window.location.href = "http://publish-callback?error=" +
                        encodeURIComponent("No post ID found. Response: " + debugJson);
                    return;
                }}

                window.location.href = "http://publish-callback?success=true&id=" +
                    encodeURIComponent(postName || postId) + "&url=" + encodeURIComponent(postUrl || "");
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
    // Close any existing window with this label
    if let Some(existing) = app.get_webview_window(window_label) {
        let _ = existing.close();
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    // Create a oneshot channel to receive the result from the
    // on_navigation callback. The channel sender is wrapped in
    // Arc<Mutex<Option<...>>> so the closure can take ownership
    // and send the result when the navigation occurs.
    let (tx, rx) = oneshot::channel::<WebViewPublishResult>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    // Parse the target URL
    let parsed_url = Url::parse(url).map_err(|e| CookieCaptureError {
        code: "TAURI_ERROR".to_string(),
        message: format!("Invalid URL: {}", e),
    })?;

    // Build the hidden WebView with a navigation handler.
    // The handler intercepts navigations to http://publish-callback?...
    // and extracts the result from the query parameters.
    let tx_clone = tx.clone();
    let window = WebviewWindowBuilder::new(app, window_label, WebviewUrl::External(parsed_url))
        .title("NetAmplify — Publishing...")
        .inner_size(1.0, 1.0)
        .visible(false)
        .on_navigation(move |nav_url: &Url| {
            // Check if this is our callback URL
            if nav_url.host_str() == Some("publish-callback") {
                // Parse the query parameters
                let query: std::collections::HashMap<String, String> =
                    nav_url.query_pairs()
                        .map(|(k, v)| (k.to_string(), v.to_string()))
                        .collect();

                let success = query.get("success").map(|s| s == "true").unwrap_or(false);
                let id = query.get("id").cloned().unwrap_or_default();
                let url = query.get("url").cloned().unwrap_or_default();
                let error = query.get("error").cloned();

                let result = WebViewPublishResult {
                    id,
                    url,
                    success,
                    error,
                };

                // Send the result through the channel
                if let Some(sender) = tx_clone.lock().unwrap().take() {
                    let _ = sender.send(result);
                }

                // Cancel the navigation (return false) so the WebView
                // doesn't actually navigate to the invalid callback URL
                return false;
            }
            // Allow all other navigations (page loads, redirects, etc.)
            true
        })
        .build()
        .map_err(|e| CookieCaptureError {
            code: "TAURI_ERROR".to_string(),
            message: format!("Failed to create WebView window: {}", e),
        })?;

    log::info!("Opened hidden WebView on {} for publishing", url);

    // Wait for the page to load before injecting JS.
    // 3 seconds is enough for most pages to fully load.
    tokio::time::sleep(std::time::Duration::from_millis(PAGE_LOAD_WAIT_MS)).await;

    // Inject the JavaScript that makes the fetch() request.
    // The JS will navigate to http://publish-callback?... when done.
    window.eval(js_code)
        .map_err(|e| CookieCaptureError {
            code: "JS_ERROR".to_string(),
            message: format!("Failed to execute JavaScript: {}", e),
        })?;

    // Wait for the result (with timeout).
    // The JS will navigate to http://publish-callback?... when the
    // fetch() completes. The on_navigation handler will send the
    // result through the channel.
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
