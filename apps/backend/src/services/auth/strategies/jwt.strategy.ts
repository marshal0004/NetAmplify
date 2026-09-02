// /home/z/my-project/netamplify-app/apps/backend/src/services/auth/strategies/jwt.strategy.ts
// NetAmplify — Passport JwtStrategy for protected routes.
//
// Reads the Bearer token from the Authorization header, verifies the JWT,
// and returns the decoded payload. AuthGuard('jwt') uses this to populate
// `req.user`.
//
// Per docs/02-SRS.md FR-001: 7-day expiry, HS256 signature, JWT_SECRET from env.

import { Strategy, ExtractJwt } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { AuthService, type JwtPayload } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly _auth: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
      algorithms: ['HS256'],
    });
  }

  /**
   * Called by AuthGuard('jwt') after the JWT is verified. Returns the
   * payload that gets attached to `req.user`.
   *
   * We extend the payload with the current user record (loaded from DB) so
   * downstream handlers always have fresh user data — even if the user was
   * renamed/deleted since the token was issued. If the user is gone, throw
   * to fail the strategy (NestJS maps to 401).
   */
  async validate(payload: JwtPayload): Promise<{
    id: string;
    email: string;
    name: string;
  }> {
    if (!payload.sub) {
      throw new Error('JWT payload missing sub (user id)');
    }
    const user = await this._auth.getCurrentUser(payload.sub);
    if (!user) {
      throw new Error('User no longer exists');
    }
    return user;
  }
}
