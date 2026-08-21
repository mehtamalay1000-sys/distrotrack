import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Home, MapPin, Clock, User, LogOut, Sun, Moon, Receipt, CreditCard } from 'lucide-react';
import { NotificationBell } from '@/shared/ui';
import { useState } from 'react';

const tabs = [
  { to: '/w', label: 'Today', icon: Home, end: true },
  { to: '/w/route', label: 'Route', icon: MapPin },
  { to: '/w/payments', label: 'Payments', icon: CreditCard },
  { to: '/w/expenses', label: 'Expenses', icon: Receipt },
  { to: '/w/history', label: 'History', icon: Clock },
  { to: '/w/profile', label: 'Profile', icon: User },
];

export function WorkerLayout() {
  const { profile, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-surface-100">
      {/* Top header — minimal */}
      <header className="h-12 bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800 flex items-center px-4 sticky top-0 z-20">
        <div className="flex items-center gap-2 flex-1">
          <div className="h-6 w-6 rounded-md bg-blue-600 flex items-center justify-center">
            <MapPin className="h-3 w-3 text-white" />
          </div>
          <span className="font-semibold text-sm text-surface-900 dark:text-white">DistroTrack</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Realtime Notification Bell for Worker */}
          <NotificationBell role="worker" workerId={profile?.id} />

          <span className="text-xs text-surface-500 dark:text-surface-400 mx-1 hidden sm:block">
            {profile?.full_name || 'Worker'}
          </span>
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="h-7 w-7 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-xs font-bold text-blue-700 dark:text-blue-300"
            >
              {(profile?.full_name || 'W').charAt(0).toUpperCase()}
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg py-1 z-50">
                <button
                  onClick={() => { toggleTheme(); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700"
                >
                  {theme === 'dark' ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <Moon className="h-3.5 w-3.5" />}
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </button>
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-surface-50 dark:hover:bg-surface-700"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Click-away for menu */}
      {showMenu && (
        <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
      )}

      {/* Page content — takes remaining vertical space above bottom tabs */}
      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>

      {/* Bottom tab bar — mobile-first navigation */}
      <nav className="fixed bottom-0 left-0 right-0 h-14 bg-white dark:bg-surface-900 border-t border-surface-200 dark:border-surface-800 flex items-stretch z-20 safe-bottom">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `
              flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors
              ${isActive
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-surface-400 dark:text-surface-500'}
            `}
          >
            <tab.icon className="h-5 w-5" />
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
