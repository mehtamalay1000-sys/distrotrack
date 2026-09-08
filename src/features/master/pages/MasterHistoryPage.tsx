import { useState, useEffect } from 'react';
import {
  RefreshCw, CalendarDays, TrendingUp, TrendingDown,
  Layers, Truck, Users,
} from 'lucide-react';
import {
  getHistoricalSummaries, getRouteProfitability,
  type PeriodSummary, type RouteProfitabilityResponse,
} from '@/features/master/services/masterService';

// ── Helpers ──────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtShort = (n: number) =>
  n >= 1_00_000
    ? `₹${(n / 1_00_000).toFixed(2)}L`
    : n >= 1_000
    ? `₹${(n / 1_000).toFixed(1)}K`
    : `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

// ── Simple Bar Chart ──────────────────────────────────────────────

interface SimpleBarChartProps {
  data: { label: string; value: number; color: string }[];
  height?: number;
}

function SimpleBarChart({ data, height = 120 }: SimpleBarChartProps) {
  const max = Math.max(...data.map(d => d.value), 1);
  const barWidth = Math.max(12, Math.floor(320 / Math.max(data.length, 1)) - 4);

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(320, data.length * (barWidth + 4) + 16)} height={height + 36} className="text-xs">
        {data.map((d, i) => {
          const barH = Math.max(4, (Math.max(0, d.value) / max) * height);
          const x = 8 + i * (barWidth + 4);
          const y = height - barH + 4;
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={barWidth} height={barH} fill={d.color} rx={3} opacity={0.85} />
              <title>{d.label}: {fmt(d.value)}</title>
              <text
                x={x + barWidth / 2}
                y={height + 16}
                textAnchor="middle"
                fontSize={9}
                fill="#94a3b8"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Trend indicator ───────────────────────────────────────────────

function Trend({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ── Period selector ───────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function generateLastNMonths(n: number): Array<{ year: number; month: number }> {
  const now = new Date();
  const result = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return result.reverse();
}

// ── Main Page ─────────────────────────────────────────────────────

type HistoryTab = 'periods' | 'routes' | 'workers';

export function MasterHistoryPage() {
  const now = new Date();
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const [activeTab, setActiveTab] = useState<HistoryTab>('periods');
  const [mode, setMode] = useState<'last6' | 'last12' | 'custom_range'>('last6');
  const [customFrom, setCustomFrom] = useState({ year: now.getFullYear(), month: Math.max(1, now.getMonth() - 2) });
  const [customTo, setCustomTo] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });

  const [summaries, setSummaries] = useState<PeriodSummary[]>([]);
  const [routeProfitability, setRouteProfitability] = useState<RouteProfitabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const buildMonthList = (): Array<{ year: number; month: number }> => {
    if (mode === 'last6') return generateLastNMonths(6);
    if (mode === 'last12') return generateLastNMonths(12);
    // custom range
    const list: Array<{ year: number; month: number }> = [];
    let y = customFrom.year, m = customFrom.month;
    while (y < customTo.year || (y === customTo.year && m <= customTo.month)) {
      list.push({ year: y, month: m });
      m++;
      if (m > 12) { m = 1; y++; }
      if (list.length > 24) break; // safety cap
    }
    return list;
  };

  const getActiveRange = () => {
    const months = buildMonthList();
    if (months.length === 0) return { from: '', to: '' };
    const first = months[0];
    const last = months[months.length - 1];
    const fromStr = `${first.year}-${String(first.month).padStart(2, '0')}-01`;
    const lastDay = new Date(last.year, last.month, 0).getDate();
    const toStr = `${last.year}-${String(last.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { from: fromStr, to: toStr };
  };

  const load = async () => {
    setLoading(true);
    const months = buildMonthList();
    const range = getActiveRange();

    const [summaryData, routeData] = await Promise.all([
      getHistoricalSummaries(months),
      getRouteProfitability({ start_date: range.from, end_date: range.to }),
    ]);

    setSummaries(summaryData);
    setRouteProfitability(routeData);
    setLoading(false);
  };

  useEffect(() => { load(); }, [mode, customFrom.year, customFrom.month, customTo.year, customTo.month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chart data
  const salesChartData = summaries.map(s => ({ label: s.label, value: s.totalSales, color: '#6366f1' }));
  const collectionsChartData = summaries.map(s => ({ label: s.label, value: s.totalCollections, color: '#10b981' }));
  const contributionChartData = summaries.map(s => ({ label: s.label, value: s.contributionBeforeCogs, color: '#0ea5e9' }));

  // Worker aggregated performance from route profitability
  const workerAggregates = (() => {
    if (!routeProfitability || !routeProfitability.routes) return [];
    const map: Record<string, {
      workerId: string;
      workerName: string;
      routeCount: number;
      sales: number;
      collections: number;
      credit: number;
      approvedExpenses: number;
      contribution: number;
      cashDiscrepancy: number;
    }> = {};

    for (const r of routeProfitability.routes) {
      const wId = r.worker_id || 'unassigned';
      const wName = r.worker_name || 'Unassigned Worker';
      if (!map[wId]) {
        map[wId] = {
          workerId: wId,
          workerName: wName,
          routeCount: 0,
          sales: 0,
          collections: 0,
          credit: 0,
          approvedExpenses: 0,
          contribution: 0,
          cashDiscrepancy: 0,
        };
      }
      map[wId].routeCount += 1;
      map[wId].sales += Number(r.sales ?? 0);
      map[wId].collections += Number(r.total_collected ?? 0);
      map[wId].credit += Number(r.credit_sales ?? 0);
      map[wId].approvedExpenses += Number(r.approved_expenses ?? 0);
      map[wId].contribution += Number(r.contribution_before_cogs ?? 0);
      map[wId].cashDiscrepancy += Number(r.cash_discrepancy ?? 0);
    }

    return Object.values(map).sort((a, b) => b.sales - a.sales);
  })();

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Historical Analysis & Oversight</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Multi-period performance, route contribution history & cross-worker analytics
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden text-xs font-semibold">
            {([
              { id: 'last6', label: 'Last 6 Months' },
              { id: 'last12', label: 'Last 12 Months' },
              { id: 'custom_range', label: 'Custom Range' },
            ] as const).map(({ id, label }) => (
              <button key={id} onClick={() => setMode(id)}
                className={`px-3 py-1.5 cursor-pointer transition-colors ${mode === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading}
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors disabled:opacity-40 cursor-pointer"
            title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 mb-5 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('periods')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'periods'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40 rounded-t-lg'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="h-4 w-4" />
          Period Breakdown (Monthly)
        </button>
        <button
          onClick={() => setActiveTab('routes')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'routes'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40 rounded-t-lg'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Truck className="h-4 w-4" />
          Route Performance History
          {routeProfitability?.routes?.length ? (
            <span className="bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded-full text-[10px]">
              {routeProfitability.routes.length}
            </span>
          ) : null}
        </button>
        <button
          onClick={() => setActiveTab('workers')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'workers'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40 rounded-t-lg'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="h-4 w-4" />
          Worker Performance History
          {workerAggregates.length > 0 && (
            <span className="bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded-full text-[10px]">
              {workerAggregates.length}
            </span>
          )}
        </button>
      </div>

      {/* Custom range selectors */}
      {mode === 'custom_range' && (
        <div className="flex items-center gap-3 mb-4 bg-white rounded-xl border border-slate-200 px-4 py-3 flex-wrap">
          <CalendarDays className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-600">From:</span>
          <select value={customFrom.month} onChange={e => setCustomFrom(p => ({ ...p, month: Number(e.target.value) }))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 font-medium">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={customFrom.year} onChange={e => setCustomFrom(p => ({ ...p, year: Number(e.target.value) }))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 font-medium">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="text-xs font-semibold text-slate-600">To:</span>
          <select value={customTo.month} onChange={e => setCustomTo(p => ({ ...p, month: Number(e.target.value) }))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 font-medium">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={customTo.year} onChange={e => setCustomTo(p => ({ ...p, year: Number(e.target.value) }))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 font-medium">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading authoritative historical data…
        </div>
      )}

      {!loading && activeTab === 'periods' && summaries.length > 0 && (
        <>
          {/* ── Charts ────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            {[
              { title: 'Delivered Sales by Month', data: salesChartData, accent: 'text-indigo-700' },
              { title: 'Collections by Month', data: collectionsChartData, accent: 'text-emerald-700' },
              { title: 'Contribution (Before COGS)', data: contributionChartData, accent: 'text-sky-700' },
            ].map(({ title, data, accent }) => (
              <div key={title} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className={`text-xs font-semibold ${accent} uppercase tracking-wider mb-3`}>{title}</div>
                <SimpleBarChart data={data} height={100} />
              </div>
            ))}
          </div>

          {/* ── Data Table (with UPI, Contribution, Expected Physical Cash) ── */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-5">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Period-by-Period Authoritative Breakdown</h2>
              <span className="text-xs text-slate-400">Distinguishes Cash, UPI, Cheque, Credit</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <th className="text-left px-3 py-2.5 whitespace-nowrap">Period</th>
                    <th className="text-right px-3 py-2.5 whitespace-nowrap">Delivered Sales</th>
                    <th className="text-right px-3 py-2.5 whitespace-nowrap">Collections</th>
                    <th className="text-right px-3 py-2.5 whitespace-nowrap text-emerald-700">Cash</th>
                    <th className="text-right px-3 py-2.5 whitespace-nowrap text-violet-700">UPI</th>
                    <th className="text-right px-3 py-2.5 whitespace-nowrap text-sky-700">Cheque</th>
                    <th className="text-right px-3 py-2.5 whitespace-nowrap text-amber-700">Credit</th>
                    <th className="text-right px-3 py-2.5 whitespace-nowrap text-rose-600">Expenses</th>
                    <th className="text-right px-3 py-2.5 whitespace-nowrap text-indigo-700">Contribution (COGS)</th>
                    <th className="text-right px-3 py-2.5 whitespace-nowrap text-teal-700">Exp. Cash Handover</th>
                    <th className="text-right px-3 py-2.5 whitespace-nowrap text-rose-700">Outstanding</th>
                    <th className="text-center px-3 py-2.5 whitespace-nowrap">Deliv. (Done/Tot)</th>
                    <th className="text-left px-3 py-2.5 whitespace-nowrap">vs Prev</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summaries.map((s, i) => {
                    const prev = summaries[i - 1];
                    return (
                      <tr key={`${s.year}-${s.month}`} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2.5 font-semibold text-slate-800 whitespace-nowrap">{s.label}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-indigo-700 whitespace-nowrap">{fmtShort(s.totalSales)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-700 whitespace-nowrap">{fmtShort(s.totalCollections)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 whitespace-nowrap">{fmtShort(s.totalCash)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-violet-700 whitespace-nowrap">{fmtShort(s.totalUpi)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-sky-700 whitespace-nowrap">{fmtShort(s.totalCheque)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-amber-700 whitespace-nowrap">{fmtShort(s.totalCredit)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-rose-600 whitespace-nowrap">{fmtShort(s.totalExpenses)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-indigo-700 whitespace-nowrap">{fmtShort(s.contributionBeforeCogs)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-teal-700 whitespace-nowrap">{fmtShort(s.expectedPhysicalCash)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-rose-700 whitespace-nowrap">{fmtShort(s.totalOutstanding)}</td>
                        <td className="px-3 py-2.5 text-center text-slate-700 whitespace-nowrap">{s.completedDeliveries} / {s.totalDeliveries}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {prev ? <Trend current={s.totalCollections} previous={prev.totalCollections} /> : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {summaries.length > 1 && (
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold">
                      <td className="px-3 py-2.5 text-slate-800 text-[11px] uppercase tracking-wider">Total</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-indigo-700 whitespace-nowrap">{fmtShort(summaries.reduce((s, r) => s + r.totalSales, 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 whitespace-nowrap">{fmtShort(summaries.reduce((s, r) => s + r.totalCollections, 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 whitespace-nowrap">{fmtShort(summaries.reduce((s, r) => s + r.totalCash, 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-violet-700 whitespace-nowrap">{fmtShort(summaries.reduce((s, r) => s + r.totalUpi, 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-sky-700 whitespace-nowrap">{fmtShort(summaries.reduce((s, r) => s + r.totalCheque, 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-amber-700 whitespace-nowrap">{fmtShort(summaries.reduce((s, r) => s + r.totalCredit, 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-rose-600 whitespace-nowrap">{fmtShort(summaries.reduce((s, r) => s + r.totalExpenses, 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-indigo-700 whitespace-nowrap">{fmtShort(summaries.reduce((s, r) => s + r.contributionBeforeCogs, 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-teal-700 whitespace-nowrap">{fmtShort(summaries.reduce((s, r) => s + r.expectedPhysicalCash, 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-rose-700 whitespace-nowrap">{fmtShort(summaries[summaries.length - 1]?.totalOutstanding ?? 0)}</td>
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        {summaries.reduce((s, r) => s + r.completedDeliveries, 0)} / {summaries.reduce((s, r) => s + r.totalDeliveries, 0)}
                      </td>
                      <td className="px-3 py-2.5" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* ── Financial Year Note ──────────────────────────── */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-500">
            <span className="font-semibold">Authoritative Definitions:</span> Commercial Sales = Delivered Commercial Qty × Rate ·
            Contribution Before COGS = Sales − Approved Operating Expenses · Expected Physical Cash = Cash − Cash Expenses.
          </div>
        </>
      )}

      {/* ── Route Performance History Tab ──────────────────── */}
      {!loading && activeTab === 'routes' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Historical Route Profitability & Discrepancies</h2>
            <span className="text-xs text-slate-400">Authoritative get_route_profitability</span>
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
                    <th className="text-right px-3 py-2.5">Collections</th>
                    <th className="text-right px-3 py-2.5 text-rose-600">Approved Exp.</th>
                    <th className="text-right px-3 py-2.5 text-indigo-700">Contribution</th>
                    <th className="text-right px-3 py-2.5">Expected Cash</th>
                    <th className="text-right px-3 py-2.5">Actual Cash</th>
                    <th className="text-right px-3 py-2.5">Variance</th>
                    <th className="text-center px-3 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {routeProfitability.routes.map(r => (
                    <tr key={r.picklist_id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                        {r.date} <span className="text-slate-400 font-normal">({r.picklist_number})</span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 font-medium">{r.route_name || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600">{r.worker_name || '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{fmt(r.sales)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{fmt(r.total_collected)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">{fmt(r.approved_expenses)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-indigo-700">{fmt(r.contribution_before_cogs)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmt(r.expected_cash)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{fmt(r.actual_cash_returned)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${
                        r.cash_discrepancy !== 0 ? 'text-rose-600' : 'text-slate-400'
                      }`}>
                        {fmt(r.cash_discrepancy)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
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
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-sm">
              No route profitability data for the selected range.
            </div>
          )}
        </div>
      )}

      {/* ── Worker Performance History Tab ─────────────────── */}
      {!loading && activeTab === 'workers' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Historical Worker Comparison & Accountability</h2>
            <span className="text-xs text-slate-400">Aggregated from authoritative route reports</span>
          </div>
          {workerAggregates.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <th className="text-left px-4 py-2.5">Worker Name</th>
                    <th className="text-center px-4 py-2.5">Routes Handled</th>
                    <th className="text-right px-4 py-2.5">Delivered Commercial Sales</th>
                    <th className="text-right px-4 py-2.5">Collections Realized</th>
                    <th className="text-right px-4 py-2.5 text-amber-700">Credit Extended</th>
                    <th className="text-right px-4 py-2.5 text-rose-600">Approved Expenses</th>
                    <th className="text-right px-4 py-2.5 text-indigo-700">Contribution (COGS)</th>
                    <th className="text-right px-4 py-2.5">Cash Discrepancy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workerAggregates.map(w => (
                    <tr key={w.workerId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{w.workerName}</td>
                      <td className="px-4 py-2.5 text-center font-medium text-slate-700">{w.routeCount}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-bold text-slate-900">{fmt(w.sales)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700 font-medium">{fmt(w.collections)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{fmt(w.credit)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-rose-600">{fmt(w.approvedExpenses)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-bold text-indigo-700">{fmt(w.contribution)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                        w.cashDiscrepancy !== 0 ? 'text-rose-600' : 'text-emerald-600'
                      }`}>
                        {fmt(w.cashDiscrepancy)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-sm">
              No worker performance data for the selected range.
            </div>
          )}
        </div>
      )}

      {!loading && activeTab === 'periods' && summaries.length === 0 && (
        <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
          No data found for the selected period.
        </div>
      )}
    </div>
  );
}

