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
 <div className="flex min-h-screen bg-background text-foreground">
 {/* Sidebar */}
 <motion.aside
 initial={{ x: -260, opacity: 0 }}
 animate={{ x: 0, opacity: 1 }}
 transition={{ duration: 0.4, ease: 'easeOut' }}
 className="fixed z-20 flex h-screen w-64 flex-col border-r border-border bg-card/60 backdrop-blur-xl"
 >
 {/* Logo */}
 <div className="px-6 py-7">
 <div className="flex items-center gap-2.5">
 <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">N</div>
 <span className="text-lg font-bold text-foreground">NetAmplify</span>
 </div>
 </div>

 {/* Nav items */}
 <nav className="flex-1 space-y-1 px-3">
 {navItems.map((item, i) => (
 <motion.div
 key={item.to}
 initial={{ opacity: 0, x: -16 }}
 animate={{ opacity: 1, x: 0 }}
 transition={{ duration: 0.25, delay: 0.05 + i * 0.04 }}
 >
 <NavLink
 to={item.to}
 end={item.to === '/dashboard'}
 className={({ isActive }) =>
 cn(
 'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
 isActive
 ? 'bg-primary/15 text-foreground'
 : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
 )
 }
 >
 {({ isActive }) => (
 <>
 {isActive && (
 <motion.div
 layoutId="active-nav"
 className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary"
 />
 )}
 <span className="text-base">{item.icon}</span>
 {item.label}
 </>
 )}
 </NavLink>
 </motion.div>
 ))}
 </nav>

 {/* User info + logout */}
 <div className="border-t border-border p-4">
 <div className="mb-3 rounded-xl bg-secondary p-3">
 <p className="text-sm font-medium text-foreground">{user?.name}</p>
 <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
 </div>
 <Button
 variant="ghost"
 size="sm"
 onClick={handleLogout}
 disabled={loggingOut}
 className="w-full justify-start text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
 >
 {loggingOut ? 'Logging out…' : '← Log out'}
 </Button>
 </div>
 </motion.aside>

 {/* Main content */}
 <main className="flex-1 overflow-auto pl-64">
 <AnimatePresence mode="wait">
 <motion.div
 initial={{ opacity: 0, y: 8 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -8 }}
 transition={{ duration: 0.25 }}
 className="relative z-10 p-8"
 >
 <Outlet />
 </motion.div>
 </AnimatePresence>
 </main>
 </div>
 );
}
