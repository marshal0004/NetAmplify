// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/database/prisma/connections/connections.repository.ts
// NetAmplify — ConnectionRepository (single point of access for Connection table).
//
// Per docs/07-SECURITY-ACCESS.md §3 R3: "Publish validates: postCard.userId
// == session.user AND every requested platform has that user's ACTIVE
// connection — server-side, every time."
//
// All methods take userId as the FIRST argument and scope every query by
// it. No unscoped reads of Connection.

import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Connection, Platform, Prisma } from '@prisma/client';

@Injectable()
export class ConnectionRepository {
  constructor(@Inject(PrismaService) private readonly _prisma: PrismaService) {}

  /**
   * Find all connections for a user. NEVER returns credentialsCipher —
   * we select only the safe columns. Per docs/07-SECURITY-ACCESS.md §3 R2:
   * "Connection credentials: selected ONLY inside TokenVault consumers.
   * API responses build from a whitelist projection — never select *."
   */
  async listByUser(userId: string): Promise<
    Array<
      Omit<Connection, 'credentialsCipher'> & { credentialsCipher: undefined }
    >
  > {
    const conns = await this._prisma.connection.findMany({
      where: { userId },
      // Explicit projection — never select credentialsCipher here
      select: {
        id: true,
        userId: true,
        platform: true,
        type: true,
        platformAccountId: true,
        platformUsername: true,
        scopes: true,
        status: true,
        lastUsedAt: true,
        lastValidatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    // Make credentialsCipher field explicitly undefined for type-safety
    return conns.map((c) => ({ ...c, credentialsCipher: undefined }));
  }

  /**
   * Find a user's connection for a specific platform.
   * Returns the full Connection row INCLUDING credentialsCipher (used only
   * by TokenVault consumers — workers, publish service, connect validation).
   */
  async findByPlatform(userId: string, platform: Platform): Promise<Connection | null> {
    return this._prisma.connection.findUnique({
      where: { userId_platform: { userId, platform } },
    });
  }

  /**
   * Upsert a connection. Used by both OAuth flows (after code exchange)
   * and SIMPLE flows (after credential validation). Hard-deletes any
   * existing connection for the same user+platform before creating a new
   * one (preserves id uniqueness + avoids stale credentials).
   *
   * Per docs/02-SRS.md FR-008 edge cases: "Same platform reconnected with
   * different account → upsert, old ciphertext overwritten, username
   * updated."
   */
  async upsert(data: {
    userId: string;
    platform: Platform;
    type:
      | 'OAUTH'
      | 'API_KEY'
      | 'WEBHOOK'
      | 'BOT_TOKEN'
      | 'APP_PASSWORD';
    platformAccountId: string;
    platformUsername?: string;
    credentialsCipher: string;
    scopes: string[];
  }): Promise<Connection> {
    return this._prisma.connection.upsert({
      where: { userId_platform: { userId: data.userId, platform: data.platform } },
      create: {
        userId: data.userId,
        platform: data.platform,
        type: data.type,
        platformAccountId: data.platformAccountId,
        platformUsername: data.platformUsername,
        credentialsCipher: data.credentialsCipher,
        scopes: data.scopes,
      },
      update: {
        type: data.type,
        platformAccountId: data.platformAccountId,
        platformUsername: data.platformUsername,
        credentialsCipher: data.credentialsCipher,
        scopes: data.scopes,
        status: 'ACTIVE',
        lastValidatedAt: new Date(),
      },
    });
  }

  /**
   * Hard-delete a user's connection for a platform. Per docs/02-SRS.md
   * FR-010: "Hard-delete Connection row (ciphertext gone)."
   */
  async deleteByPlatform(userId: string, platform: Platform): Promise<void> {
    await this._prisma.connection.deleteMany({
      where: { userId, platform },
    });
  }

  /**
   * Mark a connection as REVOKED (detected on publish AUTH failure).
   * Per docs/02-SRS.md FR-010: "Revoked-on-platform detection: adapter
   * call fails with auth error → mark Connection REVOKED."
   */
  async markRevoked(userId: string, platform: Platform): Promise<void> {
    await this._prisma.connection.update({
      where: { userId_platform: { userId, platform } },
      data: { status: 'REVOKED' },
    });
  }

  /**
   * Update lastUsedAt timestamp (called after each successful publish).
   */
  async touchUsed(userId: string, platform: Platform): Promise<void> {
    await this._prisma.connection.update({
      where: { userId_platform: { userId, platform } },
      data: { lastUsedAt: new Date() },
    });
  }
}
