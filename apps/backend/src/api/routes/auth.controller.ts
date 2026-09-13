// /home/z/my-project/netamplify-app/apps/backend/src/api/routes/auth.controller.ts
// NetAmplify — AuthController (signup, login, logout, me, reset-request, reset-confirm, account-delete).
//
// Per docs/05-API-SPEC.md:
//   POST /api/auth/signup         { email, password, name }
//   POST /api/auth/login          { email, password }
//   POST /api/auth/logout         (no body — clears cookie in future)
//   GET  /api/auth/me             (JWT-required)
//   POST /api/auth/reset-request  { email }   → always 204
//   POST /api/auth/reset-confirm  { token, newPassword }
//   DELETE /api/account           (JWT-required; cascades)
//
// All inputs are Zod-validated server-side; all errors are routed through
// errorMapper for the standard envelope.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards, Inject } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type AuditContext, type AuthResult } from '@netamplify/backend/services/auth/auth.service';
import { JwtAuthGuard } from '@netamplify/backend/services/auth/guards/jwt-auth.guard';
import { errorMapper, ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';

/**
 * Attach user + audit context from request.
 */
function getAuditContext(req: Request): AuditContext {
  return {
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
    userAgent: req.headers['user-agent'],
  };
}

/**
 * Get the authenticated user id from req.user (set by JwtAuthGuard).
 */
function getUserId(req: Request): string {
  const user = req.user as { id?: string } | undefined;
  if (!user?.id) {
    throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
  }
  return user.id;
}

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly _auth: AuthService) {}

  /**
   * POST /api/auth/signup
   * Body: { email, password, name }
   * Returns 201 { user: { id, email, name }, accessToken, expiresAt }
   * Errors: 400 (validation), 409 (EMAIL_TAKEN)
   */
  @Post('signup')
  @HttpCode(201)
  async signup(@Body() body: unknown, @Req() req: Request): Promise<AuthResult> {
    try {
      return await this._auth.signup(body, getAuditContext(req));
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * POST /api/auth/login
   * Body: { email, password }
   * Returns 200 { user: { id, email, name }, accessToken, expiresAt }
   * Errors: 400 (validation), 401 (INVALID_CREDENTIALS)
   */
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request): Promise<AuthResult> {
    try {
      return await this._auth.login(body, getAuditContext(req));
    } catch (e) {
      throw errorMapper(e);
    }
  }

  /**
   * POST /api/auth/logout
   * Returns 204 (no-op in JWT-without-cookies model; client deletes token)
   * Phase 5+ may add refresh-token revocation list.
   */
  @Post('logout')
  @HttpCode(204)
  async logout(): Promise<void> {
    return;
  }

  /**
   * GET /api/auth/me
   * Returns 200 { id, email, name }
   * Errors: 401 (UNAUTHENTICATED)
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async me(@Req() req: Request): Promise<{ id: string; email: string; name: string }> {
    const userId = getUserId(req);
    const user = await this._auth.getCurrentUser(userId);
    if (!user) {
      throw errorMapper(new ServiceError('UNAUTHENTICATED', 'Authentication required'));
    }
    return user;
  }

  /**
   * POST /api/auth/reset-request
   * Body: { email }
   * Returns 204 always (no email enumeration).
   * Side effect: if email exists, generate + persist a 1h reset token and
   * send it via EmailService. In dev (no EMAIL_PROVIDER), log to console.
   */
  @Post('reset-request')
  @HttpCode(204)
  async resetRequest(@Body() body: unknown, @Req() req: Request): Promise<void> {
    try {
      const token = await this._auth.requestPasswordReset(body, getAuditContext(req));
      if (token !== null) {
        // Phase 2 will wire EmailService here for production email.
        // For dev (no EMAIL_PROVIDER set), log the reset link to console.
        if (process.env.EMAIL_PROVIDER === 'resend') {
          // TODO Phase 2.5: call EmailService.sendEmailSync(to, subject, html)
          // For now, log to console to support local testing without email infra.
          console.log(`[DEV] Password reset link: ${process.env.PUBLIC_APP_URL || 'http://localhost:3000'}/reset?token=${token}`);
        } else {
          console.log(`[DEV] Password reset link: ${process.env.PUBLIC_APP_URL || 'http://localhost:3000'}/reset?token=${token}`);
        }
      }
    } catch (e) {
      // Don't leak validation errors either — return 204 for malformed emails too
      // (the client can validate locally; we don't reveal server-side errors).
      if (e instanceof ServiceError && e.code === 'VALIDATION_ERROR') {
        return;
      }
      throw errorMapper(e);
    }
  }

  /**
   * POST /api/auth/reset-confirm
   * Body: { token, newPassword }
   * Returns 204 on success.
   * Errors: 400 (validation), 400 (INVALID_TOKEN).
   */
  @Post('reset-confirm')
  @HttpCode(204)
  async resetConfirm(@Body() body: unknown, @Req() req: Request): Promise<void> {
    try {
      await this._auth.confirmPasswordReset(body, getAuditContext(req));
    } catch (e) {
      throw errorMapper(e);
    }
  }
}

/**
 * AccountController — separate controller for DELETE /api/account.
 * Per docs/05-API-SPEC.md: DELETE /api/account cascades user data.
 */
@Controller('api/account')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(@Inject(AuthService) private readonly _auth: AuthService) {}

  @Delete()
  @HttpCode(204)
  async deleteAccount(@Req() req: Request): Promise<void> {
    try {
      await this._auth.deleteAccount(getUserId(req), getAuditContext(req));
    } catch (e) {
      throw errorMapper(e);
    }
  }
}
