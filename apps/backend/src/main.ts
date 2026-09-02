import compression from 'compression';

import { loadSwagger } from '@netamplify/helpers/swagger/load.swagger';
import { json } from 'express';

process.env.TZ = 'UTC';

import cookieParser from 'cookie-parser';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from '@netamplify/nestjs-libraries/services/exception.filter';
import { ConfigurationChecker } from '@netamplify/helpers/configuration/configuration.checker';

/**
 * NetAmplify Phase 1 (minimal): backend entry point.
 *
 * Removed in Phase 1: Sentry init, Temporal Runtime.install,
 *   startMcp (CopilotKit), SubscriptionExceptionFilter, PostValidationExceptionFilter,
 *   CopilotKit-specific CORS headers.
 *
 * Phase 2 will add: Passport LocalStrategy + JwtStrategy wiring,
 *   /api/health endpoint returning { db: "up", redis: "up" }.
 * Phase 4-5 will add: PostCard, Connections, Publish controllers + their filters.
 */
async function start() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    cors: {
      ...(!process.env.NOT_SECURED ? { credentials: true } : {}),
      allowedHeaders: ['Content-Type', 'Authorization', 'auth'],
      exposedHeaders: [
        'reload',
        'onboarding',
        'activate',
        ...(process.env.NOT_SECURED ? ['auth'] : []),
      ],
      origin: [
        process.env.FRONTEND_URL,
        ...(process.env.MAIN_URL ? [process.env.MAIN_URL] : []),
      ],
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    })
  );

  app.use(cookieParser());
  app.use(compression());
  app.useGlobalFilters(new HttpExceptionFilter());

  loadSwagger(app);

  const port = process.env.PORT || 3000;

  try {
    await app.listen(port);
    console.log('Backend started successfully on port ' + port);

    checkConfiguration();

    Logger.log(`🚀 Backend is running on: http://localhost:${port}`);
  } catch (e) {
    Logger.error(`Backend failed to start on port ${port}`, e);
  }
}

function checkConfiguration() {
  const checker = new ConfigurationChecker();
  checker.readEnvFromProcess();
  checker.check();

  if (checker.hasIssues()) {
    for (const issue of checker.getIssues()) {
      Logger.warn(issue, 'Configuration issue');
    }

    Logger.warn('Configuration issues found: ' + checker.getIssuesCount());
  } else {
    Logger.log('Configuration check completed without any issues');
  }
}

start();
