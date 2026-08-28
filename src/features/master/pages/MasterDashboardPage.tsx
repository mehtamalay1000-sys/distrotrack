import { useState, useEffect } from 'react';
import {
  TrendingUp, Package, Truck, CreditCard, Users, MapPin,
  AlertCircle, CheckCircle2, Clock, ArrowUp, ArrowDown,
  RefreshCw, CalendarDays, Building2, ClipboardList,
} from 'lucide-react';
import {
  getMasterKPIs, todayRange, monthRange,
  type DateRange, type MasterKPIs,
} from '@/features/master/services/masterService';
import { useAuth } from '@/app/AuthProvider';

// ── Helpers ──────────────────────────────────────────────────────

const fmt = (n: number) =>
  n >= 1_00_000
    ? `₹${(n / 1_00_000).toFixed(2)}L`
    : n >= 1_000
    ? `₹${(n / 1_000).toFixed(1)}K`
    : `₹${n.toLocaleString('en-IN')}`;

const fmtFull = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Period Presets ────────────────────────────────────────────────

type Preset = 'today' | 'this_month' | 'custom';

function getPresetRange(preset: Preset, custom: { year: number; month: number }): DateRange {
  if (preset === 'today') return todayRange();
  if (preset === 'this_month') {
    const now = new Date();
    return monthRange(now.getFullYear(), now.getMonth() + 1);
  }
  return monthRange(custom.year, custom.month);
}

// ── KPI Card ──────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string; // Tailwind color class prefix like 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky'
  trend?: 'up' | 'down' | 'neutral';
}

function KpiCard({ label, value, sub, icon: Icon, color, trend }: KpiCardProps) {
  const colorMap: Record<string, { bg: string; icon: string; badge: string }> = {
    indigo: { bg: 'bg-indigo-50', icon: 'text-indigo-600', badge: 'bg-indigo-100 text-indigo-700' },
    emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' },
    amber: { bg: 'bg-amber-50', icon: 'text-amber-600', badge: 'bg-amber-100 text-amber-700' },
    rose: { bg: 'bg-rose-50', icon: 'text-rose-600', badge: 'bg-rose-100 text-rose-700' },
    sky: { bg: 'bg-sky-50', icon: 'text-sky-600', badge: 'bg-sky-100 text-sky-700' },
    slate: { bg: 'bg-slate-50', icon: 'text-slate-600', badge: 'bg-slate-100 text-slate-700' },
  };
  const c = colorMap[color] ?? colorMap.indigo;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`h-8 w-8 rounded-lg ${c.bg} flex items-center justify-center`}>
          <Icon className={`h-4 w-4 ${c.icon}`} />
        </div>
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-900 tabular-nums">{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      </div>
      {trend && (
        <div className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full w-fit
          ${trend === 'up' ? 'bg-emerald-50 text-emerald-700' : trend === 'down' ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-500'}`}>
          {trend === 'up' ? <ArrowUp className="h-3 w-3" /> : trend === 'down' ? <ArrowDown className="h-3 w-3" /> : null}
          {trend === 'up' ? 'Positive' : trend === 'down' ? 'Attention' : 'Stable'}
        </div>
      )}
    </div>
  );
}

// ── Payment Breakdown Bar ─────────────────────────────────────────

function PaymentBreakdown({ cash, cheque, credit }: { cash: number; cheque: number; credit: number }) {
  const total = cash + cheque + credit || 1;
  const cashPct = (cash / total) * 100;
  const chequePct = (cheque / total) * 100;
  const creditPct = (credit / total) * 100;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment Breakdown</span>
        <CreditCard className="h-4 w-4 text-slate-400" />
      </div>
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-3">
        {cashPct > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${cashPct}%` }} />}
        {chequePct > 0 && <div className="bg-sky-500 transition-all" style={{ width: `${chequePct}%` }} />}
        {creditPct > 0 && <div className="bg-amber-400 transition-all" style={{ width: `${creditPct}%` }} />}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Cash', value: cash, color: 'bg-emerald-500' },
          { label: 'Cheque', value: cheque, color: 'bg-sky-500' },
          { label: 'Credit', value: credit, color: 'bg-amber-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <span className={`h-2 w-2 rounded-full ${color} flex-shrink-0`} />
              <span className="text-[11px] font-medium text-slate-500">{label}</span>
            </div>
            <div className="text-sm font-bold text-slate-800">{fmt(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Delivery Status Card ──────────────────────────────────────────

function DeliveryStatus({ total, completed, pending }: { total: number; completed: number; pending: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Delivery Status</span>
        <Truck className="h-4 w-4 text-slate-400" />
      </div>
      <div className="flex items-end gap-3 mb-3">
        <div className="text-2xl font-bold text-slate-900">{pct}%</div>
        <div className="text-xs text-slate-400 mb-0.5">completion rate</div>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          {completed} completed
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3 text-amber-500" />
          {pending} pending
        </span>
        <span className="text-slate-400">{total} total</span>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export function MasterDashboardPage() {
  const { profile } = useAuth();
  const now = new Date();

  const [preset, setPreset] = useState<Preset>('this_month');
  const [customYear, setCustomYear] = useState(now.getFullYear());
  const [customMonth, setCustomMonth] = useState(now.getMonth() + 1);
  const [kpis, setKpis] = useState<MasterKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(now);

  const range = getPresetRange(preset, { year: customYear, month: customMonth });

  const load = async () => {
    setLoading(true);
    const data = await getMasterKPIs(range);
    setKpis(data);
    setLastRefreshed(new Date());
    setLoading(false);
  };

  useEffect(() => { load(); }, [preset, customYear, customMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Master Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Global visibility — Sanghavi Traders · {profile?.full_name || 'Master'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Period presets */}
          <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden text-xs font-semibold">
            {(['today', 'this_month', 'custom'] as Preset[]).map(p => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`px-3 py-1.5 transition-colors cursor-pointer ${
                  preset === p
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {p === 'today' ? 'Today' : p === 'this_month' ? 'This Month' : 'Custom'}
              </button>
            ))}
          </div>

          {/* Custom period selectors */}
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
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Period label */}
      <div className="flex items-center gap-2 mb-4 text-xs text-slate-500">
        <CalendarDays className="h-3.5 w-3.5" />
        <span>
          Period: <strong className="text-slate-700">{range.from}</strong> to <strong className="text-slate-700">{range.to}</strong>
        </span>
        <span className="text-slate-300">·</span>
        <span>Last refreshed: {lastRefreshed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      {loading && !kpis && (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading data…
        </div>
      )}

      {kpis && (
        <>
          {/* ── Primary KPI Grid ───────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
            <KpiCard
              label="Total Sales"
              value={fmt(kpis.totalSales)}
              sub={fmtFull(kpis.totalSales)}
              icon={TrendingUp}
              color="indigo"
              trend="neutral"
            />
            <KpiCard
              label="Collections"
              value={fmt(kpis.totalCollections)}
              sub={`${kpis.totalPicklists} picklists`}
              icon={CreditCard}
              color="emerald"
              trend={kpis.totalCollections > 0 ? 'up' : 'neutral'}
            />
            <KpiCard
              label="Outstanding"
              value={fmt(kpis.outstandingAmount)}
              sub="Pending recovery"
              icon={AlertCircle}
              color="amber"
              trend={kpis.outstandingAmount > 0 ? 'down' : 'up'}
            />
            <KpiCard
              label="Expenses"
              value={fmt(kpis.totalExpenses)}
              sub="Operational costs"
              icon={Package}
              color="rose"
            />
          </div>

          {/* ── Secondary KPI Grid ─────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <KpiCard label="Active Workers" value={String(kpis.activeWorkers)} icon={Users} color="sky" />
            <KpiCard label="Active Routes" value={String(kpis.activeRoutes)} icon={MapPin} color="slate" />
            <KpiCard label="Parties" value={String(kpis.totalParties)} icon={Building2} color="indigo" />
            <KpiCard label="Products" value={String(kpis.totalProducts)} icon={ClipboardList} color="emerald" />
          </div>

          {/* ── Detail Cards Row ───────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <PaymentBreakdown
              cash={kpis.totalCash}
              cheque={kpis.totalCheque}
              credit={kpis.totalCredit}
            />
            <DeliveryStatus
              total={kpis.totalDeliveries}
              completed={kpis.completedDeliveries}
              pending={kpis.pendingDeliveries}
            />
          </div>

          {/* ── Summary Table ──────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Period Summary</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-2.5">Metric</th>
                    <th className="text-right px-4 py-2.5">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    { label: 'Total Sales (Picklist Value)', value: fmtFull(kpis.totalSales) },
                    { label: 'Cash Collections', value: fmtFull(kpis.totalCash) },
                    { label: 'Cheque Collections', value: fmtFull(kpis.totalCheque) },
                    { label: 'Credit Extended (Udhari)', value: fmtFull(kpis.totalCredit) },
                    { label: 'Total Collections (excl. credit)', value: fmtFull(kpis.totalCollections) },
                    { label: 'Outstanding Amount', value: fmtFull(kpis.outstandingAmount) },
                    { label: 'Total Expenses', value: fmtFull(kpis.totalExpenses) },
                    { label: 'Net (Collections − Expenses)', value: fmtFull(kpis.totalCollections - kpis.totalExpenses) },
                    { label: 'Total Deliveries', value: String(kpis.totalDeliveries) },
                    { label: 'Completed Deliveries', value: String(kpis.completedDeliveries) },
                    { label: 'Pending Deliveries', value: String(kpis.pendingDeliveries) },
                    { label: 'Picklists Processed', value: String(kpis.totalPicklists) },
                  ].map(row => (
                    <tr key={row.label} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 text-slate-700">{row.label}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
