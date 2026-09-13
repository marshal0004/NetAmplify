// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/discord/discord.adapter.ts
// NetAmplify — Discord adapter.
//
// SIMPLE credential: user pastes a webhook URL from their server settings.
// We validate it by GET-ing the webhook (returns channel metadata), then
// store the URL encrypted. Publish posts to the webhook via Discord's
// embed-rich-message format.
//
// Discord API docs: https://discord.com/developers/docs/resources/webhook
//
// Trust model per docs/12-TRUST-COPY.md §1:
//   "A webhook can only post to ONE channel in your server. Even in a
//    worst case, it can't read messages, DMs, or touch your account."

import { Injectable } from '@nestjs/common';
import type {
  PlatformAdapter,
  PlatformIdentity,
  AdapterCredentials,
  FormattedPost,
  PublishResult,
} from '../adapter.interface';
import { PublishError } from '../adapter.interface';
import type { Platform } from '@prisma/client';

/**
 * The shape of the credentials JSON blob stored encrypted in
 * Connection.credentialsCipher for Discord.
 */
export interface DiscordCredentials extends AdapterCredentials {
  webhookUrl: string;
  webhookId?: string;
}

/**
 * Discord webhook validation response shape (from GET /webhooks/:id/:token).
 * Docs: https://discord.com/developers/docs/resources/webhook#get-webhook
 */
interface DiscordWebhookInfo {
  id: string;
  name: string;
  channel_id: string;
  guild_id?: string;
  guild_name?: string;
}

/**
 * Discord embed message format (used for rich-formatted posts).
 * Docs: https://discord.com/developers/docs/resources/message#embed-object
 */
interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

/**
 * Discord webhook rate limit: 30 messages per 60 seconds per channel.
 * We don't enforce this client-side — Discord returns 429 with Retry-After
 * if we exceed it, and we retry.
 */
const DISCORD_RATE_LIMIT_PER_MINUTE = 30;

@Injectable()
export class DiscordAdapter implements PlatformAdapter {
  readonly platform: Platform = 'DISCORD';
  readonly name = 'Discord';
  readonly toolTip = 'Paste a webhook URL from your server';
  readonly kind = 'SIMPLE' as const;

  configured(): boolean {
    // Discord requires no env vars — the user pastes their own webhook URL.
    return true;
  }

  /**
   * Validate the user-pasted webhook URL by GET-ing it. Returns the
   * channel identity (id + name) so we can show "Will post to #channel in
   * <server>" on the Connect Checklist.
   *
   * Per docs/02-SRS.md FR-006: "server GETs it (returns channel metadata) →
   * shows 'Will post to #channel-name in <server>' → store encrypted."
   */
  async validateCredentials(
    input: Record<string, string>
  ): Promise<{ identity: PlatformIdentity; credentials: DiscordCredentials }> {
    const webhookUrl = input.webhookUrl;
    if (!webhookUrl || typeof webhookUrl !== 'string') {
      throw new PublishError('VALIDATION', 'webhookUrl is required');
    }
    if (!webhookUrl.startsWith('https://')) {
      throw new PublishError(
        'VALIDATION',
        'Discord webhook URL must start with https://'
      );
    }

    const resp = await fetch(webhookUrl, { method: 'GET' });
    if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
      throw new PublishError(
        'AUTH',
        `Discord webhook URL is invalid or revoked (${resp.status})`
      );
    }
    if (resp.status === 429) {
      throw new PublishError(
        'RATE',
        'Discord webhook is rate-limited — try again in a moment'
      );
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Discord webhook validation failed (${resp.status}): ${text}`
      );
    }

    const data = (await resp.json()) as DiscordWebhookInfo;
    return {
      identity: {
        id: data.channel_id,
        username: `#${data.name}`,
      },
      credentials: {
        webhookUrl,
        webhookId: data.id,
      },
    };
  }

  /**
   * Publish a post to the Discord webhook. Uses Discord's embed format for
   * rich-formatted posts: title, description (markdown), URL link,
   * optional fields (tech stack, repo link, live link).
   *
   * Endpoint: POST /webhooks/:id/:token (the webhook URL itself)
   * Docs: https://discord.com/developers/docs/resources/webhook#execute-webhook
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult> {
    const creds = credentials as DiscordCredentials;
    if (!creds.webhookUrl) {
      throw new PublishError('AUTH', 'Discord webhook URL missing from credentials');
    }

    // Build the embed (rich-formatted message)
    const embed: DiscordEmbed = {
      title: formatted.title.slice(0, 256), // Discord embed title limit
      description: formatted.body.slice(0, 4096), // Discord embed description limit
    };
    if (formatted.url) {
      embed.url = formatted.url;
    }
    // Add tech stack + repo/live links as embed fields
    const fields: DiscordEmbed['fields'] = [];
    if (formatted.hashtags && formatted.hashtags.length > 0) {
      fields.push({
        name: 'Tech Stack',
        value: formatted.hashtags.map((t) => `\`${t}\``).join(' '),
      });
    }
    if (fields.length > 0) {
      embed.fields = fields.slice(0, 25); // Discord limit: 25 fields per embed
    }

    const body = {
      embeds: [embed],
      username: 'NetAmplify',
    };

    const resp = await fetch(`${creds.webhookUrl}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
      throw new PublishError(
        'AUTH',
        'Discord webhook is invalid or revoked — user must reconnect'
      );
    }
    if (resp.status === 429) {
      const retryAfter = resp.headers.get('Retry-After');
      throw new PublishError(
        'RATE',
        `Discord rate-limited${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`
      );
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new PublishError(
        'NETWORK',
        `Discord publish failed (${resp.status}): ${text}`
      );
    }

    const data = (await resp.json()) as { id: string; channel_id: string };
    return {
      id: data.id,
      url: `https://discord.com/channels/${data.channel_id}/${data.id}`,
    };
  }
}
