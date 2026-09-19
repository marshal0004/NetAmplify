// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/validation/schemas.ts
// NetAmplify — Zod validation schemas (single source of truth, shared by
// client forms and server routes per docs/08-CODING-STANDARDS.md).
//
// All schemas here are pure (no DB, no network, no Date.now/random) and
// unit-tested.

import { z } from 'zod';

// ============================================================================
// Auth
// ============================================================================

export const EMAIL_SCHEMA = z
  .string()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .transform((s) => s.trim().toLowerCase())
  .pipe(
    z.string().min(1, 'Email is required').email('Invalid email format')
  );

export const PASSWORD_SCHEMA = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long (max 128 chars)')
  .regex(
    /[a-z]/,
    'Password must contain at least one lowercase letter'
  )
  .regex(
    /[A-Z]/,
    'Password must contain at least one uppercase letter'
  )
  .regex(/[0-9]/, 'Password must contain at least one digit');

export const NAME_SCHEMA = z
  .string()
  .min(1, 'Name is required')
  .max(100, 'Name is too long (max 100 chars)')
  .transform((s) => s.trim());

export const SIGNUP_SCHEMA = z.object({
  email: EMAIL_SCHEMA,
  password: PASSWORD_SCHEMA,
  name: NAME_SCHEMA,
});

export const LOGIN_SCHEMA = z.object({
  email: EMAIL_SCHEMA,
  password: z.string().min(1, 'Password is required').max(128),
});

export const RESET_REQUEST_SCHEMA = z.object({
  email: EMAIL_SCHEMA,
});

export const RESET_CONFIRM_SCHEMA = z.object({
  token: z.string().min(1, 'Token is required').max(256, 'Token is invalid'),
  newPassword: PASSWORD_SCHEMA,
});

// ============================================================================
// Profile (FR-002)
// ============================================================================

const URL_SCHEMA = z
  .string()
  .max(500, 'URL is too long')
  .url('Invalid URL format')
  .or(z.literal(''))
  .optional();

export const PROFILE_UPDATE_SCHEMA = z.object({
  name: NAME_SCHEMA.optional(),
  headline: z
    .string()
    .max(140, 'Headline must be ≤140 chars')
    .optional(),
  college: z.string().max(200, 'College name too long').optional(),
  graduationYear: z
    .number()
    .int('Graduation year must be an integer')
    .min(2015, 'Graduation year must be ≥2015')
    .max(2035, 'Graduation year must be ≤2035')
    .optional(),
  githubUrl: URL_SCHEMA,
  portfolioUrl: URL_SCHEMA,
  bio: z.string().max(500, 'Bio must be ≤500 chars').optional(),
});

// ============================================================================
// PostCard (FR-003)
// ============================================================================

export const POSTCARD_CREATE_SCHEMA = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(120, 'Title must be ≤120 chars'),
  summary: z
    .string()
    .min(1, 'Summary is required')
    .max(200, 'Summary must be ≤200 chars'),
  description: z
    .string()
    .min(1, 'Description is required')
    .max(5000, 'Description must be ≤5000 chars'),
  techStack: z
    .array(z.string().min(1).max(50))
    .min(1, 'At least one tech tag is required')
    .max(10, 'Maximum 10 tech tags allowed'),
  repoUrl: URL_SCHEMA,
  liveUrl: URL_SCHEMA,
  imageUrl: URL_SCHEMA,
});

export const POSTCARD_UPDATE_SCHEMA = POSTCARD_CREATE_SCHEMA.partial();

// ============================================================================
// Platform identifiers (for Connect Checklist + Publish)
// ============================================================================

export const PLATFORM_SCHEMA = z.enum([
  'REDDIT',
  'DISCORD',
  'DEVTO',
  'TELEGRAM',
  'BLUESKY',
  'HASHNODE',
  'TWITTER',
  'LINKEDIN',
  'MASTODON',
  'WORDPRESS',
  'TWITTER_COOKIE',
  'REDDIT_COOKIE',
]);

export const PUBLISH_SCHEMA = z.object({
  platforms: z
    .array(
      z.object({
        platform: PLATFORM_SCHEMA,
        options: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .min(1, 'Select at least one platform')
    .max(8, 'Maximum 8 platforms per publish'),
  requestId: z
    .string()
    .min(1, 'requestId is required for idempotency')
    .max(128, 'requestId too long')
    .optional(),
});

// ============================================================================
// Connections (per-platform credential shapes — Connect Checklist)
// ============================================================================

export const CONNECT_DEVTO_SCHEMA = z.object({
  apiKey: z.string().min(1, 'API key is required').max(256),
});

export const CONNECT_HASHNODE_SCHEMA = z.object({
  pat: z.string().min(1, 'Personal Access Token is required').max(256),
});

export const CONNECT_DISCORD_SCHEMA = z.object({
  webhookUrl: z
    .string()
    .min(1, 'Webhook URL is required')
    .max(500, 'Webhook URL too long')
    .url('Invalid URL format')
    .regex(
      /^https:\/\/(?:discord\.com|ptb\.discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/,
      'Not a valid Discord webhook URL'
    ),
});

export const CONNECT_TELEGRAM_SCHEMA = z.object({
  botToken: z
    .string()
    .min(1, 'Bot token is required')
    .max(256)
    .regex(/^\d+:[\w-]+$/, 'Not a valid Telegram bot token'),
  channel: z
    .string()
    .min(1, 'Channel is required')
    .max(200)
    .regex(/^@?[\w\d_]+$/, 'Channel must be a @username or channel id'),
});

export const CONNECT_BLUESKY_SCHEMA = z.object({
  handle: z
    .string()
    .min(1, 'Handle is required')
    .max(200)
    .regex(/^[\w.\-]+(\.bsky\.social)?$/, 'Invalid Bluesky handle'),
  appPassword: z
    .string()
    .min(1, 'App password is required')
    .max(256)
    .regex(
      /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/,
      'App password should be in xxxx-xxxx-xxxx-xxxx format (lowercase alphanumeric)'
    ),
});

// ============================================================================
// Cookie-based platforms (X + Reddit — Option A)
// ============================================================================
//
// Per docs/01-PRD.md §6: cookie bypass for paywalled platforms. The user
// pastes their session cookies (extracted via a browser extension like
// Cookie-Editor) instead of using OAuth.

export const CONNECT_TWITTER_COOKIE_SCHEMA = z.object({
  authToken: z
    .string()
    .min(40, 'auth_token must be a 40-char hex string')
    .max(40, 'auth_token must be a 40-char hex string')
    .regex(/^[a-f0-9]{40}$/i, 'auth_token must be 40 hex chars (0-9, a-f)'),
  ct0: z
    .string()
    .min(32, 'ct0 must be a 32-char hex string')
    .max(32, 'ct0 must be a 32-char hex string')
    .regex(/^[a-f0-9]{32}$/i, 'ct0 must be 32 hex chars (0-9, a-f)'),
});

export const CONNECT_REDDIT_COOKIE_SCHEMA = z.object({
  token: z
    .string()
    .min(100, 'token (JWT) looks too short — copy the full cookie value')
    .max(5000, 'token is too long (max 5000 chars)')
    // JWT format: 3 dot-separated base64url-encoded parts
    .regex(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
      'token must be a JWT with 3 dot-separated parts (header.payload.signature)'
    ),
  csrfToken: z
    .string()
    .min(32, 'csrf_token must be 32 chars')
    .max(32, 'csrf_token must be 32 chars')
    .regex(/^[a-f0-9]{32}$/i, 'csrf_token must be 32 hex chars (0-9, a-f)'),
});

// ============================================================================
// New OAuth / API-key platforms (Mastodon + WordPress)
// ============================================================================

export const CONNECT_MASTODON_SCHEMA = z.object({
  instance: z
    .string()
    .min(3, 'Instance URL is required (e.g., "mastodon.social")')
    .max(200, 'Instance URL is too long')
    // Allow with-or-without protocol; the adapter normalizes
    .regex(
      /^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?$/i,
      'Instance must be a domain like "mastodon.social" or "https://mastodon.social"'
    ),
  accessToken: z
    .string()
    .min(20, 'Access token looks too short — copy the full token')
    .max(500, 'Access token is too long')
    // Mastodon access tokens are typically alphanumeric + dashes/underscores
    .regex(/^[A-Za-z0-9_-]+$/, 'Access token contains invalid characters'),
});

export const CONNECT_WORDPRESS_SCHEMA = z.object({
  siteUrl: z
    .string()
    .min(7, 'Site URL is required (e.g., "https://blog.example.com")')
    .max(200, 'Site URL is too long')
    .regex(
      /^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?$/i,
      'Site URL must be a domain like "blog.example.com" or "https://blog.example.com"'
    ),
  username: z
    .string()
    .min(1, 'WordPress username is required')
    .max(100, 'WordPress username is too long')
    .regex(/^[\w.@-]+$/, 'Username contains invalid characters'),
  appPassword: z
    .string()
    .min(16, 'App password looks too short — copy the full password')
    .max(200, 'App password is too long')
    // WordPress app passwords are 24 chars (with optional spaces) — alphanumeric
    .regex(/^[A-Za-z0-9 ]+$/, 'App password must be alphanumeric (spaces allowed)'),
});

// ============================================================================
// Type exports (for use in controllers + services)
// ============================================================================

export type SignupInput = z.infer<typeof SIGNUP_SCHEMA>;
export type LoginInput = z.infer<typeof LOGIN_SCHEMA>;
export type ResetRequestInput = z.infer<typeof RESET_REQUEST_SCHEMA>;
export type ResetConfirmInput = z.infer<typeof RESET_CONFIRM_SCHEMA>;
export type ProfileUpdateInput = z.infer<typeof PROFILE_UPDATE_SCHEMA>;
export type PostCardCreateInput = z.infer<typeof POSTCARD_CREATE_SCHEMA>;
export type PostCardUpdateInput = z.infer<typeof POSTCARD_UPDATE_SCHEMA>;
export type PublishInput = z.infer<typeof PUBLISH_SCHEMA>;
export type ConnectDevtoInput = z.infer<typeof CONNECT_DEVTO_SCHEMA>;
export type ConnectHashnodeInput = z.infer<typeof CONNECT_HASHNODE_SCHEMA>;
export type ConnectDiscordInput = z.infer<typeof CONNECT_DISCORD_SCHEMA>;
export type ConnectTelegramInput = z.infer<typeof CONNECT_TELEGRAM_SCHEMA>;
export type ConnectBlueskyInput = z.infer<typeof CONNECT_BLUESKY_SCHEMA>;
export type ConnectTwitterCookieInput = z.infer<typeof CONNECT_TWITTER_COOKIE_SCHEMA>;
export type ConnectRedditCookieInput = z.infer<typeof CONNECT_REDDIT_COOKIE_SCHEMA>;
export type ConnectMastodonInput = z.infer<typeof CONNECT_MASTODON_SCHEMA>;
export type ConnectWordPressInput = z.infer<typeof CONNECT_WORDPRESS_SCHEMA>;
