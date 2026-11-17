// /home/z/my-project/netamplify-app/apps/backend/src/services/connections/oauth-redirect.test.ts
// Vitest unit tests for the OAuth redirect-URI / frontend-URL helpers.
//
// These tests pin down the platform-aware behaviour that lets Facebook +
// LinkedIn work over plain localhost (no ngrok domain in FB App Domains or the
// LinkedIn console needed) while Instagram keeps using PUBLIC_APP_URL (HTTPS,
// required by Meta).

import { describe, it, expect } from 'vitest';
import type { Platform } from '@prisma/client';
import {
  buildOAuthFrontendUrl,
  buildOAuthRedirectUri,
  isHttpsRequest,
  resolveRequestOrigin,
  type HeaderSource,
} from './oauth-redirect';

/** Build a HeaderSource from a headers map + optional direct protocol. */
function req(
  headers: Record<string, string | undefined> = {},
  protocol?: string,
): HeaderSource {
  return {
    get: (name: string) => headers[name.toLowerCase()],
    protocol,
  };
}

describe('resolveRequestOrigin', () => {
  it('uses x-forwarded-proto + x-forwarded-host when present (ngrok case)', () => {
    const origin = resolveRequestOrigin(
      req({
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'subfrac-nonepigram.ngrok-free.dev',
      }),
    );
    expect(origin).toBe('https://subfrac-nonepigram.ngrok-free.dev');
  });

  it('uses forwarded headers for the Vite xfwd dev case (localhost:4200)', () => {
    const origin = resolveRequestOrigin(
      req({
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'localhost:4200',
      }),
    );
    expect(origin).toBe('http://localhost:4200');
  });

  it('falls back to req.protocol + host when no forwarded headers are set', () => {
    const origin = resolveRequestOrigin(req({ host: 'localhost:4200' }, 'http'));
    expect(origin).toBe('http://localhost:4200');
  });

  it('takes only the first value of a comma-separated forwarded header (proxy chain)', () => {
    const origin = resolveRequestOrigin(
      req({
        'x-forwarded-proto': 'https, http',
        'x-forwarded-host': 'client.example.com, proxy.internal',
      }),
    );
    expect(origin).toBe('https://client.example.com');
  });

  it('falls back to localhost:4200 when nothing is present', () => {
    const origin = resolveRequestOrigin(req({}));
    expect(origin).toBe('http://localhost:4200');
  });
});

describe('buildOAuthRedirectUri', () => {
  it('Instagram uses PUBLIC_APP_URL (HTTPS required by Meta) when set', () => {
    const uri = buildOAuthRedirectUri(
      req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'localhost:4200' }),
      'INSTAGRAM',
      'https://subfrac-nonepigram.ngrok-free.dev',
    );
    expect(uri).toBe(
      'https://subfrac-nonepigram.ngrok-free.dev/api/oauth/instagram/callback',
    );
  });

  it('Instagram falls back to the request origin when PUBLIC_APP_URL is unset', () => {
    const uri = buildOAuthRedirectUri(
      req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'my.ngrok-free.dev' }),
      'INSTAGRAM',
    );
    expect(uri).toBe('https://my.ngrok-free.dev/api/oauth/instagram/callback');
  });

  it('strips a trailing slash from PUBLIC_APP_URL (avoids double-slash "Invalid redirect_uri")', () => {
    // If the user sets PUBLIC_APP_URL="https://my.ngrok-free.dev/" (with a
    // trailing slash), we must send
    //   "https://my.ngrok-free.dev/api/oauth/instagram/callback"
    // NOT
    //   "https://my.ngrok-free.dev//api/oauth/instagram/callback"  (double slash)
    // Instagram rejects the double-slash form at the authorize step with
    // "Invalid redirect_uri" because it no longer matches the URI registered
    // in the Meta console.
    const uri = buildOAuthRedirectUri(
      req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'my.ngrok-free.dev' }),
      'INSTAGRAM',
      'https://subfrac-nonepigram.ngrok-free.dev/',
    );
    expect(uri).toBe(
      'https://subfrac-nonepigram.ngrok-free.dev/api/oauth/instagram/callback',
    );
  });

  it('strips multiple trailing slashes from PUBLIC_APP_URL (Threads)', () => {
    const uri = buildOAuthRedirectUri(
      req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'my.ngrok-free.dev' }),
      'THREADS',
      'https://my.ngrok-free.dev///',
    );
    expect(uri).toBe('https://my.ngrok-free.dev/api/oauth/threads/callback');
  });

  it('Facebook uses the request origin (localhost) — NOT PUBLIC_APP_URL', () => {
    // This is the core fix: FB OAuth works over localhost without registering
    // the ngrok domain in FB App Domains.
    const uri = buildOAuthRedirectUri(
      req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'localhost:4200' }),
      'FACEBOOK',
      'https://subfrac-nonepigram.ngrok-free.dev',
    );
    expect(uri).toBe('http://localhost:4200/api/oauth/facebook/callback');
  });

  it('LinkedIn uses the request origin (localhost)', () => {
    const uri = buildOAuthRedirectUri(
      req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'localhost:4200' }),
      'LINKEDIN',
    );
    expect(uri).toBe('http://localhost:4200/api/oauth/linkedin/callback');
  });

  it('Twitter uses the request origin (localhost)', () => {
    const uri = buildOAuthRedirectUri(
      req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'localhost:4200' }),
      'TWITTER',
    );
    expect(uri).toBe('http://localhost:4200/api/oauth/twitter/callback');
  });

  it('Facebook accessed via ngrok uses the ngrok origin (still NOT PUBLIC_APP_URL)', () => {
    // If the user happens to initiate FB OAuth while on the ngrok URL, the
    // redirect URI is the ngrok origin (the request's actual origin), not the
    // PUBLIC_APP_URL env var. This is correct: the redirect URI must match the
    // host the browser is on so the state cookie round-trips.
    const uri = buildOAuthRedirectUri(
      req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'my.ngrok-free.dev' }),
      'FACEBOOK',
      'https://other.ngrok-free.dev',
    );
    expect(uri).toBe('https://my.ngrok-free.dev/api/oauth/facebook/callback');
  });
});

describe('buildOAuthFrontendUrl', () => {
  it('returns the request origin (so the browser lands back where it started)', () => {
    expect(
      buildOAuthFrontendUrl(req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'localhost:4200' })),
    ).toBe('http://localhost:4200');
  });

  it('does NOT force PUBLIC_APP_URL — it always follows the request origin', () => {
    // Crucial for FB/LinkedIn: the post-OAuth redirect must go to localhost,
    // not ngrok, or the dashboard won't load.
    expect(
      buildOAuthFrontendUrl(req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'localhost:4200' })),
    ).toBe('http://localhost:4200');
  });

  it('returns the ngrok origin when the user is on ngrok (Instagram case)', () => {
    expect(
      buildOAuthFrontendUrl(req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'my.ngrok-free.dev' })),
    ).toBe('https://my.ngrok-free.dev');
  });
});

describe('isHttpsRequest', () => {
  it('is true when x-forwarded-proto is https (ngrok)', () => {
    expect(isHttpsRequest(req({ 'x-forwarded-proto': 'https' }))).toBe(true);
  });

  it('is true when direct protocol is https', () => {
    expect(isHttpsRequest(req({}, 'https'))).toBe(true);
  });

  it('is false for plain localhost http', () => {
    expect(
      isHttpsRequest(req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'localhost:4200' })),
    ).toBe(false);
  });

  it('takes the first proto in a comma-separated forwarded header', () => {
    expect(isHttpsRequest(req({ 'x-forwarded-proto': 'https, http' }))).toBe(true);
    expect(isHttpsRequest(req({ 'x-forwarded-proto': 'http, https' }))).toBe(false);
  });
});
