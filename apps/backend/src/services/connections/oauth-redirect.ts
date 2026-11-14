// /home/z/my-project/netamplify-app/apps/backend/src/services/connections/oauth-redirect.ts
// NetAmplify — pure helpers for OAuth redirect URI + frontend URL resolution.
//
// Extracted from OAuthController so the platform-aware redirect logic is unit
// testable without standing up the full Nest request pipeline. The controller
// delegates to these helpers.
//
// Why platform-aware:
//   - Instagram + Threads REQUIRES HTTPS redirect URIs (Meta rejects
//     http://localhost), so they must use PUBLIC_APP_URL (ngrok in dev, the
//     prod URL in prod). Threads is the same Meta OAuth family as Instagram.
//   - Facebook + LinkedIn + YouTube ACCEPT http://localhost redirect URIs in
//     their dev console config, so they use the request's actual origin — no
//     need to register the ngrok domain in FB App Domains, the LinkedIn
//     console, or the Google Cloud Console.
//
// Why forwarded headers:
//   The Vite dev proxy uses `changeOrigin: true`, which rewrites the Host
//   header to the backend target (localhost:3000). With `xfwd: true` on the
//   proxy, x-forwarded-proto / x-forwarded-host carry the original client
//   origin, which we prefer here. ngrok also sets these.

import type { Platform } from '@prisma/client';

/** Minimal header-reader shape (works with Express Request or a plain object). */
export interface HeaderSource {
  get(name: string): string | undefined;
  protocol?: string;
}

/**
 * Resolve the origin the user's browser is actually on, from forwarded headers
 * first (set by ngrok + Vite's xfwd), falling back to the direct protocol/host.
 * Forwarded headers can be comma-separated lists when proxies chain; we take
 * the first (leftmost = original client).
 */
export function resolveRequestOrigin(req: HeaderSource): string {
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http')
    .split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || 'localhost:4200')
    .split(',')[0].trim();
  return `${proto}://${host}`;
}

/**
 * Build the OAuth redirect URI (where the platform sends the browser callback).
 *
 * - Instagram + Threads: PUBLIC_APP_URL (HTTPS required by Meta) → /api/oauth/<platform>/callback
 *   Falls back to the request origin only if PUBLIC_APP_URL is unset.
 *   Both are Meta-family OAuth and reject http://localhost redirect URIs.
 * - Facebook / LinkedIn / YouTube: the request's actual origin
 *   → /api/oauth/<platform>/callback (localhost works in their dev console).
 */
export function buildOAuthRedirectUri(
  req: HeaderSource,
  platform: Platform,
  publicAppUrl?: string,
): string {
  const requestOrigin = resolveRequestOrigin(req);
  // Meta-family platforms (Instagram, Threads) require HTTPS redirect URIs.
  // Route them to PUBLIC_APP_URL (ngrok in dev, prod URL in prod). All other
  // OAuth platforms (Facebook, LinkedIn, YouTube) accept http://localhost.
  if (platform === 'INSTAGRAM' || platform === 'THREADS') {
    const base = publicAppUrl || requestOrigin;
    return `${base}/api/oauth/${platform.toLowerCase()}/callback`;
  }
  return `${requestOrigin}/api/oauth/${platform.toLowerCase()}/callback`;
}

/**
 * Build the frontend URL the browser is redirected to after OAuth completes.
 * Always the request's actual origin — the user lands back on the host they
 * started from (localhost:4200 in dev, prod URL in prod, ngrok when tunneled).
 */
export function buildOAuthFrontendUrl(req: HeaderSource): string {
  return resolveRequestOrigin(req);
}

/**
 * Whether the request arrived over HTTPS (used to set the Secure flag on the
 * OAuth state cookie). True when the forwarded proto or the direct proto is https.
 */
export function isHttpsRequest(req: HeaderSource): boolean {
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http')
    .split(',')[0].trim();
  return proto === 'https';
}
