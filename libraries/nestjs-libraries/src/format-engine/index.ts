// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/index.ts
// NetAmplify — Format Engine entry point.
//
// Single source of truth for per-platform formatting. Per docs/02-SRS.md
// FR-011: "Format Engine (pure) — pure functions, no DB, no network, no
// Date.now/random."
//
// Usage:
//   import { formatForPlatform } from '@netamplify/nestjs-libraries/format-engine';
//   const result = formatForPlatform('REDDIT', postCard, profile, { subreddit: 'test' });
//
// The Format Engine is registered in DI as a stateless service (FormatEngine)
// for use in controllers + workers; the pure functions are exported for
// direct use in tests + the UI preview endpoint.

export type {
  Formatter,
  FormatEnginePostCard,
  FormatEngineProfile,
  FormatEngineOptions,
  FormattedPost,
  FormatResult,
} from './types';

import { Injectable } from '@nestjs/common';
import type { Platform } from '@prisma/client';
import type {
  Formatter,
  FormatEnginePostCard,
  FormatEngineProfile,
  FormatEngineOptions,
  FormattedPost,
  FormatResult,
} from './types';
import { redditFormatter } from './reddit';
import { xFormatter } from './x';
import { linkedinFormatter } from './linkedin';
import { discordFormatter } from './discord';
import { devtoFormatter } from './devto';
import { hashnodeFormatter } from './hashnode';
import { telegramFormatter } from './telegram';
import { blueskyFormatter } from './bluesky';

/**
 * Map of platform → formatter function. Pure functions, no DI.
 */
export const FORMATTERS: Record<Platform, Formatter> = {
  REDDIT: redditFormatter,
  TWITTER: xFormatter,
  LINKEDIN: linkedinFormatter,
  DISCORD: discordFormatter,
  DEVTO: devtoFormatter,
  HASHNODE: hashnodeFormatter,
  TELEGRAM: telegramFormatter,
  BLUESKY: blueskyFormatter,
};

/**
 * Pure function: format a PostCard for a specific platform.
 * Used by the preview endpoint + the publish worker.
 *
 * Per FR-011: deterministic — same input → identical output.
 */
export function formatForPlatform(
  platform: Platform,
  postCard: FormatEnginePostCard,
  profile: FormatEngineProfile | null = null,
  options: FormatEngineOptions = {}
): FormattedPost {
  const formatter = FORMATTERS[platform];
  if (!formatter) {
    throw new Error(`No formatter registered for platform: ${platform}`);
  }
  return formatter(postCard, profile, options);
}

/**
 * Format for all platforms at once. Returns a map for the publish page's
 * per-platform preview.
 */
export function formatForAllPlatforms(
  postCard: FormatEnginePostCard,
  profile: FormatEngineProfile | null,
  optionsByPlatform: Partial<Record<Platform, FormatEngineOptions>> = {}
): Record<Platform, FormatResult> {
  const results = {} as Record<Platform, FormatResult>;
  for (const platform of Object.keys(FORMATTERS) as Platform[]) {
    const opts = optionsByPlatform[platform] || {};
    const formatted = formatForPlatform(platform, postCard, profile, opts);
    results[platform] = {
      platform,
      formatted,
      truncated: formatted.charCount >= formatted.limit,
    };
  }
  return results;
}

/**
 * Injectable wrapper for use in NestJS controllers + services.
 */
@Injectable()
export class FormatEngine {
  format(
    platform: Platform,
    postCard: FormatEnginePostCard,
    profile: FormatEngineProfile | null = null,
    options: FormatEngineOptions = {}
  ): FormattedPost {
    return formatForPlatform(platform, postCard, profile, options);
  }

  formatAll(
    postCard: FormatEnginePostCard,
    profile: FormatEngineProfile | null,
    optionsByPlatform: Partial<Record<Platform, FormatEngineOptions>> = {}
  ): Record<Platform, FormatResult> {
    return formatForAllPlatforms(postCard, profile, optionsByPlatform);
  }
}
