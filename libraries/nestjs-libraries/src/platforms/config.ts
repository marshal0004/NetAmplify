// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/config.ts
// NetAmplify — per-platform configuration.
//
// Single source of truth for:
//   - char limits (per docs/03-ARCHITECTURE.md "Platform Config" table)
//   - rate limits
//   - X monthly post budget (FR-018)
//   - retry policy (backoff schedule per docs/03-ARCHITECTURE.md)
//
// Hardcoded caps here are NOT magic numbers in logic — they're config that
// is loaded once and read by adapters + workers. This satisfies
// CLAUDE.md Rule 8: "Hardcoded caps from docs/03-ARCHITECTURE.md platform
// table ... are config, not magic numbers in logic."

import type { Platform } from '@prisma/client';

export interface PlatformConfig {
  platform: Platform;
  /** Display name for the Connect Checklist UI */
  name: string;
  /** Character limit for this platform's primary post field (title or body) */
  charLimit: number;
  /** Per-user rate limit (requests per minute). null for per-user OAuth buckets (effectively unbounded) */
  rateLimitPerMinute: number | null;
  /** Whether the platform supports markdown in the post body */
  markdownSupported: boolean;
  /** Whether the platform accepts image attachments in posts */
  imageSupported: boolean;
  /** Max image count per post (0 = no images) */
  maxImages: number;
}

/**
 * Per-platform config — used by the Format Engine (Phase 5) + workers
 * (Phase 5) for char-limit enforcement and publish-time validation.
 */
export const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  REDDIT: {
    platform: 'REDDIT',
    name: 'Reddit',
    charLimit: 300, // title limit; body is 40000
    rateLimitPerMinute: 60, // per-user OAuth token — generous
    markdownSupported: true,
    imageSupported: false,
    maxImages: 0,
  },
  DISCORD: {
    platform: 'DISCORD',
    name: 'Discord',
    charLimit: 4096, // embed description limit
    rateLimitPerMinute: 30, // per-webhook
    markdownSupported: true,
    imageSupported: true,
    maxImages: 1,
  },
  DEVTO: {
    platform: 'DEVTO',
    name: 'Dev.to',
    charLimit: 70000, // soft limit per article
    rateLimitPerMinute: 10, // 10 articles/hour soft
    markdownSupported: true,
    imageSupported: true,
    maxImages: 1,
  },
  TELEGRAM: {
    platform: 'TELEGRAM',
    name: 'Telegram',
    charLimit: 4096, // message body limit
    rateLimitPerMinute: 30, // 30 msg/sec global per bot — we use 30/min for safety
    markdownSupported: false, // supports HTML, not markdown
    imageSupported: true,
    maxImages: 1,
  },
  BLUESKY: {
    platform: 'BLUESKY',
    name: 'Bluesky',
    charLimit: 300, // grapheme-correct per FR-011
    rateLimitPerMinute: null, // 5000 posts/day per account — effectively unbounded for MVP
    markdownSupported: false, // supports facets (rich text), not markdown
    imageSupported: true,
    maxImages: 4,
  },
  HASHNODE: {
    platform: 'HASHNODE',
    name: 'Hashnode',
    charLimit: 100000, // generous
    rateLimitPerMinute: null,
    markdownSupported: true,
    imageSupported: true,
    maxImages: 1,
  },
  TWITTER: {
    platform: 'TWITTER',
    name: 'X (Twitter)',
    charLimit: 280,
    rateLimitPerMinute: 50, // 50 posts/24h per user (3-legged OAuth)
    markdownSupported: false,
    imageSupported: true,
    maxImages: 4,
  },
  LINKEDIN: {
    platform: 'LINKEDIN',
    name: 'LinkedIn',
    charLimit: 3000, // plain text, no markdown
    rateLimitPerMinute: null, // limited access mode in MVP
    markdownSupported: false,
    imageSupported: false,
    maxImages: 0,
  },
};

/**
 * BullMQ retry policy — exponential backoff for transient errors.
 * Per docs/02-SRS.md NFR-003: 3 attempts, exponential backoff (10s/60s/300s)
 * for transient errors only.
 */
export const RETRY_BACKOFF_MS = [10_000, 60_000, 300_000] as const;

/**
 * Max retry attempts per PostTarget. After this, target is FAILED.
 */
export const MAX_RETRY_ATTEMPTS = 3;

/**
 * X monthly post budget (per docs/02-SRS.md FR-018).
 * Default 450 — under X free tier's 1500 cap, leaves headroom for manual posts.
 * Override via X_MONTHLY_POST_BUDGET env var.
 */
export const X_MONTHLY_POST_BUDGET_DEFAULT = 450;

/**
 * Get the X monthly post budget (env-overrideable for testing).
 */
export function getXMonthlyPostBudget(): number {
  const env = process.env.X_MONTHLY_POST_BUDGET;
  if (env === undefined || env.trim() === '') {
    return X_MONTHLY_POST_BUDGET_DEFAULT;
  }
  const n = Number.parseInt(env, 10);
  if (Number.isNaN(n) || n < 0) {
    return X_MONTHLY_POST_BUDGET_DEFAULT;
  }
  return n;
}

/**
 * Current year-month string ("2026-09") for QuotaUsage tracking.
 */
export function currentYearMonth(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
