// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/services/error.mapper.ts
// NetAmplify — error mapper (single source of truth for service errors → HTTP).
//
// Per docs/08-CODING-STANDARDS.md: "routes = guard → Zod → service → errorMapper".
// Services throw typed errors; the mapper translates them to NestJS
// HttpException. The error envelope is per docs/05-API-SPEC.md:
//   { error: { code: "VALIDATION_ERROR", message: "...", fieldErrors?: {...} } }

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ZodError } from 'zod';

/**
 * Service-level error codes (transport-agnostic; mapped to HTTP here).
 */
export type ServiceErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'RATE_LIMITED'
  | 'OAUTH_EXCHANGE_FAILED'
  | 'BAD_STATE'
  | 'PLATFORM_NOT_CONFIGURED'
  | 'QUOTA_EXCEEDED'
  | 'INTERNAL';

/**
 * ServiceError — thrown by services, caught by errorMapper.
 */
export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

/**
 * Map a ServiceError or ZodError to an HttpException with the standard
 * error envelope body.
 *
 * Usage in route handlers:
 *   try { ... }
 *   catch (e) { throw errorMapper(e); }
 */
export function errorMapper(error: unknown): HttpException {
  // Already an HttpException — pass through.
  if (error instanceof HttpException) {
    return error;
  }

  // Zod validation error → 400 with field errors.
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.') || '_';
      if (!fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'One or more fields are invalid',
        fieldErrors,
      },
    });
  }

  // ServiceError → map code → HTTP
  if (error instanceof ServiceError) {
    const body = (message: string) => ({
      error: {
        code: error.code,
        message,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      },
    });

    switch (error.code) {
      case 'VALIDATION_ERROR':
        return new BadRequestException(body(error.message));
      case 'UNAUTHENTICATED':
        return new UnauthorizedException(body(error.message));
      case 'FORBIDDEN':
        return new ForbiddenException(body(error.message));
      case 'NOT_FOUND':
        return new NotFoundException(body(error.message));
      case 'CONFLICT':
        return new ConflictException(body(error.message));
      case 'EMAIL_TAKEN':
        return new ConflictException(
          body('An account with this email already exists')
        );
      case 'INVALID_CREDENTIALS':
        return new UnauthorizedException(body('Invalid email or password'));
      case 'INVALID_TOKEN':
        return new BadRequestException(body(error.message));
      case 'TOKEN_EXPIRED':
        return new UnauthorizedException(body(error.message));
      case 'RATE_LIMITED':
        return new HttpException(
          {
            status: 429,
            ...body(error.message),
          },
          429
        );
      case 'OAUTH_EXCHANGE_FAILED':
        return new HttpException(
          {
            status: 502,
            ...body(error.message),
          },
          502
        );
      case 'BAD_STATE':
        return new BadRequestException(
          body('Security check failed — please reconnect')
        );
      case 'PLATFORM_NOT_CONFIGURED':
        return new NotFoundException(
          body('This platform is not configured on the server')
        );
      case 'QUOTA_EXCEEDED':
        return new UnprocessableEntityException(body(error.message));
      case 'INTERNAL':
      default:
        return new HttpException(
          {
            status: 500,
            error: {
              code: 'INTERNAL',
              message:
                'An unexpected error occurred. Please try again or contact support.',
            },
          },
          500
        );
    }
  }

  // Unknown error — log + 500.
  console.error('Unhandled error:', error);
  return new HttpException(
    {
      status: 500,
      error: {
        code: 'INTERNAL',
        message:
          'An unexpected error occurred. Please try again or contact support.',
      },
    },
    500
  );
}
