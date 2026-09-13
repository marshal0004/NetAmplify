// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/adapter.interface.ts
// NetAmplify — Platform adapter contract.
//
// Every platform adapter (Reddit, X, LinkedIn, Discord, Dev.to, Telegram,
// Bluesky, Hashnode) implements this interface. Per docs/03-ARCHITECTURE.md
// "Adapter Contracts":
//
//   OAuth-capable adapter (Reddit, X, LinkedIn):
//     getAuthUrl(pkce, state), exchangeCode(code, pkce), getIdentity(creds),
//     publish(creds, formatted), refresh?(creds)
//
//   Simple connector adapter (Dev.to, Hashnode, Discord, Telegram, Bluesky):
//     validateCredentials(input), publish(creds, formatted)
//
// All adapters register in `lib/platforms/registry.ts`.
// `configured()` returns true when the platform's required env vars are
// present → drives "Setup pending" UI for Tier B without errors.

import type { Platform } from '@prisma/client';

/**
 * The credential shape stored (encrypted) in `Connection.credentialsCipher`.
 * Each adapter defines its own concrete type via `CredentialsFor<P>`.
 *
 * `unknown` here means: the adapter handles its own credential typing.
 * The Connection table stores the JSON blob (encrypted via TokenVault);
 * the adapter decrypts + narrows the type on each use.
 */
export type AdapterCredentials = Record<string, unknown>;

/**
 * The formatted-post shape passed to `adapter.publish()`.
 * Produced by the Format Engine (Phase 5 — not yet implemented) per
 * docs/02-SRS.md FR-011. For Phase 3, we accept a minimal shape and
 * the adapter implementation decides which fields to use.
 */
export interface FormattedPost {
  title: string;
  body: string;
  url?: string;
  hashtags?: string[];
  options?: Record<string, unknown>;
}

/**
 * Result returned by `adapter.publish()` on success.
 */
export interface PublishResult {
  /** Public URL of the published post (for permalink) */
  url: string;
  /** Platform-side post id (for retry + status polling) */
  id: string;
  /** True if the post is in a "pending" state (Reddit rate-limit queue, etc.) */
  pending?: boolean;
  /** If pending=true, the platform's pending-id (used to poll for completion) */
  pendingId?: string;
}

/**
 * PKCE pair used by OAuth flows (per docs/02-SRS.md FR-005).
 */
export interface PkcePair {
  code_verifier: string;
  code_challenge: string;
  code_challenge_method: 'S256';
}

/**
 * Result of `adapter.exchangeCode()` for OAuth adapters.
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch seconds
  scopes?: string[];
}

/**
 * Result of `adapter.getIdentity()` / `adapter.validateCredentials()`.
 * Stored in `Connection.platformAccountId` + `Connection.platformUsername`.
 */
export interface PlatformIdentity {
  id: string; // platform-side stable id (user id, channel id, etc.)
  username: string; // display handle (e.g. "@yourname")
}

/**
 * Classification of publish errors (drives retry policy + UI per
 * docs/03-ARCHITECTURE.md "Failure Classification"):
 *
 *   AUTH — 401/403/invalid token → mark Connection REVOKED + FAILED + reconnect hint
 *   RATE — 429/rate-limit → backoff retry (3×), then FAILED with "try later"
 *   VALIDATION — platform rejected content → FAILED, surface platform message
 *   NETWORK — 5xx/timeout → backoff retry
 *   QUOTA — X budget exhausted → SKIPPED with explanation
 */
export type ErrorClass = 'AUTH' | 'RATE' | 'VALIDATION' | 'NETWORK' | 'QUOTA';

/**
 * PublishError — thrown by `adapter.publish()` with a classified error class
 * so the worker can decide retry vs. permanent failure.
 */
export class PublishError extends Error {
  constructor(
    public readonly errorClass: ErrorClass,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

/**
 * The adapter contract. Every platform adapter implements this.
 *
 * `kind: 'OAUTH'` adapters implement `getAuthUrl`, `exchangeCode`,
 * `getIdentity`, `publish`. They drive the "Connect via Reddit/X/LinkedIn"
 * OAuth flow.
 *
 * `kind: 'SIMPLE'` adapters implement `validateCredentials`, `publish`.
 * They drive the "paste your API key / webhook URL / bot token / app
 * password" flow.
 */
export interface PlatformAdapter {
  /** The Prisma Platform enum value (REDDIT, X, etc.) */
  readonly platform: Platform;

  /** Human-readable name (e.g. "Reddit") */
  readonly name: string;

  /** Tooltip shown on the Connect Checklist UI (e.g. "OAuth login") */
  readonly toolTip: string;

  /** 'OAUTH' (Reddit/X/LinkedIn) or 'SIMPLE' (Dev.to/Discord/Telegram/Bluesky/Hashnode) */
  readonly kind: 'OAUTH' | 'SIMPLE';

  /** Returns true when the platform's required env vars are present. */
  configured(): boolean;

  // OAuth-only methods (present when kind === 'OAUTH')
  getAuthUrl?(pkce: PkcePair, state: string, redirectUri: string): string;
  exchangeCode?(
    code: string,
    pkce: PkcePair,
    redirectUri: string
  ): Promise<OAuthTokens>;
  getIdentity?(tokens: OAuthTokens): Promise<PlatformIdentity>;
  refresh?(tokens: OAuthTokens): Promise<OAuthTokens>;

  // SIMPLE-only method (present when kind === 'SIMPLE')
  validateCredentials?(
    input: Record<string, string>
  ): Promise<{ identity: PlatformIdentity; credentials: AdapterCredentials }>;

  // Common — every adapter implements this
  publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult>;
}

/**
 * Sentinel for "platform not configured" — used by `getAdapter()` when the
 * platform's env vars are missing. The Connect Checklist UI renders this as
 * "Setup pending".
 */
export class PlatformNotConfiguredError extends Error {
  constructor(public readonly platform: Platform) {
    super(
      `Platform ${platform} is not configured — required env vars missing. ` +
        `Add the credentials to .env and restart the app.`
    );
    this.name = 'PlatformNotConfiguredError';
  }
}

/**
 * Sentinel for "no adapter registered for this platform identifier".
 */
export class AdapterNotFoundError extends Error {
  constructor(public readonly identifier: string) {
    super(`No adapter registered for platform "${identifier}".`);
    this.name = 'AdapterNotFoundError';
  }
}
