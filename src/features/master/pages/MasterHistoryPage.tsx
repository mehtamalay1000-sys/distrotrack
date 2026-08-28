import { useState, useEffect } from 'react';
import { RefreshCw, CalendarDays, TrendingUp, TrendingDown } from 'lucide-react';
import { getHistoricalSummaries, type PeriodSummary } from '@/features/master/services/masterService';

// ── Helpers ──────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtShort = (n: number) =>
  n >= 1_00_000
    ? `₹${(n / 1_00_000).toFixed(2)}L`
    : n >= 1_000
    ? `₹${(n / 1_000).toFixed(1)}K`
    : `₹${n.toLocaleString('en-IN')}`;

// ── Simple Bar Chart ──────────────────────────────────────────────
// SVG-based, no external lib. Only shown where it genuinely adds value.

interface SimpleBarChartProps {
  data: { label: string; value: number; color: string }[];
  height?: number;
}

function SimpleBarChart({ data, height = 120 }: SimpleBarChartProps) {
  const max = Math.max(...data.map(d => d.value), 1);
  const barWidth = Math.floor(320 / data.length) - 4;

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(320, data.length * (barWidth + 4) + 16)} height={height + 36} className="text-xs">
        {data.map((d, i) => {
          const barH = Math.max(4, (d.value / max) * height);
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

export function MasterHistoryPage() {
  const now = new Date();
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const [mode, setMode] = useState<'last6' | 'last12' | 'custom_range'>('last6');
  const [customFrom, setCustomFrom] = useState({ year: now.getFullYear(), month: Math.max(1, now.getMonth() - 2) });
  const [customTo, setCustomTo] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });

  const [summaries, setSummaries] = useState<PeriodSummary[]>([]);
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

  const load = async () => {
    setLoading(true);
    const months = buildMonthList();
    const data = await getHistoricalSummaries(months);
    setSummaries(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [mode, customFrom.year, customFrom.month, customTo.year, customTo.month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chart data
  const salesChartData = summaries.map(s => ({ label: s.label, value: s.totalSales, color: '#6366f1' }));
  const collectionsChartData = summaries.map(s => ({ label: s.label, value: s.totalCollections, color: '#10b981' }));
  const expensesChartData = summaries.map(s => ({ label: s.label, value: s.totalExpenses, color: '#f43f5e' }));

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Historical Analysis</h1>
          <p className="text-sm text-slate-500 mt-0.5">Multi-period business performance — cross-month and cross-year</p>
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
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors disabled:opacity-40">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Custom range selectors */}
      {mode === 'custom_range' && (
        <div className="flex items-center gap-3 mb-4 bg-white rounded-xl border border-slate-200 px-4 py-3 flex-wrap">
          <CalendarDays className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-600">From:</span>
          <select value={customFrom.month} onChange={e => setCustomFrom(p => ({ ...p, month: Number(e.target.value) }))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={customFrom.year} onChange={e => setCustomFrom(p => ({ ...p, year: Number(e.target.value) }))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="text-xs font-semibold text-slate-600">To:</span>
          <select value={customTo.month} onChange={e => setCustomTo(p => ({ ...p, month: Number(e.target.value) }))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={customTo.year} onChange={e => setCustomTo(p => ({ ...p, year: Number(e.target.value) }))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading historical data…
        </div>
      )}

      {!loading && summaries.length > 0 && (
        <>
          {/* ── Charts ────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            {[
              { title: 'Sales by Month', data: salesChartData, accent: 'text-indigo-700' },
              { title: 'Collections by Month', data: collectionsChartData, accent: 'text-emerald-700' },
              { title: 'Expenses by Month', data: expensesChartData, accent: 'text-rose-600' },
            ].map(({ title, data, accent }) => (
              <div key={title} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className={`text-xs font-semibold ${accent} uppercase tracking-wider mb-3`}>{title}</div>
                <SimpleBarChart data={data} height={100} />
              </div>
            ))}
          </div>

          {/* ── Data Table ──────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-5">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Period-by-Period Breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['Period', 'Sales', 'Collections', 'Cash', 'Cheque', 'Credit', 'Expenses', 'Net', 'Deliveries', 'Completed', 'vs Prev'].map(c => (
                      <th key={c} className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summaries.map((s, i) => {
                    const prev = summaries[i - 1];
                    return (
                      <tr key={`${s.year}-${s.month}`} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2.5 font-semibold text-slate-800 whitespace-nowrap">{s.label}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-indigo-700 whitespace-nowrap">{fmtShort(s.totalSales)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700 whitespace-nowrap">{fmtShort(s.totalCollections)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 whitespace-nowrap">{fmtShort(s.totalCash)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 whitespace-nowrap">{fmtShort(s.totalCheque)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-amber-700 whitespace-nowrap">{fmtShort(s.totalCredit)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-rose-600 whitespace-nowrap">{fmtShort(s.totalExpenses)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold whitespace-nowrap"
                          style={{ color: s.totalCollections - s.totalExpenses >= 0 ? '#16a34a' : '#dc2626' }}>
                          {fmtShort(s.totalCollections - s.totalExpenses)}
                        </td>
                        <td className="px-4 py-2.5 text-center text-slate-700">{s.totalDeliveries}</td>
                        <td className="px-4 py-2.5 text-center text-emerald-700 font-semibold">{s.completedDeliveries}</td>
                        <td className="px-4 py-2.5">
                          {prev ? <Trend current={s.totalCollections} previous={prev.totalCollections} /> : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {summaries.length > 1 && (
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold">
                      <td className="px-4 py-2.5 text-slate-800 text-xs uppercase tracking-wider">Total</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-indigo-700 whitespace-nowrap">{fmt(summaries.reduce((s, r) => s + r.totalSales, 0))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700 whitespace-nowrap">{fmt(summaries.reduce((s, r) => s + r.totalCollections, 0))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 whitespace-nowrap">{fmt(summaries.reduce((s, r) => s + r.totalCash, 0))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 whitespace-nowrap">{fmt(summaries.reduce((s, r) => s + r.totalCheque, 0))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-amber-700 whitespace-nowrap">{fmt(summaries.reduce((s, r) => s + r.totalCredit, 0))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-rose-600 whitespace-nowrap">{fmt(summaries.reduce((s, r) => s + r.totalExpenses, 0))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap"
                        style={{ color: summaries.reduce((s, r) => s + r.totalCollections - r.totalExpenses, 0) >= 0 ? '#16a34a' : '#dc2626' }}>
                        {fmt(summaries.reduce((s, r) => s + r.totalCollections - r.totalExpenses, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-center">{summaries.reduce((s, r) => s + r.totalDeliveries, 0)}</td>
                      <td className="px-4 py-2.5 text-center text-emerald-700">{summaries.reduce((s, r) => s + r.completedDeliveries, 0)}</td>
                      <td className="px-4 py-2.5" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* ── Financial Year Note ──────────────────────────── */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-500">
            <span className="font-semibold">Note:</span> Indian financial year runs April → March.
            To view a complete financial year, select April of the start year to March of the following year using the Custom Range option.
          </div>
        </>
      )}

      {!loading && summaries.length === 0 && (
        <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
          No data found for the selected period.
        </div>
      )}
    </div>
  );
}
