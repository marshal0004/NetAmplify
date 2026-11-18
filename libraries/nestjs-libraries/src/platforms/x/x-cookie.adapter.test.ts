// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/x/x-cookie.adapter.test.ts
// Vitest unit tests for XCookieAdapter.
//
// Per docs/09-TESTING-STRATEGY.md Rule #1: "Mock at the HTTP boundary only."

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { XCookieAdapter, XCookieCredentials } from './x-cookie.adapter';
import { PublishError } from '../adapter.interface';

// The X cookie adapter was rewritten to use Playwright (UI-based) instead of
// the old GraphQL API approach (commit 4145fcc). The old _resetQueryIdCacheForTests
// helper was removed because there's no more queryId caching. The tests below
// still test the OLD API approach and need to be rewritten to test the Playwright
// approach — that's a separate task. For now, define a no-op stub so the import
// doesn't crash the test runner.
const _resetQueryIdCacheForTests = (): void => {
  // No-op — queryId cache was removed when the adapter switched to Playwright.
};

function mockResponse(status: number, body: unknown, headersInit?: Record<string, string>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headersInit ?? {}),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

const VALID_AUTH_TOKEN = 'a'.repeat(40);
const VALID_CT0 = 'b'.repeat(160);
const VALID_CREDS: XCookieCredentials = {
  authToken: VALID_AUTH_TOKEN,
  ct0: VALID_CT0,
};

describe('XCookieAdapter', () => {
  let adapter: XCookieAdapter;

  beforeEach(() => {
    _resetQueryIdCacheForTests();
    adapter = new XCookieAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('has platform=TWITTER_COOKIE, kind=SIMPLE', () => {
      expect(adapter.platform).toBe('TWITTER_COOKIE');
      expect(adapter.kind).toBe('SIMPLE');
      expect(adapter.name).toContain('X');
    });

    it('configured() returns true (no env vars needed)', () => {
      expect(adapter.configured()).toBe(true);
    });
  });

  describe('validateCredentials()', () => {
    it('returns user identity on valid cookies (cookie-based — no API call)', async () => {
      // The X cookie adapter trusts the cookies (no fetch — X's WAF blocks
      // Node.js requests). It returns a synthetic identity derived from the
      // auth_token. Real validation happens at publish time via Playwright.
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await adapter.validateCredentials({
        authToken: VALID_AUTH_TOKEN,
        ct0: VALID_CT0,
      });

      expect(result.identity.id).toBe(VALID_AUTH_TOKEN.substring(0, 16));
      expect(result.identity.username).toBe('Connected via Cookie');
      expect(result.credentials.authToken).toBe(VALID_AUTH_TOKEN);
      expect(result.credentials.ct0).toBe(VALID_CT0);
      // No API call made — the adapter does not fetch X's verify_credentials.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws PublishError(VALIDATION) when authToken missing', async () => {
      await expect(
        adapter.validateCredentials({ ct0: VALID_CT0 })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when ct0 missing', async () => {
      await expect(
        adapter.validateCredentials({ authToken: VALID_AUTH_TOKEN })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when authToken is not 40-char hex', async () => {
      await expect(
        adapter.validateCredentials({ authToken: 'short', ct0: VALID_CT0 })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when ct0 is not 32-char hex', async () => {
      await expect(
        adapter.validateCredentials({ authToken: VALID_AUTH_TOKEN, ct0: 'short' })
      ).rejects.toThrow(PublishError);
    });
  });

  describe('publish()', () => {
    // NOTE: The X cookie adapter was rewritten to use Playwright (UI-based
    // publish via headless Chromium) instead of the old GraphQL API. The old
    // fetch-mocking publish tests (posts-a-tweet, AUTH/RATE/NETWORK on fetch
    // statuses, duplicate, queryId caching) were removed — they tested the
    // dead API path. Playwright-based publish cannot be unit-tested without a
    // real browser, so only the pre-Playwright VALIDATION guards are tested
    // here (text length, empty body, missing credentials). E2E coverage of
    // the Playwright publish flow lives in the curl-tests/twitter-cookie-live
    // script (run against a real backend with Chromium installed).

    it('throws PublishError(VALIDATION) when text exceeds 280 chars', async () => {
      const longText = 'x'.repeat(281);
      await expect(
        adapter.publish(VALID_CREDS, { body: longText })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when body is empty', async () => {
      await expect(
        adapter.publish(VALID_CREDS, { body: '' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when credentials missing', async () => {
      await expect(
        adapter.publish({}, { body: 'Hello' })
      ).rejects.toThrow(PublishError);
    });
  });
});
