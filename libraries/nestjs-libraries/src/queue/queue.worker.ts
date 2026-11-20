// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/queue/queue.worker.ts
// NetAmplify — Publish worker (BullMQ processor).
//
// Picks up 'publish' jobs, runs the full publish flow:
//   1. Load PostTarget
//   2. Load + decrypt Connection credentials (via TokenVault)
//   3. Format PostCard via Format Engine (pure)
//   4. Call adapter.publish()
//   5. On success: mark target SUCCESS + permalink; touch connection.lastUsedAt
//   6. On AUTH failure: mark Connection REVOKED + target FAILED with reconnect hint
//   7. On RATE failure: BullMQ auto-retries with exponential backoff
//   8. On VALIDATION failure: mark target FAILED with platform message
//   9. On NETWORK failure: BullMQ auto-retries
//   10. On QUOTA failure: mark target SKIPPED with explanation
//
// Per docs/03-ARCHITECTURE.md "Failure Classification":
//   AUTH (401/403/invalid token) → Connection REVOKED, target FAILED, reconnect hint
//   RATE (429/limits) → backoff retry (up to 3), then FAILED with "try later"
//   VALIDATION (platform rejected content) → FAILED, surface platform message
//   NETWORK/5xx → backoff retry
//   QUOTA (X budget) → SKIPPED with explanation

import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { PrismaService } from '../database/prisma/prisma.service';
import { PostTargetRepository } from '../database/prisma/posts/posts.repository';
import { PostCardRepository } from '../database/prisma/postcards/postcards.repository';
import { ConnectionRepository } from '../database/prisma/connections/connections.repository';
import { QuotaService } from '../database/prisma/quota/quota.service';
import { AuditLogService } from '../database/prisma/audit/audit.service';
import { TokenVault } from '../services/vault/token-vault';
import { AdapterRegistry } from '../platforms/registry';
import { PublishError, type AdapterCredentials } from '../platforms/adapter.interface';
import { formatForPlatform, type FormatEnginePostCard } from '../format-engine';
import { ioRedis } from '../redis/redis.service';
import type { Platform } from '@prisma/client';

interface PublishJobData {
  postTargetId: string;
  postId: string;
  userId: string;
  postCardId: string;
  platform: Platform;
  connectionId: string | null;
}

@Injectable()
export class PublishWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublishWorker.name);
  private worker: Worker | null = null;

  constructor(
    @Inject(PrismaService) private readonly _prisma: PrismaService,
    @Inject(PostTargetRepository) private readonly _targets: PostTargetRepository,
    @Inject(PostCardRepository) private readonly _postcards: PostCardRepository,
    @Inject(ConnectionRepository) private readonly _connections: ConnectionRepository,
    @Inject(QuotaService) private readonly _quota: QuotaService,
    @Inject(AuditLogService) private readonly _audit: AuditLogService,
    @Inject(TokenVault) private readonly _vault: TokenVault,
    @Inject(AdapterRegistry) private readonly _adapters: AdapterRegistry,
  ) {}

  onModuleInit() {
    // Don't auto-start the worker in test mode (avoids Redis dependency)
    if (process.env.DISABLE_WORKERS === 'true') {
      this.logger.warn('Workers disabled via DISABLE_WORKERS=true');
      return;
    }
    this.startWorker();
  }

  onModuleDestroy() {
    void this.worker?.close();
  }

  private startWorker() {
    this.worker = new Worker(
      'publish',
      async (job: Job<PublishJobData>) => this.processJob(job),
      {
        connection: ioRedis as never,
        concurrency: 5, // 5 concurrent publishes across all platforms
      },
    );
    this.worker.on('completed', (job) => {
      // processJob returns { success: true } only when the publish actually
      // succeeded. For AUTH/VALIDATION/QUOTA failures, it catches the error,
      // marks the target FAILED, and returns { success: false } — the job
      // "completes" (BullMQ doesn't see a throw) but the publish failed.
      // Log accordingly so the backend log isn't misleading ("completed" on a
      // failed publish confused users into thinking the post went through).
      const rv = job.returnvalue as { success?: boolean; skipped?: boolean } | undefined;
      if (rv?.success) {
        this.logger.log(`Job ${job.id} completed — publish SUCCEEDED for target ${job.data.postTargetId}`);
      } else if (rv?.skipped) {
        this.logger.log(`Job ${job.id} finished — target ${job.data.postTargetId} skipped (${rv.success ? 'already terminal' : 'see PublishFailed log above'})`);
      } else {
        this.logger.warn(`Job ${job.id} finished — publish FAILED for target ${job.data.postTargetId} (see PublishFailed log above for the error)`);
      }
    });
    this.worker.on('failed', (job, err) => {
      const targetId = job?.data.postTargetId;
      const platform = job?.data.platform;
      const postCardId = job?.data.postCardId;
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? 1;
      const isFinal = attemptsMade >= maxAttempts;
      this.logger.error(
        `Job ${job?.id} failed for target ${targetId} postCard ${postCardId} ` +
          `platform ${platform} attempt ${attemptsMade}/${maxAttempts}` +
          `${isFinal ? ' (FINAL)' : ' (will retry)'}: ${err.message}`,
      );
      // RC-5: when BullMQ exhausts all retries on a RATE/NETWORK error,
      // processJob's catch rethrows (to trigger retry) but never marks the
      // target FAILED — so PostTarget.status stays PUBLISHING forever (the
      // dangling "stuck publishing" state the user saw for Instagram + Bluesky).
      // Recover it here on the FINAL failed attempt. Fire-and-forget (void)
      // because the failed-event handler must stay synchronous for BullMQ.
      if (isFinal && targetId) {
        void this._targets
          .updateStatus(targetId, 'FAILED', {
            error: `${platform ?? 'unknown'} publish failed after ${attemptsMade} attempts: ${err.message}`,
            errorClass: 'NETWORK',
          })
          .catch((markErr) =>
            this.logger.error(
              `Failed to mark target ${targetId} as FAILED after final retry: ${markErr}`,
            ),
          );
      }
    });
    this.logger.log('Publish worker started (concurrency=5)');
  }

  /**
   * Process one publish job. Throws on retryable errors (BullMQ auto-retries);
   * marks FAILED on permanent errors.
   */
  async processJob(job: Job<PublishJobData>): Promise<{ success: boolean; skipped?: boolean }> {
    const { postTargetId, postId, userId, postCardId, platform, connectionId } = job.data;

    // 1. Load target (skip if already terminal)
    const target = await this._targets.findById(postId, postTargetId);
    if (!target) {
      this.logger.warn(`Target ${postTargetId} not found — skipping job`);
      return { success: false, skipped: true };
    }
    if (target.status === 'SUCCESS' || target.status === 'SKIPPED') {
      this.logger.log(`Target ${postTargetId} already ${target.status} — skipping`);
      return { success: true, skipped: true };
    }

    // 2. Mark PUBLISHING
    await this._targets.markPublishing(postTargetId);

    // 3. Load PostCard (403 if not owner — shouldn't happen since publish validated)
    const postCard = await this._postcards.findById(userId, postCardId);
    if (!postCard) {
      await this._targets.updateStatus(postTargetId, 'FAILED', {
        error: 'PostCard no longer exists',
        errorClass: 'VALIDATION',
      });
      return { success: false };
    }

    // 4. Load + decrypt Connection
    if (!connectionId) {
      await this._targets.updateStatus(postTargetId, 'SKIPPED', {
        error: 'Connection removed before execution',
        errorClass: 'AUTH',
      });
      return { success: false, skipped: true };
    }
    const conn = await this._connections.findByPlatform(userId, platform);
    if (!conn || conn.status !== 'ACTIVE') {
      await this._targets.updateStatus(postTargetId, 'FAILED', {
        error: `Connection is ${conn?.status ?? 'missing'} — reconnect ${platform}`,
        errorClass: 'AUTH',
      });
      return { success: false };
    }
    const creds = this._vault.decrypt(conn.credentialsCipher) as Record<string, unknown>;

    // 5. Format via Format Engine
    const formatInput: FormatEnginePostCard = {
      title: postCard.title,
      summary: postCard.summary,
      description: postCard.description,
      techStack: postCard.techStack,
      repoUrl: postCard.repoUrl ?? undefined,
      liveUrl: postCard.liveUrl ?? undefined,
      imageUrl: postCard.imageUrl ?? undefined,
      // Type-safe access: the Prisma PostCard type may not include mediaUrls
      // until the user runs `prisma-generate` after the schema change.
      // The cast lets this compile regardless; at runtime, the field is
      // undefined until the DB column exists (after `prisma-db-push`).
      mediaUrls: (postCard as { mediaUrls?: string[] }).mediaUrls ?? undefined,
    };
    const formatted = formatForPlatform(platform, formatInput, null, (target.options ?? {}) as Record<string, unknown>);

    // 6. Call adapter.publish()
    const adapter = this._adapters.get(platform);
    try {
      // 5.5. Proactively refresh expiring credentials BEFORE publish.
      //
      // Adapters that implement refreshCredentials() (Bluesky, YouTube,
      // Instagram) decode their token's expiry + return a refreshed blob when
      // it's near expiry. The worker persists the new blob so the refresh
      // sticks — CRITICAL for Bluesky, which rotates the refresh token on every
      // refreshSession (without persisting, the next job would reuse the
      // now-invalidated old refreshJwt + fail). When the token is still valid
      // the adapter returns the SAME object reference + we skip the re-encrypt
      // + persist round-trip (cheap to call on every job).
      //
      // A refresh AUTH error (refresh token invalid/revoked) is caught by this
      // same try/catch + classified like a publish AUTH failure → REVOKED +
      // FAILED + reconnect hint, no retry. RATE/NETWORK refresh errors rethrow
      // to BullMQ for retry.
      let publishCreds = creds;
      if (adapter.refreshCredentials) {
        const refreshed = await adapter.refreshCredentials(creds);
        if (refreshed !== creds) {
          const newCipher = this._vault.encrypt(refreshed);
          await this._connections.updateCredentials(userId, platform, newCipher);
          publishCreds = refreshed;
          this.logger.log(
            `Refreshed ${platform} credentials for target ${postTargetId} before publish`,
          );
        }
      }

      const result = await adapter.publish(publishCreds, {
        title: formatted.title,
        body: formatted.body,
        url: formatted.url,
        hashtags: formatted.hashtags,
        options: formatted.options,
      });

      // 7. SUCCESS
      await this._targets.markSuccess(postTargetId, result.url, result.id);
      await this._connections.touchUsed(userId, platform);
      if (platform === 'TWITTER') {
        await this._quota.increment(platform);
      }
      await this._audit.log({
        userId,
        action: 'PUBLISH',
        platform,
        metadata: { postTargetId, platformPostUrl: result.url },
      });
      return { success: true };
    } catch (e) {
      // 8. Log EVERY publish failure with full context — postcardId, platform,
      // targetId, attempt number, errorClass, message. The original worker only
      // surfaced RATE/NETWORK failures (via the BullMQ `failed` event) and
      // silently returned for AUTH/VALIDATION/QUOTA — which is why the backend
      // logs showed "no error" for YouTube/Hashnode failures (they were
      // AUTH/VALIDATION class, written only to the PostTarget.error DB column,
      // never to stdout). This single log line is the highest-leverage fix for
      // "I don't see so much error in backend".
      const errorClass = e instanceof PublishError ? e.errorClass : 'UNKNOWN';
      const errMsg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `PublishFailed target=${postTargetId} postCard=${postCardId} platform=${platform} ` +
          `attempt=${(job.attemptsMade ?? 0) + 1}/${job.opts?.attempts ?? 1} ` +
          `errorClass=${errorClass}: ${errMsg}`,
      );
      // Classify error per docs/03-ARCHITECTURE.md
      if (e instanceof PublishError) {
        switch (e.errorClass) {
          case 'AUTH':
            await this._connections.markRevoked(userId, platform);
            await this._targets.updateStatus(postTargetId, 'FAILED', {
              error: `${platform} connection revoked: ${e.message} — reconnect this platform`,
              errorClass: 'AUTH',
            });
            await this._audit.log({
              userId,
              action: 'TOKEN_FAIL',
              platform,
              metadata: { postTargetId, message: e.message },
            });
            return { success: false }; // permanent — don't retry
          case 'VALIDATION':
            await this._targets.updateStatus(postTargetId, 'FAILED', {
              error: `${platform} rejected: ${e.message}`,
              errorClass: 'VALIDATION',
            });
            return { success: false }; // permanent
          case 'QUOTA':
            await this._targets.updateStatus(postTargetId, 'SKIPPED', {
              error: `${platform} quota exhausted: ${e.message}`,
              errorClass: 'QUOTA',
            });
            return { success: false, skipped: true }; // skipped (not retried)
          case 'RATE':
          case 'NETWORK':
            // BullMQ auto-retries via `attempts: 3` config; throw to trigger retry
            throw e;
          default:
            await this._targets.updateStatus(postTargetId, 'FAILED', {
              error: `${platform} publish failed: ${e.message}`,
              errorClass: e.errorClass,
            });
            return { success: false };
        }
      }
      // Unknown error — log + rethrow for BullMQ retry
      this.logger.error(`Unknown publish error for ${platform}: ${e}`);
      throw e;
    }
  }
}
