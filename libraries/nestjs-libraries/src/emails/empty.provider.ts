// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/emails/empty.provider.ts
// NetAmplify — EmptyProvider fallback for EmailService.
// Used when EMAIL_PROVIDER env var is unset; logs the would-be email
// instead of sending. Phase 2 will use this in dev mode so password-reset
// tokens print to console (docs/11-FEATURE-TICKETS.md T-02).

import { EmailInterface } from './email.interface';

export class EmptyProvider implements EmailInterface {
  name = 'no provider';
  validateEnvKeys: string[] = [];
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    _emailFromName: string,
    _emailFromAddress: string,
    _replyTo?: string
  ): Promise<string> {
    return `No email provider found, email was supposed to be sent to ${to} with subject: ${subject} and ${html}, html`;
  }
}
