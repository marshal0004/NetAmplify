// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/hashnode/hashnode.adapter.test.ts
// Vitest unit tests for HashnodeAdapter.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HashnodeAdapter } from './hashnode.adapter';
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

describe('HashnodeAdapter', () => {
  let adapter: HashnodeAdapter;

  beforeEach(() => {
    adapter = new HashnodeAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('has platform=HASHNODE, kind=SIMPLE', () => {
      expect(adapter.platform).toBe('HASHNODE');
      expect(adapter.kind).toBe('SIMPLE');
    });
  });

  describe('validateCredentials()', () => {
    it('returns user identity + publicationId on valid PAT', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          data: {
            me: {
              id: 'user-123',
              username: 'janedev',
              publications: {
                nodes: [{ id: 'pub-abc', title: 'Jane Dev Blog' }],
              },
            },
          },
        })
      ));

      const result = await adapter.validateCredentials({ pat: 'hashnode-pat-123' });

      expect(result.identity.id).toBe('user-123');
      expect(result.identity.username).toBe('janedev');
      expect(result.credentials.pat).toBe('hashnode-pat-123');
      expect(result.credentials.publicationId).toBe('pub-abc');
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.validateCredentials({ pat: 'bad' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when GraphQL returns errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { errors: [{ message: 'Invalid token' }] })
      ));
      await expect(
        adapter.validateCredentials({ pat: 'bad' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when pat missing', async () => {
      await expect(adapter.validateCredentials({})).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow')));
      await expect(
        adapter.validateCredentials({ pat: 'x' })
      ).rejects.toThrow(PublishError);
    });
  });

  describe('publish()', () => {
    it('publishes a post on success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, {
          data: {
            publishPost: {
              post: { id: 'post-abc', slug: 'test-post', url: 'https://janedev.hashnode.dev/test-post' },
            },
          },
        })
      ));

      const result = await adapter.publish(
        { pat: 'pat-123', publicationId: 'pub-abc' },
        { title: 'Test Post', body: '# markdown', hashtags: ['typescript'] }
      );

      expect(result.id).toBe('post-abc');
      expect(result.url).toBe('https://janedev.hashnode.dev/test-post');
    });

    it('throws PublishError(VALIDATION) when publicationId missing', async () => {
      await expect(
        adapter.publish({ pat: 'pat' }, { title: 'T', body: 'B' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) when pat missing', async () => {
      await expect(
        adapter.publish({ publicationId: 'pub' }, { title: 'T', body: 'B' })
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(VALIDATION) when GraphQL returns errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        mockResponse(200, { errors: [{ message: 'Tag not allowed' }] })
      ));
      await expect(
        adapter.publish(
          { pat: 'pat', publicationId: 'pub' },
          { title: 'T', body: 'B', hashtags: ['bad-tag'] }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(AUTH) on 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, 'unauthorized')));
      await expect(
        adapter.publish(
          { pat: 'pat', publicationId: 'pub' },
          { title: 'T', body: 'B' }
        )
      ).rejects.toThrow(PublishError);
    });

    it('throws PublishError(RATE) on 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(429, 'slow')));
      await expect(
        adapter.publish(
          { pat: 'pat', publicationId: 'pub' },
          { title: 'T', body: 'B' }
        )
      ).rejects.toThrow(PublishError);
    });
  });
});
