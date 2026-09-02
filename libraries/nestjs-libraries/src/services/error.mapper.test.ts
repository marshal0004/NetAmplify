// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/services/error.mapper.test.ts
// Vitest unit tests for errorMapper — pure function, no mocks.

import { describe, it, expect } from 'vitest';
import {
  HttpException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { SIGNUP_SCHEMA } from '../validation/schemas';
import {
  ServiceError,
  errorMapper,
} from './error.mapper';

describe('errorMapper', () => {
  it('passes HttpException through unchanged', () => {
    const original = new BadRequestException('already http');
    const result = errorMapper(original);
    expect(result).toBe(original);
  });

  it('maps ZodError → 400 with fieldErrors', () => {
    const result = SIGNUP_SCHEMA.safeParse({ email: 'not-email', password: 'weak', name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const http = errorMapper(result.error);
      expect(http).toBeInstanceOf(BadRequestException);
      expect(http.getStatus()).toBe(400);
      const body = (http.getResponse() as { error: { code: string; message: string; fieldErrors: Record<string, string> } });
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.fieldErrors).toBeDefined();
      expect(Object.keys(body.error.fieldErrors).length).toBeGreaterThan(0);
    }
  });

  it('maps VALIDATION_ERROR ServiceError → 400', () => {
    const http = errorMapper(new ServiceError('VALIDATION_ERROR', 'bad input'));
    expect(http.getStatus()).toBe(400);
    expect((http.getResponse() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('maps UNAUTHENTICATED → 401', () => {
    const http = errorMapper(new ServiceError('UNAUTHENTICATED', 'not logged in'));
    expect(http).toBeInstanceOf(UnauthorizedException);
    expect(http.getStatus()).toBe(401);
  });

  it('maps FORBIDDEN → 403', () => {
    const http = errorMapper(new ServiceError('FORBIDDEN', 'no access'));
    expect(http).toBeInstanceOf(ForbiddenException);
    expect(http.getStatus()).toBe(403);
  });

  it('maps NOT_FOUND → 404', () => {
    const http = errorMapper(new ServiceError('NOT_FOUND', 'missing'));
    expect(http).toBeInstanceOf(NotFoundException);
    expect(http.getStatus()).toBe(404);
  });

  it('maps CONFLICT → 409', () => {
    const http = errorMapper(new ServiceError('CONFLICT', 'conflict'));
    expect(http).toBeInstanceOf(ConflictException);
    expect(http.getStatus()).toBe(409);
  });

  it('maps EMAIL_TAKEN → 409 with friendly message', () => {
    const http = errorMapper(new ServiceError('EMAIL_TAKEN', 'email exists'));
    expect(http.getStatus()).toBe(409);
    const body = (http.getResponse() as { error: { message: string } });
    expect(body.error.message).toContain('already exists');
  });

  it('maps INVALID_CREDENTIALS → 401 (no email enumeration)', () => {
    const http = errorMapper(new ServiceError('INVALID_CREDENTIALS', 'wrong pw'));
    expect(http).toBeInstanceOf(UnauthorizedException);
    const body = (http.getResponse() as { error: { message: string } });
    expect(body.error.message).toBe('Invalid email or password');
  });

  it('maps INVALID_TOKEN → 400', () => {
    const http = errorMapper(new ServiceError('INVALID_TOKEN', 'bad reset token'));
    expect(http.getStatus()).toBe(400);
  });

  it('maps TOKEN_EXPIRED → 401', () => {
    const http = errorMapper(new ServiceError('TOKEN_EXPIRED', 'expired'));
    expect(http.getStatus()).toBe(401);
  });

  it('maps RATE_LIMITED → 429', () => {
    const http = errorMapper(new ServiceError('RATE_LIMITED', 'slow down'));
    expect(http.getStatus()).toBe(429);
  });

  it('maps OAUTH_EXCHANGE_FAILED → 502', () => {
    const http = errorMapper(new ServiceError('OAUTH_EXCHANGE_FAILED', 'reddit failed'));
    expect(http.getStatus()).toBe(502);
  });

  it('maps BAD_STATE → 400 with security message', () => {
    const http = errorMapper(new ServiceError('BAD_STATE', 'state mismatch'));
    expect(http.getStatus()).toBe(400);
    const body = (http.getResponse() as { error: { message: string } });
    expect(body.error.message).toContain('Security check failed');
  });

  it('maps PLATFORM_NOT_CONFIGURED → 404', () => {
    const http = errorMapper(new ServiceError('PLATFORM_NOT_CONFIGURED', 'not set'));
    expect(http).toBeInstanceOf(NotFoundException);
  });

  it('maps QUOTA_EXCEEDED → 422', () => {
    const http = errorMapper(new ServiceError('QUOTA_EXCEEDED', 'X quota used'));
    expect(http.getStatus()).toBe(422);
  });

  it('maps INTERNAL + unknown errors → 500', () => {
    const http1 = errorMapper(new ServiceError('INTERNAL', 'oh no'));
    expect(http1.getStatus()).toBe(500);
    const http2 = errorMapper(new Error('unexpected'));
    expect(http2.getStatus()).toBe(500);
  });

  it('includes fieldErrors in the envelope when present', () => {
    const http = errorMapper(
      new ServiceError('VALIDATION_ERROR', 'bad', { email: 'invalid format' })
    );
    const body = (http.getResponse() as { error: { fieldErrors: Record<string, string> } });
    expect(body.error.fieldErrors).toEqual({ email: 'invalid format' });
  });
});
