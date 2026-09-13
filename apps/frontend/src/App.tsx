// /home/z/my-project/netamplify-app/apps/frontend/src/App.tsx
// NetAmplify — Root router + auth guard.
//
// Routes:
//   /                          → Landing (public)
//   /login                     → Login
//   /signup                    → Signup
//   /reset                     → Password reset request
//   /reset/confirm             → Password reset confirm
//   /dashboard                 → Dashboard (auth required)
//   /dashboard/connections     → Connect Checklist (auth required)
//   /dashboard/postcards/new   → Composer (auth required)
//   /dashboard/postcards/:id   → View/edit (auth required)
//   /dashboard/postcards/:id/publish → Publish page (auth required)
//   /dashboard/history         → History (auth required)
//   /dashboard/settings        → Profile + Trust & Security (auth required)

import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Landing } from '@/pages/Landing';
import { Login } from '@/pages/Login';
import { Signup } from '@/pages/Signup';
import { ResetRequest } from '@/pages/ResetRequest';
import { DashboardLayout } from '@/pages/DashboardLayout';
import { Dashboard } from '@/pages/Dashboard';
import { ConnectChecklist } from '@/pages/ConnectChecklist';
import { PostCardComposer } from '@/pages/PostCardComposer';
import { PostCardView } from '@/pages/PostCardView';
import { PublishPage } from '@/pages/PublishPage';
import { History } from '@/pages/History';
import { Settings } from '@/pages/Settings';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) {
    return <div className="flex h-screen items-center justify-center">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/reset" element={<ResetRequest />} />
      <Route path="/dashboard" element={<RequireAuth><DashboardLayout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="connections" element={<ConnectChecklist />} />
        <Route path="postcards/new" element={<PostCardComposer />} />
        <Route path="postcards/:id" element={<PostCardView />} />
        <Route path="postcards/:id/publish" element={<PublishPage />} />
        <Route path="history" element={<History />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
