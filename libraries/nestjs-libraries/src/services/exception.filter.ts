// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/services/exception.filter.ts
// NetAmplify HttpExceptionFilter — catches HttpForbiddenException and
// returns 401. The auth-middleware dep was removed in Phase 1 (the
// middleware referenced deleted modules); Phase 2 will reintroduce a
// LocalStrategy-based AuthMiddleware with a proper removeAuth() helper.

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException, Inject } from '@nestjs/common';
import { Response } from 'express';

export class HttpForbiddenException extends HttpException {
  constructor() {
    super('Forbidden', 403);
  }
}

@Catch(HttpForbiddenException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpForbiddenException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    // Phase 2 will add: removeAuth(response) to clear the JWT cookie.
    return response.status(401).send();
  }
}
