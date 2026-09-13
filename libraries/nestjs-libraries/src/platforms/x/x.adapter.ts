// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/x/x.adapter.ts
// NetAmplify — X (Twitter) adapter.
//
// OAuth 2.0 + PKCE per docs/02-SRS.md FR-005.
// X API docs: https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code
//
// Per the previous conversation's verification: X's Free tier auto-approves
// OAuth 2.0 PKCE for basic tweet posting (instant, no review). We use the
// tweet.reply scope for posting + users.read for identity.
//
// Scopes requested (minimal per trust model):
//   - tweet.read  + tweet.write  → post on user's behalf
//   - users.read  + offline.access  → fetch identity + refresh token
//
// Per docs/02-SRS.md FR-018: X monthly post budget guard (default 450).
// The guard is implemented in the publish service (Phase 5), not here.

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

const X_AUTHORIZE_URL = 'https://twitter.com/i/v2/oauth2/authorize';
const X_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const X_API_BASE = 'https://api.twitter.com/2';

const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];

/**
 * The shape of the credentials JSON blob stored encrypted in
 * Connection.credentialsCipher for X.
 */
export interface XCredentials extends AdapterCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch seconds
  scopes: string[];
  /** X user id (for quota tracking) */
  userId?: string;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
}

@Injectable()
export class XAdapter implements PlatformAdapter {
  readonly platform: Platform = 'TWITTER';
  readonly name = 'X (Twitter)';
  readonly toolTip = 'Connect with your X account (OAuth)';
  readonly kind = 'OAUTH' as const;

  configured(): boolean {
    return Boolean(
      process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET
    );
  }

  getAuthUrl(pkce: PkcePair, state: string, redirectUri: string): string {
    if (!this.configured()) {
      throw new Error('X adapter not configured (missing TWITTER_CLIENT_ID/SECRET)');
    }
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.TWITTER_CLIENT_ID!,
      redirect_uri: redirectUri,
      scope: X_SCOPES.join(' '),
      state,
      code_challenge: pkce.code_challenge,
      code_challenge_method: pkce.code_challenge_method,
    });
    return `${X_AUTHORIZE_URL}?${params.toString()}`;
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
      throw new Error('X adapter not configured');
    }
    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: process.env.TWITTER_CLIENT_ID!,
      redirect_uri: redirectUri,
      code_verifier: pkce.code_verifier,
    });

    const resp = await fetch(X_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(
          process.env.TWITTER_CLIENT_ID!,
          process.env.TWITTER_CLIENT_SECRET!
        ),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (resp.status === 401) {
      throw new PublishError('AUTH', 'X code exchange failed (client credentials invalid)');
    }
    if (resp.status === 400) {
      const text = await resp.text();
      throw new PublishError('VALIDATION', `X rejected code: ${text}`);
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError('NETWORK', `X token exchange failed (${resp.status}): ${text}`);
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
      scopes: data.scope ? data.scope.split(' ') : X_SCOPES,
    };
  }

  /**
   * Fetch the user's identity via GET /users/me.
   * Docs: https://developer.x.com/en/docs/twitter-api/users/lookup/api-reference/get-users-me
   */
  async getIdentity(tokens: OAuthTokens): Promise<PlatformIdentity> {
    const resp = await fetch(`${X_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (resp.status === 401) {
      throw new PublishError('AUTH', 'X access token invalid or expired');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError('NETWORK', `X getIdentity failed (${resp.status}): ${text}`);
    }
    const data = (await resp.json()) as { data: { id: string; username: string; name: string } };
    if (!data.data?.id) {
      throw new PublishError('NETWORK', 'X returned no user id');
    }
    return {
      id: data.data.id,
      username: `@${data.data.username}`,
    };
  }

  /**
   * Publish a post to X. Per docs/02-SRS.md FR-011: ≤280 chars.
   *
   * Endpoint: POST /tweets
   * Docs: https://developer.x.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult> {
    const creds = credentials as XCredentials;
    if (!creds.accessToken) {
      throw new PublishError('AUTH', 'X access token missing from credentials');
    }

    // Build tweet text: title + body + tags (≤280 chars)
    const tagsLine =
      formatted.hashtags && formatted.hashtags.length > 0
        ? `\n${formatted.hashtags.map((t) => `#${t}`).join(' ')}`
        : '';
    const urlLine = formatted.url ? `\n${formatted.url}` : '';
    const text = `${formatted.title}\n${formatted.body}${urlLine}${tagsLine}`;

    // Twitter counts URLs as 23 chars (t.co wrap), but we approximate by
    // checking total length. The actual grapheme check is in the Format Engine
    // (Phase 5); the worker enforces a hard cap here.
    if (text.length > 280) {
      throw new PublishError(
        'VALIDATION',
        `Tweet exceeds 280 chars (got ${text.length})`
      );
    }

    const payload: Record<string, unknown> = { text };
    if (formatted.url) {
      // Twitter doesn't support explicit URL fields — URL is part of the text.
      // It will be auto-wrapped to a t.co URL on the server side.
    }

    const resp = await fetch(`${X_API_BASE}/tweets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (resp.status === 401) {
      throw new PublishError(
        'AUTH',
        'X access token invalid — user must reconnect'
      );
    }
    if (resp.status === 403) {
      const text = await resp.text();
      // Could be app-level monthly quota exhausted
      if (text.toLowerCase().includes('quota') || text.toLowerCase().includes('limit')) {
        throw new PublishError('QUOTA', `X quota exhausted: ${text}`);
      }
      throw new PublishError('AUTH', `X forbidden: ${text}`);
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'X rate-limited — try again later');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError('NETWORK', `X publish failed (${resp.status}): ${text}`);
    }

    const data = (await resp.json()) as {
      data?: { id: string; text: string };
      errors?: Array<{ message: string }>;
    };
    if (data.errors && data.errors.length > 0) {
      throw new PublishError(
        'VALIDATION',
        `X rejected tweet: ${data.errors.map((e) => e.message).join('; ')}`
      );
    }
    const id = data.data?.id;
    if (!id) {
      throw new PublishError('NETWORK', 'X returned no tweet id');
    }
    return {
      id,
      url: `https://x.com/i/status/${id}`,
    };
  }
}
