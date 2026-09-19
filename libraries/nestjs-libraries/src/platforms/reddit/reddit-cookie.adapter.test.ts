// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/reddit/reddit-cookie.adapter.test.ts
// Vitest unit tests for RedditCookieAdapter.
//
// Per docs/09-TESTING-STRATEGY.md Rule #1: "Mock at the HTTP boundary only."
//
// Uses the modern Reddit cookie auth flow:
//   - token_v2 cookie (JWT, ~1500-2500 chars) — primary auth, has scopes including "submit"
//   - csrf_token cookie (32-char hex) — CSRF protection, sent as x-CSRF-TOKEN header
//   - token cookie (JWT, ~500-2000 chars, OPTIONAL) — legacy fallback, has no scopes

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RedditCookieAdapter, RedditCookieCredentials } from './reddit-cookie.adapter';
import { PublishError } from '../adapter.interface';

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

// Valid JWT shape (header.payload.signature) — each part is base64url.
const JWT_HEADER_V2 = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IlNIQTI1NjpzS3dsMnlsV0VtMjVmcXhwTU40cWY4MXE2OWFFdWFyMnpLMUdhVGxjdWNZIiwidHlwIjoiSldUIn0';
const JWT_PAYLOAD_V2 = 'eyJzdWIiOiJ1c2VyIiwiZXhwIjoxNzg5ODc5MDA1LjczMDM4MywiaWF0IjoxNzg5NzkyNjA1LjczMDM4MywianRpIjoiRFIyVXMyR0d3cHJ5WGQ1V0FPeGVqX0FRV2VjZ2d3IiwiY2lkIjoiMFItV0FNaHVvby1NeVEiLCJsaWQiOiJ0Ml8yYm5qOHBubTlhIiwiYWlkIjoidDJfMmJuajhwbm05YSIsImF0IjoxLCJsY2EiOjE3NzUzNTE0NTUwNDAsInNjcCI6ImVKeGtrVkhPM0RBSWhPX0NzMF9RcTFSVjVkaGtGelUyRWVDczl2WVZXWk9OOUw4TjhHVU1rOS1RcTJJbGctUktNRmRJZ0MzVEJnbDJJdS1Yd3FPZlJPODhlc0dHM1JRU0ZNRmE2WlRUWTkweUNTUjRraHJMR3hKUXhXNWtMamM2c09XZUh3Z0pHdGZDZmFYSHBVMW9HY2JpZG8xcldEV3VHMDlxN3RXNGRyYnB3dmJFLUdabnRTa1Z0X1dqVFBLNlV2a1VMX3JuTjdXM2p1VzdfUzUwWk1PR3F2bUIzcGxKQ080c2Zycm13OTlUazFGc0NGYTE5M2FTT3BaMjNxNWowU0swT0hkODF2UFhaakl1cDJsNVp2dDExeThodzF1ZTF6RHFBR2FzTVk4eXhwRjF6Szg2Z01ZVkpSdExFTjlHSUZjdWZfMlhZTDgyX1RtNGZlS0g3MGJjOVliZm1vRjZMa0djLWlWa0NIXy1Ed0FRMWVUUiIsInJjaWQiOiJra2tWc2oyTllPNVd6LVYwWWpoU2o0b2FHa0hoQVFpNTF3UDVsRTlQMlIwIiwiZmxvIjoyfQ';
const JWT_SIG_V2 = 'Y6nf4z2MklyAncn5xF8ugmFcE0LVMGZorYnQ4thnBzWy1rAKVMlDRVIxOsTnDl4mbP0hTK1ZbVdRaSYNEitJlMZV-z49GB9yd6j4fbFShgcdUffhM7s4aRFunAusSmTQR4u3Dr83___DH5z5qXdX5uBpViKECO4_grGopztdbBEG9hR9uDOfgwSL8pvYYdtkj_2b_UQl_ZEs2W4bUVvMy7ptcuUf1OxPDRUu35Hg8Ud8UmgsuTaY4DQ--dWyvQNqxLnN6PAnr6idA1Sm8GCmR7b79FLtavQqExyrJwbuSQhDXPmS51akQoA7Y4I5h0g7yik7ToZoRCK8mQObwycbhg';
const VALID_TOKEN_V2 = `${JWT_HEADER_V2}.${JWT_PAYLOAD_V2}.${JWT_SIG_V2}`;

// Legacy `token` cookie (optional, no scopes)
const JWT_HEADER_LEGACY = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IlNIQTI1NjpsVFdYNlFVUEloWktaRG1rR0pVd1gvdWNFK01BSjBYRE12RU1kNzVxTXQ4IiwidHlwIjoiSldUIn0';
const JWT_PAYLOAD_LEGACY = 'eyJzdWIiOiJ0Ml8yYm5qOHBubTlhIiwiZXhwIjoxODA1MjA4MjUxLjU3NTk1OSwiaWF0IjoxNzg5NTY5ODUxLjU3NTk1OSwianRpIjoibXdVdXp4MEZIallIY2lVeTFRMzZfZGNwYjlTZU5nIiwiYXQiOjEsImNpZCI6ImNvb2tpZSIsImxjYSI6MTc3NTM1MTQ1NTA0MCwic2NwIjoiZUp3QUFnRDlfMXRkQXdBQkZRQzUiLCJmbG8iOjMsImFtciI6WyJzc28iXX0';
const JWT_SIG_LEGACY = 'i_sh3PJq3MLXxk7yWrsebpXdGM6Gul2uPyOLw5AfrVZN6340_vTdPWTVkG0sNfmeoaGGxb3xAet9BT2-_U_uXEVB9Cx1pHEm3o35V3gdGAxPcrqoSiiEPM_LDt36GxqUb-LVgCST6wu0Bg4imCP4tz6nlEzdNjaR13DZ6mJ7jPF0Hsh2ZnMe8mu0LEIr-Iq3EwWTsGcJ_xGZdJ7IE-cmUs5tx5tRCrUSuxx9AbEw3UW6a_NJWexEjBA1vZdP96v2I6rtkeQ37nzoN70XQSdI5zwikwTWXNb8qJRR4eLlSlUpnf-6IgPeuiqeJCwrm23cuH8RE7R3XxddeAd-OA-djQ';
const VALID_TOKEN_LEGACY = `${JWT_HEADER_LEGACY}.${JWT_PAYLOAD_LEGACY}.${JWT_SIG_LEGACY}`;

const VALID_CSRF = '38347fc606021458b4069a77822832cf';

const VALID_CREDS: RedditCookieCredentials = {
  tokenV2: VALID_TOKEN_V2,
  csrfToken: VALID_CSRF,
};

const VALID_CREDS_WITH_LEGACY: RedditCookieCredentials = {
  tokenV2: VALID_TOKEN_V2,
  csrfToken: VALID_CSRF,
  token: VALID_TOKEN_LEGACY,
};

describe('RedditCookieAdapter', () => {
  let adapter: RedditCookieAdapter;

  beforeEach(() => {
    adapter = new RedditCookieAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('has platform=REDDIT_COOKIE, kind=SIMPLE', () => {
      expect(adapter.platform).toBe('REDDIT_COOKIE');
      expect(adapter.kind).toBe('SIMPLE');
      expect(adapter.name).toContain('Cookie');
    });

    it('configured() returns true (no env vars needed)', () => {
      expect(adapter.configured()).toBe(true);
    });
  });

  describe('validateCredentials()', () => {
    it('returns user identity on valid cookies (token_v2 + csrf only, no legacy token)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          id: 't2_2bnj8pnm9a',
          name: 'Marshal_The_dev0007',
          comment_karma: 5,
          link_karma: 10,
        })
      ));

      const result = await adapter.validateCredentials({
        tokenV2: VALID_TOKEN_V2,
        csrfToken: VALID_CSRF,
      });

      expect(result.identity.id).toBe('t2_2bnj8pnm9a');
      expect(result.identity.username).toBe('u/Marshal_The_dev0007');
      expect(result.credentials.tokenV2).toBe(VALID_TOKEN_V2);
      expect(result.credentials.csrfToken).toBe(VALID_CSRF);
      expect(result.credentials.token).toBeUndefined();
    });

    it('accepts optional legacy `token` cookie and includes it in the credential blob', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { id: 't2_x', name: 'test' })
      ));

      const result = await adapter.validateCredentials({
        tokenV2: VALID_TOKEN_V2,
        csrfToken: VALID_CSRF,
        token: VALID_TOKEN_LEGACY,
      });

      expect(result.credentials.token).toBe(VALID_TOKEN_LEGACY);
    });

    it('throws PublishError(VALIDATION) when token_v2 is missing', async () => {
      await expect(
        adapter.validateCredentials({ csrfToken: VALID_CSRF })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when csrf_token is missing', async () => {
      await expect(
        adapter.validateCredentials({ tokenV2: VALID_TOKEN_V2 })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when token_v2 is too short (<100 chars)', async () => {
      await expect(
        adapter.validateCredentials({ tokenV2: 'short.token.sig', csrfToken: VALID_CSRF })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when token_v2 is not a JWT (no dots)', async () => {
      const longString = 'a'.repeat(200);
      await expect(
        adapter.validateCredentials({ tokenV2: longString, csrfToken: VALID_CSRF })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when token_v2 has only 2 parts (missing signature)', async () => {
      const twoPartToken = `${JWT_HEADER_V2}.${JWT_PAYLOAD_V2}`;
      await expect(
        adapter.validateCredentials({ tokenV2: twoPartToken, csrfToken: VALID_CSRF })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when csrf_token is not 32 chars', async () => {
      await expect(
        adapter.validateCredentials({ tokenV2: VALID_TOKEN_V2, csrfToken: 'short' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when csrf_token is not hex', async () => {
      const nonHex = 'z'.repeat(32);
      await expect(
        adapter.validateCredentials({ tokenV2: VALID_TOKEN_V2, csrfToken: nonHex })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when optional legacy token is provided but not a valid JWT', async () => {
      await expect(
        adapter.validateCredentials({
          tokenV2: VALID_TOKEN_V2,
          csrfToken: VALID_CSRF,
          token: 'not-a-jwt-but-long-enough-' + 'x'.repeat(100),
        })
      ).rejects.toThrow(PublishError);
    });

    it('accepts empty string for optional legacy token (treated as not provided)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { id: '1', name: 'test' })
      ));
      const result = await adapter.validateCredentials({
        tokenV2: VALID_TOKEN_V2,
        csrfToken: VALID_CSRF,
        token: '',
      });
      expect(result.credentials.token).toBeUndefined();
    });

    it('throws PublishError(AUTH) on 401 (invalid cookies or blocked IP)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(401, '{"success":false,"error":{"reason":"UNAUTHORIZED"}}')
      ));
      try {
        await adapter.validateCredentials({ tokenV2: VALID_TOKEN_V2, csrfToken: VALID_CSRF });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(AUTH) on 403 (WAF block or forbidden)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(403, '{"message": "Forbidden", "error": 403}')
      ));
      try {
        await adapter.validateCredentials({ tokenV2: VALID_TOKEN_V2, csrfToken: VALID_CSRF });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow down')));
      try {
        await adapter.validateCredentials({ tokenV2: VALID_TOKEN_V2, csrfToken: VALID_CSRF });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('RATE');
      }
    });

    it('throws PublishError(NETWORK) when id missing from response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { name: 'test' })  // no id
      ));
      try {
        await adapter.validateCredentials({ tokenV2: VALID_TOKEN_V2, csrfToken: VALID_CSRF });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('NETWORK');
      }
    });

    it('sends correct headers (Authorization Bearer token_v2 + x-csrf-token + cookies + origin + referer)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, { id: 't2_x', name: 'test' })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.validateCredentials({
        tokenV2: VALID_TOKEN_V2,
        csrfToken: VALID_CSRF,
        token: VALID_TOKEN_LEGACY,
      });

      const callArgs = mockFetch.mock.calls[0];
      const url = callArgs[0] as string;
      const init = callArgs[1] as RequestInit;
      const headers = init.headers as Record<string, string>;

      expect(url).toBe('https://www.reddit.com/api/v1/me');
      // Modern Reddit auth flow: Authorization Bearer uses token_v2 (the one with scopes)
      expect(headers.authorization).toBe(`Bearer ${VALID_TOKEN_V2}`);
      expect(headers['x-csrf-token']).toBe(VALID_CSRF);
      // All 3 cookies should be present: token_v2, csrf_token, token (legacy)
      expect(headers.cookie).toContain(`token_v2=${VALID_TOKEN_V2}`);
      expect(headers.cookie).toContain(`csrf_token=${VALID_CSRF}`);
      expect(headers.cookie).toContain(`token=${VALID_TOKEN_LEGACY}`);
      // Browser-like headers
      expect(headers['user-agent']).toMatch(/Mozilla/);
      expect(headers.origin).toBe('https://www.reddit.com');
      expect(headers.referer).toBe('https://www.reddit.com/');
    });

    it('omits legacy token from cookie header when not provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, { id: '1', name: 'test' })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.validateCredentials({
        tokenV2: VALID_TOKEN_V2,
        csrfToken: VALID_CSRF,
      });

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      // token_v2 + csrf_token present, but no legacy token cookie.
      // We check for `token=eyJ` (the JWT prefix) specifically to avoid
      // false matches with `csrf_token=` or `token_v2=`.
      expect(headers.cookie).toContain(`token_v2=${VALID_TOKEN_V2}`);
      expect(headers.cookie).toContain(`csrf_token=${VALID_CSRF}`);
      // The legacy `token=` cookie (followed by a JWT starting with `eyJ`)
      // should NOT be present.
      expect(headers.cookie).not.toMatch(/\btoken=eyJ/);
    });
  });

  describe('publish()', () => {
    it('submits a self-post and returns id + permalink on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, {
          json: {
            errors: [],
            data: {
              id: '1abc234',
              url: 'https://www.reddit.com/r/test/comments/1abc234/my_post/',
              name: 't3_1abc234',
            },
          },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.publish(
        VALID_CREDS,
        {
          title: 'My Test Post',
          body: 'This is the markdown body.',
          hashtags: [],
          options: { subreddit: 'test' },
        }
      );

      expect(result.id).toBe('t3_1abc234');
      expect(result.url).toContain('r/test/comments/1abc234');
    });

    it('submits a link-post when formatted.url is set', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, {
          json: {
            errors: [],
            data: { id: 'xyz', name: 't3_xyz' },
          },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.publish(
        VALID_CREDS,
        {
          title: 'Cool Link',
          body: '',
          url: 'https://github.com/marshal0004/NetAmplify',
          options: { subreddit: 'programming' },
        }
      );

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const bodyStr = init.body as string;
      const params = new URLSearchParams(bodyStr);
      expect(params.get('kind')).toBe('link');
      expect(params.get('url')).toBe('https://github.com/marshal0004/NetAmplify');
      expect(params.get('sr')).toBe('programming');
    });

    it('includes legacy token cookie in publish request when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, {
          json: { errors: [], data: { id: '1', name: 't3_1' } },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.publish(
        VALID_CREDS_WITH_LEGACY,
        { title: 'Test', body: 'body', options: { subreddit: 'test' } }
      );

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.cookie).toContain(`token_v2=${VALID_TOKEN_V2}`);
      expect(headers.cookie).toContain(`csrf_token=${VALID_CSRF}`);
      expect(headers.cookie).toContain(`token=${VALID_TOKEN_LEGACY}`);
    });

    it('throws PublishError(VALIDATION) when subreddit missing', async () => {
      await expect(
        adapter.publish(VALID_CREDS, { title: 'Test', body: 'body' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when subreddit name is invalid', async () => {
      await expect(
        adapter.publish(VALID_CREDS, {
          title: 'Test',
          body: 'body',
          options: { subreddit: 'invalid name with spaces' },
        })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when title missing', async () => {
      await expect(
        adapter.publish(VALID_CREDS, {
          title: '',
          body: 'body',
          options: { subreddit: 'test' },
        })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when title > 300 chars', async () => {
      await expect(
        adapter.publish(VALID_CREDS, {
          title: 'x'.repeat(301),
          body: 'body',
          options: { subreddit: 'test' },
        })
      ).rejects.toThrow(PublishError);
    });

    it('strips leading r/ from subreddit name', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, {
          json: { errors: [], data: { id: '1', name: 't3_1' } },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.publish(
        VALID_CREDS,
        { title: 'Test', body: 'body', options: { subreddit: 'r/test' } }
      );

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const params = new URLSearchParams(init.body as string);
      expect(params.get('sr')).toBe('test');
    });

    it('throws PublishError(AUTH) on 403 (WAF block or cookies expired)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(403, '{"message": "Forbidden", "error": 403}')
      ));
      try {
        await adapter.publish(VALID_CREDS, { title: 'Test', body: 'body', options: { subreddit: 'test' } });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow')));
      try {
        await adapter.publish(VALID_CREDS, { title: 'Test', body: 'body', options: { subreddit: 'test' } });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('RATE');
      }
    });

    it('throws PublishError(RATE) when Reddit returns RATELIMIT error code', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          json: {
            errors: [['RATELIMIT', 'you are doing that too much', 'RATELIMIT']],
            data: {},
          },
        })
      ));
      try {
        await adapter.publish(VALID_CREDS, { title: 'Test', body: 'body', options: { subreddit: 'test' } });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('RATE');
      }
    });

    it('throws PublishError(AUTH) when Reddit returns SUBREDDIT_NOTALLOWED', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          json: {
            errors: [['SUBREDDIT_NOTALLOWED', 'not allowed here', 'SUBREDDIT_NOTALLOWED']],
            data: {},
          },
        })
      ));
      try {
        await adapter.publish(VALID_CREDS, { title: 'Test', body: 'body', options: { subreddit: 'test' } });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(VALIDATION) when Reddit returns generic error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          json: {
            errors: [['BAD_TITLE', 'title is bad', 'BAD_TITLE']],
            data: {},
          },
        })
      ));
      try {
        await adapter.publish(VALID_CREDS, { title: 'Test', body: 'body', options: { subreddit: 'test' } });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('VALIDATION');
      }
    });

    it('throws PublishError(NETWORK) when post id missing from success response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { json: { errors: [], data: {} } })
      ));
      try {
        await adapter.publish(VALID_CREDS, { title: 'Test', body: 'body', options: { subreddit: 'test' } });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('NETWORK');
      }
    });

    it('throws PublishError(AUTH) when credentials missing', async () => {
      await expect(
        adapter.publish({}, { title: 'Test', body: 'body', options: { subreddit: 'test' } })
      ).rejects.toThrow(PublishError);
    });
  });
});
