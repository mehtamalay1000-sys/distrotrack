import { useState, useEffect } from 'react';
import {
  RefreshCw, BarChart3, Truck, Users, Package, AlertCircle,
  ShieldAlert, Search, XCircle, Clock, CalendarDays, History,
} from 'lucide-react';
import {
  getMasterKPIs, getRouteProfitability, getMasterProductAnalytics,
  getMasterPartyDebtAging, getMasterExceptions, getHistoricalSummaries, monthRange,
  type DateRange, type MasterKPIs, type RouteProfitabilityResponse,
  type MasterProductMetric, type MasterPartyAging, type MasterExceptions,
  type PeriodSummary,
} from '@/features/master/services/masterService';

// ── Helpers ──────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ReportTab =
  | 'route_profitability'
  | 'worker_performance'
  | 'sku_performance'
  | 'party_aging'
  | 'financial_overview'
  | 'monthly'
  | 'exceptions';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function MasterReportsPage() {
  const now = new Date();
  const [activeTab, setActiveTab] = useState<ReportTab>('route_profitability');
  const [preset, setPreset] = useState<'this_month' | 'last_month' | 'custom'>('this_month');
  const [customYear, setCustomYear] = useState(now.getFullYear());
  const [customMonth, setCustomMonth] = useState(now.getMonth() + 1);

  const [loading, setLoading] = useState(true);

  // Tab Data States
  const [routeProfitability, setRouteProfitability] = useState<RouteProfitabilityResponse | null>(null);
  const [skuMetrics, setSkuMetrics] = useState<MasterProductMetric[]>([]);
  const [partyAging, setPartyAging] = useState<MasterPartyAging[]>([]);
  const [kpis, setKpis] = useState<MasterKPIs | null>(null);
  const [monthlySummaries, setMonthlySummaries] = useState<PeriodSummary[]>([]);
  const [exceptions, setExceptions] = useState<MasterExceptions | null>(null);

  // Filters within tabs
  const [skuSearch, setSkuSearch] = useState('');
  const [partyRiskFilter, setPartyRiskFilter] = useState<'all' | 'high' | 'moderate' | 'normal'>('all');
  const [partySearch, setPartySearch] = useState('');
  const [routeStatusFilter, setRouteStatusFilter] = useState<'all' | 'reconciled' | 'discrepancy' | 'pending'>('all');

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const getDateRange = (): DateRange => {
    if (preset === 'this_month') {
      return monthRange(now.getFullYear(), now.getMonth() + 1);
    }
    if (preset === 'last_month') {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return monthRange(prev.getFullYear(), prev.getMonth() + 1);
    }
    return monthRange(customYear, customMonth);
  };

  const range = getDateRange();

  const loadTabData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'route_profitability' || activeTab === 'worker_performance') {
        const data = await getRouteProfitability({ start_date: range.from, end_date: range.to });
        setRouteProfitability(data);
      } else if (activeTab === 'sku_performance') {
        const data = await getMasterProductAnalytics(range);
        setSkuMetrics(data);
      } else if (activeTab === 'party_aging') {
        const data = await getMasterPartyDebtAging();
        setPartyAging(data);
      } else if (activeTab === 'financial_overview') {
        const data = await getMasterKPIs(range);
        setKpis(data);
      } else if (activeTab === 'monthly') {
        const monthsList = [];
        for (let i = 0; i < 12; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          monthsList.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
        }
        const data = await getHistoricalSummaries(monthsList.reverse());
        setMonthlySummaries(data);
      } else if (activeTab === 'exceptions') {
        const data = await getMasterExceptions(range);
        setExceptions(data);
      }
    } catch (err) {
      console.warn('[MasterReportsPage] load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTabData();
  }, [activeTab, preset, customYear, customMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  // Worker performance aggregation from routeProfitability
  const workerAggregates = (() => {
    if (!routeProfitability?.routes) return [];
    const map: Record<string, {
      workerId: string;
      workerName: string;
      routesHandled: number;
      sales: number;
      collections: number;
      cash: number;
      upi: number;
      cheque: number;
      credit: number;
      approvedExpenses: number;
      contribution: number;
      expectedCash: number;
      actualCash: number;
      discrepancy: number;
      exceptionsCount: number;
    }> = {};

    for (const r of routeProfitability.routes) {
      const wId = r.worker_id || 'unassigned';
      const wName = r.worker_name || 'Unassigned Worker';
      if (!map[wId]) {
        map[wId] = {
          workerId: wId,
          workerName: wName,
          routesHandled: 0,
          sales: 0,
          collections: 0,
          cash: 0,
          upi: 0,
          cheque: 0,
          credit: 0,
          approvedExpenses: 0,
          contribution: 0,
          expectedCash: 0,
          actualCash: 0,
          discrepancy: 0,
          exceptionsCount: 0,
        };
      }
      map[wId].routesHandled += 1;
      map[wId].sales += Number(r.sales ?? 0);
      map[wId].collections += Number(r.total_collected ?? 0);
      map[wId].cash += Number(r.cash_collected ?? 0);
      map[wId].upi += Number(r.upi_collected ?? 0);
      map[wId].cheque += Number((r.cheque_cleared ?? 0) + (r.cheque_pending ?? 0));
      map[wId].credit += Number(r.credit_sales ?? 0);
      map[wId].approvedExpenses += Number(r.approved_expenses ?? 0);
      map[wId].contribution += Number(r.contribution_before_cogs ?? 0);
      map[wId].expectedCash += Number(r.expected_cash ?? 0);
      map[wId].actualCash += Number(r.actual_cash_returned ?? 0);
      map[wId].discrepancy += Number(r.cash_discrepancy ?? 0);
      if (r.cash_discrepancy !== 0 || r.financial_status === 'discrepancy') {
        map[wId].exceptionsCount += 1;
      }
    }
    return Object.values(map).sort((a, b) => b.sales - a.sales);
  })();

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Master Analytical Reports</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Executive oversight · Route profitability, worker accountability, SKU analytics & aging risk
          </p>
        </div>

        {/* Global Period Selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden text-xs font-semibold">
            <button
              onClick={() => setPreset('this_month')}
              className={`px-3 py-1.5 cursor-pointer transition-colors ${
                preset === 'this_month' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => setPreset('last_month')}
              className={`px-3 py-1.5 cursor-pointer transition-colors ${
                preset === 'last_month' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Last Month
            </button>
            <button
              onClick={() => setPreset('custom')}
              className={`px-3 py-1.5 cursor-pointer transition-colors ${
                preset === 'custom' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Custom
            </button>
          </div>

          {preset === 'custom' && (
            <div className="flex items-center gap-1.5">
              <select
                value={customMonth}
                onChange={e => setCustomMonth(Number(e.target.value))}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 font-medium"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
              <select
                value={customYear}
                onChange={e => setCustomYear(Number(e.target.value))}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 font-medium"
              >
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}

          <button
            onClick={loadTabData}
            disabled={loading}
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors disabled:opacity-40 cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Date Range Badge */}
      <div className="flex items-center gap-2 mb-4 text-xs text-slate-500">
        <CalendarDays className="h-3.5 w-3.5" />
        <span>
          Reporting Period: <strong className="text-slate-700">{range.from}</strong> to <strong className="text-slate-700">{range.to}</strong>
        </span>
      </div>

      {/* ── Tabs Navigation ────────────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-6 border-b border-slate-200 overflow-x-auto pb-0.5">
        {[
          { id: 'route_profitability', label: 'Route Profitability', icon: Truck },
          { id: 'worker_performance', label: 'Worker Performance', icon: Users },
          { id: 'sku_performance', label: 'SKU / Products', icon: Package },
          { id: 'party_aging', label: 'Party Debt Aging', icon: AlertCircle },
          { id: 'financial_overview', label: 'Financial Overview', icon: BarChart3 },
          { id: 'monthly', label: 'Monthly Performance', icon: History },
          { id: 'exceptions', label: 'Exceptions & Audit', icon: ShieldAlert },
        ].map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as ReportTab)}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                active
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50 rounded-t-lg'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50/60'
              }`}
            >
              <Icon className={`h-4 w-4 ${active ? 'text-indigo-600' : 'text-slate-400'}`} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading analytical data…
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 1: ROUTE PROFITABILITY
         ───────────────────────────────────────────────────────────── */}
      {!loading && activeTab === 'route_profitability' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Authoritative Route Profitability & Reconciliation</h2>
              <p className="text-xs text-slate-400 mt-0.5">Commercial sales, operating costs, contribution & cash discrepancies</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Filter:</span>
              <select
                value={routeStatusFilter}
                onChange={e => setRouteStatusFilter(e.target.value as any)}
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700"
              >
                <option value="all">All Routes</option>
                <option value="reconciled">Reconciled</option>
                <option value="discrepancy">Discrepant</option>
                <option value="pending">Pending</option>
              </select>
            </div>
          </div>

          {routeProfitability?.routes && routeProfitability.routes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <th className="text-left px-3 py-2.5">Date / Picklist</th>
                    <th className="text-left px-3 py-2.5">Route</th>
                    <th className="text-left px-3 py-2.5">Worker</th>
                    <th className="text-right px-3 py-2.5">Commercial Sales</th>
                    <th className="text-right px-3 py-2.5">Cash</th>
                    <th className="text-right px-3 py-2.5">UPI</th>
                    <th className="text-right px-3 py-2.5">Cheque</th>
                    <th className="text-right px-3 py-2.5 text-amber-700">Credit</th>
                    <th className="text-right px-3 py-2.5">Total Collected</th>
                    <th className="text-right px-3 py-2.5 text-rose-600">Approved Expenses</th>
                    <th className="text-right px-3 py-2.5 text-indigo-700">Contribution (COGS)</th>
                    <th className="text-right px-3 py-2.5">Expected Cash</th>
                    <th className="text-right px-3 py-2.5">Actual Cash</th>
                    <th className="text-right px-3 py-2.5">Discrepancy</th>
                    <th className="text-center px-3 py-2.5">Reconciliation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {routeProfitability.routes
                    .filter(r => routeStatusFilter === 'all' || r.financial_status === routeStatusFilter)
                    .map(r => (
                      <tr key={r.picklist_id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                          {r.date} <span className="text-slate-400 font-normal">({r.picklist_number})</span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 font-medium">{r.route_name || '—'}</td>
                        <td className="px-3 py-2.5 text-slate-600">{r.worker_name || '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{fmt(r.sales)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(r.cash_collected)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(r.upi_collected)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt((r.cheque_cleared ?? 0) + (r.cheque_pending ?? 0))}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{fmt(r.credit_sales)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 font-medium">{fmt(r.total_collected)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">{fmt(r.approved_expenses)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-bold text-indigo-700">{fmt(r.contribution_before_cogs)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmt(r.expected_cash)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{fmt(r.actual_cash_returned)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${
                          r.cash_discrepancy !== 0 ? 'text-rose-600' : 'text-slate-400'
                        }`}>
                          {fmt(r.cash_discrepancy)}
                        </td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            r.financial_status === 'reconciled' ? 'bg-emerald-100 text-emerald-800' :
                            r.financial_status === 'discrepancy' ? 'bg-rose-100 text-rose-800' :
                            'bg-amber-100 text-amber-800'
                          }`}>
                            {r.financial_status || 'pending'}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
                {routeProfitability.totals && (
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold">
                      <td colSpan={3} className="px-3 py-2.5 text-slate-800 uppercase text-[11px] tracking-wider">Total Route Operations</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{fmt(routeProfitability.totals.sales)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(routeProfitability.totals.cash_collected)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(routeProfitability.totals.upi_collected)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt((routeProfitability.totals.cheque_cleared ?? 0) + (routeProfitability.totals.cheque_pending ?? 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{fmt(routeProfitability.totals.credit_sales)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{fmt(routeProfitability.totals.total_collected)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">{fmt(routeProfitability.totals.approved_expenses)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-indigo-700">{fmt(routeProfitability.totals.contribution_before_cogs)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(routeProfitability.totals.expected_cash)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{fmt(routeProfitability.totals.actual_cash_returned)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">{fmt(routeProfitability.totals.cash_discrepancy)}</td>
                      <td className="px-3 py-2.5" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-sm">
              No route profitability data for the selected period.
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 2: WORKER PERFORMANCE
         ───────────────────────────────────────────────────────────── */}
      {!loading && activeTab === 'worker_performance' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">Worker Analytical Comparison & Performance</h2>
            <p className="text-xs text-slate-400 mt-0.5">Commercial value delivered, collections, expense efficiency & discrepancy records</p>
          </div>

          {workerAggregates.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <th className="text-left px-3 py-2.5">Worker</th>
                    <th className="text-center px-3 py-2.5">Routes</th>
                    <th className="text-right px-3 py-2.5">Delivered Commercial Sales</th>
                    <th className="text-right px-3 py-2.5">Cash</th>
                    <th className="text-right px-3 py-2.5">UPI</th>
                    <th className="text-right px-3 py-2.5">Cheque</th>
                    <th className="text-right px-3 py-2.5 text-amber-700">Credit</th>
                    <th className="text-right px-3 py-2.5">Total Collections</th>
                    <th className="text-right px-3 py-2.5 text-rose-600">Approved Expenses</th>
                    <th className="text-right px-3 py-2.5 text-indigo-700">Contribution (COGS)</th>
                    <th className="text-right px-3 py-2.5">Expected Cash</th>
                    <th className="text-right px-3 py-2.5">Actual Cash</th>
                    <th className="text-right px-3 py-2.5">Variance</th>
                    <th className="text-center px-3 py-2.5">Exceptions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workerAggregates.map(w => (
                    <tr key={w.workerId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2.5 font-semibold text-slate-900">{w.workerName}</td>
                      <td className="px-3 py-2.5 text-center text-slate-700 font-medium">{w.routesHandled}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900">{fmt(w.sales)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(w.cash)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(w.upi)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(w.cheque)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{fmt(w.credit)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 font-medium">{fmt(w.collections)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">{fmt(w.approvedExpenses)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-indigo-700">{fmt(w.contribution)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmt(w.expectedCash)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{fmt(w.actualCash)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${
                        w.discrepancy !== 0 ? 'text-rose-600' : 'text-emerald-600'
                      }`}>
                        {fmt(w.discrepancy)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {w.exceptionsCount > 0 ? (
                          <span className="bg-rose-100 text-rose-800 text-[10px] font-bold px-1.5 py-0.5 rounded">
                            {w.exceptionsCount} Discrepant
                          </span>
                        ) : (
                          <span className="text-emerald-600 text-xs font-medium">Clean</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-sm">
              No worker activity records found for this period.
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 3: SKU / PRODUCT PERFORMANCE
         ───────────────────────────────────────────────────────────── */}
      {!loading && activeTab === 'sku_performance' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Product / SKU Commercial Performance</h2>
              <p className="text-xs text-slate-400 mt-0.5">Authoritative delivery quantities & delivered commercial values</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="h-3.5 w-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search SKU..."
                value={skuSearch}
                onChange={e => setSkuSearch(e.target.value)}
                className="w-full text-xs pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          {skuMetrics.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <th className="text-left px-4 py-2.5">SKU</th>
                    <th className="text-right px-4 py-2.5">Ordered Qty</th>
                    <th className="text-right px-4 py-2.5 text-emerald-700">Delivered Qty</th>
                    <th className="text-right px-4 py-2.5 text-amber-700">Refused / Return Qty</th>
                    <th className="text-right px-4 py-2.5 text-indigo-700">Delivered Commercial Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {skuMetrics
                    .filter(s => !skuSearch || s.sku.toLowerCase().includes(skuSearch.toLowerCase()))
                    .map(item => (
                      <tr key={item.sku} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2.5 font-semibold text-slate-800">{item.sku}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{item.orderedQty}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{item.deliveredQty}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{item.refusedQty}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-indigo-700">{fmt(item.deliveredValue)}</td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold">
                    <td className="px-4 py-2.5 text-slate-800 uppercase text-[11px]">Total ({skuMetrics.length} SKUs)</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{skuMetrics.reduce((s, r) => s + r.orderedQty, 0)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{skuMetrics.reduce((s, r) => s + r.deliveredQty, 0)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{skuMetrics.reduce((s, r) => s + r.refusedQty, 0)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-indigo-700">{fmt(skuMetrics.reduce((s, r) => s + r.deliveredValue, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-sm">
              No SKU delivery records found for this period.
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 4: PARTY DEBT AGING
         ───────────────────────────────────────────────────────────── */}
      {!loading && activeTab === 'party_aging' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Party Debt Aging & Risk Analysis</h2>
              <p className="text-xs text-slate-400 mt-0.5">Authoritative party financial ledger debit history & payment behavior</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-48">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter party..."
                  value={partySearch}
                  onChange={e => setPartySearch(e.target.value)}
                  className="w-full text-xs pl-7 pr-2.5 py-1 border border-slate-200 rounded-lg"
                />
              </div>
              <select
                value={partyRiskFilter}
                onChange={e => setPartyRiskFilter(e.target.value as any)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700"
              >
                <option value="all">All Risk Tiers</option>
                <option value="high">High Risk (&gt;60 days)</option>
                <option value="moderate">Moderate (&gt;30 days)</option>
                <option value="normal">Normal (&lt;30 days)</option>
              </select>
            </div>
          </div>

          {partyAging.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <th className="text-left px-3 py-2.5">Party</th>
                    <th className="text-left px-3 py-2.5">Code</th>
                    <th className="text-right px-3 py-2.5">Outstanding Balance</th>
                    <th className="text-left px-3 py-2.5">Oldest Debit Entry</th>
                    <th className="text-right px-3 py-2.5">Days Aging</th>
                    <th className="text-center px-3 py-2.5">Payments Made</th>
                    <th className="text-center px-3 py-2.5">Risk Level</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {partyAging
                    .filter(p => partyRiskFilter === 'all' || p.risk === partyRiskFilter)
                    .filter(p => !partySearch || p.partyName.toLowerCase().includes(partySearch.toLowerCase()) || p.partyCode.toLowerCase().includes(partySearch.toLowerCase()))
                    .map(p => (
                      <tr key={p.partyId} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2.5 font-semibold text-slate-900">{p.partyName}</td>
                        <td className="px-3 py-2.5 text-slate-500">{p.partyCode}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900">{fmt(p.outstanding)}</td>
                        <td className="px-3 py-2.5 text-slate-600">{p.oldestDebitDate || '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-800">
                          {p.daysAging > 0 ? `${p.daysAging} days` : 'Current'}
                        </td>
                        <td className="px-3 py-2.5 text-center tabular-nums text-slate-700">{p.paymentCount}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            p.risk === 'high' ? 'bg-rose-100 text-rose-800' :
                            p.risk === 'moderate' ? 'bg-amber-100 text-amber-800' :
                            'bg-emerald-100 text-emerald-800'
                          }`}>
                            {p.risk.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold">
                    <td colSpan={2} className="px-3 py-2.5 text-slate-800 uppercase text-[11px]">Total Outstanding Debt</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">{fmt(partyAging.reduce((s, r) => s + r.outstanding, 0))}</td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-sm">
              No outstanding debt recorded in party financial ledger.
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 5: FINANCIAL OVERVIEW
         ───────────────────────────────────────────────────────────── */}
      {!loading && activeTab === 'financial_overview' && kpis && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Authoritative Financial Statement</h2>
              <p className="text-xs text-slate-400 mt-0.5">Strict compliance with Stage 5, 6, and 7 accounting definitions</p>
            </div>
            <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded">get_financial_summary</span>
          </div>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              {[
                { label: 'Delivered Commercial Sales (Sum of Delivered Qty × Rate)', value: fmt(kpis.totalSales), bold: true },
                { label: 'Cash Collections', value: fmt(kpis.totalCash) },
                { label: 'UPI Collections', value: fmt(kpis.totalUpi) },
                { label: 'Cheque Collections — Cleared', value: fmt(kpis.chequeCleared) },
                { label: 'Cheque Collections — Pending Clearance', value: fmt(kpis.chequePending) },
                { label: 'Credit Extended (Udhari on Delivery)', value: fmt(kpis.totalCredit) },
                { label: 'Total Realized Collections (Cash + UPI + Cleared + Pending Cheques)', value: fmt(kpis.totalCollections), bold: true },
                { label: 'Total Outstanding Balance (Parties Ledger)', value: fmt(kpis.outstandingAmount) },
                { label: 'Approved Route Operating Expenses', value: fmt(kpis.totalExpenses) },
                { label: 'Approved Cash Route Expenses', value: fmt(kpis.totalCashExpenses) },
                { label: 'Expected Physical Cash Handover (Cash Collections − Cash Expenses)', value: fmt(kpis.expectedPhysicalCash), bold: true },
                { label: 'Contribution Before COGS (Commercial Sales − Approved Expenses)', value: fmt(kpis.contributionBeforeCogs), bold: true },
              ].map(row => (
                <tr key={row.label} className="hover:bg-slate-50 transition-colors">
                  <td className={`px-4 py-2.5 ${row.bold ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{row.label}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${row.bold ? 'font-bold text-slate-900 text-sm' : 'text-slate-700'}`}>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 6: MONTHLY PERFORMANCE
         ───────────────────────────────────────────────────────────── */}
      {!loading && activeTab === 'monthly' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">Monthly / Historical Business Performance</h2>
            <p className="text-xs text-slate-400 mt-0.5">Authoritative monthly trend analysis with strict financial classification</p>
          </div>
          {monthlySummaries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <th className="text-left px-3 py-2.5">Period</th>
                    <th className="text-right px-3 py-2.5">Delivered Commercial Sales</th>
                    <th className="text-right px-3 py-2.5">Realized Collections</th>
                    <th className="text-right px-3 py-2.5">Cash</th>
                    <th className="text-right px-3 py-2.5">UPI</th>
                    <th className="text-right px-3 py-2.5">Cheque Cleared</th>
                    <th className="text-right px-3 py-2.5">Cheque Pending</th>
                    <th className="text-right px-3 py-2.5 text-amber-700">Credit Extended</th>
                    <th className="text-right px-3 py-2.5 text-rose-600">Approved Expenses</th>
                    <th className="text-right px-3 py-2.5 text-indigo-700">Contribution (COGS)</th>
                    <th className="text-right px-3 py-2.5">Expected Cash</th>
                    <th className="text-right px-3 py-2.5 text-rose-700">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthlySummaries.map(m => (
                    <tr key={m.label} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">{m.label}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900">{fmt(m.totalSales)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 font-medium">{fmt(m.totalCollections)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(m.totalCash)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(m.totalUpi)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600">{fmt(m.chequeCleared)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-amber-600">{fmt(m.chequePending)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{fmt(m.totalCredit)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">{fmt(m.totalExpenses)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-indigo-700">{fmt(m.contributionBeforeCogs)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(m.expectedPhysicalCash)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-rose-700">{fmt(m.totalOutstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-sm">
              No historical data available.
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 7: EXCEPTIONS & RECONCILIATION
         ───────────────────────────────────────────────────────────── */}
      {!loading && activeTab === 'exceptions' && exceptions && (
        <div className="space-y-6">
          {/* Deck Overview */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3 bg-white rounded-xl border border-slate-200">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>Cash Discrepancies</span>
                <Clock className="h-3.5 w-3.5 text-amber-500" />
              </div>
              <div className="text-xl font-bold text-slate-900">{exceptions.cashDiscrepancies.count}</div>
              <div className="text-xs text-rose-600 font-semibold">{fmt(exceptions.cashDiscrepancies.totalAmount)} total</div>
            </div>

            <div className="p-3 bg-white rounded-xl border border-slate-200">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>Bounced Cheques</span>
                <XCircle className="h-3.5 w-3.5 text-rose-500" />
              </div>
              <div className="text-xl font-bold text-slate-900">{exceptions.bouncedCheques.count}</div>
              <div className="text-xs text-rose-600 font-semibold">{fmt(exceptions.bouncedCheques.totalAmount)} debt</div>
            </div>

            <div className="p-3 bg-white rounded-xl border border-slate-200">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>Pending Expenses</span>
                <Clock className="h-3.5 w-3.5 text-amber-500" />
              </div>
              <div className="text-xl font-bold text-slate-900">{exceptions.pendingExpenses.count}</div>
              <div className="text-xs text-amber-600 font-semibold">{fmt(exceptions.pendingExpenses.totalAmount)} pending</div>
            </div>

            <div className="p-3 bg-white rounded-xl border border-slate-200">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>Damaged Goods</span>
                <Package className="h-3.5 w-3.5 text-slate-500" />
              </div>
              <div className="text-xl font-bold text-slate-900">{exceptions.stockExceptions.totalDamagedQty}</div>
              <div className="text-xs text-slate-500">{exceptions.stockExceptions.damagedTransitCount} transit / {exceptions.stockExceptions.damagedWarehouseCount} warehouse</div>
            </div>
          </div>

          {/* Detailed Lists */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Active Cash Discrepancies</h3>
              <span className="text-xs text-slate-400">{exceptions.cashDiscrepancies.routes.length} incidents</span>
            </div>
            {exceptions.cashDiscrepancies.routes.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase">
                      <th className="text-left px-3 py-2">Picklist</th>
                      <th className="text-left px-3 py-2">Route</th>
                      <th className="text-left px-3 py-2">Worker</th>
                      <th className="text-right px-3 py-2">Expected Cash</th>
                      <th className="text-right px-3 py-2">Actual Cash</th>
                      <th className="text-right px-3 py-2 text-rose-600">Discrepancy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {exceptions.cashDiscrepancies.routes.map(r => (
                      <tr key={r.id}>
                        <td className="px-3 py-2 font-semibold text-slate-900">{r.picklistNumber}</td>
                        <td className="px-3 py-2 text-slate-700">{r.routeName}</td>
                        <td className="px-3 py-2 text-slate-600">{r.workerName}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.expectedCash)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.actualCash)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-600">{fmt(r.discrepancy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-slate-400">Zero cash discrepancies in period.</div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Bounced Cheques (Uncollected Debt)</h3>
              <span className="text-xs text-slate-400">{exceptions.bouncedCheques.items.length} cheques</span>
            </div>
            {exceptions.bouncedCheques.items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase">
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">Party</th>
                      <th className="text-left px-3 py-2">Cheque #</th>
                      <th className="text-left px-3 py-2">Worker</th>
                      <th className="text-right px-3 py-2 text-rose-600">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {exceptions.bouncedCheques.items.map(b => (
                      <tr key={b.id}>
                        <td className="px-3 py-2 text-slate-600">{b.date}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">{b.partyName}</td>
                        <td className="px-3 py-2 text-slate-500">{b.chequeNumber || '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{b.workerName}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-600">{fmt(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-slate-400">Zero bounced cheques in period.</div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Pending Expenses Awaiting Review</h3>
              <span className="text-xs text-amber-600 font-semibold">{exceptions.pendingExpenses.items.length} pending</span>
            </div>
            {exceptions.pendingExpenses.items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase">
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">Category</th>
                      <th className="text-left px-3 py-2">Worker</th>
                      <th className="text-left px-3 py-2">Description</th>
                      <th className="text-right px-3 py-2 text-amber-700">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {exceptions.pendingExpenses.items.map(e => (
                      <tr key={e.id}>
                        <td className="px-3 py-2 text-slate-600">{e.date}</td>
                        <td className="px-3 py-2 font-medium capitalize text-slate-800">{e.category}</td>
                        <td className="px-3 py-2 text-slate-600">{e.workerName}</td>
                        <td className="px-3 py-2 text-slate-500">{e.description || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-amber-700">{fmt(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-slate-400">Zero pending expenses awaiting review.</div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Damaged Stock Incidents</h3>
              <span className="text-xs text-rose-600 font-semibold">{exceptions.stockExceptions.recentDamagedMovements.length} incidents</span>
            </div>
            {exceptions.stockExceptions.recentDamagedMovements.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase">
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">SKU</th>
                      <th className="text-left px-3 py-2">Type</th>
                      <th className="text-left px-3 py-2">Worker</th>
                      <th className="text-right px-3 py-2 text-rose-600">Qty</th>
                      <th className="text-left px-3 py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {exceptions.stockExceptions.recentDamagedMovements.map(m => (
                      <tr key={m.id}>
                        <td className="px-3 py-2 text-slate-600">{m.date ? m.date.split('T')[0] : '—'}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">{m.sku}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            m.movementType === 'damaged_transit' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                          }`}>
                            {m.movementType === 'damaged_transit' ? 'Transit Damage' : 'Warehouse Damage'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{m.workerName}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-600">{m.quantity}</td>
                        <td className="px-3 py-2 text-slate-500">{m.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-slate-400">Zero damaged stock recorded in period.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
