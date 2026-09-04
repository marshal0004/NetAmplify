// /home/z/my-project/netamplify-app/apps/frontend/src/pages/Settings.tsx
// NetAmplify — Settings page.
// Per docs/06-FRONTEND-SPEC.md Screen 8: Profile form + Trust & Security
// panel + Account deletion.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleDeleteAccount() {
    if (deleteConfirm !== 'DELETE') {
      alert('Type "DELETE" to confirm');
      return;
    }
    if (!confirm('Are you absolutely sure? This will permanently delete your account, all Post Cards, connections, and publish history. This cannot be undone.')) {
      return;
    }
    setLoading(true);
    try {
      await authApi.deleteAccount();
      await logout();
      navigate('/');
    } catch (err) {
      alert(`Failed to delete account: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Profile (read-only in MVP) */}
      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={user?.name ?? ''} readOnly className="mt-1 bg-gray-50" />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={user?.email ?? ''} readOnly className="mt-1 bg-gray-50" />
          </div>
          <p className="text-xs text-gray-500">Profile editing is coming in a future update.</p>
        </CardContent>
      </Card>

      {/* Trust & Security panel */}
      <Card>
        <CardHeader><CardTitle>Trust & Security</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-indigo-50 p-4">
            <h3 className="mb-2 font-semibold text-indigo-700">How we protect you</h3>
            <ul className="space-y-2 text-sm text-gray-700">
              <li>🔐 We never see or store your platform passwords — OAuth or keys you control, only.</li>
              <li>🔒 Credentials are encrypted (AES-256-GCM) — even a database breach alone can't expose usable credentials.</li>
              <li>✅ We request the minimum permissions possible: posting only. No DMs, no password changes, no account access.</li>
              <li>↩️ Everything is revocable instantly — disconnect here, or revoke on the platform; we detect it and stop immediately.</li>
              <li>📋 Every connection and publish is audit-logged; you can export or delete ALL your data anytime.</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-red-200">
        <CardHeader><CardTitle className="text-red-600">Danger Zone</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-sm text-gray-600">
              Permanently delete your account and all associated data (Post Cards, connections, publish history).
              This action cannot be undone.
            </p>
            <Label htmlFor="delete-confirm">Type "DELETE" to confirm</Label>
            <Input
              id="delete-confirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              className="mt-1 max-w-xs"
            />
          </div>
          <Button
            variant="destructive"
            onClick={handleDeleteAccount}
            disabled={loading || deleteConfirm !== 'DELETE'}
          >
            {loading ? 'Deleting…' : 'Permanently delete account'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
