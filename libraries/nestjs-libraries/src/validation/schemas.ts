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
