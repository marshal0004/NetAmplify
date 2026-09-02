// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/platforms/telegram/telegram.adapter.ts
// NetAmplify — Telegram adapter.
//
// SIMPLE credential: user creates their own bot via @BotFather, then pastes
// the bot token + channel @username. We validate by:
//   1. GET-ing /getMe (validates the bot token)
//   2. GET-ing /getChat (validates the bot is admin of the channel)
//
// Per docs/02-SRS.md FR-007: "server calls getMe (validate token) + getChat
// (validate bot is admin of that channel) → store both encrypted."
//
// Trust model per docs/12-TRUST-COPY.md §1:
//   "The bot is YOURS — you create it with @BotFather and control it. We
//    only get the ability to send messages to the one channel where you
//    made it an admin. Remove the bot anytime."

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

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * The shape of the credentials JSON blob stored encrypted in
 * Connection.credentialsCipher for Telegram.
 */
export interface TelegramCredentials extends AdapterCredentials {
  botToken: string;
  /** Channel @username or numeric -100xxx id */
  channel: string;
  /** Bot's display name (for trust panel) */
  botUsername?: string;
}

/**
 * Telegram getMe response shape.
 * Docs: https://core.telegram.org/bots/api#getme
 */
interface TelegramGetMeResponse {
  ok: boolean;
  result?: {
    id: number;
    username: string;
    first_name: string;
  };
  description?: string;
}

/**
 * Telegram getChat response shape.
 * Docs: https://core.telegram.org/bots/api#getchat
 */
interface TelegramGetChatResponse {
  ok: boolean;
  result?: {
    id: number;
    type: string;
    title?: string;
    username?: string;
  };
  description?: string;
}

@Injectable()
export class TelegramAdapter implements PlatformAdapter {
  readonly platform: Platform = 'TELEGRAM';
  readonly name = 'Telegram';
  readonly toolTip = 'Paste your bot token + channel @username';
  readonly kind = 'SIMPLE' as const;

  configured(): boolean {
    return true;
  }

  /**
   * Validate the user-pasted bot token + channel by calling getMe (validates
   * the token) then getChat (validates the bot is admin of the channel).
   */
  async validateCredentials(
    input: Record<string, string>
  ): Promise<{ identity: PlatformIdentity; credentials: TelegramCredentials }> {
    const botToken = input.botToken;
    const channel = input.channel;
    if (!botToken || typeof botToken !== 'string') {
      throw new PublishError('VALIDATION', 'botToken is required');
    }
    if (!channel || typeof channel !== 'string') {
      throw new PublishError('VALIDATION', 'channel is required');
    }
    // Telegram channel must start with @ or be a numeric -100xxx id
    const channelClean = channel.startsWith('@') ? channel : `@${channel}`;

    // Step 1: getMe — validate the bot token
    const meResp = (await (
      await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/getMe`)
    ).json()) as TelegramGetMeResponse;
    if (!meResp.ok || !meResp.result) {
      const reason = meResp.description || 'unknown error';
      if (reason.toLowerCase().includes('unauthorized')) {
        throw new PublishError('AUTH', `Bot token invalid: ${reason}`);
      }
      throw new PublishError('AUTH', `Telegram getMe failed: ${reason}`);
    }
    const botUsername = meResp.result.username;

    // Step 2: getChat — validate the bot is admin of the channel
    const chatResp = (await (
      await fetch(
        `${TELEGRAM_API_BASE}/bot${botToken}/getChat?chat_id=${encodeURIComponent(channelClean)}`
      )
    ).json()) as TelegramGetChatResponse;
    if (!chatResp.ok || !chatResp.result) {
      const reason = chatResp.description || 'unknown error';
      if (reason.toLowerCase().includes('chat not found')) {
        throw new PublishError(
          'AUTH',
          `Channel ${channelClean} not found — make your bot an admin of the channel first`
        );
      }
      if (reason.toLowerCase().includes('forbidden')) {
        throw new PublishError(
          'AUTH',
          `Bot is not an admin of ${channelClean} — add the bot to the channel as admin`
        );
      }
      throw new PublishError('AUTH', `Telegram getChat failed: ${reason}`);
    }

    const chat = chatResp.result;
    return {
      identity: {
        id: String(chat.id),
        username: chat.title || chat.username || channelClean,
      },
      credentials: {
        botToken,
        channel: channelClean,
        botUsername,
      },
    };
  }

  /**
   * Publish a HTML message to the Telegram channel via the bot.
   *
   * Endpoint: POST /bot<token>/sendMessage
   * Docs: https://core.telegram.org/bots/api#sendmessage
   */
  async publish(
    credentials: AdapterCredentials,
    formatted: FormattedPost
  ): Promise<PublishResult> {
    const creds = credentials as TelegramCredentials;
    if (!creds.botToken || !creds.channel) {
      throw new PublishError('AUTH', 'Telegram bot token or channel missing from credentials');
    }

    // Telegram message body: title (bold) + body + link (if present)
    // Telegram supports HTML formatting: <b>, <i>, <a>, <code>
    // Per FR-011: HTML message ≤4096 chars with title link + tags
    const linkHtml = formatted.url
      ? ` <a href="${formatted.url}">${formatted.url}</a>`
      : '';
    const tagsHtml =
      formatted.hashtags && formatted.hashtags.length > 0
        ? `\n\n${formatted.hashtags.map((t) => `#${t}`).join(' ')}`
        : '';
    const text = `<b>${escapeHtml(formatted.title)}</b>\n\n${formatted.body}${linkHtml}${tagsHtml}`;
    if (text.length > 4096) {
      throw new PublishError(
        'VALIDATION',
        `Telegram message exceeds 4096 chars (got ${text.length})`
      );
    }

    const body = new URLSearchParams({
      chat_id: creds.channel,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: 'false',
    });

    const resp = await fetch(
      `${TELEGRAM_API_BASE}/bot${creds.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }
    );

    if (resp.status === 401) {
      const data = (await resp.json()) as { description?: string };
      throw new PublishError(
        'AUTH',
        `Telegram bot token invalid: ${data.description || 'unauthorized'}`
      );
    }
    if (resp.status === 429) {
      const data = (await resp.json()) as { parameters?: { retry_after?: number } };
      throw new PublishError(
        'RATE',
        `Telegram rate-limited${data.parameters?.retry_after ? ` (retry after ${data.parameters.retry_after}s)` : ''}`
      );
    }
    if (!resp.ok) {
      const data = (await resp.json()) as { description?: string };
      const reason = data.description || `HTTP ${resp.status}`;
      if (reason.toLowerCase().includes('chat not found') || reason.toLowerCase().includes('forbidden')) {
        throw new PublishError(
          'AUTH',
          `Bot no longer admin of channel: ${reason}`
        );
      }
      throw new PublishError('NETWORK', `Telegram publish failed: ${reason}`);
    }

    const data = (await resp.json()) as {
      result?: { message_id: number; chat?: { id: number; username?: string } };
    };
    const msgId = data.result?.message_id;
    if (!msgId) {
      throw new PublishError('NETWORK', 'Telegram returned no message_id');
    }
    const chatUsername = data.result?.chat?.username;
    return {
      id: String(msgId),
      url: chatUsername
        ? `https://t.me/${chatUsername}/${msgId}`
        : `https://t.me/c/${Math.abs(data.result?.chat?.id ?? 0)}/${msgId}`,
    };
  }
}

/**
 * Escape HTML special chars to prevent injection in Telegram's HTML mode.
 * Per Telegram docs: only <b>, <i>, <a>, <code>, <pre> tags are allowed;
 * all other angle brackets must be escaped.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
