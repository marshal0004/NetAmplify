import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
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
    if (deleteConfirm !== 'DELETE') { alert('Type "DELETE" to confirm'); return; }
    if (!confirm('Are you absolutely sure? This will permanently delete your account, all Post Cards, connections, and publish history.')) return;
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
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-3xl font-bold text-white"
      >
        Settings
      </motion.h1>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
        <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
          <CardHeader><CardTitle className="text-white">Profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name" className="text-white/60">Name</Label>
              <Input id="name" value={user?.name ?? ''} readOnly className="mt-1 border-white/10 bg-white/5 text-white/50" />
            </div>
            <div>
              <Label htmlFor="email" className="text-white/60">Email</Label>
              <Input id="email" value={user?.email ?? ''} readOnly className="mt-1 border-white/10 bg-white/5 text-white/50" />
            </div>
            <p className="text-xs text-white/30">Profile editing is coming in a future update.</p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
        <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
          <CardHeader><CardTitle className="text-white">Trust & Security</CardTitle></CardHeader>
          <CardContent>
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
              <h3 className="mb-3 font-semibold text-indigo-300">How we protect you</h3>
              <ul className="space-y-2 text-sm text-white/60">
                <li>🔐 We never see or store your platform passwords — OAuth or keys you control, only.</li>
                <li>🔒 Credentials are encrypted (AES-256-GCM) — even a database breach alone can't expose usable credentials.</li>
                <li>✅ We request the minimum permissions possible: posting only. No DMs, no password changes, no account access.</li>
                <li>↩️ Everything is revocable instantly — disconnect here, or revoke on the platform; we detect it and stop immediately.</li>
                <li>📋 Every connection and publish is audit-logged; you can export or delete ALL your data anytime.</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }}>
        <Card className="border-red-500/20 bg-red-500/5 backdrop-blur-xl">
          <CardHeader><CardTitle className="text-red-400">Danger Zone</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-sm text-white/50">
                Permanently delete your account and all associated data (Post Cards, connections, publish history). This action cannot be undone.
              </p>
              <Label htmlFor="delete-confirm" className="text-white/60">Type "DELETE" to confirm</Label>
              <Input id="delete-confirm" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder="DELETE" className="mt-1 max-w-xs border-white/10 bg-white/5 text-white placeholder:text-white/20" />
            </div>
            <Button variant="destructive" onClick={handleDeleteAccount} disabled={loading || deleteConfirm !== 'DELETE'}>
              {loading ? 'Deleting…' : 'Permanently delete account'}
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
