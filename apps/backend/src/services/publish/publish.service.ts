// /home/z/my-project/netamplify-app/apps/backend/src/services/publish/publish.service.ts
// NetAmplify — PublishService (the "Amplify" flow).
//
// Per docs/02-SRS.md FR-012 + docs/03-ARCHITECTURE.md Flow A (Amplify):
//   1. Validate: user owns postCard, every requested platform has ACTIVE connection
//   2. Check X monthly budget (FR-018) — skip X if exhausted (SKIPPED with msg)
//   3. Tx: create Post + PostTargets (QUEUED); enqueue one BullMQ job per target
//   4. Return { post: { id, targets: [{ id, platform, status }] } }
//
// Idempotency: if requestId matches existing Post, return it without re-publishing.

import { Injectable, Inject } from '@nestjs/common';
import { PostRepository, PostTargetRepository } from '@netamplify/nestjs-libraries/database/prisma/posts/posts.repository';
import { PostCardRepository } from '@netamplify/nestjs-libraries/database/prisma/postcards/postcards.repository';
import { ConnectionRepository } from '@netamplify/nestjs-libraries/database/prisma/connections/connections.repository';
import { QuotaService } from '@netamplify/nestjs-libraries/database/prisma/quota/quota.service';
import { AuditLogService } from '@netamplify/nestjs-libraries/database/prisma/audit/audit.service';
import { ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';
import { PUBLISH_SCHEMA, type PublishInput } from '@netamplify/nestjs-libraries/validation/schemas';
import type { Platform, Post, PostTarget } from '@prisma/client';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';

interface AuditContext {
  ip?: string;
  userAgent?: string;
}

export interface PublishResultView {
  post: {
    id: string;
    createdAt: string;
    targets: Array<{
      id: string;
      platform: Platform;
      status: 'QUEUED' | 'PUBLISHING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
      error?: string | null;
      platformPostUrl?: string | null;
      attempts?: number;
      publishedAt?: string | null;
    }>;
  };
}

@Injectable()
export class PublishService {
  constructor(
    @Inject(PostRepository) private readonly _posts: PostRepository,
    @Inject(PostTargetRepository) private readonly _targets: PostTargetRepository,
    @Inject(PostCardRepository) private readonly _postcards: PostCardRepository,
    @Inject(ConnectionRepository) private readonly _connections: ConnectionRepository,
    @Inject(QuotaService) private readonly _quota: QuotaService,
    @Inject(AuditLogService) private readonly _audit: AuditLogService,
    @InjectQueue('publish') private readonly _publishQueue: Queue,
  ) {}

  /**
   * Publish a PostCard to N platforms.
   *
   * Flow:
   *   1. Validate input shape (Zod)
   *   2. Verify postCard ownership (403 if not owner)
   *   3. Idempotency check: if requestId matches existing Post, return it
   *   4. For each requested platform:
   *      - Verify ACTIVE connection exists (400 with invalidPlatforms list if not)
   *      - For X (TWITTER): check monthly budget → if exceeded, mark SKIPPED
   *   5. Tx: create Post + PostTargets (QUEUED for valid, SKIPPED for X-quota)
   *   6. Enqueue one BullMQ job per non-SKIPPED target
   *   7. Audit-log PUBLISH
   *   8. Return PostWithTargets view
   */
  async publish(
    userId: string,
    postCardId: string,
    rawInput: unknown,
    audit: AuditContext = {},
  ): Promise<PublishResultView> {
    // 1. Validate input
    const parsed = PUBLISH_SCHEMA.safeParse(rawInput);
    if (!parsed.success) {
      throw new ServiceError('VALIDATION_ERROR', 'Invalid publish input', undefined, parsed.error);
    }
    const input = parsed.data as PublishInput;

    // 2. Verify postCard ownership
    const postCard = await this._postcards.findById(userId, postCardId);
    if (!postCard) {
      throw new ServiceError('NOT_FOUND', `PostCard ${postCardId} not found`);
    }

    // 3. Idempotency check
    if (input.requestId) {
      const existing = await this._posts.findByRequestId(userId, input.requestId);
      if (existing) {
        // Return existing Post + targets (idempotent — no re-publish)
        const existingWithTargets = await this._posts.findById(userId, existing.id);
        if (existingWithTargets) {
          return this.toView(existingWithTargets);
        }
      }
    }

    // 4. Validate connections + check X quota
    const invalidPlatforms: Platform[] = [];
    const validTargets: Array<{ platform: Platform; connectionId: string; options?: Record<string, unknown> }> = [];
    const skippedTargets: Array<{ platform: Platform; reason: string }> = [];

    for (const p of input.platforms) {
      const platform = p.platform;
      const options = p.options as Record<string, unknown> | undefined;

      // Check connection
      const conn = await this._connections.findByPlatform(userId, platform);
      if (!conn || conn.status !== 'ACTIVE') {
        invalidPlatforms.push(platform);
        continue;
      }

      // Check X quota (FR-018)
      if (platform === 'TWITTER') {
        const exceeded = await this._quota.wouldExceedBudget(platform);
        if (exceeded) {
          skippedTargets.push({
            platform,
            reason: 'X quota for this month is used — other platforms unaffected.',
          });
          continue;
        }
      }

      validTargets.push({ platform, connectionId: conn.id, options });
    }

    // 400 if any platform lacks an ACTIVE connection
    if (invalidPlatforms.length > 0) {
      throw new ServiceError(
        'VALIDATION_ERROR',
        `No active connection for: ${invalidPlatforms.join(', ')}. Connect these platforms first.`,
      );
    }

    // Must have at least one valid OR skipped target (else nothing to do)
    if (validTargets.length === 0 && skippedTargets.length === 0) {
      throw new ServiceError('VALIDATION_ERROR', 'No platforms selected');
    }

    // 5. Create Post + Targets in transaction
    const allTargets = [
      ...validTargets.map((t) => ({ platform: t.platform, connectionId: t.connectionId, options: t.options })),
      ...skippedTargets.map((t) => ({ platform: t.platform, connectionId: null, options: { skipReason: t.reason } })),
    ];

    const { post, targets } = await this._posts.createWithTargets(
      userId,
      postCardId,
      input.requestId,
      allTargets,
    );

    // Mark skipped targets immediately (they don't go through the queue)
    for (const target of targets) {
      const skipped = skippedTargets.find((s) => s.platform === target.platform);
      if (skipped) {
        await this._targets.updateStatus(target.id, 'SKIPPED', {
          error: skipped.reason,
          errorClass: 'QUOTA',
        });
        // Increment quota counter for SKIPPED too (counts as "attempted")
        // Actually NO — we only count successful publishes. Skip this.
      }
    }

    // 6. Enqueue BullMQ jobs for non-skipped targets
    for (const target of targets) {
      const skipped = skippedTargets.find((s) => s.platform === target.platform);
      if (skipped) continue;
      await this._publishQueue.add(
        'publish',
        {
          postTargetId: target.id,
          postId: post.id,
          userId,
          postCardId,
          platform: target.platform,
          connectionId: target.connectionId,
        },
        {
          jobId: target.id, // dedup by target id
          attempts: 3, // BullMQ-level retries (worker also handles via PublishError class)
          backoff: { type: 'exponential', delay: 10_000 }, // 10s, 20s, 40s
        },
      );
    }

    // 7. Audit log
    await this._audit.log({
      userId,
      action: 'PUBLISH',
      ip: audit.ip,
      userAgent: audit.userAgent,
      metadata: {
        postCardId,
        postId: post.id,
        platforms: input.platforms.map((p) => p.platform),
        requestId: input.requestId,
      },
    });

    // 8. Return view (with updated target statuses)
    const finalPost = await this._posts.findById(userId, post.id);
    if (!finalPost) {
      throw new ServiceError('INTERNAL', 'Failed to load post after publish');
    }
    return this.toView(finalPost);
  }

  /**
   * Retry a FAILED target. Re-enqueues the BullMQ job (with reset attempts).
   *
   * Per FR-013: "Retry a FAILED target only: re-enqueue that single target;
   * attempts ≤3 total; auth-class errors → hint 'reconnect platform'."
   */
  async retry(
    userId: string,
    postId: string,
    targetId: string,
    audit: AuditContext = {},
  ): Promise<{ id: string; status: string }> {
    const post = await this._posts.findById(userId, postId);
    if (!post) {
      throw new ServiceError('NOT_FOUND', `Post ${postId} not found`);
    }
    const target = post.targets.find((t) => t.id === targetId);
    if (!target) {
      throw new ServiceError('NOT_FOUND', `PostTarget ${targetId} not found`);
    }
    if (target.status !== 'FAILED') {
      throw new ServiceError(
        'CONFLICT',
        `Cannot retry target in status ${target.status} (must be FAILED)`,
      );
    }
    if (target.attempts >= 3) {
      throw new ServiceError(
        'CONFLICT',
        `Cannot retry — max attempts (3) reached. Reconnect the platform.`,
      );
    }

    // Reset target to QUEUED
    await this._targets.updateStatus(targetId, 'QUEUED', {
      error: null,
      errorClass: null,
    });

    // Re-enqueue
    await this._publishQueue.add(
      'publish',
      {
        postTargetId: targetId,
        postId: post.id,
        userId,
        postCardId: post.postCardId,
        platform: target.platform,
        connectionId: target.connectionId,
      },
      {
        jobId: `retry-${targetId}-${Date.now()}`, // unique job id for retry
        attempts: 3 - target.attempts, // remaining attempts only
        backoff: { type: 'exponential', delay: 10_000 },
      },
    );

    await this._audit.log({
      userId,
      action: 'RETRY',
      platform: target.platform,
      ip: audit.ip,
      userAgent: audit.userAgent,
      metadata: { postId, targetId },
    });

    return { id: targetId, status: 'QUEUED' };
  }

  /**
   * List user's posts with pagination + filters.
   * Per docs/05-API-SPEC.md:
   *   GET /api/posts?page=1&platform=REDDIT&status=SUCCESS
   */
  async list(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
    filters: { platform?: Platform; status?: string } = {},
  ) {
    const result = await this._posts.listByUser(userId, page, pageSize, filters);
    return {
      items: result.items.map((p) => this.toView(p)),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  /**
   * Get a single Post with all its targets. Used by the UI for status polling.
   * Per docs/05-API-SPEC.md: GET /api/posts/:id → Post + targets (poll this).
   */
  async get(userId: string, postId: string): Promise<PublishResultView> {
    const post = await this._posts.findById(userId, postId);
    if (!post) {
      throw new ServiceError('NOT_FOUND', `Post ${postId} not found`);
    }
    return this.toView(post);
  }

  /**
   * Convert Prisma Post → API view (no internal fields exposed).
   */
  private toView(post: Post & { targets: PostTarget[] }): PublishResultView {
    return {
      post: {
        id: post.id,
        createdAt: post.createdAt.toISOString(),
        targets: post.targets.map((t) => ({
          id: t.id,
          platform: t.platform,
          status: t.status,
          error: t.error,
          platformPostUrl: t.platformPostUrl,
          attempts: t.attempts,
          publishedAt: t.publishedAt?.toISOString() ?? null,
        })),
      },
    };
  }
}
