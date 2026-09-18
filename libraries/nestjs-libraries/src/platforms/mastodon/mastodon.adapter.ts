// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/mastodon/mastodon.adapter.ts
// NetAmplify — Mastodon adapter.
//
// Mastodon's API is documented, free, has no paywall, and uses OAuth 2.0
// per https://docs.joinmastodon.org/api/. Each Mastodon instance has its
// own OAuth server, so a NetAmplify user must create an application on
// THEIR instance (e.g., mastodon.social/settings/applications) and paste
// the access token here. This is similar to how Dev.to works.
//
// The flow:
//   1. User goes to https://<their-instance>/settings/applications/new
//   2. Creates a new application with `write:statuses` scope
//   3. Copies the access token
//   4. Pastes the instance URL + access token into NetAmplify
//
// NetAmplify validates by calling GET /api/v1/accounts/verify_credentials,
// which returns the user's account id + username. Publishing uses POST
// /api/v1/statuses.
//
// This is the proper, official, ToS-compliant way to post to Mastodon
// from a third-party app. No cookie scraping required.

import { Injectable } from '@nestjs/common';
import type {
  PlatformAdapter,
  PlatformIdentity,
  AdapterCredentials,
  FormattedPost,
  PublishResult,
} from '../adapter.interface';
import { PublishError } from '../adapter.interface';
import type { Platform } from '@prisma/client';

/**
 * The shape of the credentials JSON blob stored encrypted in
 * Connection.credentialsCipher for Mastodon.
 *
 * - `instance`: the Mastodon instance base URL (e.g.,
 *   "https://mastodon.social" — no trailing slash)
 * - `accessToken`: the OAuth 2.0 access token from the user's
 *   application on their instance (must have `write:statuses` scope)
 */
export interface MastodonCredentials extends AdapterCredentials {
  instance: string;
  accessToken: string;
}

/**
 * Normalize the user-supplied instance URL:
 *   - Trim whitespace
 *   - Strip trailing slash
 *   - Ensure protocol prefix (default https://)
 *   - Reject URLs with paths (instance must be origin only)
 *
 * Returns the normalized instance URL (e.g., "https://mastodon.social")
 * or throws PublishError('VALIDATION') if the input is malformed.
 */
function normalizeInstanceUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new PublishError('VALIDATION', 'Mastodon instance URL is required');
  }
  let withProtocol = trimmed;
  if (!/^https?:\/\//i.test(withProtocol)) {
    withProtocol = `https://${withProtocol}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new PublishError('VALIDATION', `Invalid Mastodon instance URL: "${raw}"`);
  }
  // Instance must be origin only (no path, no query, no hash)
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new PublishError(
      'VALIDATION',
      `Mastodon instance URL must be origin only (e.g., "https://mastodon.social") — got "${raw}"`
    );
  }
  return parsed.origin;
}

@Injectable()
export class MastodonAdapter implements PlatformAdapter {
  readonly platform: Platform = 'MASTODON';
  readonly name = 'Mastodon';
  readonly toolTip = 'Paste your Mastodon instance URL + access token';
  readonly kind = 'SIMPLE' as const;

  configured(): boolean {
    // User-pasted credentials — no env vars needed.
    return true;
  }

  /**
   * Validate the user-pasted Mastodon access token by calling
   * /api/v1/accounts/verify_credentials. Returns the user's account id
   * + username (full handle including instance).
   *
   * Endpoint: GET /api/v1/accounts/verify_credentials
   * Docs: https://docs.joinmastodon.org/methods/accounts/#verify_credentials
   */
  async validateCredentials(
    input: Record<string, string>
  ): Promise<{ identity: PlatformIdentity; credentials: MastodonCredentials }> {
    const rawInstance = input.instance;
    const accessToken = input.accessToken;

    if (!rawInstance || typeof rawInstance !== 'string') {
      throw new PublishError('VALIDATION', 'Mastodon instance URL is required');
    }
    if (!accessToken || typeof accessToken !== 'string') {
      throw new PublishError('VALIDATION', 'Mastodon access token is required');
    }
    if (accessToken.length < 20) {
      throw new PublishError(
        'VALIDATION',
        'Mastodon access token looks too short — copy the full token from your instance settings'
      );
    }

    const instance = normalizeInstanceUrl(rawInstance);
    const creds: MastodonCredentials = { instance, accessToken };

    const resp = await fetch(`${instance}/api/v1/accounts/verify_credentials`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
    });

    if (resp.status === 401) {
      throw new PublishError(
        'AUTH',
        'Mastodon access token is invalid — regenerate it from your instance settings'
      );
    }
    if (resp.status === 403) {
      throw new PublishError(
        'AUTH',
        'Mastodon access token lacks required scopes — ensure the app has `write:statuses` scope'
      );
    }
    if (resp.status === 404) {
      throw new PublishError(
        'VALIDATION',
        `Mastodon instance "${instance}" not found — check the URL`
      );
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'Mastodon is rate-limiting — try again later');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Mastodon validation failed (${resp.status}): ${text.slice(0, 200)}`
      );
    }

    const data = (await resp.json()) as {
      id?: string;
      username?: string;
      acct?: string;
      url?: string;
    };
    if (!data.id || !data.acct) {
      throw new PublishError(
        'NETWORK',
        'Mastodon verify_credentials returned no account id — response shape may have changed'
      );
    }

    // acct is "username" (without @) for the user's own instance, or
    // "username@instance.other" for remote. We use the full URL field
    // if available (it's always canonical).
    const username = data.url
      ? `@${data.acct}` // Mastodon convention: @user@instance
      : `@${data.acct}`;

    return {
      identity: {
        id: data.id,
        username,
      },
      credentials: creds,
    };
  }

  /**
   * Publish a status to Mastodon. Per docs/02-SRS.md FR-011:
   *   Mastodon: ≤500 chars; supports hashtags via #tag; supports
   *   markdown-ish (line breaks preserved, links auto-linked).
   *
   * Endpoint: POST /api/v1/statuses
   * Docs: https://docs.joinmastodon.org/methods/statuses/#create
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult> {
    const creds = credentials as MastodonCredentials;
    if (!creds.instance || !creds.accessToken) {
      throw new PublishError('AUTH', 'Mastodon credentials missing — user must reconnect');
    }

    // Build the status text — Format Engine already truncated to ≤500 chars
    const tagsLine =
      formatted.hashtags && formatted.hashtags.length > 0
        ? `\n\n${formatted.hashtags.map((t) => `#${t}`).join(' ')}`
        : '';
    const urlLine = formatted.url ? `\n\n${formatted.url}` : '';
    const text = `${formatted.body}${urlLine}${tagsLine}`.trim();

    if (text.length === 0) {
      throw new PublishError('VALIDATION', 'Mastodon status text is empty after formatting');
    }
    if (text.length > 500) {
      throw new PublishError(
        'VALIDATION',
        `Mastodon status exceeds 500 chars (got ${text.length}) — Format Engine truncation failed`
      );
    }

    const formParams = new URLSearchParams({
      status: text,
      visibility: 'public',
    });

    const resp = await fetch(`${creds.instance}/api/v1/statuses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: formParams.toString(),
    });

    if (resp.status === 401) {
      throw new PublishError(
        'AUTH',
        'Mastodon access token is invalid or expired — user must reconnect'
      );
    }
    if (resp.status === 403) {
      throw new PublishError(
        'AUTH',
        'Mastodon access token lacks write:statuses scope — user must recreate the app with proper scopes'
      );
    }
    if (resp.status === 422) {
      const text = await resp.text();
      throw new PublishError('VALIDATION', `Mastodon rejected status: ${text.slice(0, 200)}`);
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'Mastodon is rate-limiting — try again later');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Mastodon publish failed (${resp.status}): ${text.slice(0, 300)}`
      );
    }

    const data = (await resp.json()) as {
      id?: string;
      url?: string;
      uri?: string;
    };
    if (!data.id) {
      throw new PublishError(
        'NETWORK',
        'Mastodon returned success but no status id — response shape may have changed'
      );
    }

    // Prefer the public URL (e.g., https://mastodon.social/@user/123)
    // Fall back to the URI (ActivityPub URI) if no public URL.
    const url = data.url ?? data.uri ?? `${creds.instance}/@me/${data.id}`;
    return {
      id: data.id,
      url,
    };
  }
}
