// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/wordpress/wordpress.adapter.ts
// NetAmplify — WordPress adapter.
//
// WordPress (self-hosted 5.6+ or WordPress.com) exposes a REST API at
// /wp-json/wp/v2/ that accepts HTTP Basic Auth with an Application
// Password (per https://developer.wordpress.org/rest-api/using-the-rest-api/application-passwords/).
//
// Application Passwords:
//   - Generated in the WordPress admin (Users → Profile → Application
//     Passwords).
//   - 24-char alphanumeric strings, separated by spaces for readability
//     (e.g., "abcd wxyz 1234 5678 efgh ijkl mnop qrst uvwx yz01").
//   - WordPress also accepts the password with spaces stripped.
//
// The flow:
//   1. User logs into their WordPress admin
//   2. Goes to Users → Profile → Application Passwords
//   3. Creates a new app password named "NetAmplify"
//   4. Copies the password + their username + their site URL
//   5. Pastes all three into NetAmplify
//
// NetAmplify validates by calling GET /wp-json/wp/v2/users/me (Basic
// Auth). Publishing uses POST /wp-json/wp/v2/posts.

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
 * Connection.credentialsCipher for WordPress.
 *
 * - `siteUrl`: the WordPress site's base URL (e.g.,
 *   "https://blog.example.com" — no trailing slash). Can be a custom
 *   domain, a WordPress.com subdomain, or a self-hosted install.
 * - `username`: the WordPress user's login name (e.g., "neeraj")
 * - `appPassword`: the 24-char Application Password (spaces optional)
 */
export interface WordPressCredentials extends AdapterCredentials {
  siteUrl: string;
  username: string;
  appPassword: string;
}

/**
 * Normalize the user-supplied site URL:
 *   - Trim whitespace
 *   - Strip trailing slash
 *   - Ensure protocol prefix (default https://)
 *
 * Returns the normalized site URL (e.g., "https://blog.example.com")
 * or throws PublishError('VALIDATION') if the input is malformed.
 */
function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new PublishError('VALIDATION', 'WordPress site URL is required');
  }
  let withProtocol = trimmed;
  if (!/^https?:\/\//i.test(withProtocol)) {
    withProtocol = `https://${withProtocol}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new PublishError('VALIDATION', `Invalid WordPress site URL: "${raw}"`);
  }
  return parsed.origin;
}

/**
 * Build the HTTP Basic Auth header value (RFC 7617).
 * Format: Basic base64(username:password)
 *
 * WordPress Application Passwords support the password with or without
 * spaces — we strip spaces to maximize compatibility (some HTTP clients
 * mishandle spaces in Basic Auth credentials).
 */
function buildBasicAuthHeader(creds: WordPressCredentials): string {
  const cleanedPassword = creds.appPassword.replace(/\s+/g, '');
  const raw = `${creds.username}:${cleanedPassword}`;
  return 'Basic ' + Buffer.from(raw, 'utf8').toString('base64');
}

@Injectable()
export class WordPressAdapter implements PlatformAdapter {
  readonly platform: Platform = 'WORDPRESS';
  readonly name = 'WordPress';
  readonly toolTip = 'Paste your WordPress site URL + username + app password';
  readonly kind = 'SIMPLE' as const;

  configured(): boolean {
    // User-pasted credentials — no env vars needed.
    return true;
  }

  /**
   * Validate the user-pasted WordPress credentials by calling
   * /wp-json/wp/v2/users/me (Basic Auth). Returns the user's id +
   * username (slug).
   *
   * Endpoint: GET /wp-json/wp/v2/users/me
   * Docs: https://developer.wordpress.org/rest-api/reference/users/#example-request
   */
  async validateCredentials(
    input: Record<string, string>
  ): Promise<{ identity: PlatformIdentity; credentials: WordPressCredentials }> {
    const rawSiteUrl = input.siteUrl;
    const username = input.username;
    const appPassword = input.appPassword;

    if (!rawSiteUrl || typeof rawSiteUrl !== 'string') {
      throw new PublishError('VALIDATION', 'WordPress site URL is required');
    }
    if (!username || typeof username !== 'string') {
      throw new PublishError('VALIDATION', 'WordPress username is required');
    }
    if (!appPassword || typeof appPassword !== 'string') {
      throw new PublishError('VALIDATION', 'WordPress app password is required');
    }

    // Application passwords are 24 chars (when spaces removed). We allow
    // leniency for non-standard formats but reject obviously broken inputs.
    const cleanedPassword = appPassword.replace(/\s+/g, '');
    if (cleanedPassword.length < 16) {
      throw new PublishError(
        'VALIDATION',
        'WordPress app password looks too short — copy the full password from your WordPress admin (Users → Profile → Application Passwords)'
      );
    }

    const siteUrl = normalizeSiteUrl(rawSiteUrl);
    const creds: WordPressCredentials = { siteUrl, username, appPassword };

    const resp = await fetch(`${siteUrl}/wp-json/wp/v2/users/me?context=edit`, {
      method: 'GET',
      headers: {
        Authorization: buildBasicAuthHeader(creds),
        accept: 'application/json',
      },
    });

    if (resp.status === 401) {
      throw new PublishError(
        'AUTH',
        'WordPress credentials are invalid — verify the username + app password match your account'
      );
    }
    if (resp.status === 403) {
      throw new PublishError(
        'AUTH',
        'WordPress rejected the app password — Application Passwords may be disabled on this site (enable in WordPress admin or use a site running WordPress 5.6+)'
      );
    }
    if (resp.status === 404) {
      throw new PublishError(
        'VALIDATION',
        `WordPress REST API not found at "${siteUrl}/wp-json/" — check the site URL or enable the REST API in WordPress settings`
      );
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'WordPress is rate-limiting — try again later');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `WordPress validation failed (${resp.status}): ${text.slice(0, 200)}`
      );
    }

    const data = (await resp.json()) as {
      id?: number;
      name?: string;
      slug?: string;
      username?: string;
    };
    if (!data.id || !data.slug) {
      throw new PublishError(
        'NETWORK',
        'WordPress users/me returned no user id — response shape may have changed'
      );
    }

    return {
      identity: {
        id: String(data.id),
        username: data.slug ?? data.username ?? data.name ?? 'user',
      },
      credentials: creds,
    };
  }

  /**
   * Publish a post to WordPress. Per docs/02-SRS.md FR-011:
   *   WordPress: full markdown/HTML body, title, optional tags as
   *   categories; published immediately (no draft).
   *
   * Endpoint: POST /wp-json/wp/v2/posts
   * Docs: https://developer.wordpress.org/rest-api/reference/posts/#create-a-post
   *
   * The body is sent as the `content` field (raw HTML/Markdown). WordPress
   * stores it as post_content; the active theme's rendering pipeline
   * handles Markdown/HTML conversion at display time.
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult> {
    const creds = credentials as WordPressCredentials;
    if (!creds.siteUrl || !creds.username || !creds.appPassword) {
      throw new PublishError('AUTH', 'WordPress credentials missing — user must reconnect');
    }

    if (!formatted.title || formatted.title.length === 0) {
      throw new PublishError('VALIDATION', 'WordPress post title is required');
    }
    if (formatted.title.length > 200) {
      throw new PublishError(
        'VALIDATION',
        `WordPress title exceeds 200 chars (got ${formatted.title.length})`
      );
    }
    const body = formatted.body ?? '';
    if (body.length === 0) {
      throw new PublishError('VALIDATION', 'WordPress post body is empty');
    }
    if (body.length > 100000) {
      throw new PublishError(
        'VALIDATION',
        `WordPress body exceeds 100000 chars (got ${body.length}) — split into multiple posts`
      );
    }

    // Build the post payload — status=publish means it goes live immediately
    const payload: {
      title: string;
      content: string;
      status: 'publish';
      excerpt?: string;
    } = {
      title: formatted.title,
      content: body,
      status: 'publish',
    };

    // Add summary as excerpt (≤200 chars per WordPress schema)
    if (formatted.title && formatted.title.length > 0) {
      const excerptSource = body.replace(/[#*_>`]/g, '').slice(0, 200);
      payload.excerpt = excerptSource;
    }

    const resp = await fetch(`${creds.siteUrl}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: {
        Authorization: buildBasicAuthHeader(creds),
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (resp.status === 401) {
      throw new PublishError(
        'AUTH',
        'WordPress credentials are invalid — user must reconnect'
      );
    }
    if (resp.status === 403) {
      const text = await resp.text();
      throw new PublishError(
        'AUTH',
        `WordPress rejected the post (403 — user may lack publish_posts capability): ${text.slice(0, 200)}`
      );
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'WordPress is rate-limiting — try again later');
    }
    if (resp.status === 400 || resp.status === 422) {
      const text = await resp.text();
      throw new PublishError('VALIDATION', `WordPress rejected post: ${text.slice(0, 200)}`);
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `WordPress publish failed (${resp.status}): ${text.slice(0, 300)}`
      );
    }

    const data = (await resp.json()) as {
      id?: number;
      link?: string;
      slug?: string;
    };
    if (!data.id) {
      throw new PublishError(
        'NETWORK',
        'WordPress returned success but no post id — response shape may have changed'
      );
    }

    const url = data.link ?? `${creds.siteUrl}/?p=${data.id}`;
    return {
      id: String(data.id),
      url,
    };
  }
}
