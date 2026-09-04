// /home/z/my-project/netamplify-app/apps/frontend/src/pages/ConnectChecklist.tsx
// NetAmplify — Connect Checklist screen.
// Per docs/06-FRONTEND-SPEC.md Screen 4: grid of platform cards with
// Connect/Disconnect + "Why is this safe?" expanders + "Setup pending"
// for unconfigured Tier B platforms.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { connectionsApi, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

// Trust copy per docs/12-TRUST-COPY.md §1
const trustCopy: Record<string, string> = {
  REDDIT: 'You\'ll log in on Reddit\'s official page — NetAmplify never sees your password. We receive only a limited permission to submit posts, and you can revoke it anytime in your Reddit settings.',
  DISCORD: 'A webhook can only post to ONE channel in your server. Even in a worst case, it can\'t read messages, DMs, or touch your account. Delete the webhook in your server settings anytime and it\'s dead instantly.',
  DEVTO: 'You generate this key yourself in your account\'s settings. It can only manage content — and you can regenerate or delete it whenever you want.',
  TELEGRAM: 'The bot is YOURS — you create it with @BotFather and control it. We only get the ability to send messages to the one channel where you made it an admin. Remove the bot anytime.',
  BLUESKY: 'Bluesky built App Passwords exactly for this: separate from your real password, limited to posting, revocable in one click.',
  HASHNODE: 'You generate this PAT yourself in your account\'s settings. It can only manage content — and you can regenerate or delete it whenever you want.',
  TWITTER: 'You\'ll log in on X\'s official page — NetAmplify never sees your password. We receive only a limited permission to post tweets, and you can revoke it anytime in your X settings.',
  LINKEDIN: 'You\'ll log in on LinkedIn\'s official page — NetAmplify never sees your password. We receive only a limited permission to post on your behalf, and you can revoke it anytime in your LinkedIn settings.',
};

// Per-platform connect form fields
const platformFields: Record<string, Array<{ key: string; label: string; placeholder: string; type?: string }>> = {
  DISCORD: [{ key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/...' }],
  DEVTO: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Dev.to API key' }],
  HASHNODE: [{ key: 'pat', label: 'Personal Access Token', placeholder: 'Your Hashnode PAT' }],
  TELEGRAM: [
    { key: 'botToken', label: 'Bot Token', placeholder: '1234567890:AAH...' },
    { key: 'channel', label: 'Channel @username', placeholder: '@mychannel' },
  ],
  BLUESKY: [
    { key: 'handle', label: 'Handle', placeholder: 'jane.bsky.social' },
    { key: 'appPassword', label: 'App Password', placeholder: 'abcd-efgh-ijkl-mnop' },
  ],
};

export function ConnectChecklist() {
  const queryClient = useQueryClient();
  const { data: connections, isLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: () => connectionsApi.list(),
  });

  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, Record<string, string>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const connectMutation = useMutation({
    mutationFn: ({ platform, data }: { platform: string; data: Record<string, string> }) =>
      connectionsApi.connect(platform, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      setErrors({});
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrors({ global: err.message });
      }
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (platform: string) => connectionsApi.disconnect(platform),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });

  function handleConnect(platform: string) {
    const fields = platformFields[platform];
    if (!fields) {
      // OAuth platform — redirect
      window.location.href = connectionsApi.oauthStart(platform);
      return;
    }
    const values = formValues[platform] ?? {};
    connectMutation.mutate({ platform, data: values });
  }

  function handleDisconnect(platform: string) {
    if (confirm(`Disconnect ${platform}? You'll need to reconnect to publish again.`)) {
      disconnectMutation.mutate(platform);
    }
  }

  if (isLoading) return <div>Loading connections…</div>;

  const connectedCount = connections?.filter((c) => c.platformUsername !== null).length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Connect your platforms</h1>
        <p className="mt-1 text-sm text-gray-600">
          Connect each platform once. After that, you can publish to all of them with one click.
          Progress: {connectedCount}/{connections?.length ?? 8} connected
        </p>
      </div>

      {errors.global && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{errors.global}</div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {connections?.map((conn) => {
          const isConnected = conn.platformUsername !== null;
          const isTierB = conn.tier === 'B';
          const isConfigured = conn.configured;
          const fields = platformFields[conn.platform];
          
          const isExpanded = expandedPlatform === conn.platform;
          const formValuesForPlatform = formValues[conn.platform] ?? {};

          return (
            <Card key={conn.platform}>
              <CardContent className="pt-6">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{platformName(conn.platform)}</h3>
                    {isConnected ? (
                      <Badge variant="secondary" className="mt-1">
                        Connected as {conn.platformUsername}
                      </Badge>
                    ) : isTierB && !isConfigured ? (
                      <Badge variant="outline" className="mt-1 text-amber-600">Setup pending</Badge>
                    ) : (
                      <span className="mt-1 block text-sm text-gray-400">Not connected</span>
                    )}
                  </div>
                  {isConnected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDisconnect(conn.platform)}
                      disabled={disconnectMutation.isPending}
                    >
                      Disconnect
                    </Button>
                  ) : isTierB && !isConfigured ? (
                    <Button variant="outline" size="sm" disabled>Coming soon</Button>
                  ) : fields ? (
                    <Button
                      size="sm"
                      onClick={() => handleConnect(conn.platform)}
                      disabled={connectMutation.isPending}
                    >
                      Connect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleConnect(conn.platform)}
                      disabled={connectMutation.isPending}
                    >
                      Connect via OAuth
                    </Button>
                  )}
                </div>

                {/* Connect form (SIMPLE platforms only) */}
                {!isConnected && fields && isConfigured && (
                  <div className="space-y-3">
                    {fields.map((f) => (
                      <div key={f.key}>
                        <Label htmlFor={`${conn.platform}-${f.key}`} className="text-xs">{f.label}</Label>
                        <Input
                          id={`${conn.platform}-${f.key}`}
                          type={f.type ?? 'text'}
                          placeholder={f.placeholder}
                          value={formValuesForPlatform[f.key] ?? ''}
                          onChange={(e) =>
                            setFormValues((prev) => ({
                              ...prev,
                              [conn.platform]: { ...prev[conn.platform], [f.key]: e.target.value },
                            }))
                          }
                          className="mt-1"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* "Why is this safe?" expander */}
                <button
                  onClick={() => setExpandedPlatform(isExpanded ? null : conn.platform)}
                  className="mt-4 text-xs font-medium text-indigo-600 hover:underline"
                >
                  {isExpanded ? 'Hide' : 'Why is this safe?'}
                </button>
                {isExpanded && (
                  <p className="mt-2 text-sm text-gray-600">{trustCopy[conn.platform]}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
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
