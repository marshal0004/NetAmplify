// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/reddit/reddit.adapter.test.ts
// Vitest unit tests for RedditAdapter.
//
// Per docs/09-TESTING-STRATEGY.md: "platform APIs are ALWAYS mocked in
// tests." We mock ONLY at the `fetch` boundary — the adapter logic that
// parses responses + classifies errors is REAL.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RedditAdapter } from './reddit.adapter';
import { PublishError } from '../adapter.interface';

// Helper: build a mock Response object
function mockResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('RedditAdapter', () => {
  let adapter: RedditAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    adapter = new RedditAdapter();
    process.env.REDDIT_CLIENT_ID = 'test-reddit-client-id';
    process.env.REDDIT_CLIENT_SECRET = 'test-reddit-client-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('configured()', () => {
    it('returns true when REDDIT_CLIENT_ID + SECRET are set', () => {
      expect(adapter.configured()).toBe(true);
    });

    it('returns false when REDDIT_CLIENT_ID is missing', () => {
      delete process.env.REDDIT_CLIENT_ID;
      expect(adapter.configured()).toBe(false);
    });

    it('returns false when REDDIT_CLIENT_SECRET is missing', () => {
      delete process.env.REDDIT_CLIENT_SECRET;
      expect(adapter.configured()).toBe(false);
    });
  });

  describe('getAuthUrl()', () => {
    it('builds the Reddit authorize URL with PKCE + state', () => {
      const url = adapter.getAuthUrl(
        { code_verifier: 'verifier', code_challenge: 'challenge', code_challenge_method: 'S256' },
        'state-123',
        'http://localhost:3000/api/oauth/reddit/callback'
      );
      expect(url).toContain('https://www.reddit.com/api/v1/authorize');
      expect(url).toContain('client_id=test-reddit-client-id');
      expect(url).toContain('response_type=code');
      expect(url).toContain('state=state-123');
      expect(url).toContain('duration=permanent');
      expect(url).toContain('code_challenge=challenge');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain('scope=identity+submit');
    });

    it('throws when adapter not configured', () => {
      delete process.env.REDDIT_CLIENT_ID;
      expect(() =>
        adapter.getAuthUrl(
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          's',
          'r'
        )
      ).toThrow();
    });
  });

  describe('exchangeCode()', () => {
    it('returns OAuthTokens on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, {
          access_token: 'access-token-123',
          refresh_token: 'refresh-token-456',
          expires_in: 3600,
          scope: 'identity submit',
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      const tokens = await adapter.exchangeCode('code-123', {
        code_verifier: 'verifier',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
      }, 'http://localhost:3000/api/oauth/reddit/callback');

      expect(tokens.accessToken).toBe('access-token-123');
      expect(tokens.refreshToken).toBe('refresh-token-456');
      expect(tokens.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(tokens.scopes).toEqual(['identity', 'submit']);

      // Verify the request shape
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://www.reddit.com/api/v1/access_token');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toMatch(/^Basic /);
      expect(init.body).toContain('grant_type=authorization_code');
      expect(init.body).toContain('code=code-123');
      expect(init.body).toContain('code_verifier=verifier');
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.exchangeCode('code', {
          code_verifier: 'v',
          code_challenge: 'c',
          code_challenge_method: 'S256',
        }, 'http://localhost:3000/cb')
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'too many')));
      const err = await adapter.exchangeCode('code', {
        code_verifier: 'v',
        code_challenge: 'c',
        code_challenge_method: 'S256',
      }, 'http://localhost:3000/cb').catch(e => e);
      expect(err).toBeInstanceOf(PublishError);
    });
  });

  describe('getIdentity()', () => {
    it('returns the user identity on success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { id: 't2_abc123', name: 'testuser' })
      ));
      const identity = await adapter.getIdentity({ accessToken: 'access', scopes: [] });
      expect(identity.id).toBe('t2_abc123');
      expect(identity.username).toBe('testuser');
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.getIdentity({ accessToken: 'bad', scopes: [] })
      ).rejects.toThrow(PublishError);
    });
  });

  describe('publish()', () => {
    it('submits a self-post (markdown) on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, {
          json: {
            errors: [],
            data: { id: 't3_abc', permalink: '/r/test/comments/abc/title/' },
          },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.publish(
        { accessToken: 'access', scopes: ['identity', 'submit'] },
        {
          title: 'Test Post',
          body: 'This is the body',
          options: { subreddit: 'test' },
        }
      );

      expect(result.id).toBe('t3_abc');
      expect(result.url).toContain('https://www.reddit.com/r/test/comments/abc/title/');

      // Verify request shape
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://oauth.reddit.com/api/submit');
      expect(init.body).toContain('sr=test');
      expect(init.body).toContain('kind=self');
      expect(init.body).toContain('title=Test+Post');
    });

    it('submits a link-post when formatted.url is present', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, {
          json: { errors: [], data: { id: 't3_xyz', permalink: '/r/test/comments/xyz/' } },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.publish(
        { accessToken: 'access', scopes: [] },
        {
          title: 'Link post',
          body: '',
          url: 'https://example.com',
          options: { subreddit: 'test' },
        }
      );

      const [, init] = mockFetch.mock.calls[0];
      expect(init.body).toContain('kind=link');
      expect(init.body).toContain('url=');
    });

    it('throws PublishError(VALIDATION) when subreddit missing', async () => {
      // The adapter checks subreddit BEFORE calling fetch — we need to mock
      // fetch anyway because the implementation may change to fetch first.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { json: { errors: [], data: {} } })));
      await expect(
        adapter.publish(
          { accessToken: 'access', scopes: [] },
          { title: 'Test', body: 'Body' }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when Reddit returns errors array', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          json: { errors: [['BAD_SUBREDDIT', 'subreddit not allowed', 'sr']] },
        })
      ));
      await expect(
        adapter.publish(
          { accessToken: 'access', scopes: [] },
          { title: 'Test', body: 'Body', options: { subreddit: 'banned' } }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.publish(
          { accessToken: 'access', scopes: [] },
          { title: 'Test', body: 'Body', options: { subreddit: 'test' } }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow down')));
      await expect(
        adapter.publish(
          { accessToken: 'access', scopes: [] },
          { title: 'Test', body: 'Body', options: { subreddit: 'test' } }
        )
      ).rejects.toThrow(PublishError);
    });
  });
});
