import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useState } from 'react';

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
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    setTimeout(() => navigate('/'), 300);
  }

  return (
    <div className="flex min-h-screen bg-[#0a0a0f] text-white">
      {/* Animated background blobs */}
      <div className="fixed inset-0 z-0 overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-indigo-600/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-purple-600/5 rounded-full blur-[120px]" />
      </div>

      {/* Sidebar */}
      <motion.aside
        initial={{ x: -260, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="fixed z-20 flex h-screen w-64 flex-col border-r border-white/5 bg-black/40 backdrop-blur-xl"
      >
        {/* Logo */}
        <div className="px-6 py-8">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-sm font-bold">N</div>
            <span className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">NetAmplify</span>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 space-y-1 px-3">
          {navItems.map((item, i) => (
            <motion.div
              key={item.to}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.1 + i * 0.05 }}
            >
              <NavLink
                to={item.to}
                end={item.to === '/dashboard'}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                    isActive
                      ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-white'
                      : 'text-white/50 hover:bg-white/5 hover:text-white/80'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.div
                        layoutId="active-nav"
                        className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-indigo-400 to-purple-400"
                      />
                    )}
                    <span className="text-lg">{item.icon}</span>
                    {item.label}
                  </>
                )}
              </NavLink>
            </motion.div>
          ))}
        </nav>

        {/* User info + logout */}
        <div className="border-t border-white/5 p-4">
          <div className="mb-3 rounded-xl bg-white/[0.03] p-3">
            <p className="text-sm font-medium text-white/80">{user?.name}</p>
            <p className="truncate text-xs text-white/40">{user?.email}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full justify-start text-white/50 hover:bg-red-500/10 hover:text-red-400"
          >
            {loggingOut ? 'Logging out…' : '← Log out'}
          </Button>
        </div>
      </motion.aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto pl-64">
        <AnimatePresence mode="wait">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="relative z-10 p-8"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
