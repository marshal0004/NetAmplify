// /home/z/my-project/netamplify-app/src-tauri/src/commands/backend_proxy.rs
// NetAmplify — Tauri commands for proxying captured cookies to the local NestJS backend.
//
// After the Tauri WebView captures cookies from reddit.com/x.com, we need
// to send them to the local NestJS backend (running on port 3000) so it
// can:
//   1. Validate the cookies by calling the platform's identity endpoint
//   2. Encrypt them with AES-256-GCM via TokenVault
//   3. Store them in the Connection table
//   4. Return the user's platform username for the UI to display
//
// This module provides two commands:
//   - `proxy_cookie_connection`: sends captured cookies to POST /api/connections/:platform/auto-capture
//   - `get_backend_health`: checks if the backend is running (GET /api/health)

use crate::commands::{CookieCaptureError, backend_url};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Response from the NestJS backend after a successful cookie connection.
///
/// Matches the response shape of POST /api/connections/:platform/auto-capture:
///   { "id": "<connection-uuid>", "username": "<platform-username>" }
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BackendConnectionResponse {
    /// The UUID of the newly created/updated Connection row
    pub id: String,
    /// The user's platform username (e.g., "u/Marshal_The_dev0007", "@neerajrawatdev")
    pub username: String,
}

/// Response from GET /api/health — used to check if the backend is running.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BackendHealthResponse {
    /// "ok" if the backend is healthy
    pub status: String,
    /// Whether the database is connected
    pub db: bool,
    /// Whether Redis is connected
    pub redis: bool,
    /// ISO timestamp
    pub ts: String,
}

/// Proxy captured cookies to the local NestJS backend.
///
/// This command is called by the frontend AFTER `capture_reddit_cookies`
/// or `capture_x_cookies` returns successfully. It sends the captured
/// cookies to the backend's `/api/connections/:platform/auto-capture`
/// endpoint, which:
///
///   1. Receives the cookies as JSON
///   2. Validates them by calling the platform's identity endpoint
///      (Reddit: GET /api/v1/me, X: GET /1.1/account/verify_credentials.json)
///   3. Encrypts them with AES-256-GCM via TokenVault
///   4. Stores them in the Connection table
///   5. Returns the user's platform username
///
/// # Arguments
/// * `platform` — "REDDIT_COOKIE" or "TWITTER_COOKIE"
/// * `cookies` — the captured cookie map (name → value)
/// * `jwt_token` — the user's NetAmplify JWT (for authentication)
///
/// # Returns
/// * `Ok(BackendConnectionResponse)` — connection id + username on success
/// * `Err(CookieCaptureError)` — on backend error, auth failure, or validation failure
#[tauri::command]
pub async fn proxy_cookie_connection(
    platform: String,
    cookies: HashMap<String, String>,
    jwt_token: String,
) -> Result<BackendConnectionResponse, CookieCaptureError> {
    let url = format!(
        "{}/api/connections/{}/auto-capture",
        backend_url(),
        platform.to_lowercase().replace('_', "-")
    );

    log::info!("Proxying {} cookies to backend: {}", platform, url);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| CookieCaptureError {
            code: "BACKEND_ERROR".to_string(),
            message: format!("Failed to create HTTP client: {}", e),
        })?;

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", jwt_token))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "cookies": cookies }))
        .send()
        .await
        .map_err(|e| CookieCaptureError {
            code: "BACKEND_ERROR".to_string(),
            message: format!("Failed to reach the backend at {}. Is it running? Error: {}", backend_url(), e),
        })?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(CookieCaptureError {
            code: "AUTH_FAILED".to_string(),
            message: "Your NetAmplify session has expired. Please log in to NetAmplify again.".to_string(),
        });
    }

    if resp.status() == reqwest::StatusCode::BAD_REQUEST {
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let message = body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("The platform rejected your cookies. They may be expired or invalid.");
        return Err(CookieCaptureError {
            code: "VALIDATION_FAILED".to_string(),
            message: message.to_string(),
        });
    }

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(CookieCaptureError {
            code: "BACKEND_ERROR".to_string(),
            message: format!("Backend returned HTTP {}: {}", status, body),
        });
    }

    let result: BackendConnectionResponse = resp.json().await.map_err(|e| CookieCaptureError {
        code: "BACKEND_ERROR".to_string(),
        message: format!("Failed to parse backend response: {}", e),
    })?;

    log::info!("Cookie connection successful for {}: user={}", platform, result.username);
    Ok(result)
}

/// Check if the local NestJS backend is running.
///
/// Calls GET /api/health — returns the backend's health status.
/// Used by the frontend to show a "Backend: Online/Offline" indicator.
///
/// # Returns
/// * `Ok(BackendHealthResponse)` — the backend is running
/// * `Err(CookieCaptureError)` — the backend is not running or unhealthy
#[tauri::command]
pub async fn get_backend_health() -> Result<BackendHealthResponse, CookieCaptureError> {
    let url = format!("{}/api/health", backend_url());
    log::debug!("Checking backend health: {}", url);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| CookieCaptureError {
            code: "BACKEND_ERROR".to_string(),
            message: format!("Failed to create HTTP client: {}", e),
        })?;

    let resp = client.get(&url).send().await.map_err(|e| CookieCaptureError {
        code: "BACKEND_OFFLINE".to_string(),
        message: format!("Backend is not running at {}. Start it with: pnpm dev:backend. Error: {}", backend_url(), e),
    })?;

    if !resp.status().is_success() {
        return Err(CookieCaptureError {
            code: "BACKEND_UNHEALTHY".to_string(),
            message: format!("Backend returned HTTP {}", resp.status()),
        });
    }

    let health: BackendHealthResponse = resp.json().await.map_err(|e| CookieCaptureError {
        code: "BACKEND_ERROR".to_string(),
        message: format!("Failed to parse health response: {}", e),
    })?;

    Ok(health)
}
