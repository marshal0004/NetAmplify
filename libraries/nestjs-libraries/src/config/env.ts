// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/config/env.ts
// NetAmplify — typed env module (single source of truth for env access).
//
// Per docs/08-CODING-STANDARDS.md: "Env access through one typed env module".
// Per docs/03-ARCHITECTURE.md: "app fails fast at boot if a required one
// is missing."
//
// This module reads process.env ONCE at import time, validates the required
// keys, and exports a typed `env` object. Missing required keys throw a
// descriptive Error at boot. Optional keys are `undefined` when not set.

/**
 * Required env vars — app will not boot without these.
 */
const REQUIRED_ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'TOKEN_ENCRYPTION_KEY',
  'JWT_SECRET',
  'NEXTAUTH_URL', // FRONTEND_URL alias used by some Postiz code; kept for compat
] as const;

/**
 * Optional env vars — adapter credentials. When absent, the corresponding
 * platform's `configured()` returns false (Connect Checklist shows
 * "Setup pending").
 */
const OPTIONAL_ENV_KEYS = [
  'EMAIL_PROVIDER',
  'EMAIL_FROM_ADDRESS',
  'EMAIL_FROM_NAME',
  'RESEND_API_KEY',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'REDDIT_REDIRECT_URI',
  'TWITTER_CLIENT_ID',
  'TWITTER_CLIENT_SECRET',
  'TWITTER_REDIRECT_URI',
  'LINKEDIN_CLIENT_ID',
  'LINKEDIN_CLIENT_SECRET',
  'LINKEDIN_REDIRECT_URI',
  'FRONTEND_URL',
  'MAIN_URL',
  'PORT',
  'API_LIMIT',
  'X_MONTHLY_POST_BUDGET',
  'NOT_SECURED',
  'MCP_ONLY',
] as const;

type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number];
type OptionalEnvKey = (typeof OPTIONAL_ENV_KEYS)[number];
export type EnvKey = RequiredEnvKey | OptionalEnvKey;

interface EnvShape {
  required: Record<RequiredEnvKey, string>;
  optional: Record<OptionalEnvKey, string | undefined>;
  raw: NodeJS.ProcessEnv;
}

class EnvValidationError extends Error {
  constructor(missing: string[]) {
    super(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      `Set these in your .env file before starting the app. See .env.example for the full list.`
    );
    this.name = 'EnvValidationError';
  }
}

function loadEnv(): EnvShape {
  const missing: RequiredEnvKey[] = [];
  for (const key of REQUIRED_ENV_KEYS) {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new EnvValidationError(missing);
  }

  const required = {} as Record<RequiredEnvKey, string>;
  for (const key of REQUIRED_ENV_KEYS) {
    required[key] = process.env[key] as string;
  }

  const optional = {} as Record<OptionalEnvKey, string | undefined>;
  for (const key of OPTIONAL_ENV_KEYS) {
    optional[key] = process.env[key];
  }

  return { required, optional, raw: process.env };
}

/**
 * Loaded env. Throws at first import if required keys are missing.
 * Tests can call `resetEnv()` to force a reload (e.g., after stubbing
 * process.env in a setup file).
 */
export const env: EnvShape = loadEnv();

/**
 * Force a reload of env from process.env. Used by tests; not exported
 * in the public API but available for testing utilities.
 */
export function resetEnv(): void {
  const fresh = loadEnv();
  Object.assign(env.required, fresh.required);
  Object.assign(env.optional, fresh.optional);
  env.raw = fresh.raw;
}

/**
 * Get an env value by name with a type guard. Returns undefined for
 * optional keys not set. Throws for unknown keys.
 *
 * @example getString('REDDIT_CLIENT_ID') // string | undefined
 */
export function getString(key: EnvKey): string | undefined {
  if (key in env.required) {
    return env.required[key as RequiredEnvKey];
  }
  if (key in env.optional) {
    return env.optional[key as OptionalEnvKey];
  }
  throw new Error(`Unknown env key: ${key}`);
}

/**
 * Get an env value as integer with a fallback.
 *
 * @example getInt('PORT', 3000) // 3000 if PORT unset
 */
export function getInt(key: OptionalEnvKey, fallback: number): number {
  const raw = env.optional[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Env var ${key} is not a valid integer: "${raw}"`);
  }
  return n;
}

/**
 * Get an env value as boolean (true if "1" / "true" / "yes", false otherwise).
 *
 * @example getBool('NOT_SECURED', false)
 */
export function getBool(key: OptionalEnvKey, fallback: boolean): boolean {
  const raw = env.optional[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'TRUE', 'YES'].includes(raw.trim());
}
