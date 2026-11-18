// /home/z/my-project/na-work/libraries/nestjs-libraries/src/platforms/instagram/instagram.adapter.publish-fixes.test.ts
// Vitest unit tests for the Instagram publish fixes:
//   - media_type REELS (Meta deprecated 'VIDEO' → error_subcode 2207067)
//   - 4xx classified as VALIDATION (permanent), not NETWORK (retryable)
//   - refreshCredentials (proactive token refresh preserving igUserId)
//   - rewriteLocalhostUrlForMeta resolves relative /uploads/ URLs to PUBLIC_APP_URL

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InstagramAdapter, rewriteLocalhostUrlForMeta } from './instagram.adapter';
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

describe('InstagramAdapter publish fixes', () => {
  let adapter: InstagramAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    adapter = new InstagramAdapter();
    process.env.INSTAGRAM_APP_ID = 'test-app-id';
    process.env.INSTAGRAM_APP_SECRET = 'test-app-secret';
    process.env.PUBLIC_APP_URL = 'https://tunnel.ngrok-free.app';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const creds = {
    accessToken: 'IGQVJ-test-token',
    igUserId: '1782847289700445',
    userId: '1782847289700445',
    memberId: '1782847289700445',
    expiresAt: Math.floor(Date.now() / 1000) + 60 * 24 * 3600, // valid — no refresh
  };

  describe('publish() video → REELS (not deprecated VIDEO)', () => {
    it('creates a media container with media_type=REELS for video posts', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/media') && !url.includes('media_publish') && !url.includes('status_code')) {
          // create container
          return Promise.resolve(mockResponse(200, { id: 'container-123' }));
        }
        if (url.includes('status_code')) {
          // video container status poll → FINISHED immediately
          return Promise.resolve(mockResponse(200, { status_code: 'FINISHED' }));
        }
        if (url.includes('/media_publish')) {
          return Promise.resolve(mockResponse(200, { id: 'ig-post-456' }));
        }
        return Promise.resolve(mockResponse(404, { error: 'unexpected url' }));
      });
      vi.stubGlobal('fetch', fetchMock);

      await adapter.publish(creds, {
        title: 'My Video Post',
        body: 'Check this out',
        options: { imageUrl: 'https://cdn.example.com/clip.mp4' },
      });

      // Find the create-container call (POST .../media) + inspect its body.
      const createCall = fetchMock.mock.calls.find(
        ([u]) => typeof u === 'string' && u.includes('/media') && !u.includes('media_publish') && !u.includes('status_code'),
      );
      expect(createCall).toBeDefined();
      const body = String((createCall![1] as RequestInit).body);
      expect(body).toContain('media_type=REELS');
      expect(body).toContain('video_url=');
      expect(body).not.toContain('media_type=VIDEO');
    });

    it('classifies a 400 from /media create as VALIDATION (permanent, not retryable NETWORK)', async () => {
      // This is the exact error Meta returns for the deprecated VIDEO media_type
      // (error_subcode 2207067). With REELS it won't fire, but if Meta rejects
      // any content with a 4xx, it must be VALIDATION — not NETWORK (which the
      // worker would retry 3×, leaving the target stuck in PUBLISHING).
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse(400, {
            error: {
              message: "media_type 'VIDEO' has been removed",
              error_subcode: 2207067,
            },
          }),
        ),
      );

      await expect(
        adapter.publish(creds, {
          title: 't',
          body: 'b',
          options: { imageUrl: 'https://cdn.example.com/clip.mp4' },
        }),
      ).rejects.toMatchObject({
        name: 'PublishError',
        errorClass: 'VALIDATION',
      });
    });

    it('classifies a 500 from /media create as NETWORK (retryable)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(500, 'upstream down')));

      await expect(
        adapter.publish(creds, {
          title: 't',
          body: 'b',
          options: { imageUrl: 'https://cdn.example.com/clip.mp4' },
        }),
      ).rejects.toMatchObject({
        name: 'PublishError',
        errorClass: 'NETWORK',
      });
    });
  });

  describe('refreshCredentials()', () => {
    it('returns the SAME blob reference when the token is still valid (>24h left)', async () => {
      const validCreds = {
        ...creds,
        expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, // 30 days
      };
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await adapter.refreshCredentials(validCreds);
      expect(result).toBe(validCreds); // same reference — no refresh, no persist
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refreshes an expiring token + preserves igUserId/memberId/userId', async () => {
      const expiringCreds = {
        ...creds,
        expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1h left — within 24h window
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse(200, {
            access_token: 'IGQVJ-new-token',
            expires_in: 60 * 24 * 3600,
          }),
        ),
      );

      const result = (await adapter.refreshCredentials(expiringCreds)) as Record<string, unknown>;
      expect(result.accessToken).toBe('IGQVJ-new-token');
      // Non-token fields preserved (so the worker can persist directly).
      expect(result.igUserId).toBe('1782847289700445');
      expect(result.memberId).toBe('1782847289700445');
      expect(result.userId).toBe('1782847289700445');
    });

    it('throws AUTH when the refresh token is past the refresh window', async () => {
      const expiredCreds = {
        ...creds,
        expiresAt: Math.floor(Date.now() / 1000) - 100, // expired 100s ago
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'expired')));

      await expect(adapter.refreshCredentials(expiredCreds)).rejects.toMatchObject({
        name: 'PublishError',
        errorClass: 'AUTH',
      });
    });

    it('returns the blob unchanged when expiresAt is missing (older connection)', async () => {
      const noExpiryCreds = { accessToken: 'IGQVJ-token', igUserId: '1782847289700445' };
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await adapter.refreshCredentials(noExpiryCreds);
      expect(result).toBe(noExpiryCreds);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('rewriteLocalhostUrlForMeta() — relative URL support', () => {
    it('resolves a relative /uploads/ URL against PUBLIC_APP_URL', () => {
      process.env.PUBLIC_APP_URL = 'https://tunnel.ngrok-free.app';
      expect(rewriteLocalhostUrlForMeta('/uploads/abc-123.jpg')).toBe(
        'https://tunnel.ngrok-free.app/uploads/abc-123.jpg',
      );
    });

    it('preserves query strings on relative URLs', () => {
      process.env.PUBLIC_APP_URL = 'https://tunnel.ngrok-free.app';
      expect(rewriteLocalhostUrlForMeta('/uploads/abc.mp4?t=1')).toBe(
        'https://tunnel.ngrok-free.app/uploads/abc.mp4?t=1',
      );
    });

    it('throws VALIDATION when the URL is relative + PUBLIC_APP_URL is unset', () => {
      delete process.env.PUBLIC_APP_URL;
      expect(() => rewriteLocalhostUrlForMeta('/uploads/abc.jpg')).toThrow(PublishError);
      expect(() => rewriteLocalhostUrlForMeta('/uploads/abc.jpg')).toThrow(/PUBLIC_APP_URL/);
    });

    it('still rewrites localhost URLs to PUBLIC_APP_URL (unchanged behavior)', () => {
      process.env.PUBLIC_APP_URL = 'https://tunnel.ngrok-free.app';
      expect(rewriteLocalhostUrlForMeta('http://localhost:3000/uploads/abc.jpg')).toBe(
        'https://tunnel.ngrok-free.app/uploads/abc.jpg',
      );
    });

    it('passes through absolute public URLs unchanged', () => {
      expect(rewriteLocalhostUrlForMeta('https://cdn.example.com/abc.jpg')).toBe(
        'https://cdn.example.com/abc.jpg',
      );
    });
  });
});
