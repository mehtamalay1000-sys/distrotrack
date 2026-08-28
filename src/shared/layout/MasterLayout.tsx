import { useState } from 'react';
import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { useTheme } from '@/shared/theme/ThemeProvider';
import {
  LayoutDashboard, Users, BarChart3, Activity, History,
  Menu, X, LogOut, ChevronDown, Sun, Moon, Shield,
  Briefcase, ChevronRight,
} from 'lucide-react';

const navSections: Array<{
  label: string;
  items: Array<{ to: string; label: string; icon: React.ElementType; end?: boolean }>;
}> = [
  {
    label: 'Overview',
    items: [
      { to: '/master', label: 'Dashboard', icon: LayoutDashboard, end: true },
    ],
  },
  {
    label: 'Business',
    items: [
      { to: '/master/business', label: 'Business Data', icon: Briefcase },
      { to: '/master/history', label: 'Historical Analysis', icon: History },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/master/workers', label: 'Worker Monitor', icon: Users },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/master/system', label: 'System & Audit Log', icon: Activity },
      { to: '/master/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
];


export function MasterLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { profile, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex bg-[#f5f6f8] text-slate-800" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-56 bg-[#141820] flex flex-col
        transform transition-transform duration-200 ease-in-out
        lg:translate-x-0 lg:static lg:z-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5 flex-1">
            <div className="h-7 w-7 rounded-md bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <Shield className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-[13px] font-bold text-white leading-none">DistroTrack</div>
              <div className="text-[10px] font-semibold text-indigo-400 leading-none mt-0.5 tracking-wide uppercase">Master Access</div>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto lg:hidden p-1 text-slate-400 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 overflow-y-auto space-y-4">
          {navSections.map(section => (
            <div key={section.label}>
              <div className="px-3 mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.items.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end ?? false}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) => `
                      flex items-center gap-2.5 px-3 py-2 text-[13px] rounded-lg transition-colors
                      ${isActive
                        ? 'bg-indigo-600/20 text-indigo-300 font-semibold'
                        : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'}
                    `}
                  >
                    <item.icon className="h-4 w-4 flex-shrink-0" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Profile */}
        <div className="border-t border-white/[0.06] p-2 relative">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-white/[0.04] transition-colors"
          >
            <div className="h-7 w-7 rounded-full bg-indigo-700 flex items-center justify-center text-xs font-bold text-indigo-200 flex-shrink-0">
              {(profile?.full_name || 'M').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-[13px] font-semibold text-slate-200 truncate">
                {profile?.full_name || 'Master'}
              </p>
              <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-wide">Master Access</p>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
          </button>

          {profileOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-1 bg-[#1e2330] border border-white/[0.08] rounded-lg shadow-xl py-1">
              <button
                onClick={toggleTheme}
                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-slate-300 hover:bg-white/[0.04]"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </button>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-slate-300 hover:bg-white/[0.04]"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Main content ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden mr-1 p-1 text-slate-500 hover:text-slate-700"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Breadcrumb */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 font-medium">
              <Shield className="h-3.5 w-3.5 text-indigo-600" />
              <span className="text-indigo-700 font-semibold">Master Access</span>
              <ChevronRight className="h-3 w-3 text-slate-300" />
              <span className="text-slate-500">Sanghavi Traders</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Master badge */}
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-50 border border-indigo-200 text-[11px] font-bold text-indigo-700 uppercase tracking-wide">
              <Shield className="h-3 w-3" />
              Master
            </span>

            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-500" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
