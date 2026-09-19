// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/reddit/reddit-cookie.adapter.ts
// NetAmplify — Reddit cookie-based adapter (modern JWT auth flow).
//
// Per docs/01-PRD.md §6 (Cookie Method — Option A):
//   "Bypass Reddit's manual developer review by using the user's
//    session cookies to call Reddit's internal API — the same endpoints
//    reddit.com uses when a user clicks 'Submit' in their browser.
//    Same approach Postiz takes. ToS-risky but functional."
//
// Required user-supplied credentials (extracted from reddit.com cookies
// via the Cookie-Editor browser extension):
//
//   1. `token` cookie (JWT, ~500-2000 chars)
//      - The modern Reddit web app's primary authentication cookie
//      - Format: header.payload.signature (3 base64url-encoded parts
//        separated by dots)
//      - Contains the user's Reddit user ID (`sub` field, format: t2_xxx)
//      - Issued via SSO flow (`amr: ["sso"]`, `cid: "cookie"`)
//      - Lifetime: ~6 months from issue date
//      - Sent both as a cookie AND as the Authorization: Bearer header
//
//   2. `csrf_token` cookie (32-char hex)
//      - CSRF protection token
//      - Must be sent as the `x-CSRF-TOKEN` header on POST/PUT/DELETE
//      - Must match the cookie value (Reddit validates this server-side)
//
// How Reddit's internal API works (reverse-engineered, publicly
// documented at https://github.com/reddit-archive/reddit/wiki/JSON):
//
//   1. The reddit.com web app uses /api/{action} endpoints (not OAuth).
//   2. Each authenticated request requires:
//        - Authorization: Bearer <JWT>
//        - cookie: token=<JWT>; csrf_token=<csrf>;
//        - x-CSRF-TOKEN: <csrf>           (must match the cookie)
//        - User-Agent: a real browser UA (Reddit 403s non-browser UAs)
//        - Origin + Referer: https://www.reddit.com
//   3. Submitting a post:
//        - POST /api/submit with form-encoded body:
//            kind: link | self
//            sr: <subreddit>
//            title: <title>
//            url: <url>          (for kind=link)
//            text: <markdown>     (for kind=self)
//            api_type: json
//
// Validation: GET /api/v1/me — returns the user's username + id.
//
// Trust model: cookies stored encrypted (AES-256-GCM) in
// Connection.credentialsCipher. User can revoke by logging out of
// reddit.com on any device (which invalidates the JWT server-side).

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
 * Reddit's internal (non-OAuth) API endpoints. These match what a real
 * browser sends when submitting a post on reddit.com.
 */
const REDDIT_VERIFY_URL = 'https://www.reddit.com/api/v1/me';
const REDDIT_SUBMIT_URL = 'https://www.reddit.com/api/submit';

/**
 * A realistic browser User-Agent. Reddit 403s requests with non-browser
 * or generic UAs (e.g. "axios/1.0"). This is the same UA Chrome ships
 * on Linux x86_64.
 */
const REDDIT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * The shape of the credentials JSON blob stored encrypted in
 * Connection.credentialsCipher for Reddit cookie-based connections.
 *
 * - `token`:     the `token` cookie value (JWT, ~500-2000 chars).
 *                The modern Reddit web app's primary auth cookie.
 * - `csrfToken`: the `csrf_token` cookie value (32-char hex string).
 *                CSRF protection — sent as both a cookie AND the
 *                `x-CSRF-TOKEN` header (must match).
 */
export interface RedditCookieCredentials extends AdapterCredentials {
  token: string;
  csrfToken: string;
}

/**
 * Build the Cookie header value from credentials.
 * Per RFC 6265 §4.2.1 — semicolon-separated name=value pairs.
 *
 * Sends BOTH the JWT (`token`) and the CSRF token (`csrf_token`) cookies,
 * matching the modern Reddit web app's exact behavior.
 */
function buildCookieHeader(creds: RedditCookieCredentials): string {
  return `token=${creds.token}; csrf_token=${creds.csrfToken}`;
}

/**
 * Build the standard set of headers required by Reddit's internal API.
 *
 * Per Reddit's web app reverse-engineering (verified 2025-09):
 *   - Authorization: Bearer <JWT>   (the `token` cookie value, as a header)
 *   - x-CSRF-TOKEN: <csrf>         (must match the csrf_token cookie)
 *   - cookie: token=<JWT>; csrf_token=<csrf>;
 *   - User-Agent: must look like a real browser
 *   - Origin + Referer: https://www.reddit.com (prevents CSRF rejection)
 */
function buildRedditHeaders(creds: RedditCookieCredentials): Record<string, string> {
  return {
    authorization: `Bearer ${creds.token}`,
    'x-csrf-token': creds.csrfToken,
    cookie: buildCookieHeader(creds),
    'user-agent': REDDIT_USER_AGENT,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    origin: 'https://www.reddit.com',
    referer: 'https://www.reddit.com/',
  };
}

/**
 * Classify Reddit's HTTP status into our error taxonomy per
 * docs/03-ARCHITECTURE.md "Failure Classification".
 */
function classifyStatus(status: number): 'AUTH' | 'RATE' | 'VALIDATION' | 'NETWORK' {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE';
  if (status >= 400 && status < 500) return 'VALIDATION';
  return 'NETWORK';
}

@Injectable()
export class RedditCookieAdapter implements PlatformAdapter {
  readonly platform: Platform = 'REDDIT_COOKIE';
  readonly name = 'Reddit — Cookie';
  readonly toolTip = 'Paste your reddit.com session cookies (token JWT + csrf_token)';
  readonly kind = 'SIMPLE' as const;

  configured(): boolean {
    // Cookie-based — no env vars needed.
    return true;
  }

  /**
   * Validate the user-pasted Reddit session cookies by calling
   * /api/v1/me. Returns the user's id + username.
   *
   * Endpoint: GET /api/v1/me
   * Returns: { id, name, comment_karma, link_karma, ... } on success.
   *
   * Reddit's anti-bot system may reject requests from cloud IPs with
   * HTTP 401 even when the cookies are valid. Users should test from
   * their own residential IP (their Arch machine).
   */
  async validateCredentials(
    input: Record<string, string>
  ): Promise<{ identity: PlatformIdentity; credentials: RedditCookieCredentials }> {
    const token = input.token;
    const csrfToken = input.csrfToken;

    if (!token || typeof token !== 'string') {
      throw new PublishError('VALIDATION', 'token cookie (JWT) is required');
    }
    if (!csrfToken || typeof csrfToken !== 'string') {
      throw new PublishError('VALIDATION', 'csrf_token cookie is required');
    }

    // JWT format validation: 3 dot-separated base64url-encoded parts
    // (header.payload.signature). Each part uses [A-Za-z0-9_-] chars.
    if (token.length < 100) {
      throw new PublishError(
        'VALIDATION',
        'token (JWT) looks too short — copy the full cookie value (it should be a long string with 2 dots)'
      );
    }
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      throw new PublishError(
        'VALIDATION',
        'token must be a JWT with 3 dot-separated parts (header.payload.signature)'
      );
    }

    // csrf_token is a 32-char hex string
    if (!/^[a-f0-9]{32}$/i.test(csrfToken)) {
      throw new PublishError(
        'VALIDATION',
        'csrf_token must be 32 hex chars (0-9, a-f) — copy the cookie value exactly'
      );
    }

    const creds: RedditCookieCredentials = { token, csrfToken };

    const resp = await fetch(REDDIT_VERIFY_URL, {
      method: 'GET',
      headers: {
        ...buildRedditHeaders(creds),
        accept: 'application/json',
      },
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new PublishError(
        'AUTH',
        'Reddit cookies are invalid, expired, or Reddit rejected the request IP — log in to reddit.com and re-export your cookies, or test from a residential IP'
      );
    }
    if (resp.status === 429) {
      throw new PublishError('RATE', 'Reddit is rate-limiting cookie validation — try again in 60s');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Reddit cookie validation failed (${resp.status}): ${text.slice(0, 200)}`
      );
    }

    const data = (await resp.json()) as {
      id?: string;
      name?: string;
    };
    if (!data.id || !data.name) {
      throw new PublishError(
        'NETWORK',
        'Reddit /api/v1/me returned no user id — response shape may have changed'
      );
    }

    return {
      identity: {
        id: data.id,
        username: `u/${data.name}`,
      },
      credentials: creds,
    };
  }

  /**
   * Publish a submission to Reddit via the internal /api/submit endpoint.
   *
   * Endpoint: POST /api/submit
   * Content-Type: application/x-www-form-urlencoded
   *
   * Two modes based on the Format Engine output:
   *   - If `formatted.url` is set: kind=link (link post with title + url)
   *   - Otherwise: kind=self (text post with title + markdown body)
   *
   * The subreddit is passed via `formatted.options.subreddit` (required).
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult> {
    const creds = credentials as RedditCookieCredentials;
    if (!creds.token || !creds.csrfToken) {
      throw new PublishError('AUTH', 'Reddit cookie credentials missing — user must reconnect');
    }

    const subreddit = (formatted.options?.subreddit as string | undefined)?.replace(/^r\//, '');
    if (!subreddit || typeof subreddit !== 'string' || subreddit.length === 0) {
      throw new PublishError(
        'VALIDATION',
        'Subreddit is required for Reddit posts — set it in the publish options'
      );
    }
    if (!/^[A-Za-z0-9_]{3,21}$/.test(subreddit)) {
      throw new PublishError(
        'VALIDATION',
        `Invalid subreddit name "${subreddit}" — must be 3-21 alphanumeric/underscore chars`
      );
    }

    if (!formatted.title || formatted.title.length === 0) {
      throw new PublishError('VALIDATION', 'Reddit post title is required');
    }
    if (formatted.title.length > 300) {
      throw new PublishError(
        'VALIDATION',
        `Reddit title exceeds 300 chars (got ${formatted.title.length})`
      );
    }

    const isLinkPost = Boolean(formatted.url);
    const body = formatted.body ?? '';
    if (body.length > 40000) {
      throw new PublishError(
        'VALIDATION',
        `Reddit body exceeds 40000 chars (got ${body.length})`
      );
    }

    const formParams = new URLSearchParams({
      api_type: 'json',
      sr: subreddit,
      title: formatted.title,
      kind: isLinkPost ? 'link' : 'self',
      ...(isLinkPost
        ? { url: formatted.url as string }
        : { text: body }),
    });

    const resp = await fetch(REDDIT_SUBMIT_URL, {
      method: 'POST',
      headers: {
        ...buildRedditHeaders(creds),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formParams.toString(),
    });

    const errorClass = classifyStatus(resp.status);
    if (errorClass === 'AUTH') {
      const text = await resp.text();
      throw new PublishError(
        'AUTH',
        `Reddit rejected the post (${resp.status}) — cookies may be expired or Reddit blocked the request IP: ${text.slice(0, 200)}`
      );
    }
    if (errorClass === 'RATE') {
      throw new PublishError('RATE', 'Reddit is rate-limiting — try again in a few minutes');
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Reddit publish failed (${resp.status}): ${text.slice(0, 300)}`
      );
    }

    const data = (await resp.json()) as {
      json?: {
        errors?: Array<[string, string, string]>;
        data?: {
          id?: string;
          url?: string;
          name?: string;
        };
      };
    };

    // Reddit's API returns errors as an array of [field, message, code]
    if (data.json?.errors && data.json.errors.length > 0) {
      const first = data.json.errors[0];
      const field = first[0];
      const message = first[1];
      const code = first[2];

      // Common error: SUBREDDIT_NOTALLOWED → AUTH (user can't post there)
      if (code === 'SUBREDDIT_NOTALLOWED' || code === 'QUOTA_FILLED') {
        throw new PublishError('AUTH', `Reddit rejected: ${message} (code ${code})`);
      }
      // Common error: RATELIMIT → RATE
      if (code === 'RATELIMIT') {
        throw new PublishError('RATE', `Reddit rate-limited: ${message}`);
      }
      throw new PublishError(
        'VALIDATION',
        `Reddit rejected post (${field}): ${message} (code ${code})`
      );
    }

    const postId = data.json?.data?.id;
    const postName = data.json?.data?.name;
    if (!postId) {
      throw new PublishError(
        'NETWORK',
        'Reddit returned success but no post id — response shape may have changed'
      );
    }

    // Construct permalink. Reddit returns "t3_<id>" as the post name;
    // the human URL is /r/<subreddit>/comments/<id>/...
    // We don't know the slug, so we use the bare comments URL which
    // Reddit redirects to the canonical slug.
    const permalink = `https://www.reddit.com/r/${subreddit}/comments/${postId}/`;

    return {
      id: postName ?? postId,
      url: permalink,
    };
  }
}
