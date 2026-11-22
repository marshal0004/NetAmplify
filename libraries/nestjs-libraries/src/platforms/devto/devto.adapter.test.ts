// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/devto/devto.adapter.test.ts
// Vitest unit tests for DevtoAdapter.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DevtoAdapter } from './devto.adapter';
import { PublishError } from '../adapter.interface';

// Mock uploads-dir helpers. ensurePublicMediaUrl returns a fixed public URL
// (simulating the catbox.moe fallback); resolvePublicMediaUrl returns the URL
// unchanged for absolute https URLs (matching the real implementation).
vi.mock('../../services/uploads-dir', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/uploads-dir')>();
  return {
    ...actual,
    ensurePublicMediaUrl: vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith('https://') && !url.includes('localhost') && !url.includes('ngrok-free')) {
        return url;
      }
      return 'https://files.catbox.moe/abc123.mp4';
    }),
    resolvePublicMediaUrl: vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      return null;
    }),
  };
});


function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('DevtoAdapter', () => {
  let adapter: DevtoAdapter;

  beforeEach(() => {
    adapter = new DevtoAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('has platform=DEVTO, kind=SIMPLE', () => {
      expect(adapter.platform).toBe('DEVTO');
      expect(adapter.kind).toBe('SIMPLE');
      expect(adapter.name).toBe('Dev.to');
    });
  });

  describe('validateCredentials()', () => {
    it('returns user identity on valid API key', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { id: 12345, username: 'janedev' })
      ));

      const result = await adapter.validateCredentials({ apiKey: 'dev-123' });

      expect(result.identity.id).toBe('12345');
      expect(result.identity.username).toBe('janedev');
      expect(result.credentials.apiKey).toBe('dev-123');
    });

    it('throws PublishError(AUTH) on 401 (invalid key)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(adapter.validateCredentials({ apiKey: 'bad' })).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when apiKey missing', async () => {
      await expect(adapter.validateCredentials({})).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow')));
      await expect(adapter.validateCredentials({ apiKey: 'dev' })).rejects.toThrow(PublishError);
    });
  });

  describe('publish()', () => {
    it('posts an article on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(201, { id: 99, url: 'https://dev.to/janedev/test-123' })
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await adapter.publish(
        { apiKey: 'dev-123' },
        { title: 'Test Post', body: '# markdown', hashtags: ['typescript', 'react'] }
      );

      expect(result.id).toBe('99');
      expect(result.url).toBe('https://dev.to/janedev/test-123');

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.article.title).toBe('Test Post');
      expect(body.article.body_markdown).toBe('# markdown');
      expect(body.article.tags).toEqual(['typescript', 'react']);
      expect(body.article.published).toBe(true);
    });

    it('sanitizes tag characters (lowercase alphanumeric only)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(201, { id: 1, url: 'https://dev.to/u/t' })
      );
      vi.stubGlobal('fetch', mockFetch);
      await adapter.publish(
        { apiKey: 'dev' },
        { title: 'T', body: 'B', hashtags: ['TypeScript!', 'REACT'] }
      );
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.article.tags).toEqual(['typescript', 'react']);
    });

    it('limits tags to 4 (Dev.to limit)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(201, { id: 1, url: 'https://dev.to/u/t' })
      );
      vi.stubGlobal('fetch', mockFetch);
      await adapter.publish(
        { apiKey: 'dev' },
        { title: 'T', body: 'B', hashtags: ['a', 'b', 'c', 'd', 'e', 'f'] }
      );
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.article.tags.length).toBe(4);
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.publish({ apiKey: 'dev' }, { title: 'T', body: 'B' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) on 422', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(422, 'bad article')));
      await expect(
        adapter.publish({ apiKey: 'dev' }, { title: 'T', body: 'B' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow')));
      await expect(
        adapter.publish({ apiKey: 'dev' }, { title: 'T', body: 'B' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when apiKey missing from credentials', async () => {
      await expect(
        adapter.publish({}, { title: 'T', body: 'B' })
      ).rejects.toThrow(PublishError);
    });

    it('embeds a video inline in body_markdown as a <video> element (not as main_image)', async () => {
      // Regression: previously the adapter SKIPPED videos entirely — the
      // article published with text only, no playable video. After the fix,
      // the video URL is resolved to a public URL (catbox fallback) and
      // embedded as <video controls preload="metadata" src="..."></video>.
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(201, { id: 7, url: 'https://dev.to/u/v' })
      );
      vi.stubGlobal('fetch', mockFetch);
      const { ensurePublicMediaUrl } = await import('../../services/uploads-dir');
      (ensurePublicMediaUrl as ReturnType<typeof vi.fn>).mockResolvedValue(
        'https://files.catbox.moe/abc123.mp4'
      );

      await adapter.publish(
        { apiKey: 'dev' },
        {
          title: 'Video post',
          body: '---\ncover_image: /uploads/clip.mp4\npublished: true\n---\n\nMy clip.',
          options: { imageUrl: '/uploads/clip.mp4' },
        }
      );

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      // main_image MUST NOT be set for videos (Dev.to rejects video covers with 422)
      expect(body.article.main_image).toBeUndefined();
      // The body_markdown MUST contain the <video> embed with the public URL
      expect(body.article.body_markdown).toContain(
        '<video controls preload="metadata" src="https://files.catbox.moe/abc123.mp4"></video>'
      );
      // The relative cover_image frontmatter line MUST be stripped (Dev.to
      // would 422 on a relative/video cover_image).
      expect(body.article.body_markdown).not.toMatch(/^cover_image:.*\/uploads\/clip\.mp4/m);
    });

    it('uses an existing public https video URL directly (no re-upload)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(201, { id: 8, url: 'https://dev.to/u/w' })
      );
      vi.stubGlobal('fetch', mockFetch);
      const { ensurePublicMediaUrl } = await import('../../services/uploads-dir');
      const spy = (ensurePublicMediaUrl as ReturnType<typeof vi.fn>);
      spy.mockImplementation(async (url: string) => url); // public URL returned as-is

      await adapter.publish(
        { apiKey: 'dev' },
        {
          title: 'Public video',
          body: 'Body text',
          options: { imageUrl: 'https://cdn.example.com/clip.webm' },
        }
      );

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.article.body_markdown).toContain(
        '<video controls preload="metadata" src="https://cdn.example.com/clip.webm"></video>'
      );
      expect(spy).toHaveBeenCalledWith('https://cdn.example.com/clip.webm');
    });

    it('does not embed a video when no media URL is present (text-only backward compat)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(201, { id: 9, url: 'https://dev.to/u/x' })
      );
      vi.stubGlobal('fetch', mockFetch);

      await adapter.publish(
        { apiKey: 'dev' },
        { title: 'Text only', body: 'Just text, no media.' }
      );

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.article.body_markdown).not.toContain('<video');
      expect(body.article.main_image).toBeUndefined();
    });
  });
});
