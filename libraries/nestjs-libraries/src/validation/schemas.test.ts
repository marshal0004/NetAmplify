// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/validation/schemas.test.ts
// Vitest unit tests for Zod validation schemas — pure functions, no mocks.

import { describe, it, expect } from 'vitest';
import {
  SIGNUP_SCHEMA,
  LOGIN_SCHEMA,
  RESET_REQUEST_SCHEMA,
  RESET_CONFIRM_SCHEMA,
  PROFILE_UPDATE_SCHEMA,
  POSTCARD_CREATE_SCHEMA,
  POSTCARD_UPDATE_SCHEMA,
  PUBLISH_SCHEMA,
  CONNECT_DEVTO_SCHEMA,
  CONNECT_HASHNODE_SCHEMA,
  CONNECT_DISCORD_SCHEMA,
  CONNECT_TELEGRAM_SCHEMA,
  CONNECT_BLUESKY_SCHEMA,
} from './schemas';

describe('SIGNUP_SCHEMA', () => {
  it('accepts a valid signup payload', () => {
    const result = SIGNUP_SCHEMA.safeParse({
      email: 'student@example.com',
      password: 'StrongPass1',
      name: 'Jane Doe',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('student@example.com');
      expect(result.data.name).toBe('Jane Doe');
    }
  });

  it('normalizes email to lowercase + trims whitespace', () => {
    const result = SIGNUP_SCHEMA.safeParse({
      email: '  Student@Example.COM  ',
      password: 'StrongPass1',
      name: 'Jane',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('student@example.com');
    }
  });

  it('rejects an empty email', () => {
    const result = SIGNUP_SCHEMA.safeParse({
      email: '',
      password: 'StrongPass1',
      name: 'Jane',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    const result = SIGNUP_SCHEMA.safeParse({
      email: 'not-an-email',
      password: 'StrongPass1',
      name: 'Jane',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password shorter than 8 chars', () => {
    const result = SIGNUP_SCHEMA.safeParse({
      email: 'student@example.com',
      password: 'Ab1',
      name: 'Jane',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password without lowercase', () => {
    const result = SIGNUP_SCHEMA.safeParse({
      email: 'student@example.com',
      password: 'ALLUPPER1',
      name: 'Jane',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password without uppercase', () => {
    const result = SIGNUP_SCHEMA.safeParse({
      email: 'student@example.com',
      password: 'alllower1',
      name: 'Jane',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password without a digit', () => {
    const result = SIGNUP_SCHEMA.safeParse({
      email: 'student@example.com',
      password: 'NoDigits',
      name: 'Jane',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password longer than 128 chars', () => {
    const result = SIGNUP_SCHEMA.safeParse({
      email: 'student@example.com',
      password: 'A1' + 'a'.repeat(127),
      name: 'Jane',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty name', () => {
    const result = SIGNUP_SCHEMA.safeParse({
      email: 'student@example.com',
      password: 'StrongPass1',
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a name longer than 100 chars', () => {
    const result = SIGNUP_SCHEMA.safeParse({
      email: 'student@example.com',
      password: 'StrongPass1',
      name: 'x'.repeat(101),
    });
    expect(result.success).toBe(false);
  });
});

describe('LOGIN_SCHEMA', () => {
  it('accepts a valid login payload', () => {
    const result = LOGIN_SCHEMA.safeParse({
      email: 'student@example.com',
      password: 'any-password',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty password (but allows weak ones — login doesn\'t enforce complexity)', () => {
    const result = LOGIN_SCHEMA.safeParse({
      email: 'student@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    const result = LOGIN_SCHEMA.safeParse({
      email: 'not-an-email',
      password: 'password',
    });
    expect(result.success).toBe(false);
  });
});

describe('RESET_REQUEST_SCHEMA', () => {
  it('accepts a valid email', () => {
    expect(
      RESET_REQUEST_SCHEMA.safeParse({ email: 'a@b.com' }).success
    ).toBe(true);
  });

  it('rejects an invalid email', () => {
    expect(
      RESET_REQUEST_SCHEMA.safeParse({ email: 'not-email' }).success
    ).toBe(false);
  });
});

describe('RESET_CONFIRM_SCHEMA', () => {
  it('accepts a valid token + new strong password', () => {
    expect(
      RESET_CONFIRM_SCHEMA.safeParse({
        token: 'some-random-token-string',
        newPassword: 'NewStrong1',
      }).success
    ).toBe(true);
  });

  it('rejects an empty token', () => {
    expect(
      RESET_CONFIRM_SCHEMA.safeParse({
        token: '',
        newPassword: 'NewStrong1',
      }).success
    ).toBe(false);
  });

  it('rejects a weak new password', () => {
    expect(
      RESET_CONFIRM_SCHEMA.safeParse({
        token: 'token',
        newPassword: 'weak',
      }).success
    ).toBe(false);
  });
});

describe('PROFILE_UPDATE_SCHEMA', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(PROFILE_UPDATE_SCHEMA.safeParse({}).success).toBe(true);
  });

  it('accepts a full valid profile', () => {
    expect(
      PROFILE_UPDATE_SCHEMA.safeParse({
        name: 'Jane',
        headline: 'CS student',
        college: 'IIT',
        graduationYear: 2026,
        githubUrl: 'https://github.com/jane',
        portfolioUrl: 'https://jane.dev',
        bio: 'Building cool stuff',
      }).success
    ).toBe(true);
  });

  it('rejects a graduation year < 2015', () => {
    expect(
      PROFILE_UPDATE_SCHEMA.safeParse({ graduationYear: 2010 }).success
    ).toBe(false);
  });

  it('rejects a graduation year > 2035', () => {
    expect(
      PROFILE_UPDATE_SCHEMA.safeParse({ graduationYear: 2050 }).success
    ).toBe(false);
  });

  it('rejects a non-integer graduation year', () => {
    expect(
      PROFILE_UPDATE_SCHEMA.safeParse({ graduationYear: 2026.5 }).success
    ).toBe(false);
  });

  it('rejects an invalid URL', () => {
    expect(
      PROFILE_UPDATE_SCHEMA.safeParse({ githubUrl: 'not-a-url' }).success
    ).toBe(false);
  });

  it('accepts an empty string URL (clears the field)', () => {
    expect(
      PROFILE_UPDATE_SCHEMA.safeParse({ githubUrl: '' }).success
    ).toBe(true);
  });

  it('rejects a headline > 140 chars', () => {
    expect(
      PROFILE_UPDATE_SCHEMA.safeParse({ headline: 'x'.repeat(141) }).success
    ).toBe(false);
  });

  it('rejects a bio > 500 chars', () => {
    expect(
      PROFILE_UPDATE_SCHEMA.safeParse({ bio: 'x'.repeat(501) }).success
    ).toBe(false);
  });
});

describe('POSTCARD_CREATE_SCHEMA', () => {
  const validPostCard = {
    title: 'My Cool Project',
    summary: 'A one-line summary of what it does',
    description: 'A longer markdown description with **bold** text',
    techStack: ['typescript', 'react'],
  };

  it('accepts a valid postcard', () => {
    expect(POSTCARD_CREATE_SCHEMA.safeParse(validPostCard).success).toBe(true);
  });

  it('rejects an empty title', () => {
    expect(
      POSTCARD_CREATE_SCHEMA.safeParse({ ...validPostCard, title: '' }).success
    ).toBe(false);
  });

  it('rejects a title > 120 chars', () => {
    expect(
      POSTCARD_CREATE_SCHEMA.safeParse({
        ...validPostCard,
        title: 'x'.repeat(121),
      }).success
    ).toBe(false);
  });

  it('rejects an empty summary', () => {
    expect(
      POSTCARD_CREATE_SCHEMA.safeParse({ ...validPostCard, summary: '' })
        .success
    ).toBe(false);
  });

  it('rejects a summary > 200 chars', () => {
    expect(
      POSTCARD_CREATE_SCHEMA.safeParse({
        ...validPostCard,
        summary: 'x'.repeat(201),
      }).success
    ).toBe(false);
  });

  it('rejects a description > 5000 chars', () => {
    expect(
      POSTCARD_CREATE_SCHEMA.safeParse({
        ...validPostCard,
        description: 'x'.repeat(5001),
      }).success
    ).toBe(false);
  });

  it('rejects an empty techStack array', () => {
    expect(
      POSTCARD_CREATE_SCHEMA.safeParse({ ...validPostCard, techStack: [] })
        .success
    ).toBe(false);
  });

  it('rejects > 10 techStack tags', () => {
    expect(
      POSTCARD_CREATE_SCHEMA.safeParse({
        ...validPostCard,
        techStack: Array(11).fill('tag'),
      }).success
    ).toBe(false);
  });

  it('accepts optional repo/live/image URLs', () => {
    expect(
      POSTCARD_CREATE_SCHEMA.safeParse({
        ...validPostCard,
        repoUrl: 'https://github.com/user/repo',
        liveUrl: 'https://example.com',
        imageUrl: 'https://example.com/img.png',
      }).success
    ).toBe(true);
  });

  it('rejects invalid repoUrl', () => {
    expect(
      POSTCARD_CREATE_SCHEMA.safeParse({
        ...validPostCard,
        repoUrl: 'not-a-url',
      }).success
    ).toBe(false);
  });
});

describe('POSTCARD_UPDATE_SCHEMA (partial)', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(POSTCARD_UPDATE_SCHEMA.safeParse({}).success).toBe(true);
  });

  it('accepts a single field', () => {
    expect(
      POSTCARD_UPDATE_SCHEMA.safeParse({ title: 'Updated title' }).success
    ).toBe(true);
  });
});

describe('PUBLISH_SCHEMA', () => {
  it('accepts a valid publish payload', () => {
    expect(
      PUBLISH_SCHEMA.safeParse({
        platforms: [
          { platform: 'REDDIT', options: { subreddit: 'sideproject' } },
          { platform: 'DISCORD' },
        ],
        requestId: 'client-uuid-12345',
      }).success
    ).toBe(true);
  });

  it('rejects an empty platforms array', () => {
    expect(PUBLISH_SCHEMA.safeParse({ platforms: [] }).success).toBe(false);
  });

  it('rejects > 8 platforms', () => {
    expect(
      PUBLISH_SCHEMA.safeParse({
        platforms: Array(9).fill({ platform: 'REDDIT' }),
      }).success
    ).toBe(false);
  });

  it('rejects an unknown platform identifier', () => {
    expect(
      PUBLISH_SCHEMA.safeParse({
        platforms: [{ platform: 'INSTAGRAM' }],
      }).success
    ).toBe(false);
  });

  it('accepts a payload without requestId (optional)', () => {
    expect(PUBLISH_SCHEMA.safeParse({ platforms: [{ platform: 'REDDIT' }] }).success).toBe(true);
  });
});

describe('CONNECT_DISCORD_SCHEMA', () => {
  it('accepts a valid Discord webhook URL', () => {
    expect(
      CONNECT_DISCORD_SCHEMA.safeParse({
        webhookUrl: 'https://discord.com/api/webhooks/123456789/abc-def-ghi',
      }).success
    ).toBe(true);
  });

  it('accepts ptb.discordapp.com (alternate domain)', () => {
    expect(
      CONNECT_DISCORD_SCHEMA.safeParse({
        webhookUrl: 'https://ptb.discordapp.com/api/webhooks/123/abc',
      }).success
    ).toBe(true);
  });

  it('rejects a non-Discord URL', () => {
    expect(
      CONNECT_DISCORD_SCHEMA.safeParse({
        webhookUrl: 'https://example.com/webhooks/123/abc',
      }).success
    ).toBe(false);
  });

  it('rejects a non-https URL', () => {
    expect(
      CONNECT_DISCORD_SCHEMA.safeParse({
        webhookUrl: 'http://discord.com/api/webhooks/123/abc',
      }).success
    ).toBe(false);
  });

  it('rejects an empty URL', () => {
    expect(
      CONNECT_DISCORD_SCHEMA.safeParse({ webhookUrl: '' }).success
    ).toBe(false);
  });
});

describe('CONNECT_TELEGRAM_SCHEMA', () => {
  it('accepts a valid bot token + @channel', () => {
    expect(
      CONNECT_TELEGRAM_SCHEMA.safeParse({
        botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv',
        channel: '@mychannel',
      }).success
    ).toBe(true);
  });

  it('accepts a channel without leading @', () => {
    expect(
      CONNECT_TELEGRAM_SCHEMA.safeParse({
        botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv',
        channel: 'mychannel',
      }).success
    ).toBe(true);
  });

  it('rejects an invalid bot token (no colon)', () => {
    expect(
      CONNECT_TELEGRAM_SCHEMA.safeParse({
        botToken: 'invalid-token',
        channel: '@mychannel',
      }).success
    ).toBe(false);
  });

  it('rejects an empty channel', () => {
    expect(
      CONNECT_TELEGRAM_SCHEMA.safeParse({
        botToken: '7812345678:AAH1234567890abcdefghijklmnopqrstuv',
        channel: '',
      }).success
    ).toBe(false);
  });
});

describe('CONNECT_BLUESKY_SCHEMA', () => {
  it('accepts a valid handle + app password', () => {
    expect(
      CONNECT_BLUESKY_SCHEMA.safeParse({
        handle: 'jane.bsky.social',
        appPassword: 'abcd-efgh-ijkl-mnop',
      }).success
    ).toBe(true);
  });

  it('accepts a custom domain handle', () => {
    expect(
      CONNECT_BLUESKY_SCHEMA.safeParse({
        handle: 'jane.dev',
        appPassword: 'abcd-efgh-ijkl-mnop',
      }).success
    ).toBe(true);
  });

  it('rejects an app password without dashes', () => {
    expect(
      CONNECT_BLUESKY_SCHEMA.safeParse({
        handle: 'jane.bsky.social',
        appPassword: 'abcdefghijklmnop',
      }).success
    ).toBe(false);
  });

  it('rejects an app password with uppercase', () => {
    expect(
      CONNECT_BLUESKY_SCHEMA.safeParse({
        handle: 'jane.bsky.social',
        appPassword: 'Abcd-efgh-ijkl-mnop',
      }).success
    ).toBe(false);
  });

  it('rejects an empty handle', () => {
    expect(
      CONNECT_BLUESKY_SCHEMA.safeParse({
        handle: '',
        appPassword: 'abcd-efgh-ijkl-mnop',
      }).success
    ).toBe(false);
  });
});

describe('CONNECT_DEVTO_SCHEMA / CONNECT_HASHNODE_SCHEMA', () => {
  it('accepts a non-empty Dev.to API key', () => {
    expect(CONNECT_DEVTO_SCHEMA.safeParse({ apiKey: 'devto-abc-123' }).success).toBe(true);
  });

  it('rejects an empty Dev.to API key', () => {
    expect(CONNECT_DEVTO_SCHEMA.safeParse({ apiKey: '' }).success).toBe(false);
  });

  it('accepts a non-empty Hashnode PAT', () => {
    expect(CONNECT_HASHNODE_SCHEMA.safeParse({ pat: 'hashnode-pat-abc' }).success).toBe(true);
  });

  it('rejects an empty Hashnode PAT', () => {
    expect(CONNECT_HASHNODE_SCHEMA.safeParse({ pat: '' }).success).toBe(false);
  });
});
