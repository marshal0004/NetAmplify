// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/types.ts
// NetAmplify — Format Engine type definitions.
//
// Per docs/02-SRS.md FR-011: "Format Engine (pure) — Input: PostCard +
// Profile + per-platform options (subreddit for Reddit). Output rules:
//   X: ≤280 chars; tags → #hashtags appended if room; URL counts as 23.
//   LinkedIn: plain text ≤3000, line breaks preserved, ≤3 hashtags, link on own line.
//   Reddit: title ≤300 + markdown body (uses description verbatim-ish).
//   Discord: embed {title ≤256, description ≤4096, fields: tech stack, links}.
//   Dev.to: markdown article (title + body), tags ≤4.
//   Hashnode: markdown, publication optional.
//   Telegram: HTML message ≤4096 with title link + tags.
//   Bluesky: ≤300 chars (graphemes) + external link facet.
//   Deterministic; truncation strategy = trim description, then summary,
//   never title; ellipsis marker before link."

/**
 * The canonical PostCard shape passed to the Format Engine.
 * Matches the Prisma PostCard model (omitting id/timestamps).
 */
export interface FormatEnginePostCard {
  title: string;
  summary: string;
  description: string; // markdown
  techStack: string[];
  repoUrl?: string;
  liveUrl?: string;
  imageUrl?: string;
}

/**
 * The canonical Profile shape (optional input — used for some platforms).
 */
export interface FormatEngineProfile {
  name?: string;
  headline?: string;
  githubUrl?: string;
  portfolioUrl?: string;
}

/**
 * Per-platform options passed to the formatter.
 *   - Reddit: subreddit (required)
 *   - Other platforms: ignored
 */
export interface FormatEngineOptions {
  subreddit?: string;
  [key: string]: unknown;
}

/**
 * The formatted output for a platform. Each field is optional — the
 * adapter decides which to use.
 */
export interface FormattedPost {
  title?: string;
  body?: string;
  url?: string;
  hashtags?: string[];
  options?: Record<string, unknown>;
  /** Char count + limit (for UI display) */
  charCount: number;
  limit: number;
}

/**
 * Result of formatting for one platform. Includes the formatted output
 * + metadata for the UI preview.
 */
export interface FormatResult {
  platform: string;
  formatted: FormattedPost;
  /** Truncated if any field was cut to fit the limit */
  truncated: boolean;
}

/**
 * The formatter function signature — pure, no side effects.
 */
export type Formatter = (
  postCard: FormatEnginePostCard,
  profile: FormatEngineProfile | null,
  options: FormatEngineOptions
) => FormattedPost;
