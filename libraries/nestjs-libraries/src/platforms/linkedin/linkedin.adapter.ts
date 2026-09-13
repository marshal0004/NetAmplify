// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/linkedin/linkedin.adapter.ts
// NetAmplify — LinkedIn adapter.
//
// OAuth 2.0 + PKCE per docs/02-SRS.md FR-005.
// LinkedIn API docs: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
//
// Scopes requested (minimal per trust model):
//   - openid  + profile  → fetch user identity
//   - w_member_social  → post on user's behalf
//
// LinkedIn's "limited access" dev mode (instant, no review) allows posting
// on behalf of up to 10 test users that you add to your LinkedIn developer
// app. For the Sept 20-24 demo, that's sufficient.
//
// Per docs/01-PRD.md §7: if not configured (env vars missing), the Connect
// Checklist shows "Setup pending" — no errors.

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

const LINKEDIN_AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';

const LINKEDIN_SCOPES = ['openid', 'profile', 'w_member_social'];

/**
 * The shape of the credentials JSON blob stored encrypted in
 * Connection.credentialsCipher for LinkedIn.
 */
export interface LinkedInCredentials extends AdapterCredentials {
  accessToken: string;
  expiresAt?: number; // epoch seconds
  scopes: string[];
  /** LinkedIn member id (sub claim from id_token) */
  memberId?: string;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
}

@Injectable()
export class LinkedInAdapter implements PlatformAdapter {
  readonly platform: Platform = 'LINKEDIN';
  readonly name = 'LinkedIn';
  readonly toolTip = 'Connect with your LinkedIn account (OAuth)';
  readonly kind = 'OAUTH' as const;

  configured(): boolean {
    return Boolean(
      process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET
    );
  }

  getAuthUrl(pkce: PkcePair, state: string, redirectUri: string): string {
    if (!this.configured()) {
      throw new Error('LinkedIn adapter not configured (missing LINKEDIN_CLIENT_ID/SECRET)');
    }
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      redirect_uri: redirectUri,
      scope: LINKEDIN_SCOPES.join(' '),
      state,
      code_challenge: pkce.code_challenge,
      code_challenge_method: pkce.code_challenge_method,
    });
    return `${LINKEDIN_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for access token.
   * Per RFC 6749 — LinkedIn accepts client_id/secret in the body OR via Basic auth.
   */
  async exchangeCode(
    code: string,
    pkce: PkcePair,
    redirectUri: string
  ): Promise<OAuthTokens> {
    if (!this.configured()) {
      throw new Error('LinkedIn adapter not configured');
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
      code_verifier: pkce.code_verifier,
    });

    const resp = await fetch(LINKEDIN_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (resp.status === 401 || resp.status === 400) {
      const text = await resp.text();
      throw new PublishError('AUTH', `LinkedIn code exchange failed: ${text}`);
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError('NETWORK', `LinkedIn token exchange failed (${resp.status}): ${text}`);
    }

    const data = (await resp.json()) as {
      access_token: string;
      expires_in?: number;
      scope?: string;
      refresh_token?: string;
      id_token?: string;
    };

    // Decode the id_token to get the member id (sub claim)
    let memberId: string | undefined;
    if (data.id_token) {
      const parts = data.id_token.split('.');
      if (parts.length >= 2) {
        try {
          const payload = JSON.parse(
            Buffer.from(parts[1], 'base64').toString('utf8')
          ) as { sub?: string };
          memberId = payload.sub;
        } catch {
          // ignore — memberId is optional
        }
      }
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? Math.floor(Date.now() / 1000) + data.expires_in
        : undefined,
      scopes: data.scope ? data.scope.split(' ') : LINKEDIN_SCOPES,
      // Custom field — stored in the encrypted blob
      // Cast because OAuthTokens doesn't have memberId, but we store it in the Connection
      ...(memberId ? ({ memberId } as Record<string, unknown>) : {}),
    } as OAuthTokens;
  }

  /**
   * Fetch the user's identity via /userinfo (OpenID Connect).
   * Docs: https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access-token
   */
  async getIdentity(tokens: OAuthTokens): Promise<PlatformIdentity> {
    const resp = await fetch(`${LINKEDIN_API_BASE}/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (resp.status === 401) {
      throw new PublishError('AUTH', 'LinkedIn access token invalid or expired');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError('NETWORK', `LinkedIn getIdentity failed (${resp.status}): ${text}`);
    }
    const data = (await resp.json()) as { sub: string; name?: string; given_name?: string; family_name?: string };
    if (!data.sub) {
      throw new PublishError('NETWORK', 'LinkedIn returned no sub (member id)');
    }
    return {
      id: data.sub,
      username: data.name || `${data.given_name ?? ''} ${data.family_name ?? ''}`.trim() || data.sub,
    };
  }

  /**
   * Publish a post to LinkedIn via the UGC Posts API.
   * Per docs/02-SRS.md FR-011: plain text ≤3000 chars, no markdown.
   *
   * Endpoint: POST /ugcPosts
   * Docs: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/ugc-posts-api
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult> {
    const creds = credentials as LinkedInCredentials;
    if (!creds.accessToken) {
      throw new PublishError('AUTH', 'LinkedIn access token missing from credentials');
    }
    const authorUrn = creds.memberId ? `urn:li:person:${creds.memberId}` : undefined;
    if (!authorUrn) {
      throw new PublishError(
        'AUTH',
        'LinkedIn memberId missing — user must reconnect to republish their identity'
      );
    }

    // LinkedIn shares text content (no markdown, line breaks preserved).
    // Per FR-011: ≤3000 chars, ≤3 hashtags, link on own line.
    const text = `${formatted.title}\n\n${formatted.body}\n${formatted.url || ''}`.trim();
    if (text.length > 3000) {
      throw new PublishError(
        'VALIDATION',
        `LinkedIn post exceeds 3000 chars (got ${text.length})`
      );
    }

    const payload = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    };

    const resp = await fetch(`${LINKEDIN_API_BASE}/ugcPosts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(payload),
    });

    if (resp.status === 401) {
      throw new PublishError(
        'AUTH',
        'LinkedIn access token invalid — user must reconnect'
      );
    }
    if (resp.status === 403) {
      const text = await resp.text();
      if (text.toLowerCase().includes('scope') || text.toLowerCase().includes('permission')) {
        throw new PublishError(
          'AUTH',
          'LinkedIn app not in "limited access" dev mode — add the user as a test user in LinkedIn developer console'
        );
      }
      throw new PublishError('AUTH', `LinkedIn forbidden: ${text}`);
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'LinkedIn rate-limited — try again later');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError('NETWORK', `LinkedIn publish failed (${resp.status}): ${text}`);
    }

    const data = (await resp.json()) as { id: string; activity?: string };
    if (!data.id) {
      throw new PublishError('NETWORK', 'LinkedIn returned no post id');
    }
    // LinkedIn doesn't return a public URL in the API response; the post is
    // visible on the user's LinkedIn feed at their profile URL.
    return {
      id: data.id,
      url: `https://www.linkedin.com/feed/update/${data.id}/`,
    };
  }
}
