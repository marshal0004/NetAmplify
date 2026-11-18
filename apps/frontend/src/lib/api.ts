// /home/z/my-project/netamplify-app/apps/frontend/src/lib/api.ts
// NetAmplify — Typed API client.
//
// Single source of truth for all backend communication. Handles:
//   - JWT Bearer token injection
//   - Standard error envelope parsing ({ error: { code, message, fieldErrors? } })
//   - Zod response validation (optional, per endpoint)
//   - 401 → redirect to /login
//   - Network errors → typed error
//
// Per docs/07-SECURITY-ACCESS.md: never log tokens; never store tokens in
// localStorage in production (httpOnly cookie is better, but MVP uses
// localStorage for simplicity — JWT has 7-day expiry + is revocable via
// account deletion).

import { z, type ZodSchema } from 'zod';

const API_BASE = '/api';

/**
 * Standard error envelope per docs/05-API-SPEC.md:
 *   { error: { code: "VALIDATION_ERROR", message: "...", fieldErrors?: {...} } }
 */
export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Network-level error (server unreachable, CORS, etc.)
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

function getToken(): string | null {
  return localStorage.getItem('netamplify_token');
}

function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem('netamplify_token', token);
  } else {
    localStorage.removeItem('netamplify_token');
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  schema?: ZodSchema<T>,
): Promise<T> {
  const token = getToken();

  // Guard: if there is no session token AND this is a guarded route (anything
  // other than the public auth endpoints), fail fast with a clear message
  // instead of sending a headerless request that the backend rejects with a
  // cryptic "No auth token" 401. This is what makes the difference between the
  // user seeing "You must be logged in" (and going to log in) vs. an opaque
  // "An unexpected error occurred" — the latter happens when the user is on a
  // different origin (e.g. the ngrok URL) where they haven't logged in, so
  // localStorage has no token. The raw-fetch handlers in ConnectChecklist
  // already guard with `if (!jwtToken) return`, but this api-client path did
  // not, so Bluesky (which uses connectionsApi.connect → request()) failed
  // silently.
  const isPublicAuthPath = /^\/auth\/(signup|login|reset-request|reset-confirm)(\/|$)/.test(path);
  if (!token && !isPublicAuthPath) {
    // Signal the auth context to clear its (possibly stale) user state so
    // RequireAuth redirects to /login. Without this, a prior 401 that cleared
    // the token leaves `user` stale → RequireAuth keeps passing while every
    // raw-fetch handler sends `Bearer null` → backend "jwt malformed".
    window.dispatchEvent(new CustomEvent('netamplify:unauthorized'));
    throw new ApiError(
      401,
      'UNAUTHENTICATED',
      'You must be logged in to NetAmplify. Please log in and try again.',
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (e) {
    throw new NetworkError(`Cannot reach server: ${(e as Error).message}`);
  }

  if (resp.status === 204) {
    return undefined as T;
  }

  const body = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const envelope = body as ApiErrorEnvelope;
    if (envelope?.error?.code) {
      // 401 → clear token + signal auth context to clear user state + redirect.
      // The auth context listens for 'netamplify:unauthorized' and setUser(null),
      // which makes RequireAuth redirect to /login. Without the event, only the
      // token is cleared — `user` stays stale, RequireAuth keeps passing, and
      // raw-fetch handlers send `Bearer null` → "jwt malformed".
      if (resp.status === 401) {
        setToken(null);
        window.dispatchEvent(new CustomEvent('netamplify:unauthorized'));
      }
      throw new ApiError(
        resp.status,
        envelope.error.code,
        envelope.error.message,
        envelope.error.fieldErrors,
      );
    }
    // Unknown error shape — wrap in ApiError
    throw new ApiError(resp.status, 'UNKNOWN', `HTTP ${resp.status}`);
  }

  if (schema) {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(resp.status, 'RESPONSE_VALIDATION_ERROR', 'Server response did not match expected shape');
    }
    return parsed.data;
  }
  return body as T;
}

// ============================================================================
// Auth API
// ============================================================================
const AuthResultSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
  }),
  accessToken: z.string(),
  expiresAt: z.number(),
});

const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});

export const authApi = {
  async signup(email: string, password: string, name: string) {
    return request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }, AuthResultSchema);
  },

  async login(email: string, password: string) {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }, AuthResultSchema);
  },

  async logout() {
    return request('/auth/logout', { method: 'POST' });
  },

  async me() {
    return request('/auth/me', {}, UserSchema);
  },

  async resetRequest(email: string) {
    return request('/auth/reset-request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async resetConfirm(token: string, newPassword: string) {
    return request('/auth/reset-confirm', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });
  },

  async deleteAccount() {
    return request('/account', { method: 'DELETE' });
  },
};

// ============================================================================
// PostCards API
// ============================================================================
const PostCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  description: z.string(),
  techStack: z.array(z.string()),
  repoUrl: z.string().nullable(),
  liveUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const PostCardListSchema = z.object({
  items: z.array(PostCardSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const PreviewSchema = z.object({
  platform: z.string(),
  formatted: z.object({
    title: z.string().optional(),
    body: z.string().optional(),
    url: z.string().optional(),
    hashtags: z.array(z.string()).optional(),
    charCount: z.number(),
    limit: z.number(),
  }),
});

export type PostCard = z.infer<typeof PostCardSchema>;
export type PostCardList = z.infer<typeof PostCardListSchema>;
export type Preview = z.infer<typeof PreviewSchema>;

export const postcardApi = {
  async list(page = 1, pageSize = 12): Promise<PostCardList> {
    return request(`/postcards?page=${page}&pageSize=${pageSize}`, {}, PostCardListSchema);
  },

  async get(id: string): Promise<PostCard> {
    return request(`/postcards/${id}`, {}, PostCardSchema);
  },

  async create(data: {
    title: string;
    summary: string;
    description: string;
    techStack: string[];
    repoUrl?: string;
    liveUrl?: string;
    imageUrl?: string;
  }): Promise<PostCard> {
    return request('/postcards', {
      method: 'POST',
      body: JSON.stringify(data),
    }, PostCardSchema);
  },

  async update(id: string, data: Partial<{
    title: string;
    summary: string;
    description: string;
    techStack: string[];
    repoUrl: string | null;
    liveUrl: string | null;
    imageUrl: string | null;
  }>): Promise<PostCard> {
    return request(`/postcards/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, PostCardSchema);
  },

  async delete(id: string): Promise<void> {
    return request(`/postcards/${id}`, { method: 'DELETE' });
  },

  async preview(id: string, platform: string): Promise<Preview> {
    const params = new URLSearchParams({ platform });
    return request(`/postcards/${id}/preview?${params}`, {}, PreviewSchema);
  },
};

// ============================================================================
// Connections API
// ============================================================================
const ConnectionSchema = z.object({
  id: z.string(),
  platform: z.string(),
  type: z.string(),
  platformUsername: z.string().nullable(),
  platformAccountId: z.string(),
  status: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().nullable(),
  lastValidatedAt: z.string().nullable(),
  configured: z.boolean(),
  tier: z.string(),
  connectedAt: z.string(),
});

export type Connection = z.infer<typeof ConnectionSchema>;

export const connectionsApi = {
  async list(): Promise<Connection[]> {
    return request('/connections', {}, z.array(ConnectionSchema));
  },

  async connect(platform: string, data: Record<string, string>): Promise<{ id: string; username: string }> {
    // Convert platform enum to URL path: TWITTER_COOKIE → twitter-cookie
    // (backend routes use dashes: @Post('twitter-cookie'))
    const urlPath = platform.toLowerCase().replace(/_/g, '-');
    return request(`/connections/${urlPath}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, z.object({ id: z.string(), username: z.string() }));
  },

  async disconnect(platform: string): Promise<void> {
    const urlPath = platform.toLowerCase().replace(/_/g, '-');
    return request(`/connections/${urlPath}`, { method: 'DELETE' });
  },

  /** OAuth start — returns the platform authorize URL (full-page redirect) */
  oauthStart(platform: string): string {
    return `${API_BASE}/oauth/${platform}/start`;
  },
};

// ============================================================================
// Publish API
// ============================================================================
const PostTargetSchema = z.object({
  id: z.string(),
  platform: z.string(),
  status: z.enum(['QUEUED', 'PUBLISHING', 'SUCCESS', 'FAILED', 'SKIPPED']),
  error: z.string().nullable().optional(),
  platformPostUrl: z.string().nullable().optional(),
  attempts: z.number().optional(),
  publishedAt: z.string().nullable().optional(),
});

const PostSchema = z.object({
  post: z.object({
    id: z.string(),
    createdAt: z.string(),
    targets: z.array(PostTargetSchema),
  }),
});

const PostListSchema = z.object({
  items: z.array(PostSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export type PostTarget = z.infer<typeof PostTargetSchema>;
export type Post = z.infer<typeof PostSchema>;

export const publishApi = {
  async publish(
    postCardId: string,
    platforms: Array<{ platform: string; options?: Record<string, unknown> }>,
    requestId?: string,
  ): Promise<Post> {
    return request(`/postcards/${postCardId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ platforms, ...(requestId ? { requestId } : {}) }),
    }, PostSchema);
  },

  async list(page = 1, pageSize = 20, filters?: { platform?: string; status?: string }): Promise<z.infer<typeof PostListSchema>> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filters?.platform) params.set('platform', filters.platform);
    if (filters?.status) params.set('status', filters.status);
    return request(`/posts?${params}`, {}, PostListSchema);
  },

  async get(id: string): Promise<Post> {
    return request(`/posts/${id}`, {}, PostSchema);
  },

  async retry(postId: string, targetId: string): Promise<{ id: string; status: string }> {
    return request(`/posts/${postId}/targets/${targetId}/retry`, {
      method: 'POST',
    }, z.object({ id: z.string(), status: z.string() }));
  },
};

// ============================================================================
// Platforms API — per-platform config (char limits, media support) for the
// composer + publish page. Single source of truth: the frontend fetches this
// once + renders live char counters + per-platform metadata without
// duplicating the backend's PLATFORM_CONFIG.
// ============================================================================
const PlatformConfigSchema = z.object({
  platform: z.string(),
  name: z.string(),
  charLimit: z.number(),
  rateLimitPerMinute: z.number().nullable(),
  markdownSupported: z.boolean(),
  imageSupported: z.boolean(),
  maxImages: z.number(),
});

export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;

export const platformsApi = {
  /** GET /api/platforms — per-platform config (char limits, media support). */
  async list(): Promise<PlatformConfig[]> {
    return request('/platforms', {}, z.array(PlatformConfigSchema));
  },
};

// ============================================================================
// Media API — the user's uploaded media library (postflare-style reusable
// media grid). GET lists the user's files; DELETE removes one.
// ============================================================================
const MediaItemSchema = z.object({
  filename: z.string(),
  url: z.string(),
  mimeType: z.string(),
  size: z.number(),
  isVideo: z.boolean(),
  uploadedAt: z.string(),
});

export type MediaItem = z.infer<typeof MediaItemSchema>;

export const mediaApi = {
  /** GET /api/media — list the current user's uploaded media (newest first). */
  async list(): Promise<MediaItem[]> {
    return request('/media', {}, z.array(MediaItemSchema));
  },

  /** DELETE /api/media/:filename — remove a media file from the library. */
  async delete(filename: string): Promise<void> {
    return request(`/media/${encodeURIComponent(filename)}`, { method: 'DELETE' });
  },
};

// ============================================================================
// Health API
// ============================================================================
export const healthApi = {
  async check(): Promise<{ db: string; redis: string; ts: number }> {
    return request('/health', {}, z.object({
      db: z.string(),
      redis: z.string(),
      ts: z.number(),
    }));
  },
};

// ============================================================================
// Token management (for auth context)
// ============================================================================
export { setToken, getToken };
