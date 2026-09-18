// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/reddit/reddit-cookie.adapter.ts
// NetAmplify — Reddit cookie-based adapter.
//
// Per docs/01-PRD.md §6 (Cookie Method — Option A):
//   "Bypass Reddit's manual developer review by using the user's
//    session cookies to call Reddit's internal API — the same endpoints
//    reddit.com uses when a user clicks 'Submit' in their browser.
//    Same approach Postiz takes. ToS-risky but functional."
//
// Required user-supplied credentials (extracted from reddit.com cookies
// via a browser extension like Cookie-Editor):
//   - redditSession: the `reddit_session` cookie value (long string)
//   - token:          the `token` cookie value (used as modhash-like CSRF)
//
// How Reddit's internal API works (reverse-engineered, publicly
// documented at https://github.com/reddit-archive/reddit/wiki/JSON):
//   1. The reddit.com web app uses /api/{action} endpoints (not OAuth).
//   2. Each request requires:
//        - cookie: reddit_session=...; token=...
//        - User-Agent: a real browser UA (Reddit 403s empty/generic UAs)
//        - content-type: application/x-www-form-urlencoded (for POSTs)
//   3. Submitting a post:
//        - POST /api/submit with form-encoded body:
//            kind: link | self
//            sr: <subreddit>
//            title: <title>
//            url: <url>          (for kind=link)
//            text: <markdown>     (for kind=self)
//            api_type: json
//            uh: <modhash>        (optional in modern Reddit, but kept
//                                  for backwards compat)
//
// Validation: GET /api/v1/me — returns the user's username + id.
//
// Trust model: cookies stored encrypted (AES-256-GCM) in
// Connection.credentialsCipher. User can revoke by logging out of
// reddit.com on any device.

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
 * - `redditSession`: the `reddit_session` cookie value (long URL-encoded
 *   string with `%7C` separators)
 * - `token`:          the `token` cookie value (short string, ~32 chars)
 */
export interface RedditCookieCredentials extends AdapterCredentials {
  redditSession: string;
  token: string;
}

/**
 * Build the Cookie header from credentials.
 * Per RFC 6265 §4.2.1 — semicolon-separated name=value pairs.
 */
function buildCookieHeader(creds: RedditCookieCredentials): string {
  return `reddit_session=${creds.redditSession}; token=${creds.token}`;
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
  readonly toolTip = 'Paste your reddit.com session cookies (reddit_session + token)';
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
   */
  async validateCredentials(
    input: Record<string, string>
  ): Promise<{ identity: PlatformIdentity; credentials: RedditCookieCredentials }> {
    const redditSession = input.redditSession;
    const token = input.token;

    if (!redditSession || typeof redditSession !== 'string') {
      throw new PublishError('VALIDATION', 'reddit_session cookie is required');
    }
    if (!token || typeof token !== 'string') {
      throw new PublishError('VALIDATION', 'token cookie is required');
    }
    // reddit_session is a long URL-encoded string (~200-400 chars)
    if (redditSession.length < 50) {
      throw new PublishError(
        'VALIDATION',
        'reddit_session looks too short — copy the full cookie value (it should be a long string with %7C separators)'
      );
    }
    // token is typically a ~32-char alphanumeric string
    if (token.length < 16) {
      throw new PublishError(
        'VALIDATION',
        'token cookie looks too short — copy the full cookie value'
      );
    }

    const creds: RedditCookieCredentials = { redditSession, token };
    const resp = await fetch(REDDIT_VERIFY_URL, {
      method: 'GET',
      headers: {
        cookie: buildCookieHeader(creds),
        'user-agent': REDDIT_USER_AGENT,
        accept: 'application/json',
        'accept-language': 'en-US,en;q=0.5',
      },
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new PublishError(
        'AUTH',
        'Reddit cookies are invalid or expired — log in to reddit.com and re-export your cookies'
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
    if (!creds.redditSession || !creds.token) {
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
        cookie: buildCookieHeader(creds),
        'user-agent': REDDIT_USER_AGENT,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'accept-language': 'en-US,en;q=0.5',
        origin: 'https://www.reddit.com',
        referer: 'https://www.reddit.com/',
      },
      body: formParams.toString(),
    });

    const errorClass = classifyStatus(resp.status);
    if (errorClass === 'AUTH') {
      const text = await resp.text();
      throw new PublishError(
        'AUTH',
        `Reddit rejected the post (${resp.status}) — cookies may be expired: ${text.slice(0, 200)}`
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
