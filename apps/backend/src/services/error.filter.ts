// /home/z/my-project/netamplify-app/apps/backend/src/services/error.filter.ts
// NetAmplify — Global exception filter that maps ServiceError + ZodError → HTTP.
// 
// Without this, ServiceError thrown by JwtAuthGuard.handleRequest (and other
// places that bypass NestJS's controllers) would surface as 500 INTERNAL.
// 
// Per docs/05-API-SPEC.md error envelope:
//   { error: { code, message, fieldErrors? } }

import {
  Catch, ExceptionFilter, ArgumentsHost, HttpException, HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ZodError } from 'zod';
import { ServiceError, errorMapper } from '@netamplify/nestjs-libraries/services/error.mapper';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    
    // Use the existing errorMapper to do the heavy lifting
    const httpException = errorMapper(exception);
    const status = httpException.getStatus();
    const body = httpException.getResponse();
    
    response.status(status).json(body);
  }
}
