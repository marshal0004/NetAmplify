// /home/z/my-project/netamplify-app/apps/frontend/src/pages/PublishPage.tsx
// NetAmplify — Publish page (the core UX).
// Per docs/06-FRONTEND-SPEC.md Screen 6: platform checklist + per-platform
// live preview + Amplify button + status board with polling.

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from "@tanstack/react-query";
import { postcardApi, connectionsApi, publishApi, type Post, type Preview } from '@/lib/api';
import { getErrorMessage } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';

export function PublishPage() {
  const { id } = useParams<{ id: string }>();
  

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

  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [subreddit, setSubreddit] = useState('test');
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Per-platform live preview (fetched when a platform is selected)
  const [previews, setPreviews] = useState<Record<string, Preview>>({});

  // Toggle platform selection
  function togglePlatform(platform: string) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) {
        next.delete(platform);
      } else {
        next.add(platform);
      }
      return next;
    });
  }

  // Fetch preview when platform selection changes
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

  // Poll for status after publish
  useEffect(() => {
    if (!post) return;
    const interval = setInterval(async () => {
      try {
        const updated = await publishApi.get(post.post.id);
        setPost(updated);
        // Stop polling when all targets reach terminal state
        const allTerminal = updated.post.targets.every(
          (t) => t.status === 'SUCCESS' || t.status === 'FAILED' || t.status === 'SKIPPED'
        );
        if (allTerminal) clearInterval(interval);
      } catch {
        // ignore polling errors
      }
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

  if (!card) return <div>Loading…</div>;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <Link to={`/dashboard/postcards/${card.id}`}>
          <Button variant="ghost" size="sm">← Back to Post Card</Button>
        </Link>
      </div>

      <h1 className="text-2xl font-bold">Amplify "{card.title}"</h1>

      {/* Left: Post Card summary */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-gray-600">{card.summary}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {card.techStack.map((tag) => (
              <span key={tag} className="rounded-md bg-gray-100 px-2 py-1 font-mono text-xs">{tag}</span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Right: Platform checklist */}
      {connectedPlatforms.length === 0 ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-6">
            <p className="mb-4 text-amber-700">You haven't connected any platforms yet.</p>
            <Link to="/dashboard/connections">
              <Button>Connect platforms →</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Select platforms ({selectedPlatforms.size} selected)</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {connectedPlatforms.map((conn) => (
              <Card
                key={conn.platform}
                className={`cursor-pointer transition-all ${
                  selectedPlatforms.has(conn.platform) ? 'border-indigo-500 ring-2 ring-indigo-500' : ''
                }`}
                onClick={() => togglePlatform(conn.platform)}
              >
                <CardContent className="flex items-center justify-between pt-6">
                  <div>
                    <p className="font-medium">{platformName(conn.platform)}</p>
                    <p className="text-xs text-gray-500">Connected as {conn.platformUsername}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={selectedPlatforms.has(conn.platform)}
                    onChange={() => togglePlatform(conn.platform)}
                    className="h-5 w-5"
                  />
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Reddit subreddit input */}
          {selectedPlatforms.has('REDDIT') && (
            <div className="space-y-2">
              <Label htmlFor="subreddit">Subreddit for Reddit</Label>
              <Input
                id="subreddit"
                value={subreddit}
                onChange={(e) => setSubreddit(e.target.value)}
                placeholder="sideproject"
                className="max-w-xs"
              />
            </div>
          )}

          {/* Per-platform live preview */}
          {selectedPlatforms.size > 0 && (
            <div className="space-y-4">
              <h3 className="font-semibold">Live Preview</h3>
              {Array.from(selectedPlatforms).map((platform) => {
                const preview = previews[platform];
                return (
                  <Card key={platform}>
                    <CardContent className="pt-6">
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="font-medium">{platformName(platform)}</h4>
                        {preview && (
                          <span className="font-mono text-xs text-gray-500">
                            {preview.formatted.charCount}/{preview.formatted.limit}
                          </span>
                        )}
                      </div>
                      {preview ? (
                        <div className="rounded-md bg-gray-50 p-3 text-sm">
                          {preview.formatted.title && (
                            <p className="mb-2 font-semibold">{preview.formatted.title}</p>
                          )}
                          <p className="whitespace-pre-wrap text-gray-700">
                            {preview.formatted.body?.slice(0, 500)}
                            {(preview.formatted.body?.length ?? 0) > 500 ? '…' : ''}
                          </p>
                          {preview.formatted.url && (
                            <p className="mt-2 text-indigo-600">{preview.formatted.url}</p>
                          )}
                          {preview.formatted.hashtags && preview.formatted.hashtags.length > 0 && (
                            <p className="mt-2 text-xs text-gray-500">
                              {preview.formatted.hashtags.map((t) => `#${t}`).join(' ')}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">Loading preview…</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Amplify button */}
          <Button
            size="lg"
            onClick={handlePublish}
            disabled={loading || selectedPlatforms.size === 0}
            className="w-full"
          >
            {loading ? 'Publishing…' : `🚀 Amplify to ${selectedPlatforms.size} platform${selectedPlatforms.size === 1 ? '' : 's'}`}
          </Button>
        </div>
      )}

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Status board (appears after publish) */}
      {post && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">Publish Status</h2>
            <div className="space-y-3">
              {post.post.targets.map((target) => (
                <div key={target.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={target.status} />
                    <span className="font-medium">{platformName(target.platform)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {target.error && (
                      <span className="text-sm text-red-600">{target.error}</span>
                    )}
                    {target.platformPostUrl && target.status === 'SUCCESS' && (
                      <a
                        href={target.platformPostUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-indigo-600 hover:underline"
                      >
                        View post →
                      </a>
                    )}
                    {target.status === 'FAILED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await publishApi.retry(post.post.id, target.id);
                            // Trigger re-poll
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
                </div>
              ))}
            </div>
            {post.post.targets.every(
              (t) => t.status === 'SUCCESS' || t.status === 'FAILED' || t.status === 'SKIPPED'
            ) && (
              <div className="mt-4">
                <Link to="/dashboard/history">
                  <Button variant="outline" size="sm">View in History →</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function platformName(platform: string): string {
  const names: Record<string, string> = {
    REDDIT: 'Reddit',
    DISCORD: 'Discord',
    DEVTO: 'Dev.to',
    TELEGRAM: 'Telegram',
    BLUESKY: 'Bluesky',
    HASHNODE: 'Hashnode',
    TWITTER: 'X (Twitter)',
    LINKEDIN: 'LinkedIn',
  };
  return names[platform] ?? platform;
}
