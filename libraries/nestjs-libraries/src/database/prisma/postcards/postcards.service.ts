// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/database/prisma/postcards/postcards.service.ts
// NetAmplify — PostCardService (business logic for PostCard CRUD + preview).

import { Injectable, Inject } from '@nestjs/common';
import { PostCardRepository, type PostCardListResult } from './postcards.repository';
import { ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';
import {
  POSTCARD_CREATE_SCHEMA,
  POSTCARD_UPDATE_SCHEMA,
  type PostCardCreateInput,
  type PostCardUpdateInput,
} from '@netamplify/nestjs-libraries/validation/schemas';
import {
  formatForPlatform,
  type FormatEnginePostCard,
} from '@netamplify/nestjs-libraries/format-engine';
import type { Platform, PostCard } from '@prisma/client';

/**
 * Safe PostCard view (returned to API consumers). Never includes internal
 * fields the user shouldn't see.
 */
export interface PostCardView {
  id: string;
  title: string;
  summary: string;
  description: string;
  techStack: string[];
  repoUrl: string | null;
  liveUrl: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

function toView(card: PostCard): PostCardView {
  return {
    id: card.id,
    title: card.title,
    summary: card.summary,
    description: card.description,
    techStack: card.techStack,
    repoUrl: card.repoUrl,
    liveUrl: card.liveUrl,
    imageUrl: card.imageUrl,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

/**
 * Preview result for the publish page (per-platform live preview).
 */
export interface PostCardPreview {
  platform: Platform;
  formatted: {
    title?: string;
    body?: string;
    url?: string;
    hashtags?: string[];
    charCount: number;
    limit: number;
  };
}

@Injectable()
export class PostCardService {
  constructor(@Inject(PostCardRepository) private readonly _repo: PostCardRepository) {}

  async list(
    userId: string,
    page: number = 1,
    pageSize: number = 12
  ): Promise<{ items: PostCardView[]; total: number; page: number; pageSize: number }> {
    const result = await this._repo.listByUser(userId, page, pageSize);
    return { items: result.items.map(toView), total: result.total, page: result.page, pageSize: result.pageSize };
  }

  async get(userId: string, id: string): Promise<PostCardView> {
    const card = await this._repo.findById(userId, id);
    if (!card) {
      throw new ServiceError('NOT_FOUND', `PostCard ${id} not found`);
    }
    return toView(card);
  }

  async create(userId: string, rawInput: unknown): Promise<PostCardView> {
    const parsed = POSTCARD_CREATE_SCHEMA.safeParse(rawInput);
    if (!parsed.success) {
      throw new ServiceError('VALIDATION_ERROR', 'Invalid PostCard input', undefined, parsed.error);
    }
    const input = parsed.data as PostCardCreateInput;
    const card = await this._repo.create(userId, {
      title: input.title,
      summary: input.summary,
      description: input.description,
      techStack: input.techStack,
      repoUrl: input.repoUrl || undefined,
      liveUrl: input.liveUrl || undefined,
      imageUrl: input.imageUrl || undefined,
    });
    return toView(card);
  }

  async update(userId: string, id: string, rawInput: unknown): Promise<PostCardView> {
    const parsed = POSTCARD_UPDATE_SCHEMA.safeParse(rawInput);
    if (!parsed.success) {
      throw new ServiceError('VALIDATION_ERROR', 'Invalid PostCard update input', undefined, parsed.error);
    }
    const input = parsed.data as PostCardUpdateInput;
    const card = await this._repo.update(userId, id, {
      title: input.title,
      summary: input.summary,
      description: input.description,
      techStack: input.techStack,
      repoUrl: input.repoUrl === undefined ? undefined : (input.repoUrl || null),
      liveUrl: input.liveUrl === undefined ? undefined : (input.liveUrl || null),
      imageUrl: input.imageUrl === undefined ? undefined : (input.imageUrl || null),
    });
    if (!card) {
      throw new ServiceError('NOT_FOUND', `PostCard ${id} not found`);
    }
    return toView(card);
  }

  async delete(userId: string, id: string): Promise<void> {
    const deleted = await this._repo.delete(userId, id);
    if (!deleted) {
      throw new ServiceError('NOT_FOUND', `PostCard ${id} not found`);
    }
  }

  /**
   * Format-engine preview for the publish page. Returns the formatted
   * output for a specific platform (with optional subreddit for Reddit).
   * Per docs/05-API-SPEC.md:
   *   GET /api/postcards/:id/preview?platform=REDDIT&subreddit=test
   */
  async preview(
    userId: string,
    id: string,
    platform: Platform,
    subreddit?: string
  ): Promise<PostCardPreview> {
    const card = await this._repo.findById(userId, id);
    if (!card) {
      throw new ServiceError('NOT_FOUND', `PostCard ${id} not found`);
    }
    const formatInput: FormatEnginePostCard = {
      title: card.title,
      summary: card.summary,
      description: card.description,
      techStack: card.techStack,
      repoUrl: card.repoUrl ?? undefined,
      liveUrl: card.liveUrl ?? undefined,
      imageUrl: card.imageUrl ?? undefined,
    };
    const formatted = formatForPlatform(platform, formatInput, null, subreddit ? { subreddit } : {});
    return {
      platform,
      formatted: {
        title: formatted.title,
        body: formatted.body,
        url: formatted.url,
        hashtags: formatted.hashtags,
        charCount: formatted.charCount,
        limit: formatted.limit,
      },
    };
  }
}
