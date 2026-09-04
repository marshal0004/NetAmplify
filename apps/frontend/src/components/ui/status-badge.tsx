// /home/z/my-project/netamplify-app/apps/frontend/src/components/ui/status-badge.tsx
// NetAmplify — Status badge for PostTarget status display.
// Per docs/06-FRONTEND-SPEC.md: QUEUED gray, PUBLISHING blue pulse,
// SUCCESS green, FAILED red, SKIPPED gray.

import { cn } from '@/lib/utils';
import { Badge } from './badge';

const statusClass: Record<string, string> = {
  QUEUED: 'chip-queued',
  PUBLISHING: 'chip-publishing',
  SUCCESS: 'chip-success',
  FAILED: 'chip-failed',
  SKIPPED: 'chip-skipped',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn('font-mono', statusClass[status] ?? 'chip-queued')}
    >
      {status}
    </Badge>
  );
}
