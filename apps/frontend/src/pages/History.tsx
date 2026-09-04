// /home/z/my-project/netamplify-app/apps/frontend/src/pages/History.tsx
// NetAmplify — History dashboard.
// Per docs/06-FRONTEND-SPEC.md Screen 7: table with per-target status chips,
// permalinks, timestamps, filter by platform/status.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { publishApi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';

export function History() {
  const [platformFilter, setPlatformFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['posts', 1, platformFilter, statusFilter],
    queryFn: () =>
      publishApi.list(1, 20, {
        platform: platformFilter || undefined,
        status: statusFilter || undefined,
      }),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Publish History</h1>

      {/* Filters */}
      <div className="flex gap-4">
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="">All platforms</option>
          <option value="REDDIT">Reddit</option>
          <option value="DISCORD">Discord</option>
          <option value="DEVTO">Dev.to</option>
          <option value="TELEGRAM">Telegram</option>
          <option value="BLUESKY">Bluesky</option>
          <option value="HASHNODE">Hashnode</option>
          <option value="TWITTER">X</option>
          <option value="LINKEDIN">LinkedIn</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="QUEUED">Queued</option>
          <option value="PUBLISHING">Publishing</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILED">Failed</option>
          <option value="SKIPPED">Skipped</option>
        </select>
      </div>

      {isLoading ? (
        <div>Loading history…</div>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-4">
          {data.items.map((item) => (
            <Card key={item.post.id}>
              <CardContent className="pt-6">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm text-gray-500">
                    {new Date(item.post.createdAt).toLocaleString()}
                  </span>
                  <span className="text-xs text-gray-400">Post ID: {item.post.id}</span>
                </div>
                <div className="space-y-2">
                  {item.post.targets.map((target) => (
                    <div key={target.id} className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
                      <div className="flex items-center gap-3">
                        <StatusBadge status={target.status} />
                        <span className="text-sm font-medium">{target.platform}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {target.error && (
                          <span className="max-w-xs truncate text-xs text-red-600" title={target.error}>
                            {target.error}
                          </span>
                        )}
                        {target.platformPostUrl && (
                          <a
                            href={target.platformPostUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-indigo-600 hover:underline"
                          >
                            View →
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="pt-6 text-center">
            <p className="text-lg text-gray-500">No publishes yet</p>
            <p className="text-sm text-gray-400">Create a Post Card and amplify it to see history here.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
