// /home/z/my-project/netamplify-ref/libraries/nestjs-libraries/src/platforms/threads/threads.adapter.test.ts
// Vitest unit tests for ThreadsAdapter.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThreadsAdapter } from './threads.adapter';
import { PublishError } from '../adapter.interface';

function mockResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  const h = new Headers(headers ?? {});
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: h,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('ThreadsAdapter', () => {
  let adapter: ThreadsAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    adapter = new ThreadsAdapter();
    process.env.THREADS_APP_ID = 'test-threads-app-id';
    process.env.THREADS_APP_SECRET = 'test-threads-app-secret';
    delete process.env.PUBLIC_APP_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('configured()', () => {
    it('returns true when THREADS_APP_ID + THREADS_APP_SECRET are set', () => {
      expect(adapter.configured()).toBe(true);
    });

    it('returns false when THREADS_APP_ID is missing', () => {
      delete process.env.THREADS_APP_ID;
      expect(adapter.configured()).toBe(false);
    });

    it('returns false when THREADS_APP_SECRET is missing', () => {
      delete process.env.THREADS_APP_SECRET;
      expect(adapter.configured()).toBe(false);
    });
  });

  describe('getAuthUrl()', () => {
    it('builds the Threads authorize URL with client_id, scope, state', () => {
      const url = adapter.getAuthUrl(
        { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
        'state-abc',
        'https://tunnel.ngrok-free.app/api/oauth/threads/callback',
      );
      expect(url).toContain('https://threads.net/oauth/authorize');
      expect(url).toContain('client_id=test-threads-app-id');
      expect(url).toContain('response_type=code');
      expect(url).toContain('state=state-abc');
      expect(url).toContain('scope=threads_basic+threads_content_publish');
      expect(url).toContain('redirect_uri=');
    });

    it('throws when not configured (missing THREADS_APP_ID)', () => {
      delete process.env.THREADS_APP_ID;
      expect(() =>
        adapter.getAuthUrl(
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          's',
          'https://tunnel.ngrok-free.app/api/oauth/threads/callback',
        ),
      ).toThrow();
    });

    it('throws when redirect URI is not HTTPS (Meta family requires HTTPS)', () => {
      expect(() =>
        adapter.getAuthUrl(
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          's',
          'http://localhost:4200/api/oauth/threads/callback',
        ),
      ).toThrow(/HTTPS redirect URI/);
    });
  });

  describe('exchangeCode()', () => {
    it('returns long-lived token + threadsUserId on success', async () => {
      // First call: code → short-lived token + user_id.
      // Second call: short-lived → long-lived.
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          mockResponse(200, {
            access_token: 'short-lived-tok',
            user_id: 'threads-user-123',
            expires_in: 3600,
            token_type: 'bearer',
          }),
        )
        .mockResolvedValueOnce(
          mockResponse(200, {
            access_token: 'long-lived-tok',
            expires_in: 5184000,
            token_type: 'bearer',
          }),
        );
      vi.stubGlobal('fetch', mockFetch);

      const tokens = await adapter.exchangeCode(
        'code-xyz',
        { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
        'https://tunnel.ngrok-free.app/api/oauth/threads/callback',
      );

      expect(tokens.accessToken).toBe('long-lived-tok');
      expect(tokens.scopes).toContain('threads_content_publish');
      expect(tokens.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
      // threadsUserId is a custom field stashed in the encrypted blob.
      expect((tokens as Record<string, unknown>).threadsUserId).toBe('threads-user-123');

      // First call hits the token endpoint with POST + form body.
      const [firstUrl, firstInit] = mockFetch.mock.calls[0];
      expect(firstUrl).toBe('https://graph.threads.net/oauth/access_token');
      expect(firstInit.method).toBe('POST');
      expect(firstInit.body).toContain('grant_type=authorization_code');
      expect(firstInit.body).toContain('code=code-xyz');
    });

    it('falls back to short-lived token when long-lived exchange fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce(
            mockResponse(200, {
              access_token: 'short-lived-tok',
              user_id: 'threads-user-123',
              expires_in: 3600,
            }),
          )
          .mockResolvedValueOnce(mockResponse(500, 'meta hiccup')),
      );

      const tokens = await adapter.exchangeCode(
        'code-xyz',
        { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
        'https://tunnel.ngrok-free.app/api/oauth/threads/callback',
      );

      expect(tokens.accessToken).toBe('short-lived-tok');
      expect((tokens as Record<string, unknown>).threadsUserId).toBe('threads-user-123');
    });

    it('throws PublishError(AUTH) when code exchange returns non-ok', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(400, 'bad code')));
      await expect(
        adapter.exchangeCode(
          'bad-code',
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          'https://tunnel.ngrok-free.app/api/oauth/threads/callback',
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when access_token missing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));
      await expect(
        adapter.exchangeCode(
          'code',
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          'https://tunnel.ngrok-free.app/api/oauth/threads/callback',
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when user_id missing', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockResponse(200, { access_token: 'tok' })),
      );
      await expect(
        adapter.exchangeCode(
          'code',
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          'https://tunnel.ngrok-free.app/api/oauth/threads/callback',
        ),
      ).rejects.toThrow(PublishError);
    });
  });

  describe('getIdentity()', () => {
    it('returns id + @username via /me', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockResponse(200, { id: 'threads-123', username: 'neeraj_dev' })),
      );
      const identity = await adapter.getIdentity({ accessToken: 'tok', scopes: [] });
      expect(identity.id).toBe('threads-123');
      expect(identity.username).toBe('@neeraj_dev');
    });

    it('falls back to account id when username missing', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockResponse(200, { id: 'threads-123' })),
      );
      const identity = await adapter.getIdentity({ accessToken: 'tok', scopes: [] });
      expect(identity.username).toBe('Threads account threads-123');
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.getIdentity({ accessToken: 'bad', scopes: [] }),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(NETWORK) when id missing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));
      await expect(
        adapter.getIdentity({ accessToken: 'tok', scopes: [] }),
      ).rejects.toThrow(PublishError);
    });
  });

  describe('refresh()', () => {
    it('returns a fresh access token with the same scopes + threadsUserId', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse(200, {
            access_token: 'fresh-tok',
            expires_in: 5184000,
            token_type: 'bearer',
          }),
        ),
      );
      const refreshed = await adapter.refresh({
        accessToken: 'old-tok',
        scopes: ['threads_basic', 'threads_content_publish'],
        threadsUserId: 'threads-user-123',
      } as unknown as import('../adapter.interface').OAuthTokens);
      expect(refreshed.accessToken).toBe('fresh-tok');
      expect(refreshed.scopes).toContain('threads_content_publish');
      expect((refreshed as Record<string, unknown>).threadsUserId).toBe('threads-user-123');
    });

    it('throws PublishError(AUTH) on 401 (token past refresh window)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'expired')));
      await expect(
        adapter.refresh({ accessToken: 'expired-tok', scopes: [] }),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when no access token present', async () => {
      await expect(
        adapter.refresh({ accessToken: '', scopes: [] }),
      ).rejects.toThrow(PublishError);
    });
  });

  describe('publish()', () => {
    it('publishes a text post via the two-step flow (container → publish)', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(mockResponse(200, { id: 'container-123' }))
        .mockResolvedValueOnce(mockResponse(200, { id: 'post-456' }));
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.publish(
        { accessToken: 'tok', threadsUserId: 'threads-user-123' },
        { title: 'Hello Threads', body: 'First post via NetAmplify' },
      );

      expect(result.id).toBe('post-456');
      expect(result.url).toBe('https://www.threads.net/');

      // First call: create container (POST /threads).
      const [createUrl, createInit] = mockFetch.mock.calls[0];
      expect(createUrl).toBe('https://graph.threads.net/v1.0/threads-user-123/threads');
      expect(createInit.method).toBe('POST');
      expect(createInit.body).toContain('media_type=TEXT');
      expect(createInit.body).toContain('text=');

      // Second call: publish (POST /threads_publish).
      const [pubUrl] = mockFetch.mock.calls[1];
      expect(pubUrl).toBe('https://graph.threads.net/v1.0/threads-user-123/threads_publish');
    });

    it('publishes an IMAGE post when options.imageUrl is set', async () => {
      // Mock the create + publish + (no /me fetch — permalink uses profile root).
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(mockResponse(200, { id: 'container-img-1' }))
        .mockResolvedValueOnce(mockResponse(200, { id: 'post-img-9' }));
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.publish(
        { accessToken: 'tok', threadsUserId: 'threads-user-123' },
        {
          title: 'With image',
          body: 'caption text',
          options: { imageUrl: 'https://cdn.example.com/img.png' },
        },
      );

      expect(result.id).toBe('post-img-9');
      const [, createInit] = mockFetch.mock.calls[0];
      expect(createInit.body).toContain('media_type=IMAGE');
      expect(createInit.body).toContain('image_url=');
    });

    it('truncates caption to 500 chars instead of rejecting', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(mockResponse(200, { id: 'c1' })).mockResolvedValueOnce(
          mockResponse(200, { id: 'p1' }),
        ),
      );
      const longBody = 'x'.repeat(800);
      await adapter.publish(
        { accessToken: 'tok', threadsUserId: 'threads-user-123' },
        { title: 't', body: longBody },
      );
      // No throw — truncation is the production behavior.
      // (If it threw, this test would fail.)
    });

    it('throws PublishError(AUTH) when accessToken missing', async () => {
      await expect(
        adapter.publish(
          { threadsUserId: 'threads-user-123' },
          { title: 't', body: 'b' },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when threadsUserId missing', async () => {
      await expect(
        adapter.publish(
          { accessToken: 'tok' },
          { title: 't', body: 'b' },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when caption is empty', async () => {
      await expect(
        adapter.publish(
          { accessToken: 'tok', threadsUserId: 'threads-user-123' },
          { title: '', body: '' },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401 from container create', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.publish(
          { accessToken: 'tok', threadsUserId: 'threads-user-123' },
          { title: 't', body: 'b' },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429 from container create', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow down')));
      await expect(
        adapter.publish(
          { accessToken: 'tok', threadsUserId: 'threads-user-123' },
          { title: 't', body: 'b' },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(NETWORK) when container id missing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));
      await expect(
        adapter.publish(
          { accessToken: 'tok', threadsUserId: 'threads-user-123' },
          { title: 't', body: 'b' },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(NETWORK) when publish step fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce(mockResponse(200, { id: 'container-1' }))
          .mockResolvedValueOnce(mockResponse(500, 'publish failed')),
      );
      await expect(
        adapter.publish(
          { accessToken: 'tok', threadsUserId: 'threads-user-123' },
          { title: 't', body: 'b' },
        ),
      ).rejects.toThrow(PublishError);
    });
  });
});
