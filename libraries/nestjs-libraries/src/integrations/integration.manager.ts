// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/integrations/integration.manager.ts
// NetAmplify — IntegrationManager (Phase 1 minimal).
//
// The 8 platform providers (reddit, x, linkedin, discord, dev.to, telegram,
// bluesky, hashnode) have been moved to `_phase4-pending-providers/` because
// they reference postiz's deep internal types (Temporal activity, full
// SocialProvider interface with ~30 fields). Phase 4 will rewrite them per
// the NetAmplify adapter contract defined in
// `integrations/social/social.integrations.interface.ts` (already in place).
//
// In the meantime, this manager exposes the configured() method that the
// Connect Checklist UI will use to render "Setup pending" cards for
// Tier B platforms without env vars set.

import { Injectable, Inject } from '@nestjs/common';

/**
 * NetAmplify platform identifiers (lowercase strings used as the canonical
 * identifier across the codebase; the Prisma `Platform` enum will be added
 * when the schema is rewritten in Phase 2 per docs/04-DATABASE.md).
 */
export const NETAMPLIFY_PLATFORMS = [
  'REDDIT',
  'DISCORD',
  'DEVTO',
  'TELEGRAM',
  'BLUESKY',
  'HASHNODE',
  'TWITTER',
  'LINKEDIN',
] as const;

export type NetAmplifyPlatform = (typeof NETAMPLIFY_PLATFORMS)[number];

/**
 * Tier A: platforms live in MVP (instant setup).
 * Tier B: bonus attempts (work if env creds configured; "Setup pending" otherwise).
 */
export const TIER_A_PLATFORMS: ReadonlyArray<NetAmplifyPlatform> = [
  'REDDIT',
  'DISCORD',
  'DEVTO',
  'TELEGRAM',
  'BLUESKY',
  'HASHNODE',
];

export const TIER_B_PLATFORMS: ReadonlyArray<NetAmplifyPlatform> = [
  'TWITTER',
  'LINKEDIN',
];

@Injectable()
export class IntegrationManager {
  /**
   * Returns true when the platform's required env vars are present.
   * Used by Connect Checklist UI to render "Setup pending" cards for
   * unconfigured Tier B platforms without erroring.
   *
   * Tier A platforms (user-pasted credentials) are always "configured".
   * Tier B platforms (OAuth via our developer app) need env vars.
   */
  configured(identifier: string): boolean {
    switch (identifier) {
      case 'reddit':
        return Boolean(
          process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET
        );
      case 'x':
      case 'twitter':
        return Boolean(
          process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET
        );
      case 'linkedin':
        return Boolean(
          process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET
        );
      case 'discord':
      case 'devto':
      case 'hashnode':
      case 'telegram':
      case 'bluesky':
        return true; // user-pasted credentials, no env vars required
      default:
        return false;
    }
  }

  /**
   * Returns the platform tier for the Connect Checklist UI.
   * Tier A = always rendered with a Connect button.
   * Tier B = rendered with "Setup pending" if !configured().
   */
  getTier(identifier: string): 'A' | 'B' {
    const lower = identifier.toLowerCase();
    return TIER_B_PLATFORMS.some((p) => p.toLowerCase() === lower)
      ? 'B'
      : 'A';
  }

  /**
   * List of all supported NetAmplify platform identifiers.
   */
  getAllowedSocialsIntegrations(): string[] {
    return NETAMPLIFY_PLATFORMS.map((p) => p.toLowerCase());
  }

  /**
   * HIDDEN_PROVIDERS env ("x,linkedin") hides providers from the add-channel
   * screen without removing them from the registry. Empty by default.
   */
  isHiddenProvider(identifier: string): boolean {
    return (process.env.HIDDEN_PROVIDERS || '')
      .split(',')
      .map((p) => p.trim())
      .includes(identifier);
  }
}
