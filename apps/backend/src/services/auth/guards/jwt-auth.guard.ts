// /home/z/my-project/netamplify-app/apps/backend/src/services/auth/guards/jwt-auth.guard.ts
// NetAmplify — JwtAuthGuard (applies AuthGuard('jwt') to protected routes).
//
// Per docs/05-API-SPEC.md: every /api/* route except /api/auth/* and
// /api/health is JWT-protected.

import { Injectable, ExecutionContext, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly _logger = new Logger('JwtAuthGuard');

  /**
   * Override handleRequest so unauthenticated requests throw a typed
   * ServiceError (mapped to 401 by errorMapper) instead of the default
   * UnauthorizedException with no body.
   */
  handleRequest<TUser = unknown>(
    err: unknown,
    user: unknown,
    info: unknown,
    context: ExecutionContext,
    _status?: unknown
  ): TUser {
    if (err || !user) {
      // Log WHY the auth failed — without this, the backend stays
      // completely silent on 401s, which makes debugging very hard.
      // `info` contains the JWT validation error (e.g. "jwt expired",
      // "No auth token", "invalid signature").
      const req = context.switchToHttp().getRequest();
      const method = req?.method || '?';
      const url = req?.url || '?';
      const reason = info instanceof Error ? info.message : String(info || 'unknown');
      this._logger.warn(`${method} ${url} → 401 (${reason})`);
      throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
    }
    return user as TUser;
  }
}
