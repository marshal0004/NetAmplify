// /home/z/my-project/netamplify-app/apps/backend/src/services/auth/strategies/local.strategy.ts
// NetAmplify — Passport LocalStrategy for login (email + password).
//
// Wraps AuthService.login() into the Passport Strategy interface so
// AuthGuard('local') can use it. Throws ServiceError → NestJS maps to 401.
//
// Per docs/02-SRS.md FR-001 (with C5-A deviation: NestJS Passport + JWT
// instead of NextAuth — same security properties).

import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, Inject } from '@nestjs/common';
import { AuthService } from '../auth.service';

interface LocalStrategyVerifyInput {
  email: string;
  password: string;
}

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(@Inject(AuthService) private readonly _auth: AuthService) {
    super({
      usernameField: 'email',
      passwordField: 'password',
    });
  }

  /**
   * Called by AuthGuard('local') when a request hits a /login route.
   * Returns the authenticated user (used by the route handler to issue JWT)
   * or throws to fail the strategy.
   *
   * We delegate the actual auth to AuthService.login() so the same logic
   * is reusable from non-Passport contexts (tests, scripts).
   */
  async validate(email: string, password: string): Promise<unknown> {
    // AuthService.login returns AuthResult; Passport expects the user payload.
    // We return the user object; the controller will then issue the JWT
    // via AuthService.issueToken (or use the result directly).
    const result = await this._auth.login({ email, password });
    return result;
  }
}
