// /home/z/my-project/netamplify-ref/apps/frontend/src/pages/PublishPage.tsx
// NetAmplify — Publish ("Amplify") page.
//
// Flow:
//   1. Load the PostCard + the user's connections.
//   2. Show every CONNECTED platform as a selectable card — INCLUDING ones
//      whose connection status is REVOKED/ERROR (greyed out + a "Reconnect"
//      link). Surfacing the status here is the fix for the cryptic
//      "POST /api/postcards/:id/publish 400" the user saw for YouTube: the
//      400 was actually "No active connection for: YOUTUBE" (the YouTube
//      token had expired + been marked REVOKED before the refreshCredentials
//      fix landed), but the user only saw "400 Bad Request" in the console.
//      Now the card itself shows "YouTube — Reconnect" before they ever
//      click Amplify.
//   3. After selecting platforms, render a PER-PLATFORM options panel
//      (YouTube: title/tags/category/privacy/madeForKids/description;
//      Hashnode: tags/subtitle/cover/canonical; Instagram: caption;
//      DevTo: tags/published/canonical; Bluesky: altText). These options
//      flow through the publish request → worker → Format Engine → adapter
//      (each adapter honors its own option keys; see the adapter files).
//   4. Live preview per platform (char counter against the platform limit).
//   5. Amplify → POST /api/postcards/:id/publish → poll /api/posts/:id.

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  postcardApi,
  connectionsApi,
  publishApi,
  type Post,
  type Preview,
  type Connection,
  type PostCard,
} from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { MediaPreview } from '@/components/MediaPreview';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

const statusConfig: Record<string, { color: string; bg: string; label: string; icon: string }> = {
  QUEUED: { color: 'text-gray-400', bg: 'bg-gray-500/10', label: 'Queued', icon: '⏳' },
  PUBLISHING: { color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Publishing', icon: '🔄' },
  SUCCESS: { color: 'text-green-400', bg: 'bg-green-500/10', label: 'Success', icon: '✅' },
  FAILED: { color: 'text-red-400', bg: 'bg-red-500/10', label: 'Failed', icon: '❌' },
  SKIPPED: { color: 'text-gray-400', bg: 'bg-gray-500/10', label: 'Skipped', icon: '⏭️' },
};

// YouTube Data API v3 categoryId values (the snippet.categoryId field).
// Sourced from https://developers.google.com/youtube/v3/docs/videoCategories/list
// (US region). The adapter defaults to '22' (People & Blogs); this list lets
// the user pick a more accurate category per-publish from the options panel.
const YOUTUBE_CATEGORIES = [
  { value: '22', label: 'People & Blogs' },
  { value: '28', label: 'Science & Technology' },
  { value: '27', label: 'Education' },
  { value: '24', label: 'Entertainment' },
  { value: '20', label: 'Gaming' },
  { value: '26', label: 'Howto & Style' },
  { value: '10', label: 'Music' },
  { value: '1', label: 'Film & Animation' },
  { value: '23', label: 'Comedy' },
  { value: '25', label: 'News & Politics' },
  { value: '15', label: 'Pets & Animals' },
  { value: '17', label: 'Sports' },
];

export function PublishPage() {
  const { id } = useParams<{ id: string }>();
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  // Per-platform options, keyed by platform enum (e.g. 'YOUTUBE' →
  // { title, description, tags, categoryId, privacyStatus, madeForKids }).
  // Pre-filled with sensible defaults from the PostCard when a platform is
  // first selected; the user edits them in the per-platform options panel.
  // On publish, these are sent as `options` in the publish request → merged
  // into formatted.options by the Format Engine → read by each adapter.
  const [platformOptions, setPlatformOptions] = useState<
    Record<string, Record<string, string | boolean>>
  >({});

  const { data: card } = useQuery({
    queryKey: ['postcard', id],
    queryFn: () => postcardApi.get(id!),
    enabled: !!id,
  });

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => connectionsApi.list(),
  });

  // Show every connected platform — INCLUDING REVOKED/ERROR ones — so the
  // user can see when a connection needs reconnecting (the YouTube 400 fix).
  const connectedPlatforms =
    connections?.filter((c) => c.platformUsername !== null && c.configured) ?? [];

  function isSelectable(conn: Connection): boolean {
    return conn.status === 'ACTIVE';
  }

  function togglePlatform(conn: Connection) {
    if (!isSelectable(conn)) return;
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(conn.platform)) next.delete(conn.platform);
      else next.add(conn.platform);
      return next;
    });
  }

  function updateOption(platform: string, key: string, value: string | boolean) {
    setPlatformOptions((prev) => ({
      ...prev,
      [platform]: { ...(prev[platform] ?? {}), [key]: value },
    }));
  }

  // Pre-fill per-platform defaults when a platform is first selected, so the
  // user sees the Format Engine's default title/tags/caption and can tweak
  // from there rather than starting from blank.
  useEffect(() => {
    if (!card) return;
    setPlatformOptions((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const p of selectedPlatforms) {
        if (!next[p]) {
          next[p] = defaultOptionsFor(p, card);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectedPlatforms, card]);

  useEffect(() => {
    if (!id || !card) return;
    for (const platform of selectedPlatforms) {
      if (!previews[platform]) {
        postcardApi
          .preview(id, platform)
          .then((p) => setPreviews((prev) => ({ ...prev, [platform]: p })))
          .catch(() => {});
      }
    }
  }, [selectedPlatforms, id, card, previews]);

  useEffect(() => {
    if (!post) return;
    const interval = setInterval(async () => {
      try {
        const updated = await publishApi.get(post.post.id);
        setPost(updated);
        const allTerminal = updated.post.targets.every(
          (t) => t.status === 'SUCCESS' || t.status === 'FAILED' || t.status === 'SKIPPED',
        );
        if (allTerminal) clearInterval(interval);
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [post]);

  async function handlePublish() {
    if (!id || selectedPlatforms.size === 0) return;
    setError(null);
    setLoading(true);
    try {
      // Attach the per-platform options to each platform entry. sanitizeOptions
      // drops empty-string fields (so the adapter falls back to its default)
      // and keeps booleans (e.g. YouTube madeForKids, DevTo published).
      const platforms = Array.from(selectedPlatforms).map((p) => {
        const opts = platformOptions[p];
        const sanitized = opts ? sanitizeOptions(opts) : undefined;
        return { platform: p, ...(sanitized ? { options: sanitized } : {}) };
      });
      const requestId = `publish-${Date.now()}`;
      const result = await publishApi.publish(id, platforms, requestId);
      setPost(result);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (!card) return <div className="text-white/50">Loading…</div>;

  return (
    <div className="max-w-4xl space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center justify-between"
      >
        <Link to={`/dashboard/postcards/${card.id}`}>
          <Button variant="ghost" size="sm" className="text-white/50 hover:text-white">
            ← Back to Post Card
          </Button>
        </Link>
      </motion.div>

      <div>
        <h1 className="text-3xl font-bold text-white">
          Amplify <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">"{card.title}"</span>
        </h1>
      </div>

      {/* Post Card summary */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
          <CardContent className="pt-6">
            <p className="text-white/60">{card.summary}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {card.techStack.map((tag) => (
                <span key={tag} className="rounded-md bg-indigo-500/10 px-2 py-1 font-mono text-xs text-indigo-300">
                  {tag}
                </span>
              ))}
            </div>
            {card.imageUrl && (
              <div className="mt-4">
                <MediaPreview src={card.imageUrl} alt={card.title} className="max-h-64 rounded-lg border border-white/10" />
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Platform checklist */}
      {connectedPlatforms.length === 0 ? (
        <Card className="border-amber-500/30 bg-amber-500/10 backdrop-blur-xl">
          <CardContent className="pt-6">
            <p className="mb-4 text-amber-400">You haven't connected any platforms yet.</p>
            <Link to="/dashboard/connections">
              <Button className="bg-gradient-to-r from-indigo-500 to-purple-500 border-0">Connect platforms →</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-white">Select platforms ({selectedPlatforms.size} selected)</h2>

          <div className="grid gap-3 md:grid-cols-2">
            {connectedPlatforms.map((conn, i) => {
              const selectable = isSelectable(conn);
              const selected = selectedPlatforms.has(conn.platform);
              return (
                <motion.div
                  key={conn.platform}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, delay: i * 0.05 }}
                  whileHover={selectable ? { scale: 1.02 } : undefined}
                  onClick={() => togglePlatform(conn)}
                >
                  <Card
                    className={`overflow-hidden border-white/10 bg-white/[0.03] backdrop-blur-xl transition-all ${
                      selected ? 'border-indigo-500/50 ring-2 ring-indigo-500/30' : ''
                    } ${selectable ? 'cursor-pointer hover:border-white/20' : 'cursor-not-allowed opacity-60'}`}
                  >
                    <CardContent className="flex items-center justify-between pt-6">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-white">{platformName(conn.platform)}</p>
                          {!selectable && (
                            <Badge variant="destructive" className="bg-red-500/20 text-red-300 text-[10px]">
                              {conn.status === 'REVOKED' ? 'Reconnect' : conn.status}
                            </Badge>
                          )}
                        </div>
                        <p className="truncate text-xs text-white/40">
                          {selectable ? `Connected as ${conn.platformUsername}` : `Token ${conn.status.toLowerCase()} — reconnect to publish`}
                        </p>
                      </div>
                      <motion.div
                        animate={{ scale: selected ? 1 : 0.8 }}
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-all ${
                          selected ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-white/20 bg-transparent'
                        }`}
                      >
                        {selected && '✓'}
                      </motion.div>
                    </CardContent>
                    {!selectable && (
                      <div className="border-t border-white/5 bg-red-500/5 px-6 py-2">
                        <Link
                          to="/dashboard/connections"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline"
                        >
                          Reconnect {platformName(conn.platform)} →
                        </Link>
                      </div>
                    )}
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {/* Per-platform options panel — shown only when ≥1 platform selected.
              This is the "post card UI per platform" the user asked for: after
              choosing platforms, each gets a platform-specific config card so
              the user can override the title/tags/category/privacy/caption/etc.
              per platform before publishing. */}
          {selectedPlatforms.size > 0 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-white">Per-platform options</h3>
              <p className="text-xs text-white/40">
                Defaults are pre-filled from your PostCard — edit per platform. Empty fields fall back to the auto-formatted post.
              </p>
              {Array.from(selectedPlatforms).map((platform, i) => (
                <motion.div
                  key={platform}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.05 }}
                >
                  <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
                    <CardContent className="space-y-4 pt-6">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-white">{platformName(platform)}</h4>
                        {previews[platform] && (
                          <span
                            className={`font-mono text-xs ${
                              previews[platform].formatted.charCount > previews[platform].formatted.limit ? 'text-red-400' : 'text-white/40'
                            }`}
                          >
                            {previews[platform].formatted.charCount}/{previews[platform].formatted.limit}
                          </span>
                        )}
                      </div>
                      <PerPlatformFields
                        platform={platform}
                        card={card}
                        options={platformOptions[platform] ?? {}}
                        onChange={(key, value) => updateOption(platform, key, value)}
                      />
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}

          {/* Live preview */}
          {selectedPlatforms.size > 0 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-white">Live Preview</h3>
              {Array.from(selectedPlatforms).map((platform, i) => {
                const preview = previews[platform];
                return (
                  <motion.div
                    key={platform}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.1 }}
                  >
                    <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
                      <CardContent className="pt-6">
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="font-medium text-white">{platformName(platform)}</h4>
                        </div>
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
                              <p className="mt-2 text-indigo-400">{preview.formatted.url}</p>
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
          )}

          {/* Amplify button */}
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              size="lg"
              onClick={handlePublish}
              disabled={loading || selectedPlatforms.size === 0}
              className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 border-0 text-base"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Publishing…
                </span>
              ) : (
                `🚀 Amplify to ${selectedPlatforms.size} platform${selectedPlatforms.size === 1 ? '' : 's'}`
              )}
            </Button>
          </motion.div>
        </div>
      )}

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status board */}
      <AnimatePresence>
        {post && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
              <CardContent className="pt-6">
                <h2 className="mb-4 text-lg font-semibold text-white">Publish Status</h2>
                <div className="space-y-3">
                  {post.post.targets.map((target, i) => {
                    const cfg = statusConfig[target.status] ?? statusConfig.QUEUED;
                    return (
                      <motion.div
                        key={target.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: i * 0.1 }}
                        className={`flex items-center justify-between rounded-xl border border-white/10 ${cfg.bg} p-4`}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className="text-xl"
                            style={{
                              animation: target.status === 'PUBLISHING' ? 'spin 1s linear infinite' : 'none',
                              display: 'inline-block',
                            }}
                          >
                            {cfg.icon}
                          </span>
                          <div>
                            <p className="font-medium text-white">{platformName(target.platform)}</p>
                            <p className={`text-xs ${cfg.color}`}>{cfg.label}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {target.error && (
                            <span className="max-w-xs truncate text-xs text-red-400" title={target.error}>
                              {target.error}
                            </span>
                          )}
                          {target.platformPostUrl && target.status === 'SUCCESS' && (
                            <motion.a
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              href={target.platformPostUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm text-indigo-400 hover:text-indigo-300 hover:underline"
                            >
                              View post →
                            </motion.a>
                          )}
                          {target.status === 'FAILED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-white/10 bg-white/5 text-white/60 hover:bg-indigo-500/10 hover:text-indigo-400"
                              onClick={async () => {
                                try {
                                  await publishApi.retry(post.post.id, target.id);
                                  const updated = await publishApi.get(post.post.id);
                                  setPost(updated);
                                } catch (err) {
                                  setError(getErrorMessage(err));
                                }
                              }}
                            >
                              Retry
                            </Button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
                {post.post.targets.every(
                  (t) => t.status === 'SUCCESS' || t.status === 'FAILED' || t.status === 'SKIPPED',
                ) && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-4">
                    <Link to="/dashboard/history">
                      <Button variant="outline" size="sm" className="border-white/10 bg-white/5 text-white/60 hover:bg-white/10">
                        View in History →
                      </Button>
                    </Link>
                  </motion.div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Per-platform options fields
// ============================================================================

interface PerPlatformFieldsProps {
  platform: string;
  card: PostCard;
  options: Record<string, string | boolean>;
  onChange: (key: string, value: string | boolean) => void;
}

/**
 * Render the per-platform option fields for a selected platform.
 *
 * Each platform has its own set of fields, all optional — empty values fall
 * back to the Format Engine's default (the adapter checks `opt.X.trim().length
 * > 0` before using an override). The fields map 1:1 to the option keys each
 * adapter reads:
 *   - YouTube: title, description, tags, categoryId, privacyStatus, madeForKids
 *   - Instagram: caption
 *   - Hashnode: tags, subtitle, coverImage, canonicalUrl
 *   - DevTo: tags, published, canonicalUrl
 *   - Bluesky: altText
 *   - Threads/Facebook/LinkedIn/X/Discord/Telegram/Mastodon/WordPress: no
 *     per-platform options yet (use the auto-formatted post).
 */
function PerPlatformFields({ platform, card, options, onChange }: PerPlatformFieldsProps) {
  const fieldCls =
    'mt-1 border-white/10 bg-white/5 text-white placeholder:text-white/20 focus:border-indigo-500/50';
  const labelCls = 'text-white/60';

  switch (platform) {
    case 'YOUTUBE':
      return (
        <div className="space-y-3">
          <div>
            <Label className={labelCls}>Title <span className="text-white/30">(≤100)</span></Label>
            <Input
              value={(options.title as string) ?? ''}
              onChange={(e) => onChange('title', e.target.value)}
              maxLength={100}
              placeholder={card.title}
              className={fieldCls}
            />
          </div>
          <div>
            <Label className={labelCls}>Description <span className="text-white/30">(≤5000)</span></Label>
            <Textarea
              value={(options.description as string) ?? ''}
              onChange={(e) => onChange('description', e.target.value)}
              maxLength={5000}
              rows={4}
              placeholder="Defaults to the PostCard body + repo/live URL"
              className={fieldCls}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className={labelCls}>Tags <span className="text-white/30">(comma-separated)</span></Label>
              <Input
                value={(options.tags as string) ?? ''}
                onChange={(e) => onChange('tags', e.target.value)}
                placeholder={card.techStack.join(', ')}
                className={fieldCls}
              />
            </div>
            <div>
              <Label className={labelCls}>Category</Label>
              <select
                value={(options.categoryId as string) ?? '22'}
                onChange={(e) => onChange('categoryId', e.target.value)}
                className={`${fieldCls} w-full rounded-md px-3 py-2 text-sm`}
              >
                {YOUTUBE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value} className="bg-zinc-900">
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className={labelCls}>Privacy</Label>
              <select
                value={(options.privacyStatus as string) ?? 'public'}
                onChange={(e) => onChange('privacyStatus', e.target.value)}
                className={`${fieldCls} w-full rounded-md px-3 py-2 text-sm`}
              >
                <option value="public" className="bg-zinc-900">Public</option>
                <option value="unlisted" className="bg-zinc-900">Unlisted</option>
                <option value="private" className="bg-zinc-900">Private</option>
              </select>
            </div>
            <label className="flex items-center gap-2 pt-6 text-white/60">
              <input
                type="checkbox"
                checked={(options.madeForKids as boolean) ?? false}
                onChange={(e) => onChange('madeForKids', e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-white/5"
              />
              <span className="text-sm">Made for kids</span>
            </label>
          </div>
        </div>
      );

    case 'INSTAGRAM':
      return (
        <div>
          <Label className={labelCls}>Caption <span className="text-white/30">(≤2200)</span></Label>
          <Textarea
            value={(options.caption as string) ?? ''}
            onChange={(e) => onChange('caption', e.target.value)}
            maxLength={2200}
            rows={4}
            placeholder="Defaults to: title + body + URL + #hashtags"
            className={fieldCls}
          />
        </div>
      );

    case 'HASHNODE':
      return (
        <div className="space-y-3">
          <div>
            <Label className={labelCls}>Tags <span className="text-white/30">(comma-separated, ≤5)</span></Label>
            <Input
              value={(options.tags as string) ?? ''}
              onChange={(e) => onChange('tags', e.target.value)}
              placeholder={card.techStack.join(', ')}
              className={fieldCls}
            />
          </div>
          <div>
            <Label className={labelCls}>Subtitle</Label>
            <Input
              value={(options.subtitle as string) ?? ''}
              onChange={(e) => onChange('subtitle', e.target.value)}
              maxLength={240}
              placeholder="Optional article subtitle"
              className={fieldCls}
            />
          </div>
          <div>
            <Label className={labelCls}>Cover image URL</Label>
            <Input
              value={(options.coverImage as string) ?? ''}
              onChange={(e) => onChange('coverImage', e.target.value)}
              placeholder={card.imageUrl ?? 'https://… (defaults to PostCard media)'}
              className={fieldCls}
            />
          </div>
          <div>
            <Label className={labelCls}>Canonical URL</Label>
            <Input
              value={(options.canonicalUrl as string) ?? ''}
              onChange={(e) => onChange('canonicalUrl', e.target.value)}
              placeholder={card.repoUrl || card.liveUrl || 'https://… (for cross-posting)'}
              className={fieldCls}
            />
          </div>
        </div>
      );

    case 'DEVTO':
      return (
        <div className="space-y-3">
          <div>
            <Label className={labelCls}>Tags <span className="text-white/30">(comma-separated, ≤4)</span></Label>
            <Input
              value={(options.tags as string) ?? ''}
              onChange={(e) => onChange('tags', e.target.value)}
              placeholder={card.techStack.join(', ')}
              className={fieldCls}
            />
          </div>
          <div>
            <Label className={labelCls}>Publish state</Label>
            <select
              value={(options.published as boolean) === false ? 'draft' : 'published'}
              onChange={(e) => onChange('published', e.target.value === 'published')}
              className={`${fieldCls} w-full rounded-md px-3 py-2 text-sm`}
            >
              <option value="published" className="bg-zinc-900">Published (live)</option>
              <option value="draft" className="bg-zinc-900">Draft (unlisted)</option>
            </select>
          </div>
          <div>
            <Label className={labelCls}>Canonical URL</Label>
            <Input
              value={(options.canonicalUrl as string) ?? ''}
              onChange={(e) => onChange('canonicalUrl', e.target.value)}
              placeholder={card.repoUrl || card.liveUrl || 'https://… (for cross-posting)'}
              className={fieldCls}
            />
          </div>
        </div>
      );

    case 'BLUESKY':
      return (
        <div>
          <Label className={labelCls}>Image alt text <span className="text-white/30">(accessibility)</span></Label>
          <Input
            value={(options.altText as string) ?? ''}
            onChange={(e) => onChange('altText', e.target.value)}
            maxLength={1000}
            placeholder="Describe the attached image for screen readers"
            className={fieldCls}
          />
        </div>
      );

    default:
      // Threads, Facebook, LinkedIn, X (Twitter), Discord, Telegram,
      // Mastodon, WordPress — no per-platform options yet; the auto-formatted
      // post (Format Engine) is used as-is.
      return (
        <p className="text-xs text-white/30">
          No per-platform options for {platformName(platform)} — the auto-formatted PostCard is used as-is.
        </p>
      );
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Pre-fill per-platform option defaults from the PostCard so the user has a
 * starting point to edit (rather than blank fields). Empty strings are fine —
 * the adapter falls back to its Format Engine default when a field is blank.
 */
function defaultOptionsFor(platform: string, card: PostCard): Record<string, string | boolean> {
  switch (platform) {
    case 'YOUTUBE':
      return {
        title: card.title,
        description: '',
        tags: card.techStack.join(', '),
        categoryId: '22',
        privacyStatus: 'public',
        madeForKids: false,
      };
    case 'INSTAGRAM':
      return { caption: '' };
    case 'HASHNODE':
      return {
        tags: card.techStack.join(', '),
        subtitle: '',
        coverImage: card.imageUrl ?? '',
        canonicalUrl: card.repoUrl || card.liveUrl || '',
      };
    case 'DEVTO':
      return {
        tags: card.techStack.join(', '),
        published: true,
        canonicalUrl: card.repoUrl || card.liveUrl || '',
      };
    case 'BLUESKY':
      return { altText: '' };
    default:
      return {};
  }
}

/**
 * Drop empty-string option values before sending — the adapter treats an
 * absent key as "use the Format Engine default", but an empty-string key
 * would clobber the default (the adapter does `.trim().length > 0` checks,
 * but stripping here is cleaner + avoids sending noise). Booleans are kept
 * as-is (YouTube madeForKids=false is meaningful, not a default).
 *
 * Returns undefined when no options remain, so the publish request omits the
 * `options` field entirely for platforms with no overrides.
 */
function sanitizeOptions(
  opts: Record<string, string | boolean>,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string' && value.trim().length > 0) {
      // tags comes back as a comma-separated string; the adapters expect an
      // array. Split + trim here so the adapter's `Array.isArray(opt.tags)`
      // branch matches.
      if (key === 'tags') {
        const arr = value
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        if (arr.length > 0) out[key] = arr;
      } else {
        out[key] = value;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function platformName(platform: string): string {
  const names: Record<string, string> = {
    BLUESKY: 'Bluesky',
    HASHNODE: 'Hashnode',
    TWITTER: 'X (Twitter)',
    TWITTER_COOKIE: 'X (Twitter)',
    LINKEDIN: 'LinkedIn',
    INSTAGRAM: 'Instagram',
    YOUTUBE: 'YouTube',
    DEVTO: 'Dev.to',
    DISCORD: 'Discord',
    TELEGRAM: 'Telegram',
    THREADS: 'Threads',
    FACEBOOK: 'Facebook',
    MASTODON: 'Mastodon',
    WORDPRESS: 'WordPress',
  };
  return names[platform] ?? platform;
}
