// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/reddit/reddit-cookie.adapter.test.ts
// Vitest unit tests for RedditCookieAdapter.
//
// Per docs/09-TESTING-STRATEGY.md Rule #1: "Mock at the HTTP boundary only."

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

const VALID_REDDIT_SESSION = 'a'.repeat(200);
const VALID_TOKEN = 'b'.repeat(40);
const VALID_CREDS: RedditCookieCredentials = {
  redditSession: VALID_REDDIT_SESSION,
  token: VALID_TOKEN,
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
          id: 't2_abc123',
          name: 'Marshal_The_dev0007',
          comment_karma: 5,
          link_karma: 10,
        })
      ));

      const result = await adapter.validateCredentials({
        redditSession: VALID_REDDIT_SESSION,
        token: VALID_TOKEN,
      });

      expect(result.identity.id).toBe('t2_abc123');
      expect(result.identity.username).toBe('u/Marshal_The_dev0007');
      expect(result.credentials.redditSession).toBe(VALID_REDDIT_SESSION);
      expect(result.credentials.token).toBe(VALID_TOKEN);
    });

    it('throws PublishError(VALIDATION) when redditSession missing', async () => {
      await expect(
        adapter.validateCredentials({ token: VALID_TOKEN })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when token missing', async () => {
      await expect(
        adapter.validateCredentials({ redditSession: VALID_REDDIT_SESSION })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when redditSession too short (<50)', async () => {
      await expect(
        adapter.validateCredentials({ redditSession: 'short', token: VALID_TOKEN })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when token too short (<16)', async () => {
      await expect(
        adapter.validateCredentials({ redditSession: VALID_REDDIT_SESSION, token: 'short' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      try {
        await adapter.validateCredentials({ redditSession: VALID_REDDIT_SESSION, token: VALID_TOKEN });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(AUTH) on 403', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(403, 'forbidden')));
      try {
        await adapter.validateCredentials({ redditSession: VALID_REDDIT_SESSION, token: VALID_TOKEN });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('AUTH');
      }
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow down')));
      try {
        await adapter.validateCredentials({ redditSession: VALID_REDDIT_SESSION, token: VALID_TOKEN });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('RATE');
      }
    });

    it('throws PublishError(NETWORK) when id missing from response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { name: 'test' })
      ));
      try {
        await adapter.validateCredentials({ redditSession: VALID_REDDIT_SESSION, token: VALID_TOKEN });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as PublishError).errorClass).toBe('NETWORK');
      }
    });

    it('sends correct headers (cookie + user-agent + accept)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, { id: 't2_x', name: 'test' })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.validateCredentials({
        redditSession: VALID_REDDIT_SESSION,
        token: VALID_TOKEN,
      });

      const callArgs = mockFetch.mock.calls[0];
      const url = callArgs[0] as string;
      const init = callArgs[1] as RequestInit;
      const headers = init.headers as Record<string, string>;

      expect(url).toBe('https://www.reddit.com/api/v1/me');
      expect(headers.cookie).toContain(`reddit_session=${VALID_REDDIT_SESSION}`);
      expect(headers.cookie).toContain(`token=${VALID_TOKEN}`);
      expect(headers['user-agent']).toMatch(/Mozilla/);
      expect(headers.accept).toBe('application/json');
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
