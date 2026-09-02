// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/database/prisma/connections/connections.service.ts
// NetAmplify — ConnectionService (business logic for platform connections).
//
// Owns: credential validation (delegates to adapter), encryption (via
// TokenVault), connection upsert (via ConnectionRepository), audit
// logging (CONNECT/DISCONNECT/TOKEN_FAIL).
//
// Per docs/05-API-SPEC.md:
//   GET /api/connections            → list (no credentials ever returned)
//   POST /api/connections/devto      { apiKey }     → 201 { username }
//   POST /api/connections/discord    { webhookUrl } → 201 { channelName }
//   POST /api/connections/telegram   { botToken, channel } → 201
//   POST /api/connections/bluesky    { handle, appPassword } → 201
//   POST /api/connections/hashnode   { pat } → 201
//   DELETE /api/connections/:platform → 204

import { Injectable } from '@nestjs/common';
import type { Platform } from '@prisma/client';
import { ConnectionRepository } from './connections.repository';
import { AuditLogService } from '../audit/audit.service';
import { TokenVault } from '@netamplify/nestjs-libraries/services/vault/token-vault';
import { AdapterRegistry } from '@netamplify/nestjs-libraries/platforms/registry';
import {
  PlatformNotConfiguredError,
  type AdapterCredentials,
  type OAuthTokens,
  type PlatformIdentity,
} from '@netamplify/nestjs-libraries/platforms/adapter.interface';
import { PublishError } from '@netamplify/nestjs-libraries/platforms/adapter.interface';
import { ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';
import {
  CONNECT_DEVTO_SCHEMA,
  CONNECT_DISCORD_SCHEMA,
  CONNECT_TELEGRAM_SCHEMA,
  CONNECT_BLUESKY_SCHEMA,
  CONNECT_HASHNODE_SCHEMA,
} from '@netamplify/nestjs-libraries/validation/schemas';

interface AuditContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Public Connection view (returned to API consumers). NEVER contains
 * credentialsCipher or any decrypted credentials.
 */
export interface ConnectionView {
  id: string;
  platform: Platform;
  type: 'OAUTH' | 'API_KEY' | 'WEBHOOK' | 'BOT_TOKEN' | 'APP_PASSWORD';
  platformUsername: string | null;
  platformAccountId: string;
  status: 'ACTIVE' | 'REVOKED' | 'ERROR';
  scopes: string[];
  lastUsedAt: string | null;
  lastValidatedAt: string | null;
  /** Whether the platform has required env vars (true for SIMPLE adapters) */
  configured: boolean;
  /** Tier A (live) or Tier B (bonus, may show "Setup pending") */
  tier: 'A' | 'B';
  connectedAt: string;
}

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly _repo: ConnectionRepository,
    private readonly _audit: AuditLogService,
    private readonly _vault: TokenVault,
    private readonly _adapters: AdapterRegistry
  ) {}

  /**
   * List all of a user's connections (without credentials).
   * Includes "Setup pending" placeholders for unconfigured Tier B platforms.
   */
  async list(userId: string): Promise<ConnectionView[]> {
    const userConns = await this._repo.listByUser(userId);
    const allAdapters = this._adapters.all();

    // Build a map of {platform → Connection} from the DB rows
    const connByPlatform = new Map<Platform, (typeof userConns)[number]>();
    for (const c of userConns) {
      connByPlatform.set(c.platform, c);
    }

    // Build the view: one entry per registered platform, with connection
    // info if present, otherwise "not connected" state.
    const views: ConnectionView[] = [];
    for (const adapter of allAdapters) {
      const conn = connByPlatform.get(adapter.platform);
      const isConfigured = adapter.configured();
      const tier = isTierB(adapter.platform) ? 'B' : 'A';
      if (conn) {
        views.push({
          id: conn.id,
          platform: conn.platform,
          type: conn.type,
          platformUsername: conn.platformUsername,
          platformAccountId: conn.platformAccountId,
          status: conn.status,
          scopes: conn.scopes,
          lastUsedAt: conn.lastUsedAt?.toISOString() ?? null,
          lastValidatedAt: conn.lastValidatedAt?.toISOString() ?? null,
          configured: isConfigured,
          tier,
          connectedAt: conn.createdAt.toISOString(),
        });
      } else {
        views.push({
          id: 'not-connected',
          platform: adapter.platform,
          type: adapter.kind === 'OAUTH' ? 'OAUTH' : 'API_KEY',
          platformUsername: null,
          platformAccountId: 'not-connected',
          status: 'ACTIVE',
          scopes: [],
          lastUsedAt: null,
          lastValidatedAt: null,
          configured: isConfigured,
          tier,
          connectedAt: 'not-connected',
        });
      }
    }
    return views;
  }

  /**
   * Save an OAuth connection (after code exchange).
   * Called by the OAuth callback handler in Phase 4.
   */
  async saveOAuthConnection(params: {
    userId: string;
    platform: Platform;
    tokens: OAuthTokens;
    identity: PlatformIdentity;
    audit?: AuditContext;
  }): Promise<{ id: string; platformUsername: string }> {
    const adapter = this._adapters.requireConfigured(params.platform);
    if (adapter.kind !== 'OAUTH') {
      throw new ServiceError(
        'VALIDATION_ERROR',
        `${params.platform} is not an OAuth platform — use saveSimpleConnection instead`
      );
    }
    const credentials: AdapterCredentials = {
      accessToken: params.tokens.accessToken,
      refreshToken: params.tokens.refreshToken,
      expiresAt: params.tokens.expiresAt,
      scopes: params.tokens.scopes ?? [],
      // LinkedIn stores memberId; X stores userId; Reddit doesn't need it
      ...(params.identity.id ? { memberId: params.identity.id, userId: params.identity.id } : {}),
    };
    const cipher = this._vault.encrypt(credentials);
    const conn = await this._repo.upsert({
      userId: params.userId,
      platform: params.platform,
      type: 'OAUTH',
      platformAccountId: params.identity.id,
      platformUsername: params.identity.username,
      credentialsCipher: cipher,
      scopes: params.tokens.scopes ?? [],
    });
    await this._audit.log({
      userId: params.userId,
      action: 'CONNECT',
      platform: params.platform,
      ip: params.audit?.ip,
      userAgent: params.audit?.userAgent,
      metadata: { username: params.identity.username },
    });
    return { id: conn.id, platformUsername: conn.platformUsername ?? '' };
  }

  /**
   * Validate + save a SIMPLE credential connection (Discord, Dev.to,
   * Hashnode, Telegram, Bluesky).
   */
  async saveSimpleConnection(
    userId: string,
    platform: Platform,
    rawInput: unknown,
    audit: AuditContext = {}
  ): Promise<{ id: string; username: string }> {
    const adapter = this._adapters.get(platform);
    if (adapter.kind !== 'SIMPLE') {
      throw new ServiceError(
        'VALIDATION_ERROR',
        `${platform} is not a SIMPLE-credential platform`
      );
    }
    if (!adapter.validateCredentials) {
      throw new ServiceError('INTERNAL', `${platform} adapter missing validateCredentials`);
    }

    // Zod-validate the input shape per-platform
    let parsedInput: Record<string, string>;
    switch (platform) {
      case 'DEVTO':
        parsedInput = CONNECT_DEVTO_SCHEMA.parse(rawInput) as Record<string, string>;
        break;
      case 'DISCORD':
        parsedInput = CONNECT_DISCORD_SCHEMA.parse(rawInput) as Record<string, string>;
        break;
      case 'TELEGRAM':
        parsedInput = CONNECT_TELEGRAM_SCHEMA.parse(rawInput) as Record<string, string>;
        break;
      case 'BLUESKY':
        parsedInput = CONNECT_BLUESKY_SCHEMA.parse(rawInput) as Record<string, string>;
        break;
      case 'HASHNODE':
        parsedInput = CONNECT_HASHNODE_SCHEMA.parse(rawInput) as Record<string, string>;
        break;
      default:
        throw new ServiceError(
          'VALIDATION_ERROR',
          `${platform} is not a SIMPLE-credential platform`
        );
    }

    // Validate via the adapter (real HTTP call to platform's identity endpoint)
    let validation: { identity: PlatformIdentity; credentials: AdapterCredentials };
    try {
      validation = await adapter.validateCredentials(parsedInput);
    } catch (e) {
      // PublishError from adapter → map to ServiceError by error class
      if (e instanceof PublishError) {
        await this._audit.log({
          userId,
          action: 'TOKEN_FAIL',
          platform,
          ip: audit.ip,
          userAgent: audit.userAgent,
          metadata: { errorClass: e.errorClass, message: e.message },
        });
        // Surface the platform's actual error message per FR-005/006/007/008
        throw new ServiceError(
          e.errorClass === 'AUTH' ? 'INVALID_CREDENTIALS' : 'VALIDATION_ERROR',
          e.message
        );
      }
      throw e;
    }

    // Encrypt + store
    const cipher = this._vault.encrypt(validation.credentials);
    const conn = await this._repo.upsert({
      userId,
      platform,
      type: connectionTypeFor(platform),
      platformAccountId: validation.identity.id,
      platformUsername: validation.identity.username,
      credentialsCipher: cipher,
      scopes: [], // SIMPLE adapters have no OAuth scopes
    });
    await this._audit.log({
      userId,
      action: 'CONNECT',
      platform,
      ip: audit.ip,
      userAgent: audit.userAgent,
      metadata: { username: validation.identity.username },
    });
    return { id: conn.id, username: validation.identity.username };
  }

  /**
   * Disconnect a platform — hard-delete the Connection row.
   * Per docs/02-SRS.md FR-010: ciphertext gone.
   */
  async disconnect(
    userId: string,
    platform: Platform,
    audit: AuditContext = {}
  ): Promise<void> {
    const existing = await this._repo.findByPlatform(userId, platform);
    if (!existing) {
      throw new ServiceError('NOT_FOUND', `No connection found for ${platform}`);
    }
    await this._repo.deleteByPlatform(userId, platform);
    await this._audit.log({
      userId,
      action: 'DISCONNECT',
      platform,
      ip: audit.ip,
      userAgent: audit.userAgent,
    });
  }

  /**
   * Get the decrypted credentials for a user's connection. Used ONLY by
   * the publish worker (Phase 5). The decrypted value never leaves this
   * service's memory.
   */
  async getDecryptedCredentials(userId: string, platform: Platform): Promise<AdapterCredentials | null> {
    const conn = await this._repo.findByPlatform(userId, platform);
    if (!conn) return null;
    if (conn.status === 'REVOKED') {
      throw new ServiceError(
        'INVALID_CREDENTIALS',
        `${platform} connection is revoked — user must reconnect`
      );
    }
    return this._vault.decrypt(conn.credentialsCipher) as AdapterCredentials;
  }
}

/**
 * Tier A = live in MVP (instant setup): Reddit, Discord, Dev.to, Telegram,
 *   Bluesky, Hashnode
 * Tier B = bonus attempts (work if creds configured): X, LinkedIn
 */
function isTierB(platform: Platform): boolean {
  return platform === 'TWITTER' || platform === 'LINKEDIN';
}

/**
 * Map a platform to its ConnectionType enum value.
 */
function connectionTypeFor(
  platform: Platform
): 'OAUTH' | 'API_KEY' | 'WEBHOOK' | 'BOT_TOKEN' | 'APP_PASSWORD' {
  switch (platform) {
    case 'REDDIT':
    case 'TWITTER':
    case 'LINKEDIN':
      return 'OAUTH';
    case 'DEVTO':
    case 'HASHNODE':
      return 'API_KEY';
    case 'DISCORD':
      return 'WEBHOOK';
    case 'TELEGRAM':
      return 'BOT_TOKEN';
    case 'BLUESKY':
      return 'APP_PASSWORD';
    default:
      // Exhaustiveness check — TypeScript will error if a new platform is added
      const _exhaustive: never = platform;
      throw new Error(`Unknown platform: ${_exhaustive}`);
  }
}
