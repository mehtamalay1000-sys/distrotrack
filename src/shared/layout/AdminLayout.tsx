import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { useRealtimeSync } from '@/lib/useRealtimeSync';
import {
  LayoutDashboard, Users, MapPin, Building2, Package, ClipboardList,
  Truck, CreditCard, Receipt, BarChart3, FileUp, Menu, X, LogOut, ChevronDown,
  Sun, Moon, Database, FileSpreadsheet, Scale, PackagePlus, TrendingDown
} from 'lucide-react';
import { NotificationBell } from '@/shared/ui';

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/workers', label: 'Workers', icon: Users },
  { to: '/admin/routes', label: 'Routes', icon: MapPin },
  { to: '/admin/parties', label: 'Parties', icon: Building2 },
  { to: '/admin/products', label: 'Products & Inventory', icon: Package },
  { to: '/admin/inventory/import-stock', label: 'Import New Stock', icon: PackagePlus },
  { to: '/admin/inventory/import-sales', label: 'Import SAP Sales', icon: TrendingDown },
  { to: '/admin/inventory/register', label: 'Quantity Register', icon: FileSpreadsheet },
  { to: '/admin/inventory/reconciliation', label: 'SAP Reconciliation', icon: Scale },
  { to: '/admin/picklists', label: 'Picklists', icon: ClipboardList },
  { to: '/admin/deliveries', label: 'Deliveries', icon: Truck },
  { to: '/admin/payments', label: 'Payments', icon: CreditCard },
  { to: '/admin/expenses', label: 'Expenses', icon: Receipt },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { to: '/admin/import', label: 'SAP Import', icon: FileUp },
  { to: '/admin/master-data', label: 'Master Data', icon: Database },
];

export function AdminLayout() {
  useRealtimeSync('admin');
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
    <div className="min-h-screen flex bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-surface-100 transition-colors">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-56 bg-white dark:bg-surface-900 border-r border-surface-200 dark:border-surface-800 flex flex-col
        transform transition-transform duration-200 ease-in-out
        lg:translate-x-0 lg:static lg:z-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-surface-200 dark:border-surface-800">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary-600 flex items-center justify-center">
              <Package className="h-4 w-4 text-white" />
            </div>
            <span className="font-semibold text-surface-900 dark:text-white text-sm">DistroTrack</span>
            <span className="text-[10px] font-medium bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 px-1.5 py-0.5 rounded">Admin</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="ml-auto lg:hidden p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => `
                flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors
                ${isActive
                  ? 'bg-primary-50 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 font-medium'
                  : 'text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-100'}
              `}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Profile */}
        <div className="border-t border-surface-200 dark:border-surface-800 p-2 relative">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
          >
            <div className="h-7 w-7 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center text-xs font-medium text-primary-700 dark:text-primary-300">
              {(profile?.full_name || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                {profile?.full_name || 'Admin'}
              </p>
              <p className="text-xs text-surface-500 dark:text-surface-400 truncate">Owner</p>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-surface-400" />
          </button>
          {profileOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-1 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg py-1">
              <button
                onClick={toggleTheme}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </button>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700"
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
        <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden mr-2 p-1 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300">
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden sm:flex items-center gap-2 text-xs font-semibold text-surface-500 dark:text-surface-400">
              <span>DistroTrack ERP</span>
              <span className="h-1 w-1 rounded-full bg-surface-300 dark:bg-surface-600" />
              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Sync
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Realtime Notification Bell */}
            <NotificationBell role="admin" />

            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
