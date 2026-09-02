// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts
// NetAmplify — Post + PostTarget repositories (for publish flow).
//
// Per docs/02-SRS.md FR-012: "Creates Post + one PostTarget per platform,
// enqueues one BullMQ job per target."

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Post, PostTarget, Prisma, Platform } from '@prisma/client';

@Injectable()
export class PostRepository {
  constructor(private readonly _prisma: PrismaService) {}

  /**
   * Create a Post + all PostTargets in a single transaction (atomic).
   * If any target fails validation, the whole publish is rolled back.
   *
   * Per FR-012: requestId is unique — duplicate publishes return the same Post.
   */
  async createWithTargets(
    userId: string,
    postCardId: string,
    requestId: string | undefined,
    targets: Array<{ platform: Platform; connectionId: string | null; options?: Record<string, unknown> }>,
  ): Promise<{ post: Post; targets: PostTarget[] }> {
    return this._prisma.$transaction(async (tx) => {
      const post = await tx.post.create({
        data: {
          userId,
          postCardId,
          ...(requestId ? { requestId } : {}),
          targets: {
            create: targets.map((t) => ({
              platform: t.platform,
              connectionId: t.connectionId,
              status: 'QUEUED',
              options: (t.options ?? null) as Prisma.InputJsonValue,
            })),
          },
        },
        include: { targets: true },
      });
      return { post, targets: post.targets };
    });
  }

  /**
   * Idempotency: lookup by requestId. If found, return existing Post.
   * Per FR-012: "double-click publish creates ONE post (idempotency via
   * client request id)."
   */
  async findByRequestId(userId: string, requestId: string): Promise<Post | null> {
    return this._prisma.post.findUnique({
      where: { requestId },
      // requestId is globally unique per schema, so we don't need userId in the where
      // but we validate ownership separately.
    });
  }

  async findById(userId: string, id: string): Promise<(Post & { targets: PostTarget[] }) | null> {
    return this._prisma.post.findFirst({
      where: { id, userId },
      include: { targets: true },
    });
  }

  async listByUser(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
    filters: { platform?: Platform; status?: string } = {},
  ): Promise<{ items: Array<Post & { targets: PostTarget[] }>; total: number; page: number; pageSize: number }> {
    const skip = (page - 1) * pageSize;
    const where: Prisma.PostWhereInput = { userId };
    if (filters.platform) {
      where.targets = { some: { platform: filters.platform } };
    }
    if (filters.status) {
      where.targets = { some: { status: filters.status as never } };
    }
    const [items, total] = await Promise.all([
      this._prisma.post.findMany({
        where,
        include: { targets: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this._prisma.post.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}

@Injectable()
export class PostTargetRepository {
  constructor(private readonly _prisma: PrismaService) {}

  async findById(postId: string, targetId: string): Promise<PostTarget | null> {
    return this._prisma.postTarget.findFirst({
      where: { id: targetId, postId },
    });
  }

  /**
   * Update target status + optional error message.
   * Per docs/03-ARCHITECTURE.md "Failure Classification":
   *   AUTH → FAILED + "Reconnect this platform"
   *   RATE → backoff retry, then FAILED
   *   VALIDATION → FAILED, surface platform message
   *   NETWORK → backoff retry
   *   QUOTA → SKIPPED with explanation
   */
  async updateStatus(
    targetId: string,
    status: 'QUEUED' | 'PUBLISHING' | 'SUCCESS' | 'FAILED' | 'SKIPPED',
    data: {
      platformPostUrl?: string;
      platformPostId?: string;
      error?: string;
      errorClass?: string;
      attempts?: number;
      publishedAt?: Date;
    } = {},
  ): Promise<PostTarget> {
    return this._prisma.postTarget.update({
      where: { id: targetId },
      data: {
        status,
        platformPostUrl: data.platformPostUrl,
        platformPostId: data.platformPostId,
        error: data.error,
        errorClass: data.errorClass,
        attempts: data.attempts,
        publishedAt: data.publishedAt,
      },
    });
  }

  /**
   * Mark target as PUBLISHING (worker picked it up) + increment attempts.
   */
  async markPublishing(targetId: string): Promise<PostTarget> {
    return this._prisma.postTarget.update({
      where: { id: targetId },
      data: { status: 'PUBLISHING', attempts: { increment: 1 } },
    });
  }

  /**
   * Mark target as SUCCESS with the platform permalink.
   */
  async markSuccess(targetId: string, url: string, platformPostId: string): Promise<PostTarget> {
    return this._prisma.postTarget.update({
      where: { id: targetId },
      data: {
        status: 'SUCCESS',
        platformPostUrl: url,
        platformPostId,
        publishedAt: new Date(),
      },
    });
  }
}
