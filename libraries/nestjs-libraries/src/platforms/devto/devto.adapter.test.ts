// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/devto/devto.adapter.test.ts
// Vitest unit tests for DevtoAdapter.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DevtoAdapter } from './devto.adapter';
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
  });
});
