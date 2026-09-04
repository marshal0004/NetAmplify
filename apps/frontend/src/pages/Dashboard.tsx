// /home/z/my-project/netamplify-app/apps/frontend/src/pages/Dashboard.tsx
// NetAmplify — Dashboard with onboarding strip + PostCard grid.

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { postcardApi, connectionsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function Dashboard() {
  const { data: postcards } = useQuery({
    queryKey: ['postcards', 1],
    queryFn: () => postcardApi.list(1, 12),
  });

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => connectionsApi.list(),
  });

  const connectedCount = connections?.filter((c) => c.platformUsername !== null).length ?? 0;
  const hasPostCards = (postcards?.total ?? 0) > 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your Post Cards</h1>
        <Link to="/dashboard/postcards/new">
          <Button>+ New Post Card</Button>
        </Link>
      </div>

      {/* Onboarding strip */}
      {!hasPostCards || connectedCount === 0 ? (
        <Card className="border-indigo-200 bg-indigo-50">
          <CardContent className="pt-6">
            <h2 className="mb-4 font-semibold text-indigo-700">Get started in 3 steps</h2>
            <div className="flex gap-6">
              <OnboardingStep step="1" label="Create profile" done={true} link="/dashboard/settings" />
              <OnboardingStep step="2" label={`Connect platforms (${connectedCount}/8)`} done={connectedCount >= 1} link="/dashboard/connections" />
              <OnboardingStep step="3" label="Amplify your first project" done={hasPostCards} link="/dashboard/postcards/new" />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Post Cards" value={postcards?.total ?? 0} />
        <Stat label="Connected platforms" value={connectedCount} />
        <Stat label="Total publishes" value="—" />
      </div>

      {/* PostCard grid */}
      {hasPostCards ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {postcards?.items.map((card) => (
            <Link key={card.id} to={`/dashboard/postcards/${card.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <CardContent className="pt-6">
                  <h3 className="mb-2 font-semibold">{card.title}</h3>
                  <p className="mb-4 text-sm text-gray-600">{card.summary}</p>
                  <div className="flex flex-wrap gap-1">
                    {card.techStack.map((tag) => (
                      <Badge key={tag} variant="secondary" className="font-mono text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  {card.repoUrl && (
                    <p className="mt-4 truncate text-xs text-indigo-600">{card.repoUrl}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="pt-6 text-center">
            <p className="text-lg text-gray-500">No post cards yet</p>
            <p className="mb-4 text-sm text-gray-400">Create your first post card to start amplifying.</p>
            <Link to="/dashboard/postcards/new">
              <Button>+ Create your first Post Card</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OnboardingStep({ step, label, done, link }: { step: string; label: string; done: boolean; link: string }) {
  return (
    <Link to={link} className="flex flex-col items-center gap-2">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
          done ? 'bg-green-100 text-green-700' : 'bg-white text-gray-400 border'
        }`}
      >
        {done ? '✓' : step}
      </div>
      <span className={`text-sm ${done ? 'text-gray-600' : 'text-gray-900'}`}>{label}</span>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
