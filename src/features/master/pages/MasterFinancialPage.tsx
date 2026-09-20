import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, CreditCard, IndianRupee, AlertTriangle, RefreshCw,
  BarChart2, Clock,
} from 'lucide-react';
import {
  getMasterKPIs, getMasterPayments, getMasterPartyDebtAging,
  getRouteProfitability, todayRange, monthRange,
} from '../services/masterService';
import { QK } from '@/lib/queryKeys';
import { formatCurrency } from '@/shared/utils/format';

function PeriodSelector({ value, onChange }: { value: 'today' | 'month' | 'custom'; onChange: (v: 'today' | 'month' | 'custom') => void }) {
  return (
    <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg">
      {(['today', 'month'] as const).map(p => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${value === p ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {p === 'today' ? 'Today' : 'This Month'}
        </button>
      ))}
    </div>
  );
}

function KpiCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub?: string;
  color: string; icon: React.ElementType;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`h-8 w-8 rounded-lg ${color} flex items-center justify-center`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="text-2xl font-bold text-slate-900 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

export function MasterFinancialPage() {
  const [period, setPeriod] = useState<'today' | 'month' | 'custom'>('month');

  const now = new Date();
  const dateRange = period === 'today'
    ? todayRange()
    : monthRange(now.getFullYear(), now.getMonth() + 1);

  const { data: kpis, isLoading: finLoading, refetch: refetchFin, isFetching } = useQuery({
    queryKey: QK.masterKpis(dateRange.from, dateRange.to),
    queryFn: () => getMasterKPIs(dateRange),
    refetchInterval: 15000,
  });

  const { data: paymentsData = [] } = useQuery({
    queryKey: ['master-payments', dateRange.from, dateRange.to],
    queryFn: () => getMasterPayments(dateRange),
    refetchInterval: 15000,
  });

  const { data: agingData = [] } = useQuery({
    queryKey: QK.masterPartyAging,
    queryFn: getMasterPartyDebtAging,
  });

  const { data: routeProfit } = useQuery({
    queryKey: QK.masterRouteProfitability(dateRange.from, dateRange.to),
    queryFn: () => getRouteProfitability({ start_date: dateRange.from, end_date: dateRange.to }),
  });

  // Compute payment breakdown from raw payments + authoritative KPIs
  const payBreakdown = (() => {
    const cash = paymentsData.filter((p: any) => p.payment_mode === 'cash').reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const upi = paymentsData.filter((p: any) => p.payment_mode === 'upi').reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const chequeCleared = paymentsData.filter((p: any) => p.payment_mode === 'cheque' && p.status === 'cleared').reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const chequePending = paymentsData.filter((p: any) => p.payment_mode === 'cheque' && p.status !== 'cleared').reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const creditRecorded = paymentsData.filter((p: any) => p.payment_mode === 'credit').reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const credit = Math.max(Number(kpis?.totalCredit ?? 0), creditRecorded);
    const total = cash + upi + chequeCleared + chequePending + credit;
    return { cash, upi, chequeCleared, chequePending, credit, total };
  })();

  const totalSales = kpis?.totalSales ?? 0;
  const totalCollected = kpis?.totalCollections ?? 0;
  const totalOutstanding = Math.max(
    0,
    kpis?.totalCredit ?? 0,
    kpis?.outstandingAmount && kpis.outstandingAmount > 0 ? kpis.outstandingAmount : 0
  );
  const totalExpenses = kpis?.totalExpenses ?? 0;
  const netCash = totalCollected - totalExpenses;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Financial Oversight</h1>
          <p className="text-sm text-slate-500 mt-0.5">Authoritative financial view — all roles</p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodSelector value={period} onChange={setPeriod} />
          <button
            onClick={() => refetchFin()}
            disabled={isFetching}
            className="p-2 text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      {finLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse h-28" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard
            label="Total Sales"
            value={formatCurrency(totalSales)}
            sub={period === 'today' ? 'Today' : 'This Month'}
            color="bg-indigo-100 text-indigo-600"
            icon={TrendingUp}
          />
          <KpiCard
            label="Collected"
            value={formatCurrency(totalCollected)}
            sub={`Current: ${formatCurrency(kpis?.currentPeriodCollected ?? 0)} | Prior: ${formatCurrency(kpis?.priorPeriodCollected ?? 0)}`}
            color="bg-emerald-100 text-emerald-600"
            icon={IndianRupee}
          />
          <KpiCard
            label="Outstanding"
            value={formatCurrency(totalOutstanding)}
            sub="Pending from parties"
            color="bg-amber-100 text-amber-600"
            icon={Clock}
          />
          <KpiCard
            label="Expenses"
            value={formatCurrency(totalExpenses)}
            sub={`Net cash: ${formatCurrency(netCash)}`}
            color="bg-rose-100 text-rose-600"
            icon={CreditCard}
          />
        </div>
      )}

      {/* Payment Breakdown */}
      {payBreakdown && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800 text-sm">Payment Mode Breakdown</h2>
            <CreditCard className="h-4 w-4 text-slate-400" />
          </div>
          <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-4 bg-slate-100">
            {(payBreakdown.total > 0) && [
              { val: payBreakdown.cash, color: 'bg-emerald-500', label: 'Cash' },
              { val: payBreakdown.upi, color: 'bg-violet-500', label: 'UPI' },
              { val: payBreakdown.chequeCleared, color: 'bg-sky-500', label: 'Cheque Cleared' },
              { val: payBreakdown.chequePending, color: 'bg-sky-300', label: 'Cheque Pending' },
              { val: payBreakdown.credit, color: 'bg-amber-400', label: 'Credit' },
            ].filter(item => item.val > 0).map(item => (
              <div
                key={item.label}
                className={`${item.color} transition-all`}
                style={{ width: `${(item.val / payBreakdown.total) * 100}%` }}
                title={`${item.label}: ${formatCurrency(item.val)}`}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { label: 'Cash', value: payBreakdown.cash, color: 'bg-emerald-500' },
              { label: 'UPI', value: payBreakdown.upi, color: 'bg-violet-500' },
              { label: 'Cheque (Cleared)', value: payBreakdown.chequeCleared, color: 'bg-sky-500' },
              { label: 'Cheque (Pending)', value: payBreakdown.chequePending, color: 'bg-sky-300' },
              { label: 'Credit / Udhari', value: payBreakdown.credit, color: 'bg-amber-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center p-2 rounded-lg bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <span className={`h-2 w-2 rounded-full ${color} flex-shrink-0`} />
                  <span className="text-[10px] font-medium text-slate-500 truncate">{label}</span>
                </div>
                <div className="text-xs font-bold text-slate-800">{formatCurrency(value)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Route Profitability */}
      {routeProfit && routeProfit.routes && routeProfit.routes.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-slate-400" />
              Route Profitability
            </h2>
            <span className="text-xs text-slate-400 font-medium">
              {routeProfit.routes.length} route execution{routeProfit.routes.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {routeProfit.routes.slice(0, 10).map((r: any) => {
              const routeRevenue = Number(r.sales ?? r.total_revenue ?? 0);
              const routeExpenses = Number(r.approved_expenses ?? r.total_expenses ?? 0);
              const routeProfitAmount = Number(r.contribution_before_cogs ?? r.net_profit ?? (routeRevenue - routeExpenses));
              return (
                <div key={r.picklist_id || r.route_id || r.route_name} className="px-4 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800 text-sm">{r.route_name || '—'}</div>
                    <div className="text-xs text-slate-500">
                      {r.picklist_number ? `Picklist #${r.picklist_number}` : 'Daily Route'}
                      {r.worker_name ? ` · ${r.worker_name}` : ''}
                      {r.date ? ` · ${r.date}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-slate-900 text-sm">{formatCurrency(routeRevenue)}</div>
                    <div className="text-xs text-slate-400">sales revenue</div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold text-sm ${routeProfitAmount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {formatCurrency(routeProfitAmount)}
                    </div>
                    <div className="text-xs text-slate-400">net profit</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Party Debt Aging */}
      {agingData.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Party Debt Aging (Top Outstanding)
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {agingData.slice(0, 10).map((p: any) => (
              <div key={p.party_id || p.party_name} className="px-4 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-sm truncate">{p.party_name || '—'}</div>
                  <div className="text-xs text-slate-500">{p.route_name || 'No route'}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-amber-700 text-sm">{formatCurrency(p.outstanding_amount || 0)}</div>
                  {p.days_overdue > 0 && (
                    <div className="text-xs text-rose-500">{p.days_overdue}d overdue</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
