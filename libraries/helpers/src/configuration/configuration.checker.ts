import { readFileSync, existsSync } from 'fs';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

export class ConfigurationChecker {
  cfg: dotenv.DotenvParseOutput;
  issues: string[] = [];

  readEnvFromFile() {
    const envFile = resolve(__dirname, '../../../.env');

    if (!existsSync(envFile)) {
      console.error('Env file not found!: ', envFile);
      return;
    }

    const handle = readFileSync(envFile, 'utf-8');

    this.cfg = dotenv.parse(handle);
  }

  readEnvFromProcess() {
    this.cfg = process.env;
  }

  check() {
    this.checkDatabaseServers();
    this.checkNonEmpty('JWT_SECRET');
    this.checkIsValidUrl('MAIN_URL');
    this.checkIsValidUrl('FRONTEND_URL');
    this.checkIsValidUrl('NEXT_PUBLIC_BACKEND_URL');
    this.checkIsValidUrl('BACKEND_INTERNAL_URL');
    this.checkNonEmpty('STORAGE_PROVIDER', 'Needed to setup storage.');
    this.checkInstagram();
  }

  /**
   * Instagram Standalone OAuth requires:
   *   - INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET (from Meta dashboard)
   *   - PUBLIC_APP_URL (HTTPS URL — Instagram rejects http://localhost)
   *
   * If any are missing, the Instagram card on the Connections page will show
   * "Setup pending" / "Coming soon" instead of a "Connect via OAuth" button.
   */
  checkInstagram(): void {
    const igAppId = this.get('INSTAGRAM_APP_ID');
    const igAppSecret = this.get('INSTAGRAM_APP_SECRET');
    const publicAppUrl = this.get('PUBLIC_APP_URL');

    if (!igAppId && !igAppSecret) {
      // Both missing — likely the user hasn't configured Instagram at all.
      // Don't warn (silence is fine for users who don't use Instagram).
      return;
    }

    if (!igAppId) {
      this.issues.push(
        'INSTAGRAM_APP_SECRET is set but INSTAGRAM_APP_ID is missing. ' +
          'Instagram Standalone OAuth requires both. Get the Instagram App ID ' +
          'from your Meta dashboard → Instagram API → "Instagram app ID".',
      );
    }
    if (!igAppSecret) {
      this.issues.push(
        'INSTAGRAM_APP_ID is set but INSTAGRAM_APP_SECRET is missing. ' +
          'Instagram Standalone OAuth requires both. Get the Instagram App ' +
          'Secret from your Meta dashboard → Instagram API → "Instagram app secret".',
      );
    }

    if (igAppId && igAppSecret && !publicAppUrl) {
      this.issues.push(
        'PUBLIC_APP_URL not set. Instagram Standalone OAuth requires an HTTPS ' +
          'redirect URI (Instagram rejects http://localhost). For local dev, ' +
          'run `ngrok http 4200` and set PUBLIC_APP_URL to the ngrok HTTPS URL.',
      );
    } else if (igAppId && igAppSecret && publicAppUrl) {
      // Validate PUBLIC_APP_URL is HTTPS
      try {
        const url = new URL(publicAppUrl);
        if (url.protocol !== 'https:') {
          this.issues.push(
            'PUBLIC_APP_URL must be HTTPS (Instagram rejects http://localhost). ' +
              `Got: ${publicAppUrl}. Use ngrok to get an HTTPS tunnel URL.`,
          );
        }
        if (publicAppUrl.endsWith('/')) {
          this.issues.push('PUBLIC_APP_URL should not end with /');
        }
      } catch {
        this.issues.push('PUBLIC_APP_URL is not a valid URL');
      }
    }
  }

  checkNonEmpty(key: string, description?: string): boolean {
    const v = this.get(key);

    if (!description) {
      description = '';
    }

    if (!v) {
      this.issues.push(key + ' not set. ' + description);
      return false;
    }

    if (v.length === 0) {
      this.issues.push(key + ' is empty.' + description);
      return false;
    }

    return true;
  }

  get(key: string): string | undefined {
    return this.cfg[key as keyof typeof this.cfg];
  }

  checkDatabaseServers() {
    this.checkRedis();
    this.checkIsValidUrl('DATABASE_URL');
  }

  checkRedis() {
    if (!this.cfg.REDIS_URL) {
      this.issues.push('REDIS_URL not set');
    }

    try {
      const redisUrl = new URL(this.cfg.REDIS_URL);

      if (redisUrl.protocol !== 'redis:') {
        this.issues.push('REDIS_URL must start with redis://');
      }
    } catch (error) {
      this.issues.push('REDIS_URL is not a valid URL');
    }
  }

  checkIsValidUrl(key: string) {
    if (!this.checkNonEmpty(key)) {
      return;
    }

    const urlString = this.get(key);

    try {
      new URL(urlString);
    } catch (error) {
      this.issues.push(key + ' is not a valid URL');
    }

    if (urlString.endsWith('/')) {
      this.issues.push(key + ' should not end with /');
    }
  }

  hasIssues() {
    return this.issues.length > 0;
  }

  getIssues() {
    return this.issues;
  }

  getIssuesCount() {
    return this.issues.length;
  }
}
