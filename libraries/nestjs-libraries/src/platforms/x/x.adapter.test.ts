// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/x/x.adapter.test.ts
// Vitest unit tests for XAdapter.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { XAdapter } from './x.adapter';
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

describe('XAdapter', () => {
  let adapter: XAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    adapter = new XAdapter();
    process.env.TWITTER_CLIENT_ID = 'test-x-client-id';
    process.env.TWITTER_CLIENT_SECRET = 'test-x-client-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('configured()', () => {
    it('returns true when TWITTER_CLIENT_ID + SECRET are set', () => {
      expect(adapter.configured()).toBe(true);
    });

    it('returns false when TWITTER_CLIENT_ID missing', () => {
      delete process.env.TWITTER_CLIENT_ID;
      expect(adapter.configured()).toBe(false);
    });

    it('returns false when TWITTER_CLIENT_SECRET missing', () => {
      delete process.env.TWITTER_CLIENT_SECRET;
      expect(adapter.configured()).toBe(false);
    });
  });

  describe('getAuthUrl()', () => {
    it('builds the X authorize URL with PKCE', () => {
      const url = adapter.getAuthUrl(
        { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
        'state-123',
        'http://localhost:3000/api/oauth/twitter/callback'
      );
      expect(url).toContain('https://twitter.com/i/v2/oauth2/authorize');
      expect(url).toContain('client_id=test-x-client-id');
      expect(url).toContain('response_type=code');
      expect(url).toContain('state=state-123');
      expect(url).toContain('code_challenge=c');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain('scope=tweet.read');
      expect(url).toContain('offline.access');
    });

    it('throws when adapter not configured', () => {
      delete process.env.TWITTER_CLIENT_ID;
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
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          access_token: 'x-access-token',
          refresh_token: 'x-refresh-token',
          expires_in: 7200,
          scope: 'tweet.read tweet.write users.read offline.access',
        })
      ));

      const tokens = await adapter.exchangeCode('code', {
        code_verifier: 'v',
        code_challenge: 'c',
        code_challenge_method: 'S256',
      }, 'http://localhost:3000/cb');

      expect(tokens.accessToken).toBe('x-access-token');
      expect(tokens.refreshToken).toBe('x-refresh-token');
      expect(tokens.scopes).toContain('tweet.write');
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.exchangeCode('code', {
          code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256',
        }, 'http://localhost:3000/cb')
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) on 400 (bad code)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(400, 'bad code')));
      await expect(
        adapter.exchangeCode('bad', {
          code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256',
        }, 'http://localhost:3000/cb')
      ).rejects.toThrow(PublishError);
    });
  });

  describe('getIdentity()', () => {
    it('returns user identity on success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { data: { id: '12345', username: 'janedoe', name: 'Jane Doe' } })
      ));
      const identity = await adapter.getIdentity({ accessToken: 'tok', scopes: [] });
      expect(identity.id).toBe('12345');
      expect(identity.username).toBe('@janedoe');
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.getIdentity({ accessToken: 'bad', scopes: [] })
      ).rejects.toThrow(PublishError);
    });
  });

  describe('publish()', () => {
    it('posts a tweet on success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(201, { data: { id: 'tweet-123', text: 'test' } })
      ));

      const result = await adapter.publish(
        { accessToken: 'tok', scopes: ['tweet.write'] },
        { title: 'Test', body: 'Body', hashtags: ['ts'] }
      );

      expect(result.id).toBe('tweet-123');
      expect(result.url).toBe('https://x.com/i/status/tweet-123');
    });

    it('throws PublishError(VALIDATION) when tweet > 280 chars', async () => {
      const longText = 'x'.repeat(300);
      await expect(
        adapter.publish(
          { accessToken: 'tok', scopes: [] },
          { title: 'T', body: longText }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.publish({ accessToken: 'tok', scopes: [] }, { title: 'T', body: 'B' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(QUOTA) on 403 with quota message', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(403, 'Monthly quota exceeded')
      ));
      const err = await adapter.publish(
        { accessToken: 'tok', scopes: [] },
        { title: 'T', body: 'B' }
      ).catch(e => e);
      expect(err).toBeInstanceOf(PublishError);
      expect((err as PublishError).errorClass).toBe('QUOTA');
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow')));
      await expect(
        adapter.publish({ accessToken: 'tok', scopes: [] }, { title: 'T', body: 'B' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when credentials missing', async () => {
      await expect(
        adapter.publish({}, { title: 'T', body: 'B' })
      ).rejects.toThrow(PublishError);
    });
  });
});
