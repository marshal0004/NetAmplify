import * as Sentry from '@sentry/nextjs';
import { initializeSentryBasic } from '@netamplify/react/sentry/initialize.sentry.next.basic';

export const initializeSentryServer = (environment: string, dsn: string) =>
  initializeSentryBasic(environment, dsn, {});
