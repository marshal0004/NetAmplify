// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/database/prisma/audit/audit.service.ts
// NetAmplify — AuditLogService (security audit trail).
//
// Per docs/02-SRS.md FR-017: writes one row for each LOGIN, LOGIN_FAIL,
// CONNECT, DISCONNECT, PUBLISH, RETRY, TOKEN_FAIL, ACCOUNT_DELETE action.
// NEVER stores credentials or decrypted content.
//
// metadata is a free-form JSON object — callers MUST sanitize any
// platform tokens, passwords, or PII before passing it. Use the helper
// `sanitizeMetadata()` below.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Prisma } from '@prisma/client';

/**
 * Audit action codes (see docs/02-SRS.md FR-017).
 */
export type AuditAction =
  | 'LOGIN'
  | 'LOGIN_FAIL'
  | 'CONNECT'
  | 'DISCONNECT'
  | 'PUBLISH'
  | 'RETRY'
  | 'TOKEN_FAIL'
  | 'ACCOUNT_DELETE';

/**
 * Redact any keys that look like credentials before persisting metadata.
 * Conservative: anything containing "token", "secret", "password", "key",
 * "cipher", "hash", "auth" (case-insensitive) is replaced with [REDACTED].
 */
const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /\bkey\b/i,
  /cipher/i,
  /hash/i,
  /\bauth\b/i,
  /cookie/i,
  /credential/i,
];

export function sanitizeMetadata(input: unknown): Prisma.InputJsonValue {
  if (input === null || input === undefined) {
    return {} as Prisma.InputJsonValue;
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    // Primitives are returned as-is (numbers, booleans, strings without
    // redaction — caller must ensure no secrets are passed as primitives).
    return input as Prisma.InputJsonValue;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERNS.some((p) => p.test(k))) {
      sanitized[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      sanitized[k] = sanitizeMetadata(v);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized as Prisma.InputJsonValue;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly _prisma: PrismaService) {}

  /**
   * Write one audit row. Throws if DB write fails (fail-closed: better
   * to deny the action than to allow it un-audited, per security stance).
   */
  async log(params: {
    userId?: string | null;
    action: AuditAction;
    platform?: string;
    ip?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this._prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        platform: params.platform,
        ip: params.ip,
        userAgent: params.userAgent,
        metadata: sanitizeMetadata(params.metadata ?? {}),
      },
    });
  }
}
