import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { Loader2 } from 'lucide-react';

/** Ensures user is authenticated. Redirects to /login if not. */
export function ProtectedRoute() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-900">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

/** Redirects to the correct layout based on role. */
export function RoleRedirect() {
  const { role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-900">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (role === 'worker') return <Navigate to="/w" replace />;
  if (role === 'master') return <Navigate to="/master" replace />;
  return <Navigate to="/admin" replace />;
}

/** Ensures only admin/owner can access admin routes.
 *  Master users are redirected to their own dashboard — they do not
 *  share the Admin layout (though they can see all data in Master pages). */
export function AdminGuard() {
  const { role, loading } = useAuth();
  // Wait for auth to fully resolve before making role-based decisions.
  // While loading, profile is null and role defaults to 'owner' — acting on
  // that stale default would redirect Workers incorrectly and mount admin pages.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-900">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }
  if (role === 'worker') return <Navigate to="/w" replace />;
  if (role === 'master') return <Navigate to="/master" replace />;
  return <Outlet />;
}

/** Ensures only workers can access worker routes. */
export function WorkerGuard() {
  const { role, loading } = useAuth();
  // Wait for auth to fully resolve before making role-based decisions.
  // While loading, profile is null and role defaults to 'owner' — if we acted
  // on that default, a Worker would be redirected to /admin which would mount
  // DashboardPage and call the owner-only get_financial_summary RPC (→ 401).
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-900">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }
  if (role === 'owner') return <Navigate to="/admin" replace />;
  if (role === 'master') return <Navigate to="/master" replace />;
  return <Outlet />;
}

/** Ensures only the Master role can access /master/* routes.
 *  Any attempt by owner/worker to manually navigate here is blocked. */
export function MasterGuard() {
  const { role, loading } = useAuth();
  // Wait for auth to fully resolve before making role-based decisions.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-900">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }
  if (role === 'worker') return <Navigate to="/w" replace />;
  if (role === 'owner') return <Navigate to="/admin" replace />;
  // role === 'master' falls through
  return <Outlet />;
}
