// /home/z/my-project/netamplify-ref/libraries/nestjs-libraries/src/services/uploads-dir.ts
// NetAmplify — shared uploads-directory helpers.
//
// Single source of truth for WHERE uploaded files live on disk. Used by:
//   - upload.controller.ts (apps/backend) — to SAVE uploaded files
//   - main.ts (apps/backend) — to mkdir + mount express.static
//   - platform adapters (YouTube, X) — to READ the local file directly,
//     bypassing the public-URL roundtrip (which breaks on ngrok-free's
//     "Visit Site" interstitial + on any /uploads 404).
//
// The path is resolved to ABSOLUTE at module load (via path.resolve), so it is
// immune to CWD drift between save (upload.controller) and serve (main.ts
// express.static) — the root cause of the /uploads 404 that broke Instagram
// (Meta couldn't fetch the image) + X (XCookieAdapter couldn't download it).

import { join, resolve } from 'path';
import { existsSync } from 'fs';

/**
 * Absolute path to the uploads directory.
 *
 * Precedence:
 *   1. UPLOAD_DIRECTORY env var (production Docker sets this to /uploads,
 *      served by nginx `alias /uploads/;`).
 *   2. <cwd>/public/uploads (dev — nest start --watch runs with cwd at
 *      apps/backend/, so this resolves to apps/backend/public/uploads/).
 *
 * `resolve()` makes it absolute so it never depends on a later process.chdir()
 * or a different CWD at request time vs startup.
 */
export const UPLOADS_DIR: string = resolve(
  process.env.UPLOAD_DIRECTORY || join(process.cwd(), 'public', 'uploads'),
);

const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogg)$/i;

/**
 * True if the URL/filename looks like a video (by extension).
 *
 * The PostCard stores a single `imageUrl` field that holds BOTH images and
 * videos (the upload controller accepts .jpg/.png/.gif/.webp/.mp4). Each
 * adapter uses this to decide which platform API flow to use:
 *   - Instagram: video → media_type=VIDEO + video_url; image → image_url
 *   - YouTube: video → byte-upload; image → reject (YT Data API is video-only)
 *   - X: video → attach as video; image → attach as image
 */
export function isVideoMedia(url: string): boolean {
  if (!url) return false;
  // Strip query string + fragment so signed/CDN URLs detect correctly.
  const clean = url.split(/[?#]/)[0];
  return VIDEO_RE.test(clean);
}

/**
 * Given a public media URL (e.g. https://<ngrok>/uploads/<filename>), extract
 * the filename and return the ABSOLUTE local path on disk where the file was
 * saved by the upload controller.
 *
 * Returns null if:
 *   - the URL isn't a /uploads/ URL (e.g. an external Unsplash URL — no local
 *     file to read, the adapter must HTTP-fetch it instead)
 *   - the filename contains path-traversal characters (.. / \)
 *
 * Adapters (YouTube, X) call this FIRST + read the local file via fs.readFile
 * when it returns a path — this bypasses the ngrok/404/interstitial roundtrip
 * entirely. If it returns null, the adapter falls back to HTTP fetch (with the
 * ngrok-skip-browser-warning header for ngrok-free tunnels).
 */
export function resolveLocalUploadPath(url: string): string | null {
  if (!url) return null;

  // Relative URL ("/uploads/<filename>") — the upload controller now stores
  // relative URLs so media renders on any origin. `new URL()` would throw on
  // a relative URL (no base), so handle the relative case directly: match the
  // /uploads/<filename> path + apply the same path-traversal guard.
  if (url.startsWith('/')) {
    const match = url.split(/[?#]/)[0].match(/^\/uploads\/(.+)$/);
    if (!match) return null;
    const filename = match[1];
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return null;
    }
    return join(UPLOADS_DIR, filename);
  }

  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/uploads\/(.+)$/);
    if (!match) return null;
    const filename = match[1];
    // Path-traversal guard — filename must be a bare name, no dirs.
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return null;
    }
    return join(UPLOADS_DIR, filename);
  } catch {
    // Not a parseable URL (e.g. a bare filename) — treat as not-local.
    return null;
  }
}

/**
 * Read a local upload file into a Buffer. Returns null if the URL isn't a
 * local /uploads/ URL or the file doesn't exist on disk (so the caller can
 * fall back to an HTTP fetch).
 *
 * Convenience wrapper around resolveLocalUploadPath + fs.readFileSync.
 */
export function readLocalUploadFile(url: string): Buffer | null {
  const localPath = resolveLocalUploadPath(url);
  if (!localPath || !existsSync(localPath)) return null;
  // Lazy require to avoid loading fs for callers that only need the path.
  const { readFileSync } = require('fs') as typeof import('fs');
  return readFileSync(localPath);
}

/**
 * Resolve a media URL to an absolute, publicly-fetchable URL.
 *
 * The upload controller stores RELATIVE URLs ("/uploads/<filename>") so media
 * renders on any origin in the browser. But platforms that FETCH the media
 * from their servers (Dev.to, Facebook, Instagram, Threads) need an
 * ABSOLUTE URL — a relative URL like "/uploads/x.jpg" is not a valid URL they
 * can download from.
 *
 * This function:
 *   - Returns absolute URLs (http://, https://) unchanged.
 *   - Resolves relative URLs against PUBLIC_APP_URL (the public backend origin
 *     — e.g. an ngrok tunnel in dev, the prod domain in production).
 *   - Returns null if the URL is relative AND PUBLIC_APP_URL is unset (the
 *     caller should throw a clear VALIDATION error telling the user to set
 *     PUBLIC_APP_URL).
 *
 * Used by: Dev.to (main_image), Facebook (image
 * fallback for external URLs). Instagram + Threads use their own
 * rewriteLocalhostUrlForMeta (same logic, inline).
 */
export function resolvePublicMediaUrl(url: string): string | null {
  if (!url) return null;
  // Already absolute — return as-is.
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  // Relative URL — resolve against PUBLIC_APP_URL.
  const publicAppUrl = process.env.PUBLIC_APP_URL;
  if (!publicAppUrl) return null;
  try {
    return new URL(url, publicAppUrl).toString();
  } catch {
    return null;
  }
}
