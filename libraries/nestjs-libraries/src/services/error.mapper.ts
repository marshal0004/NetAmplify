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
  PayloadTooLargeException,
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

  // MulterError — thrown by @nestjs/platform-express FileInterceptor when an
  // upload violates a multer limit (file too large, too many files, unexpected
  // field name, etc.). Detected by duck-type (name + LIMIT_ code prefix) so
  // this library doesn't take a hard `multer` dependency — the errorMapper is
  // used across the whole app, and not every consumer imports multer.
  if (
    error instanceof Error &&
    error.name === 'MulterError' &&
    typeof (error as unknown as { code?: unknown }).code === 'string' &&
    ((error as unknown as { code: string }).code).startsWith('LIMIT_')
  ) {
    const multerError = error as unknown as { code: string; message: string };
    // LIMIT_FILE_SIZE → 413 Payload Too Large (the file exceeded
    // MAX_FILE_SIZE — multer aborted the stream mid-upload).
    if (multerError.code === 'LIMIT_FILE_SIZE') {
      const maxMb = parseInt(process.env.MAX_UPLOAD_SIZE_MB || '50', 10);
      return new PayloadTooLargeException({
        error: {
          code: 'VALIDATION_ERROR',
          message: `File too large. Max size: ${maxMb}MB`,
        },
      });
    }
    // LIMIT_UNEXPECTED_FILE (wrong field name), LIMIT_PART_COUNT,
    // LIMIT_FIELD_KEY, etc. → 400 Bad Request.
    return new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message:
          multerError.message ||
          'Upload validation failed — check the field name ("file") and file format.',
      },
    });
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
