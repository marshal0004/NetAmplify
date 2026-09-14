import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { postcardApi, connectionsApi, publishApi, type Post, type Preview } from '@/lib/api';
import { getErrorMessage } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const statusConfig: Record<string, { color: string; bg: string; label: string; icon: string }> = {
  QUEUED: { color: 'text-gray-400', bg: 'bg-gray-500/10', label: 'Queued', icon: '⏳' },
  PUBLISHING: { color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Publishing', icon: '🔄' },
  SUCCESS: { color: 'text-green-400', bg: 'bg-green-500/10', label: 'Success', icon: '✅' },
  FAILED: { color: 'text-red-400', bg: 'bg-red-500/10', label: 'Failed', icon: '❌' },
  SKIPPED: { color: 'text-gray-400', bg: 'bg-gray-500/10', label: 'Skipped', icon: '⏭️' },
};

export function PublishPage() {
  const { id } = useParams<{ id: string }>();
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [subreddit, setSubreddit] = useState('test');
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});

  const { data: card } = useQuery({
    queryKey: ['postcard', id],
    queryFn: () => postcardApi.get(id!),
    enabled: !!id,
  });

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => connectionsApi.list(),
  });

  const connectedPlatforms = connections?.filter((c) => c.platformUsername !== null && c.configured) ?? [];

  function togglePlatform(platform: string) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  useEffect(() => {
    if (!id || !card) return;
    for (const platform of selectedPlatforms) {
      if (!previews[platform]) {
        postcardApi
          .preview(id, platform, platform === 'REDDIT' ? subreddit : undefined)
          .then((p) => setPreviews((prev) => ({ ...prev, [platform]: p })))
          .catch(() => {});
      }
    }
  }, [selectedPlatforms, id, card, subreddit, previews]);

  useEffect(() => {
    if (!post) return;
    const interval = setInterval(async () => {
      try {
        const updated = await publishApi.get(post.post.id);
        setPost(updated);
        const allTerminal = updated.post.targets.every(
          (t) => t.status === 'SUCCESS' || t.status === 'FAILED' || t.status === 'SKIPPED'
        );
        if (allTerminal) clearInterval(interval);
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [post]);

  async function handlePublish() {
    if (!id || selectedPlatforms.size === 0) return;
    setError(null);
    setLoading(true);
    try {
      const platforms = Array.from(selectedPlatforms).map((p) => ({
        platform: p,
        ...(p === 'REDDIT' ? { options: { subreddit } } : {}),
      }));
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
          <Button variant="ghost" size="sm" className="text-white/50 hover:text-white">← Back to Post Card</Button>
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
                <span key={tag} className="rounded-md bg-indigo-500/10 px-2 py-1 font-mono text-xs text-indigo-300">{tag}</span>
              ))}
            </div>
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
            {connectedPlatforms.map((conn, i) => (
              <motion.div
                key={conn.platform}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                whileHover={{ scale: 1.02 }}
                onClick={() => togglePlatform(conn.platform)}
              >
                <Card
                  className={`cursor-pointer overflow-hidden border-white/10 bg-white/[0.03] backdrop-blur-xl transition-all ${
                    selectedPlatforms.has(conn.platform)
                      ? 'border-indigo-500/50 ring-2 ring-indigo-500/30'
                      : 'hover:border-white/20'
                  }`}
                >
                  <CardContent className="flex items-center justify-between pt-6">
                    <div>
                      <p className="font-medium text-white">{platformName(conn.platform)}</p>
                      <p className="text-xs text-white/40">Connected as {conn.platformUsername}</p>
                    </div>
                    <motion.div
                      animate={{ scale: selectedPlatforms.has(conn.platform) ? 1 : 0.8 }}
                      className={`flex h-6 w-6 items-center justify-center rounded-md border-2 transition-all ${
                        selectedPlatforms.has(conn.platform)
                          ? 'border-indigo-500 bg-indigo-500 text-white'
                          : 'border-white/20 bg-transparent'
                      }`}
                    >
                      {selectedPlatforms.has(conn.platform) && '✓'}
                    </motion.div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Reddit subreddit input */}
          {selectedPlatforms.has('REDDIT') && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="space-y-2"
            >
              <Label htmlFor="subreddit" className="text-white/50">Subreddit for Reddit</Label>
              <Input
                id="subreddit"
                value={subreddit}
                onChange={(e) => setSubreddit(e.target.value)}
                placeholder="sideproject"
                className="max-w-xs border-white/10 bg-white/5 text-white placeholder:text-white/20"
              />
            </motion.div>
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
                          {preview && (
                            <span className={`font-mono text-xs ${preview.formatted.charCount > preview.formatted.limit ? 'text-red-400' : 'text-white/40'}`}>
                              {preview.formatted.charCount}/{preview.formatted.limit}
                            </span>
                          )}
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
                          <span className="text-xl" style={{
                            animation: target.status === 'PUBLISHING' ? 'spin 1s linear infinite' : 'none',
                            display: 'inline-block',
                          }}>
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
                  (t) => t.status === 'SUCCESS' || t.status === 'FAILED' || t.status === 'SKIPPED'
                ) && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="mt-4"
                  >
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

function platformName(platform: string): string {
  const names: Record<string, string> = {
    REDDIT: 'Reddit', DISCORD: 'Discord', DEVTO: 'Dev.to', TELEGRAM: 'Telegram',
    BLUESKY: 'Bluesky', HASHNODE: 'Hashnode', TWITTER: 'X (Twitter)', LINKEDIN: 'LinkedIn',
  };
  return names[platform] ?? platform;
}
