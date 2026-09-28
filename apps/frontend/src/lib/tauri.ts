// /home/z/my-project/netamplify-app/apps/frontend/src/lib/tauri.ts
// NetAmplify — Tauri bridge for the frontend.
//
// This module provides a typed interface for invoking Tauri commands from
// the React frontend. It detects whether the app is running inside Tauri
// (desktop mode) or in a regular browser (web mode) and gracefully
// falls back when Tauri is not available.
//
// When running in Tauri:
//   - Cookie capture uses native WebView windows (zero copy-paste)
//   - The user clicks "Connect via Auto-Capture" → Tauri opens reddit.com/login
//   - User logs in normally → Tauri reads cookies → sends to backend
//
// When running in browser (no Tauri):
//   - Cookie capture falls back to the manual copy-paste form
//   - The user must use the Cookie-Editor extension + paste values manually
//   - This is the legacy flow (kept for users who can't/won't install the desktop app)

/// Type representing the result of a Tauri cookie capture operation.
/// Must match the `CookieCaptureResult` struct in `src-tauri/src/commands/mod.rs`.
export interface CookieCaptureResult {
  /** The platform identifier (e.g., "TWITTER_COOKIE", "REDDIT_COOKIE") */
  platform: string;
  /** The captured cookies as a key-value map (cookie name → value) */
  cookies: Record<string, string>;
  /** The user's platform username (may be empty if not extractable from cookies) */
  username: string;
  /** The user's platform account ID (may be empty if not extractable from cookies) */
  user_id: string;
  /** ISO 8601 timestamp of when the cookies were captured */
  captured_at: string;
}

/// Type representing the error from a Tauri cookie capture operation.
/// Must match the `CookieCaptureError` struct in `src-tauri/src/commands/mod.rs`.
export interface CookieCaptureError {
  /** Error code: "USER_CANCELLED", "TIMEOUT", "NO_COOKIES", "BACKEND_ERROR", etc. */
  code: string;
  /** Human-readable error message (shown in the UI) */
  message: string;
}

/// Type representing the response from the backend's auto-capture endpoint.
export interface BackendConnectionResponse {
  id: string;
  username: string;
}

/// Type representing the backend health status.
export interface BackendHealth {
  status: string;
  db: boolean;
  redis: boolean;
  ts: string;
}

/**
 * Detect whether the app is running inside a Tauri WebView.
 *
 * Tauri 2.0 injects a global `window.__TAURI_INTERNALS__` object when the
 * frontend is loaded inside a Tauri window. We check for this to determine
 * whether Tauri commands are available.
 *
 * In dev mode (Vite dev server on localhost:4200), Tauri loads the frontend
 * from the dev URL and the global is present. In production, Tauri loads
 * the bundled frontend dist.
 *
 * @returns true if running inside Tauri, false if running in a browser
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  // Tauri 2.0 injects `__TAURI_INTERNALS__` (not `__TAURI__` like 1.0)
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

/**
 * Invoke a Tauri command by name.
 *
 * This is a thin wrapper around `window.__TAURI_INTERNALS__.invoke()` that
 * adds type safety and error normalization. If Tauri is not available
 * (running in browser), it throws an error indicating that the feature
 * requires the desktop app.
 *
 * @param command — the Tauri command name (e.g., "capture_reddit_cookies")
 * @param args — the command arguments (serialized as JSON)
 * @returns the command result (deserialized from JSON)
 * @throws Error if Tauri is not available or the command fails
 */
async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(
      `This feature requires the NetAmplify desktop app. Please download it from https://netamplify.com/download or use the manual cookie input form below.`
    );
  }

  // Access the Tauri invoke function. In Tauri 2.0, it's available at
  // `window.__TAURI_INTERNALS__.invoke` or via the `@tauri-apps/api` package.
  const tauriInternals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<T> };
    __TAURI__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<T> };
  });

  const invoke = tauriInternals.__TAURI_INTERNALS__?.invoke ?? tauriInternals.__TAURI__?.invoke;

  if (!invoke) {
    throw new Error(
      `Tauri is detected but the invoke function is not available. This may be a Tauri version mismatch.`
    );
  }

  return invoke(command, args);
}

/**
 * Capture Reddit session cookies via the Tauri WebView.
 *
 * When called in Tauri:
 *   1. Opens a native window to reddit.com/login
 *   2. User logs in normally (types username + password into Reddit's real form)
 *   3. Tauri reads cookies from the WebView's cookie jar (including httpOnly)
 *   4. Returns the captured cookies
 *
 * When called in browser:
 *   Throws an error directing the user to the manual cookie input form.
 *
 * @returns the captured cookies + user identity
 * @throws CookieCaptureError on failure
 */
export async function captureRedditCookies(): Promise<CookieCaptureResult> {
  return invokeTauri<CookieCaptureResult>('capture_reddit_cookies');
}

/**
 * Capture X (Twitter) session cookies via the Tauri WebView.
 *
 * Same flow as `captureRedditCookies` but for x.com.
 *
 * @returns the captured cookies + user identity
 * @throws CookieCaptureError on failure
 */
export async function captureXCookies(): Promise<CookieCaptureResult> {
  return invokeTauri<CookieCaptureResult>('capture_x_cookies');
}

/**
 * Check if a Reddit `token_v2` JWT has expired.
 *
 * Decodes the JWT payload and checks the `exp` field against the current
 * time. Returns true if the token has expired or will expire within 1 hour
 * (proactive refresh).
 *
 * @param token — the Reddit `token_v2` JWT string
 * @returns true if the token is expired or about to expire
 */
export async function checkCookieExpiry(token: string): Promise<boolean> {
  return invokeTauri<boolean>('check_cookie_expiry', { token });
}

/**
 * Refresh Reddit cookies by re-opening the login window.
 *
 * If the long-lived `token` cookie is still valid, Reddit auto-logs in
 * and issues a fresh `token_v2` without user interaction. If it has
 * expired, the user types their password (3 seconds).
 *
 * @returns the fresh captured cookies
 * @throws CookieCaptureError on failure
 */
export async function refreshRedditCookies(): Promise<CookieCaptureResult> {
  return invokeTauri<CookieCaptureResult>('refresh_reddit_cookies');
}

/**
 * Refresh X cookies by re-opening the login window.
 *
 * @returns the fresh captured cookies
 * @throws CookieCaptureError on failure
 */
export async function refreshXCookies(): Promise<CookieCaptureResult> {
  return invokeTauri<CookieCaptureResult>('refresh_x_cookies');
}

/**
 * Proxy captured cookies to the local NestJS backend.
 *
 * After Tauri captures cookies, the frontend calls this to send them
 * to the backend's `/api/connections/:platform/auto-capture` endpoint.
 * The backend validates the cookies by calling the platform's identity
 * endpoint, then encrypts + stores them.
 *
 * @param platform — "REDDIT_COOKIE" or "TWITTER_COOKIE"
 * @param cookies — the captured cookie map
 * @param jwtToken — the user's NetAmplify JWT for authentication
 * @returns the connection ID + platform username
 * @throws CookieCaptureError on failure
 */
export async function proxyCookieConnection(
  platform: string,
  cookies: Record<string, string>,
  jwtToken: string
): Promise<BackendConnectionResponse> {
  return invokeTauri<BackendConnectionResponse>('proxy_cookie_connection', {
    platform,
    cookies,
    jwtToken,
  });
}

/**
 * Check if the local NestJS backend is running.
 *
 * @returns the backend health status
 * @throws CookieCaptureError if the backend is offline
 */
export async function getBackendHealth(): Promise<BackendHealth> {
  return invokeTauri<BackendHealth>('get_backend_health');
}

/**
 * Start the NestJS backend sidecar process.
 *
 * In the desktop app, the backend runs as a child process. This command
 * starts it (if not already running). Returns the PID.
 *
 * @returns the PID of the backend process
 */
export async function startBackendSidecar(): Promise<number> {
  return invokeTauri<number>('start_backend_sidecar');
}

/**
 * Stop the NestJS backend sidecar process.
 */
export async function stopBackendSidecar(): Promise<void> {
  return invokeTauri<void>('stop_backend_sidecar');
}

/**
 * High-level convenience function: capture cookies + proxy to backend.
 *
 * This is the main function called by the ConnectChecklist UI when the
 * user clicks "Connect via Auto-Capture". It:
 *   1. Opens the native login window (Tauri)
 *   2. Captures cookies after the user logs in
 *   3. Sends the cookies to the backend for validation + storage
 *   4. Returns the user's platform username
 *
 * @param platform — "REDDIT_COOKIE" or "TWITTER_COOKIE"
 * @param jwtToken — the user's NetAmplify JWT
 * @returns the connection ID + platform username
 * @throws CookieCaptureError on failure (with user-friendly error message)
 */
export async function captureAndConnect(
  platform: 'REDDIT_COOKIE' | 'TWITTER_COOKIE',
  jwtToken: string
): Promise<BackendConnectionResponse> {
  // Step 1: Capture cookies via Tauri WebView
  const captureResult = platform === 'REDDIT_COOKIE'
    ? await captureRedditCookies()
    : await captureXCookies();

  // Step 2: Proxy cookies to the backend for validation + storage
  const connection = await proxyCookieConnection(platform, captureResult.cookies, jwtToken);

  return connection;
}
