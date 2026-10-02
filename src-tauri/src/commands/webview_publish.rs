// /home/z/my-project/netamplify-app/src-tauri/src/commands/webview_publish.rs
// NetAmplify — Tauri command for publishing to X/Reddit via WebView.
//
// This is the KEY FIX for the TLS fingerprint problem. Instead of making
// the HTTP request from the Node.js backend (which uses OpenSSL and gets
// detected as a bot by X/Reddit), we make the request from inside a
// hidden Tauri WebView window.
//
// The WebView uses WebKitGTK (on Linux), which has a real browser TLS
// fingerprint (BoringSSL-equivalent). X/Reddit see it as a real browser
// request, not a bot.
//
// Flow:
//   1. Frontend calls `publish_via_webview` with the platform + cookies + post content
//   2. Tauri opens a hidden WebView window
//   3. We inject JavaScript that makes the fetch() request to X/Reddit
//   4. The fetch() runs inside the WebView (real browser TLS fingerprint)
//   5. We capture the response and return it to the frontend
//   6. Frontend shows the result in the UI
//
// This is the same approach Postiz's Chrome extension uses — the request
// is made from inside a real browser engine, not from Node.js.

use crate::commands::{CookieCaptureError, backend_url};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The request payload for publishing via WebView.
/// Sent from the frontend to the Tauri command.
#[derive(Debug, Clone, Deserialize)]
pub struct WebViewPublishRequest {
    /// The platform: "TWITTER_COOKIE" or "REDDIT_COOKIE"
    pub platform: String,
    /// The captured cookies (name → value)
    pub cookies: HashMap<String, String>,
    /// The formatted post content (from the Format Engine)
    pub formatted: FormattedPost,
    /// The user's NetAmplify JWT (for updating the PostTarget status)
    pub jwt_token: String,
    /// The PostTarget ID (so the backend can update the status)
    pub post_target_id: String,
}

/// The formatted post content from the Format Engine.
/// Matches the FormattedPost interface in the backend.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FormattedPost {
    pub title: String,
    pub body: String,
    pub url: Option<String>,
    pub hashtags: Option<Vec<String>>,
    pub options: Option<HashMap<String, serde_json::Value>>,
}

/// The result of a successful publish via WebView.
#[derive(Debug, Clone, Serialize)]
pub struct WebViewPublishResult {
    /// The platform-side post ID
    pub id: String,
    /// The public URL of the published post
    pub url: String,
    /// Whether the publish succeeded
    pub success: bool,
    /// Error message if success=false
    pub error: Option<String>,
}

/// Publish to X (Twitter) via a hidden WebView window.
///
/// This command:
///   1. Opens a hidden Tauri WebView window to x.com
///   2. Injects JavaScript that calls fetch() to the CreateTweet GraphQL endpoint
///   3. The fetch() runs inside the WebView (WebKitGTK TLS fingerprint)
///   4. Captures the response and returns it
///
/// The key insight: WebKitGTK's TLS fingerprint matches what X expects,
/// so X accepts the request. Node.js's OpenSSL fingerprint gets rejected.
#[tauri::command]
pub async fn publish_to_x_via_webview(
    app: tauri::AppHandle,
    request: WebViewPublishRequest,
) -> Result<WebViewPublishResult, CookieCaptureError> {
    log::info!("Publishing to X via WebView (TLS fingerprint bypass)...");

    let auth_token = request.cookies.get("auth_token")
        .ok_or_else(|| CookieCaptureError {
            code: "MISSING_COOKIE".to_string(),
            message: "auth_token cookie is required for X publishing".to_string(),
        })?;
    let ct0 = request.cookies.get("ct0")
        .ok_or_else(|| CookieCaptureError {
            code: "MISSING_COOKIE".to_string(),
            message: "ct0 cookie is required for X publishing".to_string(),
        })?;

    // Build the tweet text
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

    if tweet_text.len() > 280 {
        return Ok(WebViewPublishResult {
            id: String::new(),
            url: String::new(),
            success: false,
            error: Some(format!("Tweet exceeds 280 chars (got {})", tweet_text.len())),
        });
    }

    // The JavaScript to execute inside the WebView.
    // This makes the fetch() request to X's CreateTweet GraphQL endpoint.
    let js_code = format!(
        r#"
        (async () => {{
            const authToken = "{auth_token}";
            const ct0 = "{ct0}";
            const tweetText = {tweet_text_json};

            // The public Bearer token X ships in their main.js bundle
            const bearer = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuAhw6TZR0YwqHvQ%3DJqGisW7eT0YmZKb1iVpPu5pFgCqVQUO5WnLhQaLvO4";

            // First, fetch the queryId from x.com's main.js bundle
            const homeResp = await fetch("https://x.com/", {{
                headers: {{
                    "user-agent": navigator.userAgent,
                }}
            }});
            const homeHtml = await homeResp.text();
            const mainJsMatch = homeHtml.match(/https:\\/\\/abs\\.twimg\\.com\\/responsive-web\\/client-web\\/main\\.[a-z0-9]+\\.js/);
            if (!mainJsMatch) {{
                return {{ success: false, error: "Could not find main.js URL in x.com homepage" }};
            }}

            const jsResp = await fetch(mainJsMatch[0]);
            const jsBody = await jsResp.text();
            const queryIdMatch = jsBody.match(/queryId:"([A-Za-z0-9_-]+)".*?operationName:"CreateTweet"/);
            if (!queryIdMatch) {{
                return {{ success: false, error: "Could not find CreateTweet queryId in main.js" }};
            }}
            const queryId = queryIdMatch[1];

            // Now make the CreateTweet request
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
                    "cookie": `auth_token=${{authToken}}; ct0=${{ct0}}`,
                    "x-csrf-token": ct0,
                    "x-twitter-auth-type": "OAuth2Session",
                    "x-twitter-active-user": "yes",
                    "content-type": "application/json",
                }},
                body: JSON.stringify(payload),
            }});

            const data = await resp.json();
            if (data.errors && data.errors.length > 0) {{
                return {{ success: false, error: data.errors[0].message }};
            }}
            const tweetId = data.data?.create_tweet?.tweet_results?.result?.rest_id;
            if (!tweetId) {{
                return {{ success: false, error: "X returned success but no tweet ID" }};
            }}
            const screenName = data.data?.create_tweet?.tweet_results?.result?.core?.user_results?.result?.legacy?.screen_name || "i";
            return {{
                success: true,
                id: tweetId,
                url: `https://x.com/${{screenName}}/status/${{tweetId}}`,
            }};
        }})().catch(e => ({{ success: false, error: e.message }}));
        "#,
        auth_token = auth_token,
        ct0 = ct0,
        tweet_text_json = serde_json::to_string(&tweet_text).unwrap_or_else(|_| "\"\"".to_string()),
    );

    // Execute the JavaScript in a hidden WebView
    let result = execute_js_in_webview(&app, "https://x.com/home", &js_code, "x-publish").await?;

    log::info!("X publish via WebView result: {:?}", result);
    Ok(result)
}

/// Publish to Reddit via a hidden WebView window.
///
/// Same approach as X — makes the fetch() request from inside the WebView
/// so Reddit sees WebKitGTK's TLS fingerprint (not Node.js's OpenSSL).
#[tauri::command]
pub async fn publish_to_reddit_via_webview(
    app: tauri::AppHandle,
    request: WebViewPublishRequest,
) -> Result<WebViewPublishResult, CookieCaptureError> {
    log::info!("Publishing to Reddit via WebView (TLS fingerprint bypass)...");

    let token_v2 = request.cookies.get("token_v2")
        .ok_or_else(|| CookieCaptureError {
            code: "MISSING_COOKIE".to_string(),
            message: "token_v2 cookie is required for Reddit publishing".to_string(),
        })?;
    let csrf_token = request.cookies.get("csrf_token")
        .ok_or_else(|| CookieCaptureError {
            code: "MISSING_COOKIE".to_string(),
            message: "csrf_token cookie is required for Reddit publishing".to_string(),
        })?;

    let subreddit = request.formatted.options.as_ref()
        .and_then(|o| o.get("subreddit"))
        .and_then(|v| v.as_str())
        .unwrap_or("test")
        .replace("r/", "");

    let is_link_post = request.formatted.url.is_some();
    let url_or_text = if is_link_post {
        request.formatted.url.clone().unwrap_or_default()
    } else {
        request.formatted.body.clone()
    };

    // The JavaScript to execute inside the WebView
    let js_code = format!(
        r#"
        (async () => {{
            const tokenV2 = {token_v2_json};
            const csrfToken = "{csrf_token}";
            const subreddit = "{subreddit}";
            const title = {title_json};
            const kind = "{kind}";
            const content = {content_json};

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
                    "cookie": `token_v2=${{tokenV2}}; csrf_token=${{csrfToken}}`,
                    "content-type": "application/x-www-form-urlencoded",
                }},
                body: formData.toString(),
            }});

            const data = await resp.json();
            if (data.json?.errors && data.json.errors.length > 0) {{
                return {{ success: false, error: data.json.errors[0][1] }};
            }}
            const postId = data.json?.data?.id;
            if (!postId) {{
                return {{ success: false, error: "Reddit returned success but no post ID" }};
            }}
            return {{
                success: true,
                id: data.json?.data?.name || postId,
                url: `https://www.reddit.com/r/${{subreddit}}/comments/${{postId}}/`,
            }};
        }})().catch(e => ({{ success: false, error: e.message }}));
        "#,
        token_v2_json = serde_json::to_string(token_v2).unwrap_or_else(|_| "\"\"".to_string()),
        csrf_token = csrf_token,
        subreddit = subreddit,
        title_json = serde_json::to_string(&request.formatted.title).unwrap_or_else(|_| "\"\"".to_string()),
        kind = if is_link_post { "link" } else { "self" },
        content_json = serde_json::to_string(&url_or_text).unwrap_or_else(|_| "\"\"".to_string()),
    );

    let result = execute_js_in_webview(&app, "https://www.reddit.com/", &js_code, "reddit-publish").await?;

    log::info!("Reddit publish via WebView result: {:?}", result);
    Ok(result)
}

/// Execute JavaScript in a hidden WebView window and return the result.
///
/// This is the core function that makes the TLS fingerprint bypass work.
/// We open a hidden WebView, navigate to the platform's URL, then inject
/// JavaScript that makes the fetch() request. The fetch() runs inside
/// the WebView's browser engine (WebKitGTK), which has a real browser
/// TLS fingerprint.
async fn execute_js_in_webview(
    app: &tauri::AppHandle,
    url: &str,
    js_code: &str,
    window_label: &str,
) -> Result<WebViewPublishResult, CookieCaptureError> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    // Close any existing window with this label
    if let Some(existing) = app.get_webview_window(window_label) {
        let _ = existing.close();
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    let webview_url: WebviewUrl = url.parse()
        .map_err(|e| CookieCaptureError {
            code: "TAURI_ERROR".to_string(),
            message: format!("Invalid URL: {}", e),
        })?;

    let window = WebviewWindowBuilder::new(app, window_label, webview_url)
        .title("NetAmplify — Publishing...")
        .inner_size(1.0, 1.0)
        .visible(false)  // Hidden window
        .build()
        .map_err(|e| CookieCaptureError {
            code: "TAURI_ERROR".to_string(),
            message: format!("Failed to create WebView window: {}", e),
        })?;

    // Wait for the page to load
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    // Execute the JavaScript and capture the result
    let result: serde_json::Value = window.eval(js_code)
        .map_err(|e| CookieCaptureError {
            code: "JS_ERROR".to_string(),
            message: format!("Failed to execute JavaScript: {}", e),
        })?;

    // Close the hidden window
    let _ = window.close();

    // Parse the result
    let success = result.get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if success {
        let id = result.get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let url = result.get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok(WebViewPublishResult {
            id,
            url,
            success: true,
            error: None,
        })
    } else {
        let error = result.get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string();
        Ok(WebViewPublishResult {
            id: String::new(),
            url: String::new(),
            success: false,
            error: Some(error),
        })
    }
}

#[allow(unused_imports)]
use crate::commands::backend_url;
