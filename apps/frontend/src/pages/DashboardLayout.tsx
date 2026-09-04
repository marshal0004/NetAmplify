// /home/z/my-project/netamplify-app/apps/frontend/src/pages/DashboardLayout.tsx
// NetAmplify — Dashboard layout with sidebar navigation.

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { to: '/dashboard/connections', label: 'Connections', icon: '🔌' },
  { to: '/dashboard/postcards/new', label: 'New Post Card', icon: '✍️' },
  { to: '/dashboard/history', label: 'History', icon: '📋' },
  { to: '/dashboard/settings', label: 'Settings', icon: '⚙️' },
];

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-64 border-r bg-white px-4 py-6">
        <div className="mb-8 px-2">
          <span className="text-lg font-bold text-indigo-600">NetAmplify</span>
        </div>
        <nav className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/dashboard'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-100'
                )
              }
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto pt-8">
          <div className="border-t pt-4">
            <p className="px-3 text-sm text-gray-600">{user?.name}</p>
            <p className="px-3 text-xs text-gray-400">{user?.email}</p>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="mt-2 w-full justify-start text-gray-600">
              Log out
            </Button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
