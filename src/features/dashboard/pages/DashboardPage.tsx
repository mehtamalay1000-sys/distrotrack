import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, DollarSign, Truck, CheckCircle2, Receipt,
  FileUp, ArrowRight, ClipboardList, CalendarDays, Banknote, Clock, IndianRupee,
  PieChart, AlertTriangle
} from 'lucide-react';
import { PageHeader, StatCard, Button, Card, StatusBadge, LoadingState } from '@/shared/ui';
import { QK } from '@/lib/queryKeys';
import { getDashboardStats } from '../services/dashboardService';
import { getDeliveries } from '@/features/deliveries/services/deliveryService';
import { getPayments } from '@/features/payments/services/paymentService';
import { formatCurrency, formatDate, getLocalDateString, parseEffectiveDateString } from '@/shared/utils/format';
import { PendingCollectionsPanel } from '../components/PendingCollectionsPanel';

export function DashboardPage() {
  const navigate = useNavigate();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: QK.dashboardStats,
    queryFn: getDashboardStats,
  });

  const { data: allDeliveries = [] } = useQuery({
    queryKey: QK.deliveries,
    queryFn: getDeliveries,
  });

  const todayStr = getLocalDateString();
  const recentDeliveries = allDeliveries.filter((d) => parseEffectiveDateString(d.delivery_date || d.created_at) === todayStr);

  const { data: allPayments = [] } = useQuery({
    queryKey: QK.payments,
    queryFn: getPayments,
  });

  const recentPayments = allPayments.filter((p) => parseEffectiveDateString(p.payment_date || p.created_at) === todayStr);

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
          label="Current Outstanding Udhari"
          value={formatCurrency(stats.totalOutstanding)}
          icon={<IndianRupee className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
        />
        <StatCard
          label="Today's Approved Expenses"
          value={formatCurrency(stats.totalExpensesToday)}
          icon={<Receipt className="h-5 w-5 text-red-500 dark:text-red-400" />}
        />
      </div>

      {/* Monthly Overview Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            <h2 className="text-sm font-bold text-surface-900 dark:text-surface-100 uppercase tracking-wider">
              Authoritative Monthly Overview — {monthName}
            </h2>
          </div>
          {stats.customerAdvance > 0 && (
            <div className="text-xs bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 rounded-full font-medium border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5">
              <span>Customer Advance / Credit:</span>
              <span className="font-bold">{formatCurrency(stats.customerAdvance)}</span>
            </div>
          )}
        </div>

        {/* Authoritative Monthly Sales Breakdown Banner if SAP Baseline Sales exist */}
        {stats.hasSapSales && (
          <div className="mb-3 p-3 bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-emerald-500/10 border border-blue-200/80 dark:border-blue-800/60 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-bold text-surface-900 dark:text-surface-100 uppercase tracking-wider text-[11px]">
                Authoritative Monthly Sales Breakdown
              </span>
              {stats.goLiveCutoffDate && (
                <span className="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-semibold text-[10px]">
                  Go-Live Cutoff: {stats.goLiveCutoffDate}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
              <div>
                <span className="text-surface-500 text-[10px] block uppercase font-medium">SAP Sales Before Go-Live</span>
                <span className="font-bold text-purple-700 dark:text-purple-300 tabular-nums">
                  {formatCurrency(stats.sapBaselineSales)}
                </span>
              </div>
              <div className="text-surface-400 font-bold">+</div>
              <div>
                <span className="text-surface-500 text-[10px] block uppercase font-medium">DistroTrack Post-Cutoff</span>
                <span className="font-bold text-blue-700 dark:text-blue-300 tabular-nums">
                  {formatCurrency(stats.distrotrackMonthlySales)}
                </span>
              </div>
              <div className="text-surface-400 font-bold">=</div>
              <div>
                <span className="text-surface-500 text-[10px] block uppercase font-bold text-emerald-600">Total Month Sales</span>
                <span className="font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums text-sm">
                  {formatCurrency(stats.totalMonthlySales || stats.monthlySales)}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Monthly Sales */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200/80 dark:border-blue-800/50 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-blue-800 dark:text-blue-300 uppercase tracking-wider">
                Monthly Sales {stats.hasSapSales ? '(Authoritative)' : ''}
              </span>
              <div className="h-7 w-7 rounded-lg bg-blue-500 text-white flex items-center justify-center shadow-xs">
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-xl font-black text-blue-700 dark:text-blue-300 tracking-tight">
              {formatCurrency(stats.totalMonthlySales || stats.monthlySales)}
            </div>
            <div className="mt-1 text-[10px] text-blue-600/90 dark:text-blue-400 font-medium">
              Commercial deliveries by sale date
            </div>
          </div>

          {/* Monthly Collections */}
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-200/80 dark:border-emerald-800/50 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">Total Monthly Collections</span>
              <div className="h-7 w-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center shadow-xs">
                <DollarSign className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-xl font-black text-emerald-700 dark:text-emerald-300 tracking-tight">
              {formatCurrency(stats.monthlyCollections)}
            </div>
            <div className="mt-1 text-[10px] text-emerald-600/90 dark:text-emerald-400 font-medium">
              Actual money received in {monthName}
            </div>
          </div>

          {/* Current-Month Sales Collected */}
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Current-Month Sales Collected</span>
              <div className="h-7 w-7 rounded-lg bg-teal-100 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 flex items-center justify-center">
                <CheckCircle2 className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-xl font-extrabold text-surface-900 dark:text-white">
              {formatCurrency(stats.currentMonthSalesCollected)}
            </div>
            <div className="mt-1 text-[10px] text-surface-400 font-medium">
              Settling {monthName} invoices
            </div>
          </div>

          {/* Prior-Period Udhari Collected */}
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Prior Udhari / Advance Collected</span>
              <div className="h-7 w-7 rounded-lg bg-indigo-100 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <Banknote className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-xl font-extrabold text-surface-900 dark:text-white">
              {formatCurrency(stats.priorPeriodUdhariCollected)}
            </div>
            <div className="mt-1 text-[10px] text-surface-400 font-medium">
              Older credit / advance received
            </div>
          </div>

          {/* Current Outstanding Udhari */}
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200/80 dark:border-amber-800/50 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider">Current Outstanding Udhari</span>
              <div className="h-7 w-7 rounded-lg bg-amber-500 text-white flex items-center justify-center shadow-xs">
                <Clock className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-xl font-black text-amber-700 dark:text-amber-300 tracking-tight">
              {formatCurrency(stats.totalOutstanding)}
            </div>
            <div className="mt-1 text-[10px] text-amber-600/90 dark:text-amber-400 font-medium">
              Authoritative open receivables (≥ ₹0)
            </div>
          </div>
        </div>

        {/* ── Authoritative Monthly Profitability (Sales - COGS - Expenses = Net Profit) ── */}
        <div className="mt-4 pt-4 border-t border-surface-200/80 dark:border-surface-700/80">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <PieChart className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-xs font-bold text-surface-900 dark:text-surface-100 uppercase tracking-wider">
                Monthly Profitability & COGS — {monthName}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {stats.cogsStatus === 'incomplete' ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="h-3 w-3" />
                  COGS Incomplete ({stats.cogsCoveragePct}% coverage)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  <CheckCircle2 className="h-3 w-3" />
                  COGS Complete (100%)
                </span>
              )}
            </div>
          </div>

          {stats.cogsStatus === 'incomplete' && (
            <div className="mb-3 p-2.5 bg-amber-500/10 border border-amber-300 dark:border-amber-700/50 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <strong>Cost Coverage Notice:</strong> {stats.missingCostSkusCount > 0 ? `${stats.missingCostSkusCount} sold SKU(s)` : 'Some sold items'} currently lack authoritative SAP Purchase/GR inward cost records. Profitability strictly reflects available cost data and will not fabricate 100% margin.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* 1. Sales Revenue */}
            <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3 shadow-xs">
              <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider block">Sales Revenue</span>
              <div className="text-lg font-black text-surface-900 dark:text-white mt-1">
                {formatCurrency(stats.totalMonthlySales || stats.monthlySales)}
              </div>
              <span className="text-[10px] text-surface-400">Delivered commercial value</span>
            </div>

            {/* 2. COGS */}
            <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3 shadow-xs">
              <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider block">Cost of Goods Sold (COGS)</span>
              <div className="text-lg font-black text-amber-700 dark:text-amber-400 mt-1">
                {formatCurrency(stats.monthlyCogs)}
              </div>
              <span className="text-[10px] text-amber-600/80">WAC based on SAP GR inwards</span>
            </div>

            {/* 3. Gross Profit */}
            <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-300 dark:border-emerald-800 rounded-xl p-3 shadow-xs">
              <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider block">Gross Profit</span>
              <div className="text-lg font-black text-emerald-700 dark:text-emerald-300 mt-1">
                {formatCurrency(stats.monthlyGrossProfit)}
              </div>
              <span className="text-[10px] font-bold text-emerald-600">
                Gross Margin: {stats.monthlyGrossMarginPct !== null ? `${stats.monthlyGrossMarginPct}%` : 'N/A'}
              </span>
            </div>

            {/* 4. Operating Expenses */}
            <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3 shadow-xs">
              <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider block">Operating Expenses</span>
              <div className="text-lg font-black text-rose-600 dark:text-rose-400 mt-1">
                {formatCurrency(stats.monthlyApprovedExpenses)}
              </div>
              <span className="text-[10px] text-rose-500/80">Approved business costs</span>
            </div>

            {/* 5. Net Profit */}
            <div className={`border rounded-xl p-3 shadow-xs ${
              stats.monthlyNetProfit >= 0
                ? 'bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border-indigo-300 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200'
                : 'bg-rose-500/10 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
            }`}>
              <span className="text-[10px] font-bold uppercase tracking-wider block">Net Profit</span>
              <div className={`text-lg font-black mt-1 ${
                stats.monthlyNetProfit >= 0 ? 'text-indigo-700 dark:text-indigo-300' : 'text-rose-600 dark:text-rose-400'
              }`}>
                {formatCurrency(stats.monthlyNetProfit)}
              </div>
              <span className="text-[10px] font-bold">
                Net Margin: {stats.monthlyNetMarginPct !== null ? `${stats.monthlyNetMarginPct}%` : 'N/A'}
              </span>
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

      {/* Pending Collections Queue — actionable credit receivables */}
      <PendingCollectionsPanel maxRows={15} />
    </div>
  );
}
