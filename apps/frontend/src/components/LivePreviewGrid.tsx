// /home/z/my-project/netamplify-app/apps/frontend/src/components/LivePreviewGrid.tsx
// NetAmplify — LivePreviewGrid (per-platform live preview for the Publish page).
//
// Pure presentational component extracted from PublishPage.tsx so the
// per-platform preview rendering is unit-testable in isolation: props in,
// JSX out, no router/react-query/API dependencies. PublishPage keeps the
// data fetching + state; this component only renders.
//
// Renders one Card per selected platform in a RESPONSIVE 2-per-row grid
// (md:grid-cols-2). Each Card shows:
//   1. The PostCard's media — image via <img>, video via <video>, inferred
//      from the imageUrl extension by MediaPreview. This is the fix for the
//      "per-platform postcards don't show images and videos content" bug:
//      the previous inline Live Preview block rendered ONLY the Format
//      Engine's formatted text fields (title/body/url/hashtags) and never
//      touched card.imageUrl, so an uploaded image or video was invisible
//      in every per-platform preview card.
//   2. The Format Engine's formatted text (title/body/url/hashtags) BELOW
//      the media, so the user still sees how the post will read on that
//      platform. The body is truncated at 500 chars in the preview to keep
//      the card height bounded (the full body is sent at publish time).
//
// The PostCard model stores a single `imageUrl` string (no mime type, no
// mediaUrls array — see Prisma PostCard model + api.ts PostCardSchema). That
// one field holds EITHER an image OR a video URL; MediaPreview's isVideoUrl
// picks the right element. So "show all media" = render card.imageUrl via
// MediaPreview on every platform card. There is no second media field to
// also render.

import { motion } from 'framer-motion';
import { MediaPreview } from '@/components/MediaPreview';
import { Card, CardContent } from '@/components/ui/card';
import type { PostCard, Preview } from '@/lib/api';

interface LivePreviewGridProps {
  /** The PostCard being published. Its imageUrl is the media shown on every card. */
  card: PostCard | undefined;
  /** Set of platform enum strings selected for this publish (e.g. 'INSTAGRAM'). */
  selectedPlatforms: Set<string>;
  /** Loaded Format Engine previews, keyed by platform enum. */
  previews: Record<string, Preview>;
  /** Human-readable platform name for the card header (e.g. 'INSTAGRAM' → 'Instagram'). */
  platformName: (platform: string) => string;
}

/**
 * Render the Live Preview panel. Returns null when no platforms are selected
 * (so the PublishPage can mount it unconditionally without rendering an empty
 * heading).
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
          return (
            <motion.div
              key={platform}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.1 }}
            >
              {/* h-full so cards in the same row stretch to the tallest card's
                  height — without it, a short card (e.g. a loading spinner)
                  leaves a gap under its neighbour in the 2-col grid. */}
              <Card className="h-full border-white/10 bg-white/[0.03] backdrop-blur-xl">
                <CardContent className="pt-6">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="font-medium text-white">{platformName(platform)}</h4>
                  </div>

                  {/* Media block: the PostCard's image OR video, rendered on
                      EVERY platform card. MediaPreview returns null for an
                      empty src, so the truthy guard on card.imageUrl is the
                      single source of truth for "is there media to show". */}
                  {card?.imageUrl ? (
                    <MediaPreview
                      src={card.imageUrl}
                      alt={card.title}
                      className="mb-3 max-h-64 w-full rounded-lg border border-white/10 object-cover"
                    />
                  ) : (
                    <p className="mb-3 rounded-lg border border-dashed border-white/10 bg-black/20 p-3 text-xs text-white/30">
                      No media attached — this PostCard is text-only. Platforms
                      that require media (Instagram, YouTube) will reject it at
                      publish time.
                    </p>
                  )}

                  {preview ? (
                    <div className="rounded-lg border border-white/5 bg-black/30 p-3 text-sm">
                      {preview.formatted.title && (
                        <p className="mb-2 font-semibold text-white">{preview.formatted.title}</p>
                      )}
                      <p className="whitespace-pre-wrap text-white/60">
                        {preview.formatted.body?.slice(0, 500)}
                        {(preview.formatted.body?.length ?? 0) > 500 ? '…' : ''}
                      </p>
                      {preview.formatted.url && (
                        <p className="mt-2 break-all text-indigo-400">{preview.formatted.url}</p>
                      )}
                      {preview.formatted.hashtags && preview.formatted.hashtags.length > 0 && (
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
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
