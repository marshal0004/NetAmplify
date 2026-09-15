import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { publishApi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';

const statusConfig: Record<string, string> = {
  QUEUED: 'bg-gray-500/10 text-gray-400',
  PUBLISHING: 'bg-blue-500/10 text-blue-400 animate-pulse',
  SUCCESS: 'bg-green-500/10 text-green-400',
  FAILED: 'bg-red-500/10 text-red-400',
  SKIPPED: 'bg-gray-500/10 text-gray-400',
};

export function History() {
  const [platformFilter, setPlatformFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['posts', 1, platformFilter, statusFilter],
    queryFn: () => publishApi.list(1, 20, { platform: platformFilter || undefined, status: statusFilter || undefined }),
  });

  return (
    <div className="space-y-8">
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-3xl font-bold text-white"
      >
        Publish History
      </motion.h1>

      <div className="flex gap-4">
        <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
          <option value="">All platforms</option>
          {['REDDIT', 'DISCORD', 'DEVTO', 'TELEGRAM', 'BLUESKY', 'HASHNODE', 'TWITTER', 'LINKEDIN'].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
          <option value="">All statuses</option>
          {['QUEUED', 'PUBLISHING', 'SUCCESS', 'FAILED', 'SKIPPED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="text-white/50">Loading history…</div>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-4">
          {data.items.map((item, i) => (
            <motion.div key={item.post.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: i * 0.05 }}>
              <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
                <CardContent className="pt-6">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm text-white/40">{new Date(item.post.createdAt).toLocaleString()}</span>
                    <span className="text-xs text-white/20">Post ID: {item.post.id}</span>
                  </div>
                  <div className="space-y-2">
                    {item.post.targets.map((target) => (
                      <div key={target.id} className="flex items-center justify-between rounded-lg bg-black/30 px-3 py-2">
                        <div className="flex items-center gap-3">
                          <span className={`rounded-md px-2 py-0.5 text-xs font-mono ${statusConfig[target.status] ?? statusConfig.QUEUED}`}>
                            {target.status}
                          </span>
                          <span className="text-sm font-medium text-white">{target.platform}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {target.error && <span className="max-w-xs truncate text-xs text-red-400" title={target.error}>{target.error}</span>}
                          {target.platformPostUrl && (
                            <a href={target.platformPostUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:underline">View →</a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <Card className="border-dashed border-white/10 bg-white/[0.02]">
          <CardContent className="pt-6 text-center">
            <p className="text-lg text-white/40">No publishes yet</p>
            <p className="text-sm text-white/30">Create a Post Card and amplify it to see history here.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
