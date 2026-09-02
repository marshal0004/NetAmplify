import 'reflect-metadata';

import { Injectable } from '@nestjs/common';
import { XProvider } from '@netamplify/nestjs-libraries/integrations/social/x.provider';
import { SocialProvider } from '@netamplify/nestjs-libraries/integrations/social/social.integrations.interface';
import { LinkedinProvider } from '@netamplify/nestjs-libraries/integrations/social/linkedin.provider';
import { RedditProvider } from '@netamplify/nestjs-libraries/integrations/social/reddit.provider';
import { DevToProvider } from '@netamplify/nestjs-libraries/integrations/social/dev.to.provider';
import { HashnodeProvider } from '@netamplify/nestjs-libraries/integrations/social/hashnode.provider';
import { DiscordProvider } from '@netamplify/nestjs-libraries/integrations/social/discord.provider';
import { BlueskyProvider } from '@netamplify/nestjs-libraries/integrations/social/bluesky.provider';
import { TelegramProvider } from '@netamplify/nestjs-libraries/integrations/social/telegram.provider';
import { SocialAbstract } from '@netamplify/nestjs-libraries/integrations/social.abstract';

/**
 * NetAmplify keeps 8 platform providers (per docs/01-PRD.md §4):
 *   Tier A (MVP): Reddit, Discord, Dev.to, Telegram, Bluesky, Hashnode
 *   Tier B (bonus): X (Twitter), LinkedIn
 *
 * `configured()` (added per NetAmplify adapter contract) returns true when
 * the platform's required env vars are present; unconfigured Tier B
 * platforms render as "Setup pending" in the UI instead of erroring.
 */
export const socialIntegrationList: Array<SocialAbstract & SocialProvider> = [
  new XProvider(),
  new LinkedinProvider(),
  new RedditProvider(),
  new DiscordProvider(),
  new DevToProvider(),
  new HashnodeProvider(),
  new BlueskyProvider(),
  new TelegramProvider(),
];

@Injectable()
export class IntegrationManager {
  /**
   * HIDDEN_PROVIDERS ("x,linkedin") hides providers from the add-channel screen
   * without removing them from the registry. Env-driven so cloud and self-hosted
   * instances can differ.
   */
  isHiddenProvider(identifier: string) {
    return (process.env.HIDDEN_PROVIDERS || '')
      .split(',')
      .map((p) => p.trim())
      .includes(identifier);
  }

  /**
   * Returns true when the platform's required client credentials are present
   * in env (used by Connect Checklist UI to render "Setup pending" for
   * unconfigured Tier B platforms without erroring).
   */
  configured(identifier: string): boolean {
    switch (identifier) {
      case 'reddit':
        return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
      case 'x':
        return Boolean(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET);
      case 'linkedin':
        return Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
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

  async getAllIntegrations() {
    return {
      social: await Promise.all(
        socialIntegrationList
          .filter((p) => !this.isHiddenProvider(p.identifier))
          .map(async (p) => ({
            name: p.name,
            identifier: p.identifier,
            toolTip: p.toolTip,
            editor: p.editor,
            isExternal: !!p.externalUrl,
            isWeb3: !!p.isWeb3,
            isChromeExtension: !!p.isChromeExtension,
            configured: this.configured(p.identifier),
            ...(p.extensionCookies
              ? { extensionCookies: p.extensionCookies }
              : {}),
            ...(p.customFields ? { customFields: await p.customFields() } : {}),
          }))
      ),
      article: [] as any[],
    };
  }

  getAllTools(): {
    [key: string]: {
      description: string;
      dataSchema: any;
      methodName: string;
    }[];
  } {
    return socialIntegrationList.reduce(
      (all, current) => ({
        ...all,
        [current.identifier]:
          Reflect.getMetadata('custom:tool', current.constructor.prototype) ||
          [],
      }),
      {}
    );
  }

  getAllRulesDescription(): {
    [key: string]: string;
  } {
    return socialIntegrationList.reduce(
      (all, current) => ({
        ...all,
        [current.identifier]:
          Reflect.getMetadata(
            'custom:rules:description',
            current.constructor
          ) || '',
      }),
      {}
    );
  }

  getAllowedSocialsIntegrations() {
    return socialIntegrationList.map((p) => p.identifier);
  }

  getSocialIntegration(integration: string): SocialProvider {
    return socialIntegrationList.find((i) => i.identifier === integration)!;
  }
}
