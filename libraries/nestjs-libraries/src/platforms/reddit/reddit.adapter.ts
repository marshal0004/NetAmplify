// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/reddit/reddit.adapter.ts
// NetAmplify — Reddit adapter.
//
// OAuth 2.0 + PKCE per docs/02-SRS.md FR-005.
// Reddit API docs: https://www.reddit.com/dev/api/oauth
//
// Scopes requested (minimal per trust model):
//   - identity  → fetch the user's username for the "Connected as @x" display
//   - submit    → post submissions on the user's behalf
//
// Reddit uses a per-user OAuth rate limit (60 req/min by default), so this
// adapter does not need a global rate limiter — each user's token has its
// own bucket.

import { Injectable } from '@nestjs/common';
import type {
  PlatformAdapter,
  PkcePair,
  OAuthTokens,
  PlatformIdentity,
  AdapterCredentials,
  FormattedPost,
  PublishResult,
} from '../adapter.interface';
import { PublishError } from '../adapter.interface';
import type { Platform } from '@prisma/client';

/**
 * Reddit's OAuth 2.0 endpoints.
 */
const REDDIT_AUTHORIZE_URL = 'https://www.reddit.com/api/v1/authorize';
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const REDDIT_API_BASE = 'https://oauth.reddit.com';

/**
 * The minimum scopes NetAmplify requests — per the trust model, we ask
 * only for what we need (post + read identity), never for full account
 * access.
 */
const REDDIT_SCOPES = ['identity', 'submit'];

/**
 * The shape of the credentials JSON blob stored encrypted in
 * Connection.credentialsCipher for Reddit.
 */
export interface RedditCredentials extends AdapterCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch seconds
  scopes: string[];
}

/**
 * Reddit requires the client credentials as a Basic Auth header (HTTP Basic
 * with client_id:client_secret, base64-encoded). This is per RFC 6749 §2.3.1.
 */
function basicAuthHeader(clientId: string, clientSecret: string): string {
  const raw = `${clientId}:${clientSecret}`;
  return 'Basic ' + Buffer.from(raw, 'utf8').toString('base64');
}

/**
 * Detect Reddit API error class from an HTTP response.
 * Per docs/03-ARCHITECTURE.md "Failure Classification":
 *   401/403 + "invalid_grant" → AUTH (revoked)
 *   429 → RATE
 *   4xx (other) → VALIDATION
 *   5xx + network → NETWORK
 */
function classifyHttpError(
  status: number,
  body: string
): 'AUTH' | 'RATE' | 'VALIDATION' | 'NETWORK' {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE';
  if (status >= 400 && status < 500) return 'VALIDATION';
  return 'NETWORK';
}

@Injectable()
export class RedditAdapter implements PlatformAdapter {
  readonly platform: Platform = 'REDDIT';
  readonly name = 'Reddit';
  readonly toolTip = 'Connect with your Reddit account (OAuth)';
  readonly kind = 'OAUTH' as const;

  configured(): boolean {
    return Boolean(
      process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET
    );
  }

  /**
   * Build the Reddit authorize URL. User is redirected here from the
   * Connect Checklist; Reddit shows the consent screen, then redirects
   * back to our /api/oauth/reddit/callback with code + state.
   */
  getAuthUrl(pkce: PkcePair, state: string, redirectUri: string): string {
    if (!this.configured()) {
      throw new Error('Reddit adapter not configured (missing REDDIT_CLIENT_ID/SECRET)');
    }
    const params = new URLSearchParams({
      client_id: process.env.REDDIT_CLIENT_ID!,
      response_type: 'code',
      state,
      redirect_uri: redirectUri,
      duration: 'permanent', // request a refresh token
      scope: REDDIT_SCOPES.join(' '),
      code_challenge: pkce.code_challenge,
      code_challenge_method: pkce.code_challenge_method,
    });
    return `${REDDIT_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for access + refresh tokens.
   * Per RFC 6749 §4.1.3 — uses HTTP Basic auth with client credentials.
   */
  async exchangeCode(
    code: string,
    pkce: PkcePair,
    redirectUri: string
  ): Promise<OAuthTokens> {
    if (!this.configured()) {
      throw new Error('Reddit adapter not configured');
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: pkce.code_verifier,
    });

    const resp = await fetch(REDDIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(
          process.env.REDDIT_CLIENT_ID!,
          process.env.REDDIT_CLIENT_SECRET!
        ),
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'NetAmplify/1.0 (by /u/netamplify)',
      },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      const errorClass = classifyHttpError(resp.status, text);
      throw new PublishError(
        errorClass === 'AUTH' ? 'AUTH' : 'VALIDATION',
        `Reddit token exchange failed (${resp.status}): ${text}`
      );
    }

    const data = (await resp.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? Math.floor(Date.now() / 1000) + data.expires_in
        : undefined,
      scopes: data.scope ? data.scope.split(' ') : REDDIT_SCOPES,
    };
  }

  /**
   * Fetch the user's identity (id + username) using the access token.
   * Used to display "Connected as @username" on the Connect Checklist.
   */
  async getIdentity(tokens: OAuthTokens): Promise<PlatformIdentity> {
    const resp = await fetch(`${REDDIT_API_BASE}/api/v1/me`, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'User-Agent': 'NetAmplify/1.0 (by /u/netamplify)',
      },
    });
    if (!resp.ok) {
      const text = await resp.text();
      const errorClass = classifyHttpError(resp.status, text);
      throw new PublishError(
        errorClass === 'AUTH' ? 'AUTH' : 'NETWORK',
        `Reddit getIdentity failed (${resp.status}): ${text}`
      );
    }
    const data = (await resp.json()) as { id: string; name: string };
    return {
      id: data.id,
      username: data.name,
    };
  }

  /**
   * Publish a post to Reddit. Per FR-011, the Format Engine produces
   * { title, body, options: { subreddit } }; we submit as a link-post
   * if `url` is present, otherwise a self-post (markdown body).
   *
   * Endpoint: POST /api/submit
   * Docs: https://www.reddit.com/dev/api/oauth#POST_api_submit
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult> {
    const creds = credentials as RedditCredentials;
    const subreddit = (formatted.options?.subreddit as string) || 'test';
    if (!subreddit) {
      throw new PublishError(
        'VALIDATION',
        'Reddit publish requires options.subreddit'
      );
    }

    const body = new URLSearchParams({
      sr: subreddit,
      kind: formatted.url ? 'link' : 'self',
      title: formatted.title,
      ...(formatted.url ? { url: formatted.url } : {}),
      ...(formatted.body ? { text: formatted.body } : {}),
      api_type: 'json',
    });

    const resp = await fetch(`${REDDIT_API_BASE}/api/submit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'NetAmplify/1.0 (by /u/netamplify)',
      },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      const errorClass = classifyHttpError(resp.status, text);
      throw new PublishError(
        errorClass,
        `Reddit publish failed (${resp.status}): ${text}`
      );
    }

    const data = (await resp.json()) as {
      json?: {
        errors?: Array<unknown[]>;
        data?: { id?: string; url?: string; permalink?: string };
      };
    };

    // Reddit returns 200 even on validation errors (subreddit banned, etc.)
    if (data.json?.errors && data.json.errors.length > 0) {
      const errMsg = JSON.stringify(data.json.errors);
      throw new PublishError(
        'VALIDATION',
        `Reddit rejected submission: ${errMsg}`
      );
    }

    const id = data.json?.data?.id;
    const permalink = data.json?.data?.permalink;
    if (!id || !permalink) {
      throw new PublishError(
        'NETWORK',
        'Reddit returned no post id/permalink (unexpected response shape)'
      );
    }
    return {
      id,
      url: permalink.startsWith('http')
        ? permalink
        : `https://www.reddit.com${permalink}`,
    };
  }
}
