// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/x/x-cookie.adapter.test.ts
// Vitest unit tests for XCookieAdapter.
//
// Per docs/09-TESTING-STRATEGY.md Rule #1: "Mock at the HTTP boundary only."

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { XCookieAdapter, XCookieCredentials, _resetQueryIdCacheForTests } from './x-cookie.adapter';
import { PublishError } from '../adapter.interface';

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
const VALID_CT0 = 'b'.repeat(32);
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
      expect(adapter.name).toContain('Cookie');
    });

    it('configured() returns true (no env vars needed)', () => {
      expect(adapter.configured()).toBe(true);
    });
  });

  describe('validateCredentials()', () => {
    it('returns user identity on valid cookies (200 + id_str + screen_name)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          id_str: '2095926963194253312',
          screen_name: 'neerajrawatdev',
          name: 'neeraj rawat',
        })
      ));

      const result = await adapter.validateCredentials({
        authToken: VALID_AUTH_TOKEN,
        ct0: VALID_CT0,
      });

      expect(result.identity.id).toBe('2095926963194253312');
      expect(result.identity.username).toBe('@neerajrawatdev');
      expect(result.credentials.authToken).toBe(VALID_AUTH_TOKEN);
      expect(result.credentials.ct0).toBe(VALID_CT0);
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

    it('throws PublishError(AUTH) on 401 (invalid cookies)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      try {
        await adapter.validateCredentials({ authToken: VALID_AUTH_TOKEN, ct0: VALID_CT0 });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(AUTH) on 403 (forbidden)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(403, 'forbidden')));
      try {
        await adapter.validateCredentials({ authToken: VALID_AUTH_TOKEN, ct0: VALID_CT0 });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow down')));
      try {
        await adapter.validateCredentials({ authToken: VALID_AUTH_TOKEN, ct0: VALID_CT0 });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('RATE');
      }
    });

    it('throws PublishError(NETWORK) on 500', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(500, 'internal error')));
      try {
        await adapter.validateCredentials({ authToken: VALID_AUTH_TOKEN, ct0: VALID_CT0 });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('NETWORK');
      }
    });

    it('throws PublishError(NETWORK) when id_str missing from response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { screen_name: 'test' })
      ));
      try {
        await adapter.validateCredentials({ authToken: VALID_AUTH_TOKEN, ct0: VALID_CT0 });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('NETWORK');
      }
    });

    it('sends correct headers (Bearer + cookie + x-csrf-token + x-twitter-auth-type)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, { id_str: '1', screen_name: 'test' })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.validateCredentials({ authToken: VALID_AUTH_TOKEN, ct0: VALID_CT0 });

      const callArgs = mockFetch.mock.calls[0];
      const url = callArgs[0] as string;
      const init = callArgs[1] as RequestInit;
      const headers = init.headers as Record<string, string>;

      expect(url).toBe('https://api.x.com/1.1/account/verify_credentials.json');
      expect(headers.authorization).toMatch(/^Bearer /);
      expect(headers.cookie).toContain(`auth_token=${VALID_AUTH_TOKEN}`);
      expect(headers.cookie).toContain(`ct0=${VALID_CT0}`);
      expect(headers['x-csrf-token']).toBe(VALID_CT0);
      expect(headers['x-twitter-auth-type']).toBe('OAuth2Session');
    });
  });

  describe('publish()', () => {
    it('posts a tweet and returns id + url on success', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(mockResponse(200, '<script src="https://abs.twimg.com/responsive-web/client-web/main.abc123.js"></script>'))
        .mockResolvedValueOnce(mockResponse(200, 'var x={queryId:"abc123def",operationName:"CreateTweet"}'))
        .mockResolvedValueOnce(mockResponse(200, {
          data: {
            create_tweet: {
              tweet_results: {
                result: {
                  rest_id: '1893882736470003840',
                  core: { user_results: { result: { legacy: { screen_name: 'neerajrawatdev' } } } },
                },
              },
            },
          },
        }));
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.publish(
        VALID_CREDS,
        {
          body: 'Hello World from NetAmplify!',
          url: 'https://github.com/marshal0004/NetAmplify',
          hashtags: ['netamplify', 'typescript'],
        }
      );

      expect(result.id).toBe('1893882736470003840');
      expect(result.url).toBe('https://x.com/neerajrawatdev/status/1893882736470003840');
    });

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

    it('throws PublishError(AUTH) on 401/403 (expired cookies)', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(mockResponse(200, '<script src="https://abs.twimg.com/responsive-web/client-web/main.abc123.js"></script>'))
        .mockResolvedValueOnce(mockResponse(200, 'var x={queryId:"abc123def",operationName:"CreateTweet"}'))
        .mockResolvedValueOnce(mockResponse(403, '{"errors":[{"code":32,"message":"Could not authenticate you."}]}'));
      vi.stubGlobal('fetch', mockFetch);

      try {
        await adapter.publish(VALID_CREDS, { body: 'Hello World' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(RATE) on 429', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(mockResponse(200, '<script src="https://abs.twimg.com/responsive-web/client-web/main.abc123.js"></script>'))
        .mockResolvedValueOnce(mockResponse(200, 'var x={queryId:"abc123def",operationName:"CreateTweet"}'))
        .mockResolvedValueOnce(mockResponse(429, 'rate limit'));
      vi.stubGlobal('fetch', mockFetch);

      try {
        await adapter.publish(VALID_CREDS, { body: 'Hello' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('RATE');
      }
    });

    it('throws PublishError(NETWORK) when queryId not found in main.js', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(mockResponse(200, '<script src="https://abs.twimg.com/responsive-web/client-web/main.abc123.js"></script>'))
        .mockResolvedValueOnce(mockResponse(200, '// no queryId here'));
      vi.stubGlobal('fetch', mockFetch);

      try {
        await adapter.publish(VALID_CREDS, { body: 'Hello World' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('NETWORK');
      }
    });

    it('throws PublishError(VALIDATION) on duplicate tweet (code 187)', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(mockResponse(200, '<script src="https://abs.twimg.com/responsive-web/client-web/main.abc123.js"></script>'))
        .mockResolvedValueOnce(mockResponse(200, 'var x={queryId:"abc123def",operationName:"CreateTweet"}'))
        .mockResolvedValueOnce(mockResponse(200, {
          errors: [{ message: 'Status is a duplicate.', code: 187 }],
        }));
      vi.stubGlobal('fetch', mockFetch);

      try {
        await adapter.publish(VALID_CREDS, { body: 'duplicate' });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('VALIDATION');
      }
    });

    it('caches queryId across multiple publish calls', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(mockResponse(200, '<script src="https://abs.twimg.com/responsive-web/client-web/main.abc123.js"></script>'))
        .mockResolvedValueOnce(mockResponse(200, 'var x={queryId:"abc123def",operationName:"CreateTweet"}'))
        .mockResolvedValueOnce(mockResponse(200, {
          data: { create_tweet: { tweet_results: { result: { rest_id: '111' } } } },
        }))
        .mockResolvedValueOnce(mockResponse(200, {
          data: { create_tweet: { tweet_results: { result: { rest_id: '222' } } } },
        }));
      vi.stubGlobal('fetch', mockFetch);

      await adapter.publish(VALID_CREDS, { body: 'first tweet' });
      await adapter.publish(VALID_CREDS, { body: 'second tweet' });

      expect(mockFetch.mock.calls.length).toBe(4);
    });

    it('throws PublishError(AUTH) when credentials missing', async () => {
      await expect(
        adapter.publish({}, { body: 'Hello' })
      ).rejects.toThrow(PublishError);
    });
  });
});
