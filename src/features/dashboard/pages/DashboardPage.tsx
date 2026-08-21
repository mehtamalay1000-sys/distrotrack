import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, DollarSign, AlertCircle, Truck, CheckCircle2, Receipt,
  FileUp, ArrowRight, ClipboardList, CalendarDays, Banknote, CreditCard, Clock
} from 'lucide-react';
import { PageHeader, StatCard, Button, Card, StatusBadge, LoadingState } from '@/shared/ui';
import { getDashboardStats } from '../services/dashboardService';
import { getDeliveries } from '@/features/deliveries/services/deliveryService';
import { getPayments } from '@/features/payments/services/paymentService';
import { formatCurrency, formatDate } from '@/shared/utils/format';

export function DashboardPage() {
  const navigate = useNavigate();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: getDashboardStats,
  });

  const { data: allDeliveries = [] } = useQuery({
    queryKey: ['deliveries'],
    queryFn: getDeliveries,
  });

  const todayStr = new Date().toISOString().split('T')[0];
  const recentDeliveries = allDeliveries.filter((d) => (d.delivery_date || d.created_at?.split('T')[0]) === todayStr);

  const { data: allPayments = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: getPayments,
  });

  const recentPayments = allPayments.filter((p) => (p.payment_date || p.created_at?.split('T')[0]) === todayStr);

  if (statsLoading || !stats) return <LoadingState message="Loading daily dashboard…" />;

  const monthName = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Distributor Operations Dashboard"
        description="Real-time daily overview of sales, route deliveries, cash collections, and outstanding Udhari"
        actions={
          <Button icon={<FileUp className="h-4 w-4" />} onClick={() => navigate('/admin/import')}>
            Import SAP Picklist
          </Button>
        }
      />

      {/* Primary KPI Grid — Today */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Today's Sales"
          value={formatCurrency(stats.todaySales)}
          icon={<TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
        />
        <StatCard
          label="Today's Collections"
          value={formatCurrency(stats.todayCollections)}
          icon={<DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
        />
        <StatCard
          label="Outstanding / Udhari"
          value={formatCurrency(stats.totalOutstanding)}
          icon={<AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
        />
        <StatCard
          label="Today's Expenses"
          value={formatCurrency(stats.totalExpensesToday)}
          icon={<Receipt className="h-5 w-5 text-red-500 dark:text-red-400" />}
        />
      </div>

      {/* Monthly Overview Section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          <h2 className="text-sm font-bold text-surface-900 dark:text-surface-100 uppercase tracking-wider">
            Monthly Overview — {monthName}
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Monthly Sales */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200/80 dark:border-blue-800/50 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-blue-800 dark:text-blue-300 uppercase tracking-wider">Monthly Sales</span>
              <div className="h-7 w-7 rounded-lg bg-blue-500 text-white flex items-center justify-center shadow-xs">
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-xl font-black text-blue-700 dark:text-blue-300 tracking-tight">
              {formatCurrency(stats.monthlySales)}
            </div>
          </div>

          {/* Monthly Collections */}
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-200/80 dark:border-emerald-800/50 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">Monthly Collections</span>
              <div className="h-7 w-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center shadow-xs">
                <DollarSign className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-xl font-black text-emerald-700 dark:text-emerald-300 tracking-tight">
              {formatCurrency(stats.monthlyCollections)}
            </div>
          </div>

          {/* Monthly Udhari */}
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200/80 dark:border-amber-800/50 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider">Monthly Udhari</span>
              <div className="h-7 w-7 rounded-lg bg-amber-500 text-white flex items-center justify-center shadow-xs">
                <Clock className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-xl font-black text-amber-700 dark:text-amber-300 tracking-tight">
              {formatCurrency(stats.monthlyUdhari)}
            </div>
          </div>

          {/* Monthly Cash */}
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Monthly Cash</span>
              <div className="h-7 w-7 rounded-lg bg-green-100 dark:bg-green-950/50 text-green-600 dark:text-green-400 flex items-center justify-center">
                <Banknote className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-xl font-extrabold text-surface-900 dark:text-white">
              {formatCurrency(stats.monthlyCash)}
            </div>
          </div>

          {/* Monthly Cheque */}
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Monthly Cheque</span>
              <div className="h-7 w-7 rounded-lg bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <CreditCard className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-xl font-extrabold text-surface-900 dark:text-white">
              {formatCurrency(stats.monthlyCheque)}
            </div>
          </div>
        </div>
      </div>

      {/* Secondary Quick Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 flex items-center justify-between bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-950/80 flex items-center justify-center text-amber-700 dark:text-amber-300">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-surface-500 dark:text-surface-400 font-medium">Pending Deliveries</div>
              <div className="text-lg font-bold text-surface-900 dark:text-surface-100">{stats.pendingDeliveriesCount} orders</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/deliveries')}>View</Button>
        </Card>

        <Card className="p-4 flex items-center justify-between bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 flex items-center justify-center text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-surface-500 dark:text-surface-400 font-medium">Completed Deliveries</div>
              <div className="text-lg font-bold text-surface-900 dark:text-surface-100">{stats.completedDeliveriesCount} orders</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/deliveries')}>View</Button>
        </Card>

        <Card className="p-4 flex items-center justify-between bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-950/80 flex items-center justify-center text-blue-700 dark:text-blue-300">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-surface-500 dark:text-surface-400 font-medium">Active Workers On Route</div>
              <div className="text-lg font-bold text-surface-900 dark:text-surface-100">{stats.activeWorkersCount} workers</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/workers')}>Manage</Button>
        </Card>
      </div>

      {/* Two Column Layout: Recent Deliveries + Recent Collections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Deliveries Widget */}
        <Card className="p-0 overflow-hidden border-surface-200 dark:border-surface-700">
          <div className="p-4 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between bg-surface-50 dark:bg-surface-800/80">
            <h3 className="font-semibold text-sm text-surface-900 dark:text-surface-100 flex items-center gap-2">
              <Truck className="h-4 w-4 text-surface-500 dark:text-surface-400" /> Recent Deliveries
            </h3>
            <button onClick={() => navigate('/admin/deliveries')} className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 flex items-center gap-1">
              View All <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="divide-y divide-surface-100 dark:divide-surface-800">
            {recentDeliveries.slice(0, 5).map((d) => {
              const totalDelVal = Number(
                d.delivered_amount ||
                d.total_amount ||
                d.invoice?.net_amount ||
                d.collected_amount ||
                (d.payments && d.payments[0] ? d.payments[0].amount : 0) ||
                0
              );

              return (
                <div key={d.id} className="p-3 flex items-center justify-between hover:bg-surface-50 dark:hover:bg-surface-800/40 transition-colors">
                  <div>
                    <div className="text-sm font-medium text-surface-900 dark:text-surface-100">{d.party?.name || 'Customer'}</div>
                    <div className="text-xs text-surface-400 font-mono">{d.invoice?.invoice_number || d.party?.code}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm font-semibold text-surface-900 dark:text-surface-100">{formatCurrency(totalDelVal)}</div>
                      <div className="text-[10px] text-surface-400">{d.worker?.name || 'Unassigned'}</div>
                    </div>
                    <StatusBadge status={d.status} />
                  </div>
                </div>
              );
            })}
            {recentDeliveries.length === 0 && (
              <div className="p-6 text-center text-xs text-surface-400">No recent deliveries recorded</div>
            )}
          </div>
        </Card>

        {/* Collections Widget */}
        <Card className="p-0 overflow-hidden border-surface-200 dark:border-surface-700">
          <div className="p-4 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between bg-surface-50 dark:bg-surface-800/80">
            <h3 className="font-semibold text-sm text-surface-900 dark:text-surface-100 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-surface-500 dark:text-surface-400" /> Recent Payment Collections
            </h3>
            <button onClick={() => navigate('/admin/payments')} className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 flex items-center gap-1">
              View All <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="divide-y divide-surface-100 dark:divide-surface-800">
            {recentPayments.slice(0, 5).map((p) => (
              <div key={p.id} className="p-3 flex items-center justify-between hover:bg-surface-50 dark:hover:bg-surface-800/40 transition-colors">
                <div>
                  <div className="text-sm font-medium text-surface-900 dark:text-surface-100">{p.party?.name || 'Customer'}</div>
                  <div className="text-xs text-surface-400">{formatDate(p.payment_date)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={p.payment_mode} />
                  <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(p.amount)}</div>
                </div>
              </div>
            ))}
            {recentPayments.length === 0 && (
              <div className="p-6 text-center text-xs text-surface-400">No payment collections recorded today</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
