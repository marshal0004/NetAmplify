import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { connectionsApi, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

const trustCopy: Record<string, string> = {
  REDDIT: 'You\'ll log in on Reddit\'s official page — NetAmplify never sees your password. We receive only a limited permission to submit posts, and you can revoke it anytime in your Reddit settings.',
  DISCORD: 'A webhook can only post to ONE channel in your server. Even in a worst case, it can\'t read messages, DMs, or touch your account. Delete the webhook in your server settings anytime and it\'s dead instantly.',
  DEVTO: 'You generate this key yourself in your account\'s settings. It can only manage content — and you can regenerate or delete it whenever you want.',
  TELEGRAM: 'The bot is YOURS — you create it with @BotFather and control it. We only get the ability to send messages to the one channel where you made it an admin. Remove the bot anytime.',
  BLUESKY: 'Bluesky built App Passwords exactly for this: separate from your real password, limited to posting, revocable in one click.',
  HASHNODE: 'You generate this PAT yourself in your account\'s settings. It can only manage content — and you can regenerate or delete it whenever you want.',
  TWITTER: 'You\'ll log in on X\'s official page — NetAmplify never sees your password. We receive only a limited permission to post tweets, and you can revoke it anytime in your X settings.',
  LINKEDIN: 'You\'ll log in on LinkedIn\'s official page — NetAmplify never sees your password. We receive only a limited permission to post on your behalf, and you can revoke it anytime in your LinkedIn settings.',
  MASTODON: 'You create this access token yourself in your Mastodon instance\'s settings. It only has the `write:statuses` scope — meaning it can only post statuses, nothing else. Revoke it in one click from your instance settings.',
  WORDPRESS: 'WordPress Application Passwords are separate from your real password and only work via the REST API. They can\'t be used to log in to wp-admin. Revoke instantly from your WordPress profile page.',
  TWITTER_COOKIE: 'Your X session cookies are stored encrypted (AES-256-GCM) — we never see your X password. The cookies only allow posting tweets; we can\'t read your DMs, change your password, or take over your account. Log out of x.com on any device to instantly invalidate them.',
  REDDIT_COOKIE: 'Your Reddit session cookies are stored encrypted (AES-256-GCM) — we never see your Reddit password. The cookies only allow submitting posts; we can\'t read your DMs, change your password, or take over your account. Log out of reddit.com on any device to instantly invalidate them.',
};

interface FieldConfig {
  key: string;
  label: string;
  placeholder: string;
  type?: string;
}

interface PlatformConfig {
  fields?: FieldConfig[];
  steps: { text: string; link?: string; linkText?: string }[];
  docsLink?: string;
}

const platformConfig: Record<string, PlatformConfig> = {
  DISCORD: {
    fields: [{ key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/...' }],
    steps: [
      { text: 'Open your Discord server' },
      { text: 'Click the ⚙️ gear icon next to any channel (e.g., #general)' },
      { text: 'Click "Integrations" → "Webhooks"' },
      { text: 'Click "New Webhook" → "Copy Webhook URL"' },
      { text: 'Paste the URL above and click Connect' },
    ],
    docsLink: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks',
  },
  DEVTO: {
    fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'Your Dev.to API key' }],
    steps: [
      { text: 'Open Dev.to settings (opens in new tab)', link: 'https://dev.to/settings/extensions', linkText: 'Open Dev.to Settings' },
      { text: 'Scroll down to "DEV Community API Keys"' },
      { text: 'Click "Generate API Key"' },
      { text: 'Copy the key and paste it above' },
    ],
    docsLink: 'https://developers.forem.com/api/v1#section/Authentication',
  },
  HASHNODE: {
    fields: [{ key: 'pat', label: 'Personal Access Token', placeholder: 'Your Hashnode PAT' }],
    steps: [
      { text: 'Open Hashnode developer settings (opens in new tab)', link: 'https://hashnode.com/settings/developer', linkText: 'Open Hashnode Settings' },
      { text: 'Scroll down to "Personal Access Tokens"' },
      { text: 'Click "Generate a new token"' },
      { text: 'Copy the PAT and paste it above' },
    ],
    docsLink: 'https://apidocs.hashnode.com',
  },
  TELEGRAM: {
    fields: [
      { key: 'botToken', label: 'Bot Token', placeholder: '1234567890:AAH...' },
      { key: 'channel', label: 'Channel @username', placeholder: '@mychannel' },
    ],
    steps: [
      { text: 'Open Telegram and search for @BotFather (opens in new tab)', link: 'https://t.me/BotFather', linkText: 'Open @BotFather' },
      { text: 'Send /newbot and follow the prompts to name it' },
      { text: 'Copy the Bot Token provided and paste it above' },
      { text: 'Create a Telegram channel (or use existing)' },
      { text: 'Go to channel settings → Administrators → Add your bot as admin' },
      { text: 'Enter your channel @username above (e.g., @mychannel)' },
    ],
    docsLink: 'https://core.telegram.org/bots/api',
  },
  BLUESKY: {
    fields: [
      { key: 'handle', label: 'Handle', placeholder: 'jane.bsky.social' },
      { key: 'appPassword', label: 'App Password', placeholder: 'abcd-efgh-ijkl-mnop' },
    ],
    steps: [
      { text: 'Open Bluesky settings (opens in new tab)', link: 'https://bsky.app/settings/app-passwords', linkText: 'Open Bluesky Settings' },
      { text: 'Click "Add App Password"' },
      { text: 'Name it "NetAmplify" and click "Create"' },
      { text: 'Copy the app password (format: xxxx-xxxx-xxxx-xxxx)' },
      { text: 'Enter your Bluesky handle (e.g., jane.bsky.social) above' },
      { text: 'Paste the app password above' },
    ],
    docsLink: 'https://atproto.com/specs/xrpc#app-password',
  },
  REDDIT: {
    steps: [{ text: 'Click "Connect via OAuth" to log in on Reddit\'s official page.' }],
  },
  TWITTER: {
    steps: [{ text: 'Click "Connect via OAuth" to log in on X\'s official page.' }],
  },
  LINKEDIN: {
    steps: [{ text: 'Click "Connect via OAuth" to log in on LinkedIn\'s official page.' }],
  },
  // ==========================================================================
  // Cookie-based platforms (Option A — bypass X/Reddit paywalls)
  // ==========================================================================
  TWITTER_COOKIE: {
    fields: [
      { key: 'authToken', label: 'auth_token cookie', placeholder: '40-char hex string' },
      { key: 'ct0', label: 'ct0 cookie', placeholder: '32-char hex string' },
    ],
    steps: [
      { text: 'Install the Cookie-Editor extension (opens in new tab)', link: 'https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhonkehodjpanfjoadhacee', linkText: 'Install Cookie-Editor' },
      { text: 'Log in to x.com in your browser' },
      { text: 'Click the Cookie-Editor icon in your browser toolbar' },
      { text: 'Find the "auth_token" cookie — copy its value (40 hex chars)' },
      { text: 'Find the "ct0" cookie — copy its value (32 hex chars)' },
      { text: 'Paste both values above and click Connect' },
    ],
    docsLink: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies',
  },
  REDDIT_COOKIE: {
    fields: [
      { key: 'token', label: 'token cookie (JWT)', placeholder: 'eyJhbGciOiJ... (long string with 2 dots)' },
      { key: 'csrfToken', label: 'csrf_token cookie', placeholder: '32-char hex string (0-9, a-f)' },
    ],
    steps: [
      { text: 'Install the Cookie-Editor extension (opens in new tab)', link: 'https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhonkehodjpanfjoadhacee', linkText: 'Install Cookie-Editor' },
      { text: 'Log in to reddit.com in your browser' },
      { text: 'Click the Cookie-Editor icon in your browser toolbar' },
      { text: 'Find the "token" cookie — copy its full value (a long JWT with 2 dots)' },
      { text: 'Find the "csrf_token" cookie — copy its value (32 hex chars)' },
      { text: 'Paste both values above and click Connect' },
    ],
    docsLink: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies',
  },
  // ==========================================================================
  // New OAuth / API-key platforms (Mastodon + WordPress)
  // ==========================================================================
  MASTODON: {
    fields: [
      { key: 'instance', label: 'Instance URL', placeholder: 'mastodon.social' },
      { key: 'accessToken', label: 'Access Token', placeholder: 'Your access token' },
    ],
    steps: [
      { text: 'Open your Mastodon instance settings (opens in new tab)', link: 'https://mastodon.social/settings/applications', linkText: 'Open Mastodon Settings' },
      { text: 'Click "New Application"' },
      { text: 'Name it "NetAmplify" and grant the `write:statuses` scope' },
      { text: 'Submit, then copy the Access Token' },
      { text: 'Enter your instance URL above (e.g., mastodon.social)' },
      { text: 'Paste the access token above' },
    ],
    docsLink: 'https://docs.joinmastodon.org/api/',
  },
  WORDPRESS: {
    fields: [
      { key: 'siteUrl', label: 'Site URL', placeholder: 'https://blog.example.com' },
      { key: 'username', label: 'Username', placeholder: 'your WP username' },
      { key: 'appPassword', label: 'App Password', placeholder: 'abcd wxyz 1234 5678 ...' },
    ],
    steps: [
      { text: 'Log in to your WordPress admin (e.g., blog.example.com/wp-admin)' },
      { text: 'Go to Users → Profile → Application Passwords' },
      { text: 'Type "NetAmplify" → click "Add New Application Password"' },
      { text: 'Copy the generated password (24 chars, with spaces)' },
      { text: 'Enter your Site URL above (with https://)' },
      { text: 'Enter your WordPress username above' },
      { text: 'Paste the app password above (spaces are OK)' },
    ],
    docsLink: 'https://developer.wordpress.org/rest-api/using-the-rest-api/application-passwords/',
  },
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
    const config = platformConfig[platform];
    if (!config?.fields) {
      window.location.href = `/api/oauth/${platform}/start?token=${localStorage.getItem('netamplify_token')}`;
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

  if (isLoading) return <div className="text-white/50">Loading connections…</div>;

  const connectedCount = connections?.filter((c) => c.platformUsername !== null).length ?? 0;
  const totalCount = connections?.length ?? 12;

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-3xl font-bold text-white">Connect your platforms</h1>
        <p className="mt-2 text-white/50">
          Connect each platform once. After that, you can publish to all of them with one click.
        </p>
        {/* Progress bar */}
        <div className="mt-4 flex items-center gap-4">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(connectedCount / totalCount) * 100}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
            />
          </div>
          <span className="text-sm font-medium text-white/70">{connectedCount}/{totalCount} connected</span>
        </div>
      </motion.div>

      {/* Error banner */}
      <AnimatePresence>
        {errors.global && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400"
          >
            {errors.global}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Platform cards grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {connections?.map((conn, i) => {
          const isConnected = conn.platformUsername !== null;
          const isTierB = conn.tier === 'B';
          const isConfigured = conn.configured;
          const config = platformConfig[conn.platform];
          const fields = config?.fields;
          const isExpanded = expandedPlatform === conn.platform;
          const formValuesForPlatform = formValues[conn.platform] ?? {};

          return (
            <motion.div
              key={conn.platform}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              whileHover={{ y: -3 }}
            >
              <Card className={`relative overflow-hidden border-white/10 bg-white/[0.03] backdrop-blur-xl transition-all ${
                isConnected ? 'border-green-500/20' : isTierB && !isConfigured ? 'border-amber-500/20' : ''
              }`}>
                {/* Glow effect */}
                {isConnected && (
                  <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-emerald-500/5" />
                )}

                <CardContent className="relative pt-6">
                  <div className="mb-4 flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-white">{platformName(conn.platform)}</h3>
                      {isConnected ? (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 500, delay: 0.2 }}
                          className="mt-1 flex items-center gap-1.5"
                        >
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[10px] text-white">✓</span>
                          <span className="text-sm text-green-400">Connected as {conn.platformUsername}</span>
                        </motion.div>
                      ) : isTierB && !isConfigured ? (
                        <Badge variant="outline" className="mt-1 border-amber-500/30 bg-amber-500/10 text-amber-400">Setup pending</Badge>
                      ) : (
                        <span className="mt-1 block text-sm text-white/30">Not connected</span>
                      )}
                    </div>
                    {isConnected ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDisconnect(conn.platform)}
                        disabled={disconnectMutation.isPending}
                        className="border-white/10 bg-white/5 text-white/60 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30"
                      >
                        Disconnect
                      </Button>
                    ) : isTierB && !isConfigured ? (
                      <Button variant="outline" size="sm" disabled className="border-white/5 text-white/20">Coming soon</Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleConnect(conn.platform)}
                        disabled={connectMutation.isPending}
                        className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 border-0"
                      >
                        {fields ? 'Connect' : 'Connect via OAuth'}
                      </Button>
                    )}
                  </div>

                  {/* Connect form (SIMPLE platforms only) */}
                  {!isConnected && fields && isConfigured && (
                    <div className="space-y-3">
                      {fields.map((f) => (
                        <div key={f.key}>
                          <Label htmlFor={`${conn.platform}-${f.key}`} className="text-xs text-white/40">{f.label}</Label>
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
                            className="mt-1 border-white/10 bg-white/5 text-white placeholder:text-white/20 focus:border-indigo-500/50"
                          />
                        </div>
                      ))}

                      {/* Step-by-step instructions */}
                      <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                        <p className="mb-2 text-xs font-medium text-indigo-300">📋 How to connect:</p>
                        <ol className="space-y-1.5">
                          {config.steps.map((step, idx) => (
                            <li key={idx} className="flex gap-2 text-xs text-white/50">
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px]">{idx + 1}</span>
                              <span>
                                {step.text}
                                {step.link && (
                                  <a href={step.link} target="_blank" rel="noreferrer" className="ml-1 text-indigo-400 hover:underline">
                                    {step.linkText ?? 'Open →'}
                                  </a>
                                )}
                              </span>
                            </li>
                          ))}
                        </ol>
                        {config.docsLink && (
                          <a href={config.docsLink} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-white/30 hover:text-white/50">
                            📖 Read official docs
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* OAuth instructions */}
                  {!isConnected && !fields && isConfigured && config?.steps && (
                    <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                      <p className="text-xs text-white/50">{config.steps[0].text}</p>
                    </div>
                  )}

                  {/* "Why is this safe?" expander */}
                  <button
                    onClick={() => setExpandedPlatform(isExpanded ? null : conn.platform)}
                    className="mt-4 flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    {isExpanded ? '− Hide' : '+ Why is this safe?'}
                  </button>
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-2 text-sm leading-relaxed text-white/50"
                      >
                        {trustCopy[conn.platform]}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>
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
    TWITTER: 'X (Twitter) — OAuth',
    LINKEDIN: 'LinkedIn',
    MASTODON: 'Mastodon',
    WORDPRESS: 'WordPress',
    TWITTER_COOKIE: 'X (Twitter) — Cookie',
    REDDIT_COOKIE: 'Reddit — Cookie',
  };
  return names[platform] ?? platform;
}
