import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, CalendarDays, Filter, ShieldAlert, Package, AlertTriangle, Scale, FileSpreadsheet } from 'lucide-react';
import {
  getMasterPicklists, getMasterDeliveries, getMasterPayments,
  getMasterExpenses, getMasterParties, getMasterProducts,
  getMasterStockOverview, type MasterStockOverview,
  getMasterUnmappedSkus, getMasterRouteStockExceptions,
  monthRange, todayRange,
  type DateRange,
} from '@/features/master/services/masterService';
import type { UnmappedSkuException, RouteStockException } from '@/lib/database.types';

// ── Helpers ──────────────────────────────────────────────────────

const fmtCurrency = (n: number) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (s: string | null) => {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return s; }
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    inactive: 'bg-slate-50 text-slate-500 border-slate-200',
    draft: 'bg-slate-50 text-slate-600 border-slate-200',
    confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
    assigned: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    out_for_delivery: 'bg-sky-50 text-sky-700 border-sky-200',
    delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    failed: 'bg-rose-50 text-rose-700 border-rose-200',
    partial: 'bg-orange-50 text-orange-700 border-orange-200',
    paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    collected: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    bounced: 'bg-rose-50 text-rose-700 border-rose-200',
    cash: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cheque: 'bg-sky-50 text-sky-700 border-sky-200',
    credit: 'bg-amber-50 text-amber-700 border-amber-200',
    upi: 'bg-violet-50 text-violet-700 border-violet-200',
    discrepancy: 'bg-rose-50 text-rose-700 border-rose-200',
    reconciled: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  const cls = map[status?.toLowerCase()] ?? 'bg-slate-50 text-slate-500 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${cls} uppercase tracking-wide`}>
      {status ?? '—'}
    </span>
  );
}

// ── Tab type ─────────────────────────────────────────────────────

type Tab = 'picklists' | 'deliveries' | 'payments' | 'expenses' | 'parties' | 'products' | 'stock';

const TABS: { id: Tab; label: string }[] = [
  { id: 'picklists', label: 'Picklists & Routes' },
  { id: 'deliveries', label: 'Deliveries' },
  { id: 'payments', label: 'Payments' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'parties', label: 'Parties & Debt' },
  { id: 'products', label: 'Product Catalog' },
  { id: 'stock', label: 'Stock Oversight' },
];

// ── Date range helpers ────────────────────────────────────────────

type Preset = 'today' | 'this_month' | 'custom';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export function MasterBusinessPage() {
  const now = new Date();
  const [tab, setTab] = useState<Tab>('picklists');
  const [preset, setPreset] = useState<Preset>('this_month');
  const [customYear, setCustomYear] = useState(now.getFullYear());
  const [customMonth, setCustomMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<Row[]>([]);
  const [stockOverview, setStockOverview] = useState<MasterStockOverview | null>(null);
  const [unmappedSkus, setUnmappedSkus] = useState<UnmappedSkuException[]>([]);
  const [routeExceptions, setRouteExceptions] = useState<RouteStockException[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  function getRange(): DateRange {
    if (preset === 'today') return todayRange();
    if (preset === 'this_month') return monthRange(now.getFullYear(), now.getMonth() + 1);
    return monthRange(customYear, customMonth);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const range = getRange();
    let data: Row[] = [];
    try {
      if (tab === 'picklists') data = await getMasterPicklists(range);
      else if (tab === 'deliveries') data = await getMasterDeliveries(range);
      else if (tab === 'payments') data = await getMasterPayments(range);
      else if (tab === 'expenses') data = await getMasterExpenses(range);
      else if (tab === 'parties') data = await getMasterParties();
      else if (tab === 'products') data = await getMasterProducts();
      else if (tab === 'stock') {
        const [stockData, unmappedData, routeShortageData] = await Promise.all([
          getMasterStockOverview(),
          getMasterUnmappedSkus(),
          getMasterRouteStockExceptions(),
        ]);
        setStockOverview(stockData);
        setUnmappedSkus(unmappedData);
        setRouteExceptions(routeShortageData);
      }
    } catch { data = []; }
    setRows(data);
    setLoading(false);
  }, [tab, preset, customYear, customMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // Filtered rows with exceptions-only toggle
  const filtered = rows.filter(r => {
    // 1. Text Search
    if (search.trim()) {
      const match = JSON.stringify(r).toLowerCase().includes(search.toLowerCase());
      if (!match) return false;
    }
    // 2. Exceptions Only Filter
    if (exceptionsOnly) {
      if (tab === 'picklists') {
        return (r.cash_discrepancy != null && Number(r.cash_discrepancy) !== 0) || r.financial_reconciliation_status === 'discrepancy';
      }
      if (tab === 'deliveries') {
        return r.status === 'failed' || r.status === 'partial';
      }
      if (tab === 'payments') {
        return r.status === 'bounced';
      }
      if (tab === 'expenses') {
        return r.status === 'pending' || r.status === 'rejected';
      }
      if (tab === 'parties') {
        return Number(r.outstanding_amount ?? 0) > 0;
      }
      if (tab === 'products') {
        return Number(r.current_stock ?? 0) <= 10;
      }
    }
    return true;
  });

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Business Data & Operational Oversight</h1>
          <p className="text-sm text-slate-500 mt-0.5">Authoritative records, exception filtering & inventory monitoring</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Period (only for date-based tabs) */}
          {['picklists', 'deliveries', 'payments', 'expenses'].includes(tab) && (
            <>
              <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden text-xs font-semibold">
                {(['today', 'this_month', 'custom'] as Preset[]).map(p => (
                  <button key={p} onClick={() => setPreset(p)}
                    className={`px-3 py-1.5 cursor-pointer transition-colors ${preset === p ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                    {p === 'today' ? 'Today' : p === 'this_month' ? 'This Month' : 'Custom'}
                  </button>
                ))}
              </div>
              {preset === 'custom' && (
                <div className="flex gap-1.5">
                  <select value={customMonth} onChange={e => setCustomMonth(Number(e.target.value))}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 font-medium">
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                  <select value={customYear} onChange={e => setCustomYear(Number(e.target.value))}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 font-medium">
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              )}
            </>
          )}
          <button onClick={load} disabled={loading}
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors disabled:opacity-40 cursor-pointer"
            title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 bg-white border border-slate-200 rounded-xl p-1 mb-4 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setSearch(''); }}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              tab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Oversight Controls: Search + Exceptions Toggle */}
      {tab !== 'stock' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 sm:w-64">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Filter rows…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:border-indigo-400"
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={exceptionsOnly}
                onChange={e => setExceptionsOnly(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
              />
              <span className="flex items-center gap-1 text-rose-700">
                <ShieldAlert className="h-3.5 w-3.5 text-rose-600" />
                Exceptions Only
              </span>
            </label>
          </div>
          <div className="text-xs text-slate-400 font-medium">
            {loading ? 'Loading…' : `${filtered.length} record${filtered.length !== 1 ? 's' : ''}`}
          </div>
        </div>
      )}

      {/* Period bar for date-based tabs */}
      {['picklists', 'deliveries', 'payments', 'expenses'].includes(tab) && (
        <div className="flex items-center gap-2 mb-3 text-xs text-slate-500">
          <CalendarDays className="h-3.5 w-3.5" />
          <span>
            Period: <strong className="text-slate-700">{getRange().from}</strong> → <strong className="text-slate-700">{getRange().to}</strong>
          </span>
        </div>
      )}

      {/* Data Table Container */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          ) : tab === 'stock' ? (
            <StockOversightView
              overview={stockOverview}
              unmappedSkus={unmappedSkus}
              routeExceptions={routeExceptions}
            />
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              {exceptionsOnly ? 'No exception records found for this filter.' : 'No records found for this period.'}
            </div>
          ) : (
            <>
              {tab === 'picklists' && <PicklistsTable rows={filtered} />}
              {tab === 'deliveries' && <DeliveriesTable rows={filtered} />}
              {tab === 'payments' && <PaymentsTable rows={filtered} />}
              {tab === 'expenses' && <ExpensesTable rows={filtered} />}
              {tab === 'parties' && <PartiesTable rows={filtered} />}
              {tab === 'products' && <ProductsTable rows={filtered} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Individual Table Components ───────────────────────────────────

function THead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="bg-slate-50 border-b border-slate-200">
        {cols.map(c => (
          <th key={c} className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function PicklistsTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full text-sm">
      <THead cols={['#', 'Picklist No.', 'Date', 'Route', 'Worker', 'Status', 'Parties', 'Delivered Sales', 'Cash Discrepancy', 'Reconciliation']} />
      <tbody className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
            <td className="px-4 py-2.5 font-mono text-xs text-indigo-700 font-semibold">{r.picklist_number}</td>
            <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(r.date)}</td>
            <td className="px-4 py-2.5 text-slate-600">{r.route?.name ?? r.route?.code ?? '—'}</td>
            <td className="px-4 py-2.5 text-slate-600">{r.worker?.name ?? '—'}</td>
            <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
            <td className="px-4 py-2.5 text-slate-700 text-center">
              {r.completed_parties ?? 0}/{r.total_parties ?? 0}
            </td>
            <td className="px-4 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">{fmtCurrency(r.total_amount)}</td>
            <td className={`px-4 py-2.5 text-right font-bold tabular-nums whitespace-nowrap ${
              r.cash_discrepancy !== 0 ? 'text-rose-600' : 'text-slate-400'
            }`}>
              {fmtCurrency(r.cash_discrepancy ?? 0)}
            </td>
            <td className="px-4 py-2.5 whitespace-nowrap text-center">
              <StatusBadge status={r.financial_reconciliation_status ?? 'pending'} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DeliveriesTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full text-sm">
      <THead cols={['#', 'Party', 'Worker', 'Date', 'Status', 'Total Amt', 'Delivered', 'Collected', 'Payment Mode', 'Notes']} />
      <tbody className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
            <td className="px-4 py-2.5 font-medium text-slate-800">{r.party?.name ?? '—'}</td>
            <td className="px-4 py-2.5 text-slate-600">{r.worker?.name ?? '—'}</td>
            <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(r.delivery_date)}</td>
            <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
            <td className="px-4 py-2.5 text-right tabular-nums text-slate-900 font-semibold whitespace-nowrap">{fmtCurrency(r.total_amount)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 whitespace-nowrap">{fmtCurrency(r.delivered_amount)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700 font-semibold whitespace-nowrap">{fmtCurrency(r.collected_amount)}</td>
            <td className="px-4 py-2.5">{r.payment_mode ? <StatusBadge status={r.payment_mode} /> : <span className="text-slate-300">—</span>}</td>
            <td className="px-4 py-2.5 text-slate-400 text-xs max-w-[160px] truncate">{r.notes ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PaymentsTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full text-sm">
      <THead cols={['#', 'Party', 'Worker', 'Date', 'Mode', 'Amount', 'Status', 'Cheque No.', 'Notes']} />
      <tbody className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
            <td className="px-4 py-2.5 font-medium text-slate-800">{r.party?.name ?? '—'}</td>
            <td className="px-4 py-2.5 text-slate-600">{r.worker?.name ?? '—'}</td>
            <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(r.payment_date)}</td>
            <td className="px-4 py-2.5"><StatusBadge status={r.payment_mode} /></td>
            <td className="px-4 py-2.5 text-right font-bold text-slate-900 tabular-nums whitespace-nowrap">{fmtCurrency(r.amount)}</td>
            <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
            <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{r.cheque_number ?? '—'}</td>
            <td className="px-4 py-2.5 text-slate-400 text-xs max-w-[160px] truncate">{r.notes ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExpensesTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full text-sm">
      <THead cols={['#', 'Date', 'Category', 'Route', 'Worker', 'Payment', 'Status', 'Amount', 'Description']} />
      <tbody className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
            <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(r.date)}</td>
            <td className="px-4 py-2.5 font-medium text-slate-800">{r.category}</td>
            <td className="px-4 py-2.5 text-slate-600">{r.route?.code ?? '—'}</td>
            <td className="px-4 py-2.5 text-slate-600">{r.worker?.name ?? '—'}</td>
            <td className="px-4 py-2.5 text-slate-600 uppercase text-xs font-semibold">{r.payment_method ?? 'cash'}</td>
            <td className="px-4 py-2.5"><StatusBadge status={r.status ?? 'pending'} /></td>
            <td className="px-4 py-2.5 text-right font-bold text-rose-700 tabular-nums whitespace-nowrap">{fmtCurrency(r.amount)}</td>
            <td className="px-4 py-2.5 text-slate-400 text-xs">{r.description ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PartiesTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full text-sm">
      <THead cols={['#', 'Code', 'Name', 'Route', 'City', 'Outstanding', 'Status', 'Phone']} />
      <tbody className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
            <td className="px-4 py-2.5 font-mono text-xs text-indigo-700">{r.code}</td>
            <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
            <td className="px-4 py-2.5 text-slate-600">{r.route?.name ?? '—'}</td>
            <td className="px-4 py-2.5 text-slate-600">{r.city ?? '—'}</td>
            <td className="px-4 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap"
              style={{ color: r.outstanding_amount > 0 ? '#b45309' : '#16a34a' }}>
              {fmtCurrency(r.outstanding_amount)}
            </td>
            <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
            <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{r.phone ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProductsTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full text-sm">
      <THead cols={['#', 'SKU', 'Name', 'Category', 'Stock Level', 'MRP', 'Rate', 'Unit', 'Status']} />
      <tbody className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
            <td className="px-4 py-2.5 font-mono text-xs text-indigo-700">{r.sku}</td>
            <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
            <td className="px-4 py-2.5 text-slate-500">{r.category ?? '—'}</td>
            <td className="px-4 py-2.5">
              <span className={`font-bold tabular-nums ${r.current_stock <= 10 ? 'text-rose-600' : 'text-slate-900'}`}>
                {r.current_stock ?? 0}
              </span>
              {r.current_stock <= 10 && (
                <span className="ml-1 text-[10px] bg-rose-50 text-rose-700 px-1 py-0.2 rounded font-semibold">Low</span>
              )}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtCurrency(r.mrp)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{fmtCurrency(r.rate)}</td>
            <td className="px-4 py-2.5 text-slate-500">{r.unit}</td>
            <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Stock Oversight Component (Section 9) ──────────────────────────

function StockOversightView({
  overview,
  unmappedSkus = [],
  routeExceptions = [],
}: {
  overview: MasterStockOverview | null;
  unmappedSkus?: UnmappedSkuException[];
  routeExceptions?: RouteStockException[];
}) {
  if (!overview) {
    return <div className="p-8 text-center text-slate-400 text-sm">Loading stock oversight data…</div>;
  }

  return (
    <div className="p-4 space-y-6">
      {/* Quick Navigation Links */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800 rounded-xl">
        <div className="flex items-center gap-2 text-xs text-indigo-900 dark:text-indigo-200">
          <Package className="h-4 w-4 text-indigo-600 flex-shrink-0" />
          <span><strong>SAP Stock Tools:</strong> Reconcile physical depot inventory against SAP system records or analyze product quantity movement.</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/admin/inventory/register"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors shadow-sm"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-primary-600" />
            Quantity Register
          </Link>
          <Link
            to="/admin/inventory/reconciliation"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors shadow-sm"
          >
            <Scale className="h-3.5 w-3.5 text-white" />
            SAP Stock Reconciliation
          </Link>
        </div>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Warehouse SKUs</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{overview.products.length}</div>
          <div className="text-xs text-slate-400 mt-0.5">Authoritative catalog</div>
        </div>

        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Active Vehicles</div>
          <div className="text-2xl font-bold text-indigo-700 mt-1">{overview.activeVehicles.length}</div>
          <div className="text-xs text-slate-400 mt-0.5">Routes currently loaded</div>
        </div>

        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Damaged Transit</div>
          <div className={`text-2xl font-bold mt-1 ${overview.damagedTransitTotal > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
            {overview.damagedTransitTotal} <span className="text-xs font-normal text-slate-500">units</span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">En-route breakage</div>
        </div>

        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Damaged Warehouse</div>
          <div className={`text-2xl font-bold mt-1 ${overview.damagedWarehouseTotal > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
            {overview.damagedWarehouseTotal} <span className="text-xs font-normal text-slate-500">units</span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Depot shrinkage</div>
        </div>
      </div>

      {/* Active Vehicles on Route (Section 9.2) */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-indigo-600" />
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Active Route / Vehicle Stock (Loaded)</h3>
          </div>
          <span className="text-xs text-slate-400">{overview.activeVehicles.length} vehicles active</span>
        </div>
        {overview.activeVehicles.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Picklist No.</th>
                  <th className="text-left px-3 py-2">Route</th>
                  <th className="text-left px-3 py-2">Worker Assigned</th>
                  <th className="text-right px-3 py-2">Loaded Stock Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview.activeVehicles.map(v => (
                  <tr key={v.picklistId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 font-mono font-semibold text-indigo-700">{v.picklistNumber}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{v.routeName}</td>
                    <td className="px-3 py-2 text-slate-600">{v.workerName}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">{v.totalLoadedUnits} units</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 text-center text-xs text-slate-400">No active vehicle routes currently loaded.</div>
        )}
      </div>

      {/* Warehouse Stock Inventory Table (Section 9.1) */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-slate-500" />
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Warehouse Stock Balances</h3>
          </div>
          <span className="text-xs text-slate-400">{overview.products.length} catalog items</span>
        </div>
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                <th className="text-left px-3 py-2">SKU</th>
                <th className="text-left px-3 py-2">Product Name</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-right px-3 py-2">Current Stock</th>
                <th className="text-center px-3 py-2">Unit</th>
                <th className="text-right px-3 py-2">Rate</th>
                <th className="text-center px-3 py-2">Stock Alert</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overview.products.map(p => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-3 py-2 font-mono font-semibold text-indigo-700">{p.sku}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{p.name}</td>
                  <td className="px-3 py-2 text-slate-500">{p.category ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">{p.currentStock}</td>
                  <td className="px-3 py-2 text-center text-slate-500">{p.unit}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtCurrency(p.rate)}</td>
                  <td className="px-3 py-2 text-center">
                    {p.currentStock <= 10 ? (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded font-semibold">
                        <AlertTriangle className="h-3 w-3 text-rose-600" /> Low Stock
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-700 font-semibold">Adequate</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Damaged Stock Incidents (Section 9.3) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Damaged Transit */}
        {(() => {
          const transitList = overview.recentStockMovements.filter(m => m.movementType === 'damaged_transit');
          return (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Damaged in Transit</h3>
                <span className="text-xs text-amber-600 font-semibold">{transitList.length} incidents</span>
              </div>
              {transitList.length > 0 ? (
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-500 uppercase">
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-left px-3 py-2">SKU</th>
                        <th className="text-left px-3 py-2">Worker</th>
                        <th className="text-right px-3 py-2">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transitList.map((d, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-slate-600">{d.date || '—'}</td>
                          <td className="px-3 py-2 font-mono text-slate-900 font-semibold">{d.sku}</td>
                          <td className="px-3 py-2 text-slate-600">{d.workerName}</td>
                          <td className="px-3 py-2 text-right font-bold text-amber-700">{d.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-slate-400">Zero transit damage recorded.</div>
              )}
            </div>
          );
        })()}

        {/* Damaged Warehouse */}
        {(() => {
          const whList = overview.recentStockMovements.filter(m => m.movementType === 'damaged_warehouse');
          return (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Damaged in Warehouse</h3>
                <span className="text-xs text-rose-600 font-semibold">{whList.length} incidents</span>
              </div>
              {whList.length > 0 ? (
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-500 uppercase">
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-left px-3 py-2">SKU</th>
                        <th className="text-left px-3 py-2">Worker</th>
                        <th className="text-right px-3 py-2">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {whList.map((d, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-slate-600">{d.date || '—'}</td>
                          <td className="px-3 py-2 font-mono text-slate-900 font-semibold">{d.sku}</td>
                          <td className="px-3 py-2 text-slate-600">{d.workerName}</td>
                          <td className="px-3 py-2 text-right font-bold text-rose-600">{d.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-slate-400">Zero warehouse damage recorded.</div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Route Returns (Section 9.4) */}
      {(() => {
        const returnsList = overview.recentStockMovements.filter(m => m.movementType === 'route_return');
        return (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Route Returns & Stock Reversals</h3>
              <span className="text-xs text-slate-400">{returnsList.length} return events</span>
            </div>
            {returnsList.length > 0 ? (
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-500 uppercase">
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">SKU</th>
                      <th className="text-left px-3 py-2">Worker</th>
                      <th className="text-right px-3 py-2">Qty Returned</th>
                      <th className="text-left px-3 py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {returnsList.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2 text-slate-600">{r.date || '—'}</td>
                        <td className="px-3 py-2 font-mono text-slate-900 font-semibold">{r.sku}</td>
                        <td className="px-3 py-2 text-slate-600">{r.workerName}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900">{r.quantity}</td>
                        <td className="px-3 py-2 text-slate-500">{r.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-slate-400">Zero route returns recorded in period.</div>
            )}
          </div>
        );
      })()}

      {/* Section 17: Unmapped SAP SKUs Inspection */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-amber-50/60 border-b border-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
              Unmapped SAP Product SKUs ({unmappedSkus.length})
            </h3>
          </div>
          <span className="text-xs text-amber-700 font-medium">SAP Master Health Check</span>
        </div>
        {unmappedSkus.length > 0 ? (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase">
                  <th className="text-left px-3 py-2">SKU / Code</th>
                  <th className="text-left px-3 py-2">Imported Name</th>
                  <th className="text-center px-3 py-2">SAP Status</th>
                  <th className="text-right px-3 py-2">Picklists</th>
                  <th className="text-right px-3 py-2">Bills</th>
                  <th className="text-left px-3 py-2">First Seen</th>
                  <th className="text-left px-3 py-2">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unmappedSkus.map((u) => (
                  <tr key={u.id} className="hover:bg-amber-50/30 transition-colors">
                    <td className="px-3 py-2 font-mono font-bold text-rose-700">{u.sku}</td>
                    <td className="px-3 py-2 text-slate-800 font-medium">{u.imported_product_name || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 uppercase">
                        UNMAPPED SKU
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{u.affected_picklist_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{u.affected_bill_count}</td>
                    <td className="px-3 py-2 text-slate-500">{fmtDate(u.first_seen_at)}</td>
                    <td className="px-3 py-2 text-slate-500">{fmtDate(u.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 text-center text-xs text-slate-400">
            Zero unmapped SKUs detected. All operational SKUs match the official Colgate-Palmolive SAP Product Master.
          </div>
        )}
      </div>

      {/* Section 18: Route Start Stock Exceptions (Warehouse Shortages) */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-slate-600" />
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Routes Started With Warehouse Stock Shortage ({routeExceptions.length})
            </h3>
          </div>
          <span className="text-xs text-slate-500 font-medium">Non-blocking operational audits</span>
        </div>
        {routeExceptions.length > 0 ? (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase">
                  <th className="text-left px-3 py-2">Timestamp</th>
                  <th className="text-left px-3 py-2">Route</th>
                  <th className="text-left px-3 py-2">Worker</th>
                  <th className="text-left px-3 py-2">SKU</th>
                  <th className="text-right px-3 py-2">Required Qty</th>
                  <th className="text-right px-3 py-2">Recorded Stock</th>
                  <th className="text-right px-3 py-2">Shortage Qty</th>
                  <th className="text-left px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {routeExceptions.map((re) => (
                  <tr key={re.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDate(re.created_at)}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{re.route_id}</td>
                    <td className="px-3 py-2 text-slate-700">{re.worker_id}</td>
                    <td className="px-3 py-2 font-mono font-bold text-primary-700">{re.sku}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{re.required_quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{re.recorded_warehouse_stock}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-600">-{re.shortage_quantity}</td>
                    <td className="px-3 py-2 text-slate-500 max-w-xs truncate" title={re.notes || ''}>{re.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 text-center text-xs text-slate-400">
            Zero route stock shortage exceptions recorded. All routes started with sufficient recorded stock.
          </div>
        )}
      </div>
    </div>
  );
}
