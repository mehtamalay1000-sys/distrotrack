import { useAuth } from '@/app/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { User, Phone, LogOut, Shield } from 'lucide-react';

export function WorkerProfilePage() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <h1 className="text-lg font-bold text-surface-900 dark:text-white">Profile</h1>

      {/* Profile card */}
      <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-5">
        <div className="flex items-center gap-4 mb-4">
          <div className="h-14 w-14 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-xl font-bold text-blue-600 dark:text-blue-400">
            {(profile?.full_name || 'W').charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-base font-semibold text-surface-900 dark:text-white">{profile?.full_name || 'Worker'}</h2>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-2 py-0.5 rounded-full mt-1">
              <Shield className="h-3 w-3" /> Delivery Worker
            </span>
          </div>
        </div>

        <div className="space-y-3 border-t border-surface-200 dark:border-surface-700 pt-4">
          <div className="flex items-center gap-3 text-sm">
            <User className="h-4 w-4 text-surface-400" />
            <span className="text-surface-700 dark:text-surface-300">
              {profile?.email || 'Not set'}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Phone className="h-4 w-4 text-surface-400" />
            <span className="text-surface-700 dark:text-surface-300">
              Not set
            </span>
          </div>
        </div>
      </div>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
      >
        <LogOut className="h-4 w-4" />
        Sign Out
      </button>
    </div>
  );
}
