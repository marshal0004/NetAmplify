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
  /** Max video count per post (0 = no videos). */
  maxVideos: number;
  /** Whether images + videos can be mixed in a single post. */
  mixedMedia: boolean;
}

/**
 * Per-platform config — used by the Format Engine (Phase 5) + workers
 * (Phase 5) for char-limit enforcement and publish-time validation.
 */
export const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  DISCORD: {
    platform: 'DISCORD',
    name: 'Discord',
    charLimit: 4096, // embed description limit
    rateLimitPerMinute: 30, // per-webhook
    markdownSupported: true,
    imageSupported: true,
    maxImages: 1,
    maxVideos: 10, 
    mixedMedia: true, // images + videos allowed
  },
  DEVTO: {
    platform: 'DEVTO',
    name: 'Dev.to',
    charLimit: 70000, // soft limit per article
    rateLimitPerMinute: 10, // 10 articles/hour soft
    markdownSupported: true,
    imageSupported: true,
    maxImages: 1,
    maxVideos: 0, // no videos
    mixedMedia: false, 
  },
  TELEGRAM: {
    platform: 'TELEGRAM',
    name: 'Telegram',
    charLimit: 4096, // message body limit
    rateLimitPerMinute: 30, // 30 msg/sec global per bot — we use 30/min for safety
    markdownSupported: false, // supports HTML, not markdown
    imageSupported: true,
    maxImages: 1,
    maxVideos: 1, 
    mixedMedia: false, 
  },
  BLUESKY: {
    platform: 'BLUESKY',
    name: 'Bluesky',
    charLimit: 300, // grapheme-correct per FR-011
    rateLimitPerMinute: null, // 5000 posts/day per account — effectively unbounded for MVP
    markdownSupported: false, // supports facets (rich text), not markdown
    imageSupported: true,
    maxImages: 4,
    maxVideos: 1, 
    mixedMedia: false, 
  },
  TWITTER: {
    platform: 'TWITTER',
    name: 'X (Twitter)',
    charLimit: 280,
    rateLimitPerMinute: 50, // 50 posts/24h per user (3-legged OAuth)
    markdownSupported: false,
    imageSupported: true,
    maxImages: 4,
    maxVideos: 1, 
    mixedMedia: false, 
  },
  LINKEDIN: {
    platform: 'LINKEDIN',
    name: 'LinkedIn',
    charLimit: 3000, // plain text, no markdown
    rateLimitPerMinute: null, // limited access mode in MVP
    markdownSupported: false,
    imageSupported: false,
    maxImages: 0,
    maxVideos: 0, // no videos
    mixedMedia: false, 
  },
  MASTODON: {
    platform: 'MASTODON',
    name: 'Mastodon',
    charLimit: 500, // per https://docs.joinmastodon.org/user/posting/#text
    rateLimitPerMinute: 30, // 300 req/5min per token — we use 30/min for safety
    markdownSupported: true, // Mastodon renders a markdown subset
    imageSupported: true,
    maxImages: 4,
    maxVideos: 1, 
    mixedMedia: false, 
  },
  WORDPRESS: {
    platform: 'WORDPRESS',
    name: 'WordPress',
    charLimit: 200, // post_title column is VARCHAR(200)
    rateLimitPerMinute: null, // varies by site/plugin; no global cap
    markdownSupported: true, // pass-through; theme/plugin handles rendering
    imageSupported: true,
    maxImages: 1,
    maxVideos: 0, // no videos
    mixedMedia: false, 
  },
  TWITTER_COOKIE: {
    platform: 'TWITTER_COOKIE',
    name: 'X (Twitter)',
    charLimit: 280, // same as TWITTER
    rateLimitPerMinute: 30, // cookies use the per-user web rate limit (lower than API)
    markdownSupported: false,
    imageSupported: false, // MVP: text only via cookie method
    maxImages: 0,
    maxVideos: 0, // no videos
    mixedMedia: false, 
  },
  FACEBOOK: {
    platform: 'FACEBOOK',
    name: 'Facebook',
    charLimit: 63206, // FB post body limit
    rateLimitPerMinute: 200, // Graph API rate limit per app per user per hour
    markdownSupported: false, // plain text only via Graph API
    imageSupported: true,
    maxImages: 1, // single image per post via /photos
    maxVideos: 1, // single video per post via /videos
    mixedMedia: false,
  },
  INSTAGRAM: {
    platform: 'INSTAGRAM',
    name: 'Instagram',
    charLimit: 2200, // IG caption limit
    rateLimitPerMinute: 25, // 25 posts/24h per IG account via Graph API
    markdownSupported: false, // hashtags + mentions only
    imageSupported: true,
    maxImages: 1, // IG requires an image/video for every post
    maxVideos: 1, // IG supports 1 video (Reel) per post
    mixedMedia: false,
  },
  YOUTUBE: {
    platform: 'YOUTUBE',
    name: 'YouTube',
    // YouTube Data API v3 has no text-post endpoint — only video uploads.
    // title ≤100, description ≤5000. charLimit reflects the title (the primary
    // field the Format Engine truncates); the description budget is enforced
    // separately in the adapter.
    charLimit: 100,
    rateLimitPerMinute: null, // 10,000 quota units/day per project (upload = 1600 units)
    markdownSupported: false, // plain text description only
    imageSupported: false, // videos only — no image posts via Data API
    maxImages: 0,
    maxVideos: 1, 
    mixedMedia: false, 
  },
  THREADS: {
    platform: 'THREADS',
    name: 'Threads',
    charLimit: 500, // per Meta Threads docs
    rateLimitPerMinute: null, // 250 publishes / 24h per app (effectively unbounded for MVP)
    markdownSupported: false, // plain text + hashtags
    imageSupported: true, // IMAGE media_type supported (VIDEO requires async processing)
    maxImages: 1, // single image per thread (carousel is a future enhancement)
    maxVideos: 1, // single video per thread
    mixedMedia: false,
  },
  HASHNODE: {
    platform: 'HASHNODE',
    name: 'Hashnode (removed)',
    charLimit: 100000,
    rateLimitPerMinute: null,
    markdownSupported: true,
    imageSupported: true,
    maxImages: 1,
    maxVideos: 0,
    mixedMedia: false,
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
