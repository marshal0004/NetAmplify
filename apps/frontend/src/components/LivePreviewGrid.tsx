// apps/frontend/src/components/LivePreviewGrid.tsx
// NetAmplify — LivePreviewGrid (per-platform live preview for the Publish page).
//
// Pure presentational component: props in, JSX out, no router/react-query/API
// dependencies. Renders one Card per selected platform in a responsive 2-per-row
// grid (md:grid-cols-2).
//
// Each Card shows:
//   1. A platform-native header: colored avatar circle (first letter of the
//      platform name on a platform-colored background) + platform name +
//      "now" timestamp.
//   2. The PostCard's media (image via <img>, video via <video>) — rendered
//      ABOVE the text for visual-first platforms (Instagram, Facebook, X,
//      Bluesky, Threads) and BELOW the title for blog platforms (Hashnode,
//      Dev.to, LinkedIn).
//   3. The Format Engine's formatted text (title/body/url/hashtags) with
//      CHAR-LIMIT OVERFLOW HIGHLIGHTING: text beyond the platform's char
//      limit is shown in red <span className="text-red-400"> so the user
//      sees exactly what will be cropped at publish time (matching postiz's
//      <mark> overflow UX).
//   4. An engagement buttons row at the bottom (Heart, MessageCircle,
//      Repeat2, Share — icons only, non-functional, matching postflare's
//      preview UX).
//
// The PostCard model stores a single `imageUrl` string — MediaPreview's
// isVideoUrl picks <img> vs <video>.

import { motion } from 'framer-motion';
import {
  Heart,
  MessageCircle,
  Repeat2,
  Share,
  Bookmark,
} from 'lucide-react';
import { MediaPreview } from '@/components/MediaPreview';
import { Card, CardContent } from '@/components/ui/card';
import type { PostCard, Preview } from '@/lib/api';

interface LivePreviewGridProps {
  card: PostCard | undefined;
  selectedPlatforms: Set<string>;
  previews: Record<string, Preview>;
  platformName: (platform: string) => string;
}

/**
 * Platform brand colors (for the avatar circle background). Each platform
 * gets a recognizable color that matches its brand identity.
 */
const PLATFORM_COLORS: Record<string, string> = {
  INSTAGRAM: 'bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400',
  FACEBOOK: 'bg-blue-600',
  TWITTER: 'bg-black',
  TWITTER_COOKIE: 'bg-black',
  LINKEDIN: 'bg-blue-700',
  YOUTUBE: 'bg-red-600',
  BLUESKY: 'bg-sky-500',
  THREADS: 'bg-black',
  HASHNODE: 'bg-blue-500',
  DEVTO: 'bg-gray-800',
  DISCORD: 'bg-indigo-600',
  TELEGRAM: 'bg-sky-600',
  MASTODON: 'bg-purple-600',
  WORDPRESS: 'bg-gray-700',
};

/**
 * Blog-style platforms show the title ABOVE the media (like an article with
 * a cover image). Social platforms show the media ABOVE the text (like a
 * photo post with a caption).
 */
const BLOG_PLATFORMS = new Set(['HASHNODE', 'DEVTO', 'LINKEDIN']);

/**
 * Render the Live Preview panel. Returns null when no platforms are selected.
 */
export function LivePreviewGrid({
  card,
  selectedPlatforms,
  previews,
  platformName,
}: LivePreviewGridProps) {
  if (selectedPlatforms.size === 0) return null;

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-white">Live Preview</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from(selectedPlatforms).map((platform, i) => {
          const preview = previews[platform];
          const name = platformName(platform);
          const avatarColor = PLATFORM_COLORS[platform] ?? 'bg-gray-600';
          const isBlog = BLOG_PLATFORMS.has(platform);
          const charLimit = preview?.formatted.limit ?? 0;
          const body = preview?.formatted.body ?? '';
          const charCount = preview?.formatted.charCount ?? body.length;

          return (
            <motion.div
              key={platform}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.1 }}
            >
              <Card className="h-full overflow-hidden border-white/10 bg-white/[0.03] backdrop-blur-xl">
                <CardContent className="p-4">
                  {/* === Platform-native header === */}
                  <div className="mb-3 flex items-center gap-2.5">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatarColor}`}
                    >
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{name}</p>
                      <p className="text-xs text-white/40">now</p>
                    </div>
                    {/* Char counter badge — red when over limit */}
                    {charLimit > 0 && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          charCount > charLimit
                            ? 'bg-red-500/20 text-red-400'
                            : charCount > charLimit * 0.9
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'bg-white/5 text-white/40'
                        }`}
                      >
                        {charCount}/{charLimit}
                      </span>
                    )}
                  </div>

                  {/* === Blog platforms: title first, then media === */}
                  {isBlog && preview?.formatted.title && (
                    <p className="mb-2 text-lg font-bold text-white">
                      {preview.formatted.title}
                    </p>
                  )}
                  {isBlog && card?.imageUrl && (
                    <MediaPreview
                      src={card.imageUrl}
                      alt={card.title}
                      className="mb-3 max-h-48 w-full rounded-lg border border-white/10 object-cover"
                    />
                  )}

                  {/* === Social platforms: media first === */}
                  {!isBlog && card?.imageUrl ? (
                    <MediaPreview
                      src={card.imageUrl}
                      alt={card.title}
                      className="mb-3 max-h-64 w-full rounded-lg border border-white/10 object-cover"
                    />
                  ) : !isBlog && !card?.imageUrl ? (
                    <p className="mb-3 rounded-lg border border-dashed border-white/10 bg-black/20 p-3 text-xs text-white/30">
                      No media attached — Instagram and YouTube require media.
                    </p>
                  ) : null}

                  {/* === Formatted text with overflow highlighting === */}
                  {preview ? (
                    <div className="text-sm">
                      {/* Social platforms show the title inline (not as a heading) */}
                      {!isBlog && preview.formatted.title && (
                        <p className="mb-1 font-semibold text-white">
                          {preview.formatted.title}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap text-white/70">
                        {renderTextWithOverflow(body, charLimit)}
                      </p>
                      {preview.formatted.url && (
                        <p className="mt-2 break-all text-indigo-400">
                          {preview.formatted.url}
                        </p>
                      )}
                      {preview.formatted.hashtags &&
                        preview.formatted.hashtags.length > 0 && (
                          <p className="mt-2 text-xs text-white/40">
                            {preview.formatted.hashtags.map((t) => `#${t}`).join(' ')}
                          </p>
                        )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-white/30">
                      <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-indigo-400" />
                      Loading preview…
                    </div>
                  )}

                  {/* === Engagement buttons row (visual only) === */}
                  <div className="mt-3 flex items-center gap-4 border-t border-white/5 pt-3 text-white/30">
                    <Heart className="h-4 w-4 hover:text-red-400" />
                    <MessageCircle className="h-4 w-4 hover:text-sky-400" />
                    <Repeat2 className="h-4 w-4 hover:text-green-400" />
                    <Bookmark className="ml-auto h-4 w-4 hover:text-amber-400" />
                    <Share className="h-4 w-4 hover:text-white/60" />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Render text with the portion beyond the char limit highlighted in red.
 *
 * If the text is under the limit, returns it as-is. If over, splits at the
 * limit and wraps the overflow in <span className="text-red-400"> so the user
 * sees exactly what will be cropped at publish time (matching postiz's
 * overflow UX). If no limit is known (0), returns the full text truncated at
 * 500 chars for display.
 */
function renderTextWithOverflow(text: string, limit: number): React.ReactNode {
  if (limit <= 0) {
    // No limit known — just truncate for display
    const truncated = text.slice(0, 500);
    return truncated + (text.length > 500 ? '…' : '');
  }

  if (text.length <= limit) {
    return text;
  }

  // Split at the limit — the overflow is shown in red
  const visible = text.slice(0, limit);
  const overflow = text.slice(limit);
  return (
    <>
      {visible}
      <span className="text-red-400/80 line-through">{overflow.slice(0, 100)}</span>
      {overflow.length > 100 ? '…' : ''}
    </>
  );
}

export default LivePreviewGrid;
