// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/reddit/reddit-cookie.adapter.test.ts
// Vitest unit tests for RedditCookieAdapter.
//
// Per docs/09-TESTING-STRATEGY.md Rule #1: "Mock at the HTTP boundary only."
//
// Uses the modern Reddit cookie auth flow:
//   - token cookie (JWT, ~500-2000 chars) — sent as Authorization: Bearer + cookie
//   - csrf_token cookie (32-char hex) — sent as x-CSRF-TOKEN header + cookie

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
// We build a synthetic JWT that's long enough to pass the 100-char min.
const JWT_HEADER = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IlNIQTI1NjpsVFdYNlFVUEloWktaRG1rR0pVd1gvdWNFK01BSjBYRE12RU1kNzVxTXQ4IiwidHlwIjoiSldUIn0';
const JWT_PAYLOAD = 'eyJzdWIiOiJ0Ml8yYm5qOHBubTlhIiwiZXhwIjoxODA1MjA4MjUxLjU3NTk1OSwiaWF0IjoxNzg5NTY5ODUxLjU3NTk1OSwianRpIjoibXdVdXp4MEZIallIY2lVeTFRMzZfZGNwYjlTZU5nIiwiYXQiOjEsImNpZCI6ImNvb2tpZSIsImxjYSI6MTc3NTM1MTQ1NTA0MCwic2NwIjoiZUp3QUFnRDlfMXRkQXdBQkZRQzUiLCJmbG8iOjMsImFtciI6WyJzc28iXX0';
const JWT_SIGNATURE = 'i_sh3PJq3MLXxk7yWrsebpXdGM6Gul2uPyOLw5AfrVZN6340_vTdPWTVkG0sNfmeoaGGxb3xAet9BT2-_U_uXEVB9Cx1pHEm3o35V3gdGAxPcrqoSiiEPM_LDt36GxqUb-LVgCST6wu0Bg4imCP4tz6nlEzdNjaR13DZ6mJ7jPF0Hsh2ZnMe8mu0LEIr-Iq3EwWTsGcJ_xGZdJ7IE-cmUs5tx5tRCrUSuxx9AbEw3UW6a_NJWexEjBA1vZdP96v2I6rtkeQ37nzoN70XQSdI5zwikwTWXNb8qJRR4eLlSlUpnf-6IgPeuiqeJCwrm23cuH8RE7R3XxddeAd-OA-djQ';
const VALID_JWT = `${JWT_HEADER}.${JWT_PAYLOAD}.${JWT_SIGNATURE}`;

const VALID_CSRF = '38347fc606021458b4069a77822832cf';

const VALID_CREDS: RedditCookieCredentials = {
  token: VALID_JWT,
  csrfToken: VALID_CSRF,
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
    it('returns user identity on valid cookies (200 + id + name)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          id: 't2_2bnj8pnm9a',
          name: 'Marshal_The_dev0007',
          comment_karma: 5,
          link_karma: 10,
        })
      ));

      const result = await adapter.validateCredentials({
        token: VALID_JWT,
        csrfToken: VALID_CSRF,
      });

      expect(result.identity.id).toBe('t2_2bnj8pnm9a');
      expect(result.identity.username).toBe('u/Marshal_The_dev0007');
      expect(result.credentials.token).toBe(VALID_JWT);
      expect(result.credentials.csrfToken).toBe(VALID_CSRF);
    });

    it('throws PublishError(VALIDATION) when token (JWT) missing', async () => {
      await expect(
        adapter.validateCredentials({ csrfToken: VALID_CSRF })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when csrfToken missing', async () => {
      await expect(
        adapter.validateCredentials({ token: VALID_JWT })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when token is too short (<100 chars)', async () => {
      await expect(
        adapter.validateCredentials({ token: 'short.token.sig', csrfToken: VALID_CSRF })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when token is not a valid JWT (no dots)', async () => {
      // Long enough but no dots — not a JWT
      const longString = 'a'.repeat(200);
      await expect(
        adapter.validateCredentials({ token: longString, csrfToken: VALID_CSRF })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when token has only 2 parts (missing signature)', async () => {
      const twoPartToken = `${JWT_HEADER}.${JWT_PAYLOAD}`;
      await expect(
        adapter.validateCredentials({ token: twoPartToken, csrfToken: VALID_CSRF })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when csrfToken is not 32 chars', async () => {
      await expect(
        adapter.validateCredentials({ token: VALID_JWT, csrfToken: 'short' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when csrfToken is not hex', async () => {
      // 32 chars but contains non-hex chars
      const nonHex = 'z'.repeat(32);
      await expect(
        adapter.validateCredentials({ token: VALID_JWT, csrfToken: nonHex })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401 (invalid cookies or blocked IP)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(401, '{"success":false,"error":{"reason":"UNAUTHORIZED"}}')
      ));
      try {
        await adapter.validateCredentials({ token: VALID_JWT, csrfToken: VALID_CSRF });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(AUTH) on 403', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(403, 'forbidden')));
      try {
        await adapter.validateCredentials({ token: VALID_JWT, csrfToken: VALID_CSRF });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow down')));
      try {
        await adapter.validateCredentials({ token: VALID_JWT, csrfToken: VALID_CSRF });
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
        await adapter.validateCredentials({ token: VALID_JWT, csrfToken: VALID_CSRF });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('NETWORK');
      }
    });

    it('sends correct headers (Authorization Bearer + x-csrf-token + cookie + origin + referer)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, { id: 't2_x', name: 'test' })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.validateCredentials({
        token: VALID_JWT,
        csrfToken: VALID_CSRF,
      });

      const callArgs = mockFetch.mock.calls[0];
      const url = callArgs[0] as string;
      const init = callArgs[1] as RequestInit;
      const headers = init.headers as Record<string, string>;

      expect(url).toBe('https://www.reddit.com/api/v1/me');
      // Modern Reddit auth flow: Authorization Bearer + x-CSRF-TOKEN + cookie
      expect(headers.authorization).toBe(`Bearer ${VALID_JWT}`);
      expect(headers['x-csrf-token']).toBe(VALID_CSRF);
      expect(headers.cookie).toContain(`token=${VALID_JWT}`);
      expect(headers.cookie).toContain(`csrf_token=${VALID_CSRF}`);
      // Browser-like headers
      expect(headers['user-agent']).toMatch(/Mozilla/);
      expect(headers.origin).toBe('https://www.reddit.com');
      expect(headers.referer).toBe('https://www.reddit.com/');
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

    it('throws PublishError(AUTH) on 403 (cookies expired)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(403, 'forbidden')));
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
