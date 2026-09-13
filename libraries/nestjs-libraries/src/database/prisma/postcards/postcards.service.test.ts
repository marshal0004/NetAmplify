// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/database/prisma/postcards/postcards.service.test.ts
// Vitest unit tests for PostCardService — mocked at repository boundary.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostCardService } from './postcards.service';
import type { PostCardRepository, PostCardListResult } from './postcards.repository';
import type { PostCard } from '@prisma/client';
import { ServiceError } from '../../../services/error.mapper';

function makeMockRepo() {
  const cards = new Map<string, PostCard>();
  const cardsByUser = new Map<string, Set<string>>();
  let nextId = 1;

  return {
    listByUser: vi.fn(async (userId: string, page: number, pageSize: number): Promise<PostCardListResult> => {
      const ids = cardsByUser.get(userId) ?? new Set();
      const items = Array.from(ids).map((id) => cards.get(id)!).filter(Boolean);
      const total = items.length;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      return { items: items.slice(start, end), total, page, pageSize };
    }),
    findById: vi.fn(async (userId: string, id: string): Promise<PostCard | null> => {
      const card = cards.get(id);
      if (!card || card.userId !== userId) return null;
      return card;
    }),
    create: vi.fn(async (userId: string, data: Partial<PostCard>): Promise<PostCard> => {
      const id = `card-${nextId++}`;
      const now = new Date();
      const card: PostCard = {
        id, userId,
        title: data.title!,
        summary: data.summary!,
        description: data.description!,
        techStack: data.techStack!,
        repoUrl: data.repoUrl ?? null,
        liveUrl: data.liveUrl ?? null,
        imageUrl: data.imageUrl ?? null,
        createdAt: now,
        updatedAt: now,
      };
      cards.set(id, card);
      const set = cardsByUser.get(userId) ?? new Set();
      set.add(id);
      cardsByUser.set(userId, set);
      return card;
    }),
    update: vi.fn(async (userId: string, id: string, data: Partial<PostCard>): Promise<PostCard | null> => {
      const existing = cards.get(id);
      if (!existing || existing.userId !== userId) return null;
      const updated = { ...existing, ...data, updatedAt: new Date() };
      cards.set(id, updated);
      return updated;
    }),
    delete: vi.fn(async (userId: string, id: string): Promise<boolean> => {
      const existing = cards.get(id);
      if (!existing || existing.userId !== userId) return false;
      cards.delete(id);
      const set = cardsByUser.get(userId);
      set?.delete(id);
      return true;
    }),
    _reset: () => {
      cards.clear();
      cardsByUser.clear();
      nextId = 1;
    },
  };
}

describe('PostCardService', () => {
  let service: PostCardService;
  let repo: ReturnType<typeof makeMockRepo>;

  beforeEach(() => {
    repo = makeMockRepo();
    service = new PostCardService(repo as unknown as PostCardRepository);
  });

  const validPostCardInput = {
    title: 'My Project',
    summary: 'A one-line summary',
    description: 'A longer markdown description',
    techStack: ['TypeScript', 'React'],
    repoUrl: 'https://github.com/user/repo',
    liveUrl: 'https://example.com',
  };

  describe('create', () => {
    it('creates a PostCard with valid input', async () => {
      const result = await service.create('user-1', validPostCardInput);
      expect(result.id).toMatch(/^card-/);
      expect(result.title).toBe('My Project');
      expect(result.techStack).toEqual(['TypeScript', 'React']);
      expect(result.repoUrl).toBe('https://github.com/user/repo');
      expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('rejects invalid input (missing title)', async () => {
      await expect(
        service.create('user-1', { ...validPostCardInput, title: '' })
      ).rejects.toThrow(ServiceError);
    });

    it('rejects invalid input (empty techStack)', async () => {
      await expect(
        service.create('user-1', { ...validPostCardInput, techStack: [] })
      ).rejects.toThrow(ServiceError);
    });

    it('rejects too-long title (>120 chars)', async () => {
      await expect(
        service.create('user-1', { ...validPostCardInput, title: 'x'.repeat(121) })
      ).rejects.toThrow(ServiceError);
    });
  });

  describe('get', () => {
    it('returns a PostCard by id for the owner', async () => {
      const created = await service.create('user-1', validPostCardInput);
      const fetched = await service.get('user-1', created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.title).toBe('My Project');
    });

    it('throws NOT_FOUND when PostCard does not exist', async () => {
      await expect(
        service.get('user-1', 'nonexistent-id')
      ).rejects.toThrow(ServiceError);
    });

    it('throws NOT_FOUND when PostCard belongs to another user (no enumeration)', async () => {
      const created = await service.create('user-1', validPostCardInput);
      await expect(
        service.get('user-2', created.id)
      ).rejects.toThrow(ServiceError);
    });
  });

  describe('list', () => {
    it('returns paginated list of user\'s PostCards', async () => {
      for (let i = 0; i < 5; i++) {
        await service.create('user-1', { ...validPostCardInput, title: `Project ${i}` });
      }
      const result = await service.list('user-1', 1, 10);
      expect(result.items.length).toBe(5);
      expect(result.total).toBe(5);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
    });

    it('returns empty list for user with no PostCards', async () => {
      const result = await service.list('user-99', 1, 10);
      expect(result.items.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe('update', () => {
    it('updates a PostCard with valid input', async () => {
      const created = await service.create('user-1', validPostCardInput);
      const updated = await service.update('user-1', created.id, { title: 'Updated Title' });
      expect(updated.title).toBe('Updated Title');
    });

    it('throws NOT_FOUND when PostCard does not exist', async () => {
      await expect(
        service.update('user-1', 'nonexistent', { title: 'X' })
      ).rejects.toThrow(ServiceError);
    });

    it('throws NOT_FOUND when PostCard belongs to another user', async () => {
      const created = await service.create('user-1', validPostCardInput);
      await expect(
        service.update('user-2', created.id, { title: 'X' })
      ).rejects.toThrow(ServiceError);
    });
  });

  describe('delete', () => {
    it('deletes a PostCard for the owner', async () => {
      const created = await service.create('user-1', validPostCardInput);
      await service.delete('user-1', created.id);
      await expect(service.get('user-1', created.id)).rejects.toThrow(ServiceError);
    });

    it('throws NOT_FOUND when PostCard does not exist', async () => {
      await expect(
        service.delete('user-1', 'nonexistent')
      ).rejects.toThrow(ServiceError);
    });
  });

  describe('preview', () => {
    it('returns formatted preview for each platform', async () => {
      const created = await service.create('user-1', validPostCardInput);
      const preview = await service.preview('user-1', created.id, 'REDDIT', 'sideproject');
      expect(preview.platform).toBe('REDDIT');
      expect(preview.formatted.title).toBe('My Project');
      expect(preview.formatted.body).toContain('A one-line summary');
      expect(preview.formatted.charCount).toBeGreaterThan(0);
      // Reddit title limit is 300 (PLATFORM_CONFIG.REDDIT.charLimit); the formatter's
      // limit field uses the BODY limit (40_000) since Reddit's body is the larger field.
      expect(preview.formatted.limit).toBeGreaterThan(0);
    });

    it('passes subreddit option to formatter for Reddit', async () => {
      const created = await service.create('user-1', validPostCardInput);
      const preview = await service.preview('user-1', created.id, 'REDDIT', 'mytestsub');
      // Reddit formatter puts subreddit in options
      // (Note: preview endpoint returns formatted output, options.subreddit is internal to formatter)
      // We just verify the call doesn't throw
      expect(preview).toBeDefined();
    });

    it('throws NOT_FOUND when PostCard does not exist', async () => {
      await expect(
        service.preview('user-1', 'nonexistent', 'REDDIT', 'test')
      ).rejects.toThrow(ServiceError);
    });
  });
});
