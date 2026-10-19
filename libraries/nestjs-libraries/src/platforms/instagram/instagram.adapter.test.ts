// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/instagram/instagram.adapter.test.ts
// Vitest unit tests for InstagramAdapter (TRUE Standalone OAuth).
//
// Covers:
//   - configured() — env var presence
//   - getAuthUrl() — Instagram authorize URL + HTTPS enforcement
//   - exchangeCode() — token exchange + long-lived upgrade
//   - getIdentity() — profile fetch + personal account rejection
//   - publish() — two-step Content Publishing API (create container + publish)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InstagramAdapter } from './instagram.adapter';
import { PublishError } from '../adapter.interface';

/** Build a mock fetch Response object. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

const REDIRECT_URI_HTTPS = 'https://test-tunnel.ngrok-free.app/api/oauth/instagram/callback';
const REDIRECT_URI_HTTP = 'http://localhost:4200/api/oauth/instagram/callback';

describe('InstagramAdapter', () => {
  let adapter: InstagramAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    adapter = new InstagramAdapter();
    process.env.INSTAGRAM_APP_ID = '1782847289700445';
    process.env.INSTAGRAM_APP_SECRET = 'test-ig-app-secret';
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    delete process.env.PUBLIC_APP_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('configured()', () => {
    it('returns true when INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET are set', () => {
      expect(adapter.configured()).toBe(true);
    });

    it('returns false when INSTAGRAM_APP_ID is missing', () => {
      delete process.env.INSTAGRAM_APP_ID;
      expect(adapter.configured()).toBe(false);
    });

    it('returns false when INSTAGRAM_APP_SECRET is missing', () => {
      delete process.env.INSTAGRAM_APP_SECRET;
      expect(adapter.configured()).toBe(false);
    });

    it('does NOT fall back to FACEBOOK_APP_* (must use IG-specific creds)', () => {
      delete process.env.INSTAGRAM_APP_ID;
      delete process.env.INSTAGRAM_APP_SECRET;
      process.env.FACEBOOK_APP_ID = 'fb-app-id';
      process.env.FACEBOOK_APP_SECRET = 'fb-app-secret';
      expect(adapter.configured()).toBe(false);
    });
  });

  describe('getAuthUrl()', () => {
    it('builds the Instagram Standalone authorize URL with correct params', () => {
      const url = adapter.getAuthUrl(
        { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
        'state-abc-123',
        REDIRECT_URI_HTTPS,
      );
      expect(url).toContain('https://api.instagram.com/oauth/authorize');
      expect(url).toContain('client_id=1782847289700445');
      expect(url).toContain('response_type=code');
      expect(url).toContain('state=state-abc-123');
      expect(url).toContain(
        'scope=instagram_business_basic%2Cinstagram_business_content_publish',
      );
      expect(url).toContain(
        `redirect_uri=${encodeURIComponent(REDIRECT_URI_HTTPS)}`,
      );
    });

    it('throws when INSTAGRAM_APP_ID is missing', () => {
      delete process.env.INSTAGRAM_APP_ID;
      expect(() =>
        adapter.getAuthUrl(
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          's',
          REDIRECT_URI_HTTPS,
        ),
      ).toThrow(/missing INSTAGRAM_APP_ID/);
    });

    it('throws when redirect URI is http:// (Instagram rejects non-HTTPS)', () => {
      expect(() =>
        adapter.getAuthUrl(
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          's',
          REDIRECT_URI_HTTP,
        ),
      ).toThrow(/HTTPS redirect URI/);
    });

    it('does NOT use facebook.com/dialog/oauth (regression check)', () => {
      const url = adapter.getAuthUrl(
        { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
        's',
        REDIRECT_URI_HTTPS,
      );
      expect(url).not.toContain('facebook.com');
      expect(url).not.toContain('dialog/oauth');
    });
  });

  describe('exchangeCode()', () => {
    it('returns OAuthTokens with long-lived token when ig_exchange_token succeeds', async () => {
      const shortLived = mockResponse(200, {
        access_token: 'IGQVJ-short-lived-token',
        user_id: '17841405822304914',
        expires_in: 3600,
        token_type: 'bearer',
      });
      const longLived = mockResponse(200, {
        access_token: 'IGQVJ-long-lived-token',
        token_type: 'bearer',
        expires_in: 5184000,
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(shortLived)
        .mockResolvedValueOnce(longLived);
      vi.stubGlobal('fetch', fetchMock);

      const tokens = await adapter.exchangeCode(
        'auth-code-xyz',
        { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
        REDIRECT_URI_HTTPS,
      );

      expect(tokens.accessToken).toBe('IGQVJ-long-lived-token');
      expect(tokens.scopes).toEqual([
        'instagram_business_basic',
        'instagram_business_content_publish',
      ]);
      expect(tokens.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

      // Verify the first fetch hit Instagram's token endpoint (not Facebook's)
      const firstCall = fetchMock.mock.calls[0];
      expect(firstCall[0]).toBe('https://api.instagram.com/oauth/access_token');
      expect(firstCall[1].method).toBe('POST');

      // Verify the second fetch hit Instagram's graph endpoint for ig_exchange_token
      const secondCallUrl = new URL(fetchMock.mock.calls[1][0] as string);
      expect(secondCallUrl.origin).toBe('https://graph.instagram.com');
      expect(secondCallUrl.searchParams.get('grant_type')).toBe('ig_exchange_token');
      expect(secondCallUrl.searchParams.get('access_token')).toBe(
        'IGQVJ-short-lived-token',
      );
    });

    it('falls back to short-lived token when long-lived exchange fails', async () => {
      const shortLived = mockResponse(200, {
        access_token: 'IGQVJ-short-lived-token',
        user_id: '17841405822304914',
        expires_in: 3600,
        token_type: 'bearer',
      });
      const longLivedError = mockResponse(400, {
        error: { message: 'Invalid token' },
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(shortLived)
        .mockResolvedValueOnce(longLivedError);
      vi.stubGlobal('fetch', fetchMock);

      const tokens = await adapter.exchangeCode(
        'auth-code-xyz',
        { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
        REDIRECT_URI_HTTPS,
      );

      expect(tokens.accessToken).toBe('IGQVJ-short-lived-token');
    });

    it('throws AUTH PublishError when Instagram returns no access_token', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { user_id: '123' }),
      ));

      await expect(
        adapter.exchangeCode(
          'auth-code-xyz',
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          REDIRECT_URI_HTTPS,
        ),
      ).rejects.toThrow(/no access_token/);
    });

    it('throws AUTH PublishError when Instagram returns no user_id', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { access_token: 'IGQVJ-token' }),
      ));

      await expect(
        adapter.exchangeCode(
          'auth-code-xyz',
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          REDIRECT_URI_HTTPS,
        ),
      ).rejects.toThrow(/no user_id/);
    });

    it('throws AUTH PublishError on non-200 response from token endpoint', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(400, { error: { message: 'Bad code' } }),
      ));

      await expect(
        adapter.exchangeCode(
          'bad-code',
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          REDIRECT_URI_HTTPS,
        ),
      ).rejects.toThrow(/Instagram code exchange failed/);
    });

    it('throws when INSTAGRAM_APP_ID/SECRET are not configured', async () => {
      delete process.env.INSTAGRAM_APP_ID;
      delete process.env.INSTAGRAM_APP_SECRET;
      await expect(
        adapter.exchangeCode(
          'code',
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          REDIRECT_URI_HTTPS,
        ),
      ).rejects.toThrow(/not configured/);
    });
  });

  describe('getIdentity()', () => {
    it('returns PlatformIdentity with @username when profile is BUSINESS', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          id: '17841405822304914',
          username: 'neerajrawatdev',
          account_type: 'BUSINESS',
        }),
      ));

      const identity = await adapter.getIdentity({
        accessToken: 'IGQVJ-token',
        scopes: ['instagram_business_basic'],
      });

      expect(identity.id).toBe('17841405822304914');
      expect(identity.username).toBe('@neerajrawatdev');
    });

    it('returns PlatformIdentity with @username when profile is CREATOR', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          id: '17841405822304914',
          username: 'neerajrawatdev',
          account_type: 'CREATOR',
        }),
      ));

      const identity = await adapter.getIdentity({
        accessToken: 'IGQVJ-token',
      });

      expect(identity.id).toBe('17841405822304914');
      expect(identity.username).toBe('@neerajrawatdev');
    });

    it('throws VALIDATION PublishError when IG account is PERSONAL', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          id: '17841405822304914',
          username: 'someuser',
          account_type: 'PERSONAL',
        }),
      ));

      await expect(
        adapter.getIdentity({ accessToken: 'IGQVJ-token' }),
      ).rejects.toThrow(/PERSONAL/);
    });

    it('throws AUTH PublishError on 401 from /me', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(401, { error: { message: 'Invalid token' } }),
      ));

      await expect(
        adapter.getIdentity({ accessToken: 'expired-token' }),
      ).rejects.toThrow(/invalid or expired/);
    });

    it('throws NETWORK PublishError on non-401 error from /me', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(500, { error: { message: 'Server error' } }),
      ));

      await expect(
        adapter.getIdentity({ accessToken: 'IGQVJ-token' }),
      ).rejects.toThrow(/Instagram \/me failed/);
    });

    it('throws NETWORK PublishError when /me returns no id', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { username: 'someuser' }),
      ));

      await expect(
        adapter.getIdentity({ accessToken: 'IGQVJ-token' }),
      ).rejects.toThrow(/no id/);
    });

    it('uses graph.instagram.com endpoint (not graph.facebook.com)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(200, {
          id: '17841405822304914',
          username: 'neerajrawatdev',
          account_type: 'BUSINESS',
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await adapter.getIdentity({ accessToken: 'IGQVJ-token' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('https://graph.instagram.com/v21.0/me');
      expect(url).not.toContain('graph.facebook.com');
    });
  });

  describe('publish()', () => {
    it('creates a media container then publishes it (happy path)', async () => {
      const createResp = mockResponse(200, { id: 'container-1789' });
      const publishResp = mockResponse(200, { id: 'post-1790' });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createResp)
        .mockResolvedValueOnce(publishResp);
      vi.stubGlobal('fetch', fetchMock);

      const result = await adapter.publish(
        {
          accessToken: 'IGQVJ-token',
          igUserId: '17841405822304914',
        },
        {
          title: 'My Project',
          body: 'Check out my new project demo!',
          hashtags: ['dev', 'project'],
          url: 'https://github.com/me/repo',
          options: { imageUrl: 'https://example.com/image.jpg' },
        },
      );

      expect(result.id).toBe('post-1790');
      expect(result.url).toBe('https://www.instagram.com/');

      // Verify create call
      const createCall = fetchMock.mock.calls[0];
      expect(createCall[0]).toBe(
        'https://graph.facebook.com/v21.0/17841405822304914/media',
      );
      expect(createCall[1].method).toBe('POST');
      const createBody = createCall[1].body as string;
      expect(createBody).toContain('image_url=');
      expect(createBody).toContain(
        encodeURIComponent('https://example.com/image.jpg'),
      );
      expect(createBody).toContain('access_token=IGQVJ-token');
      expect(createBody).toContain('caption=');

      // Verify publish call (after 3s wait)
      const publishCall = fetchMock.mock.calls[1];
      expect(publishCall[0]).toBe(
        'https://graph.facebook.com/v21.0/17841405822304914/media_publish',
      );
      expect(publishCall[1].method).toBe('POST');
      const publishBody = publishCall[1].body as string;
      expect(publishBody).toContain('creation_id=container-1789');
      expect(publishBody).toContain('access_token=IGQVJ-token');
    });

    it('throws AUTH PublishError when accessToken is missing', async () => {
      await expect(
        adapter.publish(
          { igUserId: '17841405822304914' },
          {
            title: 't',
            body: 'b',
            options: { imageUrl: 'https://example.com/image.jpg' },
          },
        ),
      ).rejects.toThrow(/access token missing/);
    });

    it('throws AUTH PublishError when IG user ID is missing from credentials', async () => {
      await expect(
        adapter.publish(
          { accessToken: 'IGQVJ-token' },
          {
            title: 't',
            body: 'b',
            options: { imageUrl: 'https://example.com/image.jpg' },
          },
        ),
      ).rejects.toThrow(/account ID missing/);
    });

    it('throws VALIDATION PublishError when no imageUrl is provided', async () => {
      await expect(
        adapter.publish(
          { accessToken: 'IGQVJ-token', igUserId: '17841405822304914' },
          { title: 't', body: 'b' },
        ),
      ).rejects.toThrow(/require an image/);
    });

    it('throws VALIDATION PublishError when imageUrl is empty string', async () => {
      await expect(
        adapter.publish(
          { accessToken: 'IGQVJ-token', igUserId: '17841405822304914' },
          { title: 't', body: 'b', options: { imageUrl: '' } },
        ),
      ).rejects.toThrow(/require an image/);
    });

    it('throws AUTH PublishError on 401 from /media create', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(401, { error: { message: 'Token expired' } }),
      ));

      await expect(
        adapter.publish(
          { accessToken: 'expired-token', igUserId: '17841405822304914' },
          {
            title: 't',
            body: 'b',
            options: { imageUrl: 'https://example.com/image.jpg' },
          },
        ),
      ).rejects.toThrow(/expired/);
    });

    it('throws AUTH PublishError on 403 from /media create (permissions)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(403, { error: { message: 'Insufficient permissions' } }),
      ));

      await expect(
        adapter.publish(
          { accessToken: 'IGQVJ-token', igUserId: '17841405822304914' },
          {
            title: 't',
            body: 'b',
            options: { imageUrl: 'https://example.com/image.jpg' },
          },
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('throws NETWORK PublishError on 500 from /media create', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(500, { error: { message: 'Server error' } }),
      ));

      await expect(
        adapter.publish(
          { accessToken: 'IGQVJ-token', igUserId: '17841405822304914' },
          {
            title: 't',
            body: 'b',
            options: { imageUrl: 'https://example.com/image.jpg' },
          },
        ),
      ).rejects.toThrow(/Instagram \/media create failed/);
    });

    it('throws VALIDATION PublishError when /media returns error in body', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          error: { message: 'Invalid image URL' },
        }),
      ));

      await expect(
        adapter.publish(
          { accessToken: 'IGQVJ-token', igUserId: '17841405822304914' },
          {
            title: 't',
            body: 'b',
            options: { imageUrl: 'https://example.com/bad.jpg' },
          },
        ),
      ).rejects.toThrow(/Instagram rejected media/);
    });

    it('throws NETWORK PublishError when /media returns no container id', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {}),
      ));

      await expect(
        adapter.publish(
          { accessToken: 'IGQVJ-token', igUserId: '17841405822304914' },
          {
            title: 't',
            body: 'b',
            options: { imageUrl: 'https://example.com/image.jpg' },
          },
        ),
      ).rejects.toThrow(/no container id/);
    });

    it('throws NETWORK PublishError when /media_publish fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(mockResponse(200, { id: 'container-1' }))
        .mockResolvedValueOnce(mockResponse(400, { error: { message: 'bad' } }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        adapter.publish(
          { accessToken: 'IGQVJ-token', igUserId: '17841405822304914' },
          {
            title: 't',
            body: 'b',
            options: { imageUrl: 'https://example.com/image.jpg' },
          },
        ),
      ).rejects.toThrow(/Instagram \/media_publish failed/);
    });

    it('uses userId field as fallback when igUserId is missing (backwards-compat)', async () => {
      const createResp = mockResponse(200, { id: 'container-1' });
      const publishResp = mockResponse(200, { id: 'post-1' });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createResp)
        .mockResolvedValueOnce(publishResp);
      vi.stubGlobal('fetch', fetchMock);

      // saveOAuthConnection stores identity.id as both userId and memberId.
      // An older connection may only have userId/memberId, not igUserId.
      await adapter.publish(
        {
          accessToken: 'IGQVJ-token',
          userId: '17841405822304914', // no igUserId
        } as Record<string, unknown>,
        {
          title: 't',
          body: 'b',
          options: { imageUrl: 'https://example.com/image.jpg' },
        },
      );

      const createCall = fetchMock.mock.calls[0];
      expect(createCall[0]).toBe(
        'https://graph.facebook.com/v21.0/17841405822304914/media',
      );
    });

    it('uses memberId field as fallback when both igUserId and userId are missing', async () => {
      const createResp = mockResponse(200, { id: 'container-1' });
      const publishResp = mockResponse(200, { id: 'post-1' });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createResp)
        .mockResolvedValueOnce(publishResp);
      vi.stubGlobal('fetch', fetchMock);

      await adapter.publish(
        {
          accessToken: 'IGQVJ-token',
          memberId: '17841405822304914',
        } as Record<string, unknown>,
        {
          title: 't',
          body: 'b',
          options: { imageUrl: 'https://example.com/image.jpg' },
        },
      );

      const createCall = fetchMock.mock.calls[0];
      expect(createCall[0]).toBe(
        'https://graph.facebook.com/v21.0/17841405822304914/media',
      );
    });

    it('builds caption with title, body, URL, and hashtags', async () => {
      const createResp = mockResponse(200, { id: 'container-1' });
      const publishResp = mockResponse(200, { id: 'post-1' });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createResp)
        .mockResolvedValueOnce(publishResp);
      vi.stubGlobal('fetch', fetchMock);

      await adapter.publish(
        { accessToken: 'IGQVJ-token', igUserId: '17841405822304914' },
        {
          title: 'My Title',
          body: 'My body text',
          url: 'https://github.com/me/repo',
          hashtags: ['dev', 'node', 'typescript'],
          options: { imageUrl: 'https://example.com/image.jpg' },
        },
      );

      // Parse the URL-encoded body to extract the caption field properly.
      // URLSearchParams correctly handles + → space and %XX decoding.
      const createBody = new URLSearchParams(
        fetchMock.mock.calls[0][1].body as string,
      );
      const caption = createBody.get('caption') || '';
      expect(caption).toContain('My Title');
      expect(caption).toContain('My body text');
      expect(caption).toContain('https://github.com/me/repo');
      expect(caption).toContain('#dev #node #typescript');
    });
  });
});
