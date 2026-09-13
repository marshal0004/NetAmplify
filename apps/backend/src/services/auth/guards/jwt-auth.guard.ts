// /home/z/my-project/netamplify-app/apps/backend/src/services/auth/guards/jwt-auth.guard.ts
// NetAmplify — JwtAuthGuard (applies AuthGuard('jwt') to protected routes).
//
// Per docs/05-API-SPEC.md: every /api/* route except /api/auth/* and
// /api/health is JWT-protected.

import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ServiceError } from '@netamplify/nestjs-libraries/services/error.mapper';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /**
   * Override handleRequest so unauthenticated requests throw a typed
   * ServiceError (mapped to 401 by errorMapper) instead of the default
   * UnauthorizedException with no body.
   */
  handleRequest<TUser = unknown>(
    err: unknown,
    user: unknown,
    _info: unknown,
    _context: ExecutionContext,
    _status?: unknown
  ): TUser {
    if (err || !user) {
      throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
    }
    return user as TUser;
  }
}
