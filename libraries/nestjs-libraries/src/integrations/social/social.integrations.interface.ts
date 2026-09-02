// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts
// NetAmplify SocialProvider interface — adapter contract per docs/03-ARCHITECTURE.md.
// Each platform provider implements this interface so that the publish
// pipeline (BullMQ workers) can call adapter.publish() uniformly.

export type SocialProvider = {
  /** Display name e.g. "Reddit" */
  name: string;
  /** Stable identifier e.g. "reddit", "x", "linkedin" */
  identifier: string;
  /** User-facing tooltip shown on connect dialog */
  toolTip: string;
  /** Editor schema for per-platform options (e.g., subreddit input) */
  editor: any;
  /** External OAuth login URL if applicable */
  externalUrl?: string;
  /** Whether the provider requires a Web3 wallet (false for all NetAmplify MVP platforms) */
  isWeb3?: boolean;
  /** Whether the provider requires the (deleted) Chrome extension */
  isChromeExtension?: boolean;
  /** Cookie keys needed by the deleted Chrome extension (always empty in NetAmplify) */
  extensionCookies?: string[];
  /** Optional async method that returns custom connect-form fields */
  customFields?: () => Promise<any>;
  /** OAuth 2.0 authorize URL builder (only for OAuth providers) */
  getAuthUrl?: (pkce: PkcePair, state: string) => string;
  /** OAuth 2.0 code exchange (only for OAuth providers) */
  exchangeCode?: (code: string, pkce: PkcePair) => Promise<PlatformTokens>;
  /** Identity fetch — returns the platform user's id + username */
  getIdentity?: (tokens: PlatformTokens) => Promise<{ id: string; username: string }>;
  /** Validate user-pasted credentials (Dev.to API key, Discord webhook, etc.) */
  validateCredentials?: (input: Record<string, string>) => Promise<{ id: string; username: string }>;
  /** Publish to the platform; returns the post URL + platform-side id */
  publish: (creds: any, content: FormattedPost) => Promise<{ url: string; id: string }>;
};

export type SocialAbstract = {
  /** Internal helper methods shared by all providers; intentionally left minimal. */
};

export interface PkcePair {
  code_verifier: string;
  code_challenge: string;
  code_challenge_method: 'S256';
}

export interface PlatformTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

export interface FormattedPost {
  title?: string;
  body?: string;
  url?: string;
  hashtags?: string[];
  options?: Record<string, unknown>;
}

export interface AnalyticsData {
  // Reserved for Phase 5+ analytics. MVP out of scope per docs/01-PRD.md §4.
}

/**
 * AuthToken details — used by OAuth providers' refresh-token logic.
 */
export interface AuthTokenDetails {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

/**
 * Pending-check response — used by providers that need to verify a
 * pending post status (e.g., Reddit's rate-limited post queue).
 */
export interface PendingCheckResponse {
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  platformPostUrl?: string;
  platformPostId?: string;
  error?: string;
}

/**
 * PostDetails — the canonical post payload passed to adapter.publish().
 * Formatted by the Format Engine per FR-011 before reaching the adapter.
 */
export interface PostDetails {
  title?: string;
  body?: string;
  url?: string;
  hashtags?: string[];
  options?: Record<string, unknown>;
  /** Per-platform images (URLs) — MVP supports ≤1 image per PostCard */
  images?: string[];
}

/**
 * PostResponse — returned by adapter.publish() on success.
 */
export interface PostResponse {
  url: string;
  id: string;
  pending?: boolean;
  pendingId?: string;
}
