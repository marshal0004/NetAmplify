// /home/z/my-project/netamplify-ref/libraries/nestjs-libraries/src/platforms/youtube/youtube.adapter.test.ts
// Vitest unit tests for YouTubeAdapter.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { YouTubeAdapter, resolveVideoUrl } from './youtube.adapter';
import { PublishError } from '../adapter.interface';

function mockResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  const h = new Headers(headers ?? {});
  const isBinary = body instanceof ArrayBuffer || body instanceof Uint8Array;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: h,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () =>
      isBinary
        ? (body instanceof Uint8Array ? body.buffer : body)
        : new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)).buffer,
  } as Response;
}

describe('YouTubeAdapter', () => {
  let adapter: YouTubeAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    adapter = new YouTubeAdapter();
    process.env.YOUTUBE_CLIENT_ID = 'test-yt-client-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-yt-client-secret';
    delete process.env.PUBLIC_APP_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('configured()', () => {
    it('returns true when YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET are set', () => {
      expect(adapter.configured()).toBe(true);
    });

    it('returns false when YOUTUBE_CLIENT_ID missing', () => {
      delete process.env.YOUTUBE_CLIENT_ID;
      expect(adapter.configured()).toBe(false);
    });

    it('returns false when YOUTUBE_CLIENT_SECRET missing', () => {
      delete process.env.YOUTUBE_CLIENT_SECRET;
      expect(adapter.configured()).toBe(false);
    });
  });

  describe('getAuthUrl()', () => {
    it('builds Google OAuth URL with PKCE, offline access, consent, youtube scopes', () => {
      const url = adapter.getAuthUrl(
        { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
        'state-yt',
        'http://localhost:4200/api/oauth/youtube/callback',
      );
      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('client_id=test-yt-client-id');
      expect(url).toContain('response_type=code');
      expect(url).toContain('state=state-yt');
      expect(url).toContain('code_challenge=c');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
      expect(url).toContain('scope=');
      expect(url).toContain('youtube.upload');
      expect(url).toContain('youtube.readonly');
    });

    it('throws when not configured', () => {
      delete process.env.YOUTUBE_CLIENT_ID;
      expect(() =>
        adapter.getAuthUrl(
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          's',
          'http://localhost:4200/api/oauth/youtube/callback',
        ),
      ).toThrow();
    });

    it('accepts http://localhost redirect (Google allows it, unlike Meta)', () => {
      const url = adapter.getAuthUrl(
        { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
        's',
        'http://localhost:4200/api/oauth/youtube/callback',
      );
      expect(url).toContain('redirect_uri=');
      // Should NOT throw — Google accepts localhost.
      expect(url).toContain('localhost');
    });
  });

  describe('exchangeCode()', () => {
    it('returns tokens with refresh_token on success + includes code_verifier in body', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, {
          access_token: 'yt-access-tok',
          refresh_token: 'yt-refresh-tok',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
          token_type: 'Bearer',
        }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const tokens = await adapter.exchangeCode(
        'code-yt',
        { code_verifier: 'verifier-xyz', code_challenge: 'c', code_challenge_method: 'S256' },
        'http://localhost:4200/api/oauth/youtube/callback',
      );

      expect(tokens.accessToken).toBe('yt-access-tok');
      expect(tokens.refreshToken).toBe('yt-refresh-tok');
      // Google returns scopes as full URLs (not the short form). The adapter
      // splits data.scope on spaces — same pattern as the LinkedIn adapter.
      expect(tokens.scopes).toContain('https://www.googleapis.com/auth/youtube.upload');
      expect(tokens.scopes).toContain('https://www.googleapis.com/auth/youtube.readonly');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://oauth2.googleapis.com/token');
      expect(init.method).toBe('POST');
      expect(init.body).toContain('grant_type=authorization_code');
      expect(init.body).toContain('code=code-yt');
      expect(init.body).toContain('code_verifier=verifier-xyz');
      expect(init.body).toContain('client_secret=test-yt-client-secret');
    });

    it('throws PublishError(AUTH) on 400 (bad code)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(400, 'bad code')));
      await expect(
        adapter.exchangeCode(
          'bad',
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          'http://localhost:4200/api/oauth/youtube/callback',
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when access_token missing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, {})));
      await expect(
        adapter.exchangeCode(
          'code',
          { code_verifier: 'v', code_challenge: 'c', code_challenge_method: 'S256' },
          'http://localhost:4200/api/oauth/youtube/callback',
        ),
      ).rejects.toThrow(PublishError);
    });
  });

  describe('getIdentity()', () => {
    it('returns channel id + @customUrl when customUrl present', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse(200, {
            items: [
              {
                id: 'UCchannel123',
                snippet: { title: 'Neeraj Codes', customUrl: 'neerajcodes' },
              },
            ],
          }),
        ),
      );
      const identity = await adapter.getIdentity({ accessToken: 'tok', scopes: [] });
      expect(identity.id).toBe('UCchannel123');
      expect(identity.username).toBe('@neerajcodes');
    });

    it('falls back to channel title when customUrl missing', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse(200, {
            items: [
              { id: 'UCchannel123', snippet: { title: 'Neeraj Codes' } },
            ],
          }),
        ),
      );
      const identity = await adapter.getIdentity({ accessToken: 'tok', scopes: [] });
      expect(identity.username).toBe('Neeraj Codes');
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.getIdentity({ accessToken: 'bad', scopes: [] }),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 403 (API not enabled / consent screen testing)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(403, 'forbidden')));
      await expect(
        adapter.getIdentity({ accessToken: 'tok', scopes: [] }),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when account has no YouTube channel', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { items: [] })));
      await expect(
        adapter.getIdentity({ accessToken: 'tok', scopes: [] }),
      ).rejects.toThrow(PublishError);
    });
  });

  describe('refresh()', () => {
    it('returns a fresh access token + carries forward the refresh_token', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse(200, {
            access_token: 'fresh-yt-tok',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/youtube.upload',
          }),
        ),
      );
      const refreshed = await adapter.refresh({
        accessToken: 'old-tok',
        refreshToken: 'stored-refresh-tok',
        scopes: ['https://www.googleapis.com/auth/youtube.upload'],
      });
      expect(refreshed.accessToken).toBe('fresh-yt-tok');
      // Google does NOT return a new refresh_token — the old one is retained.
      expect(refreshed.refreshToken).toBe('stored-refresh-tok');
    });

    it('throws PublishError(AUTH) when no refresh_token stored', async () => {
      await expect(
        adapter.refresh({ accessToken: 'tok', scopes: [] }),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 400 (refresh token revoked)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(400, 'invalid_grant')));
      await expect(
        adapter.refresh({ accessToken: 'tok', refreshToken: 'revoked', scopes: [] }),
      ).rejects.toThrow(PublishError);
    });
  });

  describe('publish()', () => {
    const videoBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]).buffer;

    it('uploads a video via the two-step resumable flow (initiate → PUT bytes)', async () => {
      const mockFetch = vi.fn()
        // 1. Initiate session → 200 + Location header.
        .mockResolvedValueOnce(
          mockResponse(200, '', { location: 'https://upload.googleapis.com/session/abc' }),
        )
        // 2. Fetch video bytes from the video URL.
        .mockResolvedValueOnce(
          mockResponse(200, videoBytes, { 'content-type': 'video/mp4' }),
        )
        // 3. Upload bytes to session URI → 200 + { id }.
        .mockResolvedValueOnce(mockResponse(200, { id: 'vid-dQw4w9WgXcQ' }));
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.publish(
        { accessToken: 'tok', channelId: 'UC123' },
        {
          title: 'My Demo Video',
          body: 'A description of the demo.',
          url: 'https://example.com',
          hashtags: ['demo', 'netamplify'],
          options: { videoUrl: 'https://cdn.example.com/demo.mp4' },
        },
      );

      expect(result.id).toBe('vid-dQw4w9WgXcQ');
      expect(result.url).toBe('https://youtu.be/vid-dQw4w9WgXcQ');

      // First call: initiate session with Bearer + JSON metadata.
      const [initUrl, initOpts] = mockFetch.mock.calls[0];
      expect(initUrl).toContain('https://www.googleapis.com/upload/youtube/v3/videos');
      expect(initUrl).toContain('uploadType=resumable');
      expect(initOpts.method).toBe('POST');
      expect(initOpts.headers.Authorization).toBe('Bearer tok');
      const metaBody = JSON.parse(initOpts.body);
      expect(metaBody.snippet.title).toBe('My Demo Video');
      expect(metaBody.status.privacyStatus).toBe('public');

      // Third call: PUT bytes to the session URI.
      const [uploadUrl, uploadOpts] = mockFetch.mock.calls[2];
      expect(uploadUrl).toBe('https://upload.googleapis.com/session/abc');
      expect(uploadOpts.method).toBe('PUT');
    });

    it('throws PublishError(VALIDATION) when videoUrl missing', async () => {
      await expect(
        adapter.publish(
          { accessToken: 'tok', channelId: 'UC123' },
          { title: 't', body: 'b' },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when accessToken missing', async () => {
      await expect(
        adapter.publish(
          { channelId: 'UC123' },
          { title: 't', body: 'b', options: { videoUrl: 'https://x.com/v.mp4' } },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401 from initiate', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.publish(
          { accessToken: 'tok', channelId: 'UC123' },
          { title: 't', body: 'b', options: { videoUrl: 'https://x.com/v.mp4' } },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429 from initiate (quota exceeded)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'quota')));
      await expect(
        adapter.publish(
          { accessToken: 'tok', channelId: 'UC123' },
          { title: 't', body: 'b', options: { videoUrl: 'https://x.com/v.mp4' } },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(NETWORK) when initiate returns no Location header', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, '')));
      await expect(
        adapter.publish(
          { accessToken: 'tok', channelId: 'UC123' },
          { title: 't', body: 'b', options: { videoUrl: 'https://x.com/v.mp4' } },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(NETWORK) when video bytes fetch fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce(
            mockResponse(200, '', { location: 'https://session.uri' }),
          )
          .mockResolvedValueOnce(mockResponse(404, 'not found')),
      );
      await expect(
        adapter.publish(
          { accessToken: 'tok', channelId: 'UC123' },
          { title: 't', body: 'b', options: { videoUrl: 'https://x.com/missing.mp4' } },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when video bytes are empty', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce(
            mockResponse(200, '', { location: 'https://session.uri' }),
          )
          .mockResolvedValueOnce(mockResponse(200, new ArrayBuffer(0), { 'content-type': 'video/mp4' })),
      );
      await expect(
        adapter.publish(
          { accessToken: 'tok', channelId: 'UC123' },
          { title: 't', body: 'b', options: { videoUrl: 'https://x.com/empty.mp4' } },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(NETWORK) when upload step fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce(
            mockResponse(200, '', { location: 'https://session.uri' }),
          )
          .mockResolvedValueOnce(mockResponse(200, videoBytes, { 'content-type': 'video/mp4' }))
          .mockResolvedValueOnce(mockResponse(500, 'upload failed')),
      );
      await expect(
        adapter.publish(
          { accessToken: 'tok', channelId: 'UC123' },
          { title: 't', body: 'b', options: { videoUrl: 'https://x.com/v.mp4' } },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(NETWORK) when upload returns no video id', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce(
            mockResponse(200, '', { location: 'https://session.uri' }),
          )
          .mockResolvedValueOnce(mockResponse(200, videoBytes, { 'content-type': 'video/mp4' }))
          .mockResolvedValueOnce(mockResponse(200, {})),
      );
      await expect(
        adapter.publish(
          { accessToken: 'tok', channelId: 'UC123' },
          { title: 't', body: 'b', options: { videoUrl: 'https://x.com/v.mp4' } },
        ),
      ).rejects.toThrow(PublishError);
    });

    it('truncates title to 100 chars', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce(mockResponse(200, '', { location: 'https://session.uri' }))
          .mockResolvedValueOnce(mockResponse(200, videoBytes, { 'content-type': 'video/mp4' }))
          .mockResolvedValueOnce(mockResponse(200, { id: 'vid-1' })),
      );
      const longTitle = 'T'.repeat(200);
      await adapter.publish(
        { accessToken: 'tok', channelId: 'UC123' },
        { title: longTitle, body: 'b', options: { videoUrl: 'https://x.com/v.mp4' } },
      );
      const metaBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
      expect(metaBody.snippet.title.length).toBeLessThanOrEqual(100);
    });
  });

  describe('resolveVideoUrl()', () => {
    it('returns public URLs unchanged', () => {
      expect(resolveVideoUrl('https://cdn.example.com/v.mp4')).toBe('https://cdn.example.com/v.mp4');
    });

    it('rewrites localhost URL to PUBLIC_APP_URL when env is set', () => {
      process.env.PUBLIC_APP_URL = 'https://tunnel.ngrok-free.app';
      expect(resolveVideoUrl('http://localhost:3000/uploads/v.mp4')).toBe(
        'https://tunnel.ngrok-free.app/uploads/v.mp4',
      );
    });

    it('keeps localhost URL when PUBLIC_APP_URL is unset (backend loopback fetch)', () => {
      delete process.env.PUBLIC_APP_URL;
      expect(resolveVideoUrl('http://localhost:3000/uploads/v.mp4')).toBe(
        'http://localhost:3000/uploads/v.mp4',
      );
    });

    it('handles 127.0.0.1 the same as localhost', () => {
      process.env.PUBLIC_APP_URL = 'https://tunnel.ngrok-free.app';
      expect(resolveVideoUrl('http://127.0.0.1:3000/uploads/v.mp4')).toBe(
        'https://tunnel.ngrok-free.app/uploads/v.mp4',
      );
    });

    it('returns malformed URL unchanged (lets fetch throw downstream)', () => {
      expect(resolveVideoUrl('not-a-url')).toBe('not-a-url');
    });
  });
});
