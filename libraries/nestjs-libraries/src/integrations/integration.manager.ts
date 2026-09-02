import 'reflect-metadata';

import { Injectable } from '@nestjs/common';
import { XProvider } from '@netamplify/nestjs-libraries/integrations/social/x.provider';
import { SocialProvider } from '@netamplify/nestjs-libraries/integrations/social/social.integrations.interface';
import { LinkedinProvider } from '@netamplify/nestjs-libraries/integrations/social/linkedin.provider';
import { RedditProvider } from '@netamplify/nestjs-libraries/integrations/social/reddit.provider';
import { DevToProvider } from '@netamplify/nestjs-libraries/integrations/social/dev.to.provider';
import { HashnodeProvider } from '@netamplify/nestjs-libraries/integrations/social/hashnode.provider';
import { MediumProvider } from '@netamplify/nestjs-libraries/integrations/social/medium.provider';
import { FacebookProvider } from '@netamplify/nestjs-libraries/integrations/social/facebook.provider';
import { InstagramProvider } from '@netamplify/nestjs-libraries/integrations/social/instagram.provider';
import { YoutubeProvider } from '@netamplify/nestjs-libraries/integrations/social/youtube.provider';
import { TiktokProvider } from '@netamplify/nestjs-libraries/integrations/social/tiktok.provider';
import { TiktokBusinessProvider } from '@netamplify/nestjs-libraries/integrations/social/tiktok.business.provider';
import { PinterestProvider } from '@netamplify/nestjs-libraries/integrations/social/pinterest.provider';
import { DribbbleProvider } from '@netamplify/nestjs-libraries/integrations/social/dribbble.provider';
import { LinkedinPageProvider } from '@netamplify/nestjs-libraries/integrations/social/linkedin.page.provider';
import { ThreadsProvider } from '@netamplify/nestjs-libraries/integrations/social/threads.provider';
import { DiscordProvider } from '@netamplify/nestjs-libraries/integrations/social/discord.provider';
import { SlackProvider } from '@netamplify/nestjs-libraries/integrations/social/slack.provider';
import { MastodonProvider } from '@netamplify/nestjs-libraries/integrations/social/mastodon.provider';
import { BlueskyProvider } from '@netamplify/nestjs-libraries/integrations/social/bluesky.provider';
import { LemmyProvider } from '@netamplify/nestjs-libraries/integrations/social/lemmy.provider';
import { InstagramStandaloneProvider } from '@netamplify/nestjs-libraries/integrations/social/instagram.standalone.provider';
import { FarcasterProvider } from '@netamplify/nestjs-libraries/integrations/social/farcaster.provider';
import { TelegramProvider } from '@netamplify/nestjs-libraries/integrations/social/telegram.provider';
import { NostrProvider } from '@netamplify/nestjs-libraries/integrations/social/nostr.provider';
import { VkProvider } from '@netamplify/nestjs-libraries/integrations/social/vk.provider';
import { WordpressProvider } from '@netamplify/nestjs-libraries/integrations/social/wordpress.provider';
import { ListmonkProvider } from '@netamplify/nestjs-libraries/integrations/social/listmonk.provider';
import { GmbProvider } from '@netamplify/nestjs-libraries/integrations/social/gmb.provider';
import { KickProvider } from '@netamplify/nestjs-libraries/integrations/social/kick.provider';
import { TwitchProvider } from '@netamplify/nestjs-libraries/integrations/social/twitch.provider';
import { SocialAbstract } from '@netamplify/nestjs-libraries/integrations/social.abstract';
import { MoltbookProvider } from '@netamplify/nestjs-libraries/integrations/social/moltbook.provider';
import { SkoolProvider } from '@netamplify/nestjs-libraries/integrations/social/skool.provider';
import { WhopProvider } from '@netamplify/nestjs-libraries/integrations/social/whop.provider';
import { MeweProvider } from '@netamplify/nestjs-libraries/integrations/social/mewe.provider';
import { TumblrProvider } from '@netamplify/nestjs-libraries/integrations/social/tumblr.provider';

export const socialIntegrationList: Array<SocialAbstract & SocialProvider> = [
  new XProvider(),
  new LinkedinProvider(),
  new LinkedinPageProvider(),
  new RedditProvider(),
  new InstagramProvider(),
  new InstagramStandaloneProvider(),
  new FacebookProvider(),
  new ThreadsProvider(),
  new YoutubeProvider(),
  new GmbProvider(),
  new TiktokProvider(),
  new TiktokBusinessProvider(),
  new PinterestProvider(),
  new DribbbleProvider(),
  new DiscordProvider(),
  new SlackProvider(),
  new KickProvider(),
  new TwitchProvider(),
  new MastodonProvider(),
  new BlueskyProvider(),
  new LemmyProvider(),
  new FarcasterProvider(),
  new TelegramProvider(),
  new NostrProvider(),
  new VkProvider(),
  new MediumProvider(),
  new DevToProvider(),
  new HashnodeProvider(),
  new WordpressProvider(),
  new ListmonkProvider(),
  new MoltbookProvider(),
  new WhopProvider(),
  new SkoolProvider(),
  new MeweProvider(),
  new TumblrProvider(),
  // new MastodonCustomProvider(),
];

@Injectable()
export class IntegrationManager {
  // Both are env-driven so cloud and self-hosted instances can differ:
  // HIDDEN_PROVIDERS ("tiktok,x") hides providers from the add-channel screen,
  // MIGRATE_PROVIDERS ("tiktok:tiktok-business") routes a reconnect of the old
  // provider through the new provider's OAuth and migrates the channel in
  // place, keeping its id, scheduled posts and settings.
  isHiddenProvider(identifier: string) {
    return (process.env.HIDDEN_PROVIDERS || '')
      .split(',')
      .map((p) => p.trim())
      .includes(identifier);
  }

  // Note: a target provider that implements `reConnect` is not supported - the
  // connect callback would run reConnect with the old app-scoped id before the
  // migration is attempted.
  getMigrationTarget(identifier: string): string | undefined {
    const [, target] =
      (process.env.MIGRATE_PROVIDERS || '')
        .split(',')
        .map((p) => p.trim().split(':'))
        .find(([from, to]) => from === identifier && !!to) || [];

    return target &&
      target !== identifier &&
      this.getAllowedSocialsIntegrations().includes(target)
      ? target
      : undefined;
  }

  // Reverse lookup of MIGRATE_PROVIDERS: the providers whose channels a fresh
  // connect of `identifier` should adopt instead of creating a duplicate.
  getMigrationSources(identifier: string): string[] {
    return (process.env.MIGRATE_PROVIDERS || '')
      .split(',')
      .map((p) => p.trim().split(':'))
      .filter(
        ([from, to]) =>
          to === identifier &&
          !!from &&
          from !== identifier &&
          this.getAllowedSocialsIntegrations().includes(from)
      )
      .map(([from]) => from);
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

  getAllPlugs() {
    return socialIntegrationList
      .map((p) => {
        return {
          name: p.name,
          identifier: p.identifier,
          plugs: (
            Reflect.getMetadata('custom:plug', p.constructor.prototype) || []
          )
            .filter((f: any) => !f.disabled)
            .map((p: any) => ({
              ...p,
              fields: p.fields.map((c: any) => ({
                ...c,
                validation: c?.validation?.toString(),
              })),
            })),
        };
      })
      .filter((f) => f.plugs.length);
  }

  getInternalPlugs(providerName: string) {
    const p = socialIntegrationList.find((p) => p.identifier === providerName)!;
    return {
      internalPlugs:
        (
          Reflect.getMetadata(
            'custom:internal_plug',
            p.constructor.prototype
          ) || []
        ).filter((f: any) => !f.disabled) || [],
    };
  }

  getAllowedSocialsIntegrations() {
    return socialIntegrationList.map((p) => p.identifier);
  }
  getSocialIntegration(integration: string): SocialProvider {
    return socialIntegrationList.find((i) => i.identifier === integration)!;
  }
}
