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
//      Instagram: caption;
//      DevTo: tags/published/canonical; Bluesky: altText). These options
//      flow through the publish request → worker → Format Engine → adapter
//      (each adapter honors its own option keys; see the adapter files).
//   4. Live preview per platform (char counter against the platform limit).
//   5. Amplify → POST /api/postcards/:id/publish → poll /api/posts/:id.

import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
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
import { LivePreviewGrid } from '@/components/LivePreviewGrid';
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
  const [scheduledAt, setScheduledAt] = useState(''); // ISO datetime string for scheduling (empty = publish now)
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

  // Pre-publish validation — checks each selected platform for blocking
  // errors (expired connections, missing media for Instagram/YouTube) and
  // warnings (char-limit overflow). Matching postflare's checkAccount UX.
  const validationIssues = useMemo(() => {
    return validatePublish(selectedPlatforms, connections ?? [], card, previews);
  }, [selectedPlatforms, connections, card, previews]);

  const blockingErrorCount = validationIssues.filter(
    (i) => i.level === 'error',
  ).length;
  const hasBlockingErrors = blockingErrorCount > 0;

  async function handlePublish() {
    if (!id || selectedPlatforms.size === 0) return;
    setError(null);
    setLoading(true);
    try {
      const platforms = Array.from(selectedPlatforms).map((p) => {
        const opts = platformOptions[p];
        const sanitized = opts ? sanitizeOptions(opts) : undefined;
        return { platform: p, ...(sanitized ? { options: sanitized } : {}) };
      });
      const requestId = `publish-${Date.now()}`;
      const result = await publishApi.publish(id, platforms, requestId, scheduledAt || undefined);
      setPost(result);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (!card) return <div className="text-zinc-500">Loading…</div>;

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
          <Button variant="ghost" size="sm" className="text-zinc-500 hover:text-zinc-900">
            ← Back to Post Card
          </Button>
        </Link>
      </motion.div>

      <div>
        <h1 className="text-3xl font-bold text-white">
          Amplify <span className="bg-gradient-to-r text-orange-500 bg-clip-text text-transparent">"{card.title}"</span>
        </h1>
      </div>

      {/* Post Card summary */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <Card className="ring-1 ring-zinc-200 bg-white shadow-sm">
          <CardContent className="pt-6">
            <p className="text-zinc-600">{card.summary}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {card.techStack.map((tag) => (
                <span key={tag} className="rounded-md bg-orange-50 px-2 py-1 font-mono text-xs text-orange-600">
                  {tag}
                </span>
              ))}
            </div>
            {card.imageUrl && (
              <div className="mt-4">
                <MediaPreview src={card.imageUrl} alt={card.title} className="max-h-64 rounded-lg border ring-1 ring-zinc-200" />
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
              <Button className="bg-gradient-to-r bg-orange-600 border-0">Connect platforms →</Button>
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
                    className={`overflow-hidden ring-1 ring-zinc-200 bg-white shadow-sm transition-all ${
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
                        <p className="truncate text-xs text-zinc-400">
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
                      <div className="border-t ring-1 ring-zinc-100 bg-red-500/5 px-6 py-2">
                        <Link
                          to="/dashboard/connections"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-orange-500 hover:text-orange-600 hover:underline"
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
              <p className="text-xs text-zinc-400">
                Defaults are pre-filled from your PostCard — edit per platform. Empty fields fall back to the auto-formatted post.
              </p>
              {Array.from(selectedPlatforms).map((platform, i) => (
                <motion.div
                  key={platform}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.05 }}
                >
                  <Card className="ring-1 ring-zinc-200 bg-white shadow-sm">
                    <CardContent className="space-y-4 pt-6">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-white">{platformName(platform)}</h4>
                        {previews[platform] && (
                          <span
                            className={`font-mono text-xs ${
                              previews[platform].formatted.charCount > previews[platform].formatted.limit ? 'text-red-400' : 'text-zinc-400'
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

          {/* Live preview — extracted to LivePreviewGrid (responsive 2-per-row
              grid + per-card media rendering via MediaPreview). The component
              returns null when no platforms are selected, so it can be mounted
              unconditionally. See components/LivePreviewGrid.tsx. */}
          <LivePreviewGrid
            card={card}
            selectedPlatforms={selectedPlatforms}
            previews={previews}
            platformName={platformName}
          />

          {/* Pre-publish validation panel — shows per-platform issues before
              the user clicks Amplify, preventing the most common publish errors
              (missing media for Instagram/YouTube, expired connections, char
              limit overflows). Matching postflare's checkAccount UX. */}
          <PublishValidation
            selectedPlatforms={selectedPlatforms}
            connections={connections ?? []}
            card={card}
            previews={previews}
            platformName={platformName}
          />

          {/* Scheduling — datetime picker with quick picks (matching postflare's
              SchedulePicker UX). Empty = publish immediately (current behavior). */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="datetime-local"
              value={scheduledAt ? scheduledAt.slice(0, 16) : ''}
              onChange={(e) => {
                const val = e.target.value;
                setScheduledAt(val ? new Date(val).toISOString() : '');
              }}
              className="rounded-lg border ring-1 ring-zinc-200 text-zinc-50 px-3 py-2 text-sm text-white [color-scheme:dark]"
              title="Schedule for later (leave empty to publish now)"
            />
            {scheduledAt && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setScheduledAt('')}
                className="text-zinc-400 hover:text-zinc-900"
              >
                Clear (publish now)
              </Button>
            )}
            {!scheduledAt && (
              <>
                <Button type="button" variant="ghost" size="sm"
                  onClick={() => setScheduledAt(new Date(Date.now() + 3600_000).toISOString())}
                  className="text-zinc-400 hover:text-zinc-900">
                  In 1 hour
                </Button>
                <Button type="button" variant="ghost" size="sm"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 1);
                    d.setHours(9, 0, 0, 0);
                    setScheduledAt(d.toISOString());
                  }}
                  className="text-zinc-400 hover:text-zinc-900">
                  Tomorrow 9:00
                </Button>
              </>
            )}
          </div>

          {/* Amplify / Schedule button */}
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              size="lg"
              onClick={handlePublish}
              disabled={loading || selectedPlatforms.size === 0 || hasBlockingErrors}
              className="w-full bg-gradient-to-r bg-orange-600 hover:bg-orange-700 border-0 text-base"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {scheduledAt ? 'Scheduling…' : 'Publishing…'}
                </span>
              ) : hasBlockingErrors ? (
                `Fix ${blockingErrorCount} issue${blockingErrorCount === 1 ? '' : 's'} to publish`
              ) : scheduledAt ? (
                `📅 Schedule for ${new Date(scheduledAt).toLocaleString()}`
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
            <Card className="ring-1 ring-zinc-200 bg-white shadow-sm">
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
                        className={`flex items-center justify-between rounded-xl border ring-1 ring-zinc-200 ${cfg.bg} p-4`}
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
                              className="text-sm text-orange-500 hover:text-orange-600 hover:underline"
                            >
                              View post →
                            </motion.a>
                          )}
                          {target.status === 'FAILED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="ring-1 ring-zinc-200 text-zinc-50 text-zinc-600 hover:bg-orange-50 hover:text-orange-500"
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
                      <Button variant="outline" size="sm" className="ring-1 ring-zinc-200 text-zinc-50 text-zinc-600 hover:text-zinc-100">
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
 *   - DevTo: tags, published, canonicalUrl
 *   - Bluesky: altText
 *   - Threads/Facebook/LinkedIn/X/Discord/Telegram/Mastodon/WordPress: no
 *     per-platform options yet (use the auto-formatted post).
 */
function PerPlatformFields({ platform, card, options, onChange }: PerPlatformFieldsProps) {
  const fieldCls =
    'mt-1 ring-1 ring-zinc-200 text-zinc-50 text-zinc-900 placeholder:text-zinc-300 focus:ring-2 focus:ring-orange-500';
  const labelCls = 'text-zinc-600';

  switch (platform) {
    case 'YOUTUBE':
      return (
        <div className="space-y-3">
          <div>
            <Label className={labelCls}>Title <span className="text-zinc-400">(≤100)</span></Label>
            <Input
              value={(options.title as string) ?? ''}
              onChange={(e) => onChange('title', e.target.value)}
              maxLength={100}
              placeholder={card.title}
              className={fieldCls}
            />
          </div>
          <div>
            <Label className={labelCls}>Description <span className="text-zinc-400">(≤5000)</span></Label>
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
              <Label className={labelCls}>Tags <span className="text-zinc-400">(comma-separated)</span></Label>
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
            <label className="flex items-center gap-2 pt-6 text-zinc-600">
              <input
                type="checkbox"
                checked={(options.madeForKids as boolean) ?? false}
                onChange={(e) => onChange('madeForKids', e.target.checked)}
                className="h-4 w-4 rounded border-white/20 text-zinc-50"
              />
              <span className="text-sm">Made for kids</span>
            </label>
          </div>
        </div>
      );

    case 'INSTAGRAM':
      return (
        <div>
          <Label className={labelCls}>Caption <span className="text-zinc-400">(≤2200)</span></Label>
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

    default:
      return (
        <p className="text-xs text-zinc-400">
          No per-platform options for {platformName(platform)} — the auto-formatted PostCard is used as-is.
        </p>
      );
  }
}

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
    case 'DEVTO':
      return {
        tags: card.techStack.join(', '),
        published: true,
        canonicalUrl: card.repoUrl || card.liveUrl || '',
      };
    case 'BLUESKY':
      return { altText: '' };
    case 'LINKEDIN':
      return { hashtags: '', visibility: 'PUBLIC' };
    case 'FACEBOOK':
      return { hashtags: '' };
    case 'THREADS':
      return { caption: '' };
    case 'DISCORD':
      return { username: '' };
    case 'TELEGRAM':
      return { disableNotification: false };
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

// ============================================================================
// Pre-publish validation (comparison point #8 — live client-side validation)
// ============================================================================

/** Platforms that REQUIRE media (image or video) to publish. */
const MEDIA_REQUIRED_PLATFORMS = new Set(['INSTAGRAM', 'YOUTUBE', 'THREADS']);

/** Per-platform media limits (mirrors PLATFORM_CONFIG on the backend). */
const PLATFORM_MEDIA_LIMITS: Record<string, { maxImages: number; maxVideos: number; mixedMedia: boolean }> = {
  DISCORD: { maxImages: 10, maxVideos: 10, mixedMedia: true },
  DEVTO: { maxImages: 1, maxVideos: 0, mixedMedia: false },
  TELEGRAM: { maxImages: 1, maxVideos: 1, mixedMedia: false },
  BLUESKY: { maxImages: 4, maxVideos: 1, mixedMedia: false },
  TWITTER: { maxImages: 4, maxVideos: 1, mixedMedia: false },
  LINKEDIN: { maxImages: 1, maxVideos: 0, mixedMedia: false },
  MASTODON: { maxImages: 4, maxVideos: 1, mixedMedia: false },
  WORDPRESS: { maxImages: 1, maxVideos: 0, mixedMedia: false },
  TWITTER_COOKIE: { maxImages: 4, maxVideos: 1, mixedMedia: false },
  FACEBOOK: { maxImages: 10, maxVideos: 1, mixedMedia: false },
  INSTAGRAM: { maxImages: 1, maxVideos: 1, mixedMedia: false },
  YOUTUBE: { maxImages: 0, maxVideos: 1, mixedMedia: false },
  THREADS: { maxImages: 1, maxVideos: 1, mixedMedia: false },
};

interface ValidationIssue {
  platform: string;
  level: 'error' | 'warning';
  message: string;
}

/**
 * Validate the publish configuration for each selected platform.
 *
 * Checks (matching postflare's checkAccount):
 *   - ERROR: connection is not ACTIVE (REVOKED, ERROR, or missing)
 *   - ERROR: media required (Instagram, YouTube, Threads) but no imageUrl
 *   - WARNING: char count exceeds the platform's limit (will be truncated)
 *
 * Returns an array of issues. The Amplify button is disabled when any
 * issue has level === 'error'.
 */
function validatePublish(
  selectedPlatforms: Set<string>,
  connections: Array<{ platform: string; status: string; platformUsername: string | null }>,
  card: { imageUrl?: string | null; mediaUrls?: string[]; title: string } | undefined,
  previews: Record<string, { formatted: { charCount?: number; limit?: number } }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Collect all media URLs from the PostCard (mediaUrls array + imageUrl for
  // backward compat). Split into images vs videos by extension.
  const allMedia = [
    ...(card?.mediaUrls ?? []),
    ...(card?.imageUrl ? [card.imageUrl] : []),
  ];
  const videoRe = /\.(mp4|webm|mov|m4v|ogg)$/i;
  const imageCount = allMedia.filter((u) => !videoRe.test(u.split(/[?#]/)[0])).length;
  const videoCount = allMedia.filter((u) => videoRe.test(u.split(/[?#]/)[0])).length;
  for (const platform of selectedPlatforms) {
    const conn = connections.find((c) => c.platform === platform);

    // Check 1: connection status
    if (!conn) {
      issues.push({
        platform,
        level: 'error',
        message: 'No connection found — connect this platform first.',
      });
      continue;
    }
    if (conn.status !== 'ACTIVE') {
      issues.push({
        platform,
        level: 'error',
        message: `Connection is ${conn.status} — reconnect to publish.`,
      });
    }

    // Check 2: media requirement (Instagram, YouTube, Threads need at least 1 media)
    if (MEDIA_REQUIRED_PLATFORMS.has(platform) && allMedia.length === 0) {
      issues.push({
        platform,
        level: 'error',
        message: 'Media required — upload an image or video in the PostCard.',
      });
    }

    // Check 2b: per-platform media limits (maxImages, maxVideos, mixedMedia)
    const limits = PLATFORM_MEDIA_LIMITS[platform];
    if (limits) {
      if (imageCount > limits.maxImages) {
        issues.push({
          platform,
          level: 'warning',
          message: `${platformName(platform)} allows max ${limits.maxImages} image${limits.maxImages === 1 ? '' : 's'} — extra will be dropped.`,
        });
      }
      if (videoCount > limits.maxVideos) {
        issues.push({
          platform,
          level: 'warning',
          message: `${platformName(platform)} allows max ${limits.maxVideos} video${limits.maxVideos === 1 ? '' : 's'} — extra will be dropped.`,
        });
      }
      if (!limits.mixedMedia && imageCount > 0 && videoCount > 0) {
        issues.push({
          platform,
          level: 'warning',
          message: `${platformName(platform)} doesn't support mixed images + videos — only the first media item will be used.`,
        });
      }
    }

    // Check 3: char limit overflow (warning, not error — text gets truncated)
    const preview = previews[platform];
    if (preview?.formatted?.limit && preview?.formatted?.charCount) {
      const limit = preview.formatted.limit;
      const count = preview.formatted.charCount;
      if (count > limit) {
        issues.push({
          platform,
          level: 'warning',
          message: `Text exceeds ${limit} chars by ${count - limit} — will be truncated.`,
        });
      }
    }
  }

  return issues;
}

/**
 * Compact validation panel rendered before the Amplify button.
 * Shows a summary + per-platform issues. Errors are red, warnings are amber.
 * When there are no issues, shows a green "All platforms ready" message.
 */
function PublishValidation({
  selectedPlatforms,
  connections,
  card,
  previews,
  platformName: pName,
}: {
  selectedPlatforms: Set<string>;
  connections: Array<{ platform: string; status: string; platformUsername: string | null }>;
  card: { imageUrl?: string | null; title: string } | undefined;
  previews: Record<string, { formatted: { charCount?: number; limit?: number } }>;
  platformName: (platform: string) => string;
}) {
  const issues = validatePublish(selectedPlatforms, connections, card, previews);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-2 text-sm text-green-400">
        <CheckCircle2 className="h-4 w-4" />
        All {selectedPlatforms.size} platform{selectedPlatforms.size === 1 ? '' : 's'} ready to publish
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border ring-1 ring-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-center gap-3 text-sm">
        {errors.length > 0 && (
          <span className="flex items-center gap-1 text-red-400">
            <AlertCircle className="h-4 w-4" />
            {errors.length} error{errors.length === 1 ? '' : 's'}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="flex items-center gap-1 text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {issues.map((issue, i) => (
          <div
            key={`${issue.platform}-${i}`}
            className={`flex items-start gap-2 text-xs ${
              issue.level === 'error' ? 'text-red-400' : 'text-amber-400'
            }`}
          >
            <span className="font-medium">{pName(issue.platform)}:</span>
            <span className="text-zinc-600">{issue.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
