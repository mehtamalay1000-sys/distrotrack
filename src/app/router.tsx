import { createBrowserRouter } from 'react-router-dom';
import { ProtectedRoute, RoleRedirect, AdminGuard, WorkerGuard } from './ProtectedRoute';
import { AdminLayout } from '@/shared/layout/AdminLayout';
import { WorkerLayout } from '@/shared/layout/WorkerLayout';
import { LoginPage } from '@/features/auth/LoginPage';

// ── Admin pages ──────────────────────────────────────────────────
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage';
import { WorkersPage } from '@/features/workers/pages/WorkersPage';
import { RoutesPage } from '@/features/routes/pages/RoutesPage';
import { PartiesPage } from '@/features/parties/pages/PartiesPage';
import { ProductsPage } from '@/features/products/pages/ProductsPage';
import { ExpensesPage } from '@/features/expenses/pages/ExpensesPage';
import { ImportPage } from '@/features/import/pages/ImportPage';
import { MasterDataPage } from '@/features/import/pages/MasterDataPage';
import { PicklistsPage } from '@/features/picklists/pages/PicklistsPage';
import { PicklistDetailPage } from '@/features/picklists/pages/PicklistDetailPage';
import { DeliveriesPage } from '@/features/deliveries/pages/DeliveriesPage';
import { PaymentsPage } from '@/features/payments/pages/PaymentsPage';
import { ReportsPage } from '@/features/reports/pages/ReportsPage';

// ── Worker pages ─────────────────────────────────────────────────
import { WorkerDashboard } from '@/features/worker/pages/WorkerDashboard';
import { WorkerRoutePage } from '@/features/worker/pages/WorkerRoutePage';
import { WorkerPartyDeliveryPage } from '@/features/worker/pages/WorkerPartyDeliveryPage';
import { WorkerHistoryPage } from '@/features/worker/pages/WorkerHistoryPage';
import { WorkerProfilePage } from '@/features/worker/pages/WorkerProfilePage';
import { WorkerExpensesPage } from '@/features/worker/pages/WorkerExpensesPage';
import { WorkerPaymentsPage } from '@/features/worker/pages/WorkerPaymentsPage';

export const router = createBrowserRouter([
  // Public
  { path: '/login', element: <LoginPage /> },

  // Protected — requires authentication
  {
    element: <ProtectedRoute />,
    children: [
      // Root redirect → role-based
      { path: '/', element: <RoleRedirect /> },

      // ── Admin routes ───────────────────────────────────────────
      {
        element: <AdminGuard />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { path: '/admin', element: <DashboardPage /> },
              { path: '/admin/workers', element: <WorkersPage /> },
              { path: '/admin/routes', element: <RoutesPage /> },
              { path: '/admin/parties', element: <PartiesPage /> },
              { path: '/admin/products', element: <ProductsPage /> },
              { path: '/admin/picklists', element: <PicklistsPage /> },
              { path: '/admin/picklists/:id', element: <PicklistDetailPage /> },
              { path: '/admin/deliveries', element: <DeliveriesPage /> },
              { path: '/admin/payments', element: <PaymentsPage /> },
              { path: '/admin/expenses', element: <ExpensesPage /> },
              { path: '/admin/reports', element: <ReportsPage /> },
              { path: '/admin/import', element: <ImportPage /> },
              { path: '/admin/master-data', element: <MasterDataPage /> },
            ],
          },
        ],
      },

      // ── Worker routes ──────────────────────────────────────────
      {
        element: <WorkerGuard />,
        children: [
          {
            element: <WorkerLayout />,
            children: [
              { path: '/w', element: <WorkerDashboard /> },
              { path: '/w/route', element: <WorkerRoutePage /> },
              { path: '/w/route/deliver/:deliveryId', element: <WorkerPartyDeliveryPage /> },
              { path: '/w/payments', element: <WorkerPaymentsPage /> },
              { path: '/w/expenses', element: <WorkerExpensesPage /> },
              { path: '/w/history', element: <WorkerHistoryPage /> },
              { path: '/w/profile', element: <WorkerProfilePage /> },
            ],
          },
        ],
      },
    ],
  },
]);
