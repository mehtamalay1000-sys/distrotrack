import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CalendarDays, Filter } from 'lucide-react';
import {
  getMasterPicklists, getMasterDeliveries, getMasterPayments,
  getMasterExpenses, getMasterParties, getMasterProducts,
  monthRange, todayRange,
  type DateRange,
} from '@/features/master/services/masterService';

// ── Helpers ──────────────────────────────────────────────────────

const fmtCurrency = (n: number) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (s: string | null) => {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return s; }
};

const fmtDateTime = (s: string | null) => {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return s; }
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
  };
  const cls = map[status?.toLowerCase()] ?? 'bg-slate-50 text-slate-500 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${cls} uppercase tracking-wide`}>
      {status ?? '—'}
    </span>
  );
}

// ── Tab type ─────────────────────────────────────────────────────

type Tab = 'picklists' | 'deliveries' | 'payments' | 'expenses' | 'parties' | 'products';

const TABS: { id: Tab; label: string }[] = [
  { id: 'picklists', label: 'Picklists' },
  { id: 'deliveries', label: 'Deliveries' },
  { id: 'payments', label: 'Payments' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'parties', label: 'Parties' },
  { id: 'products', label: 'Products' },
];

// ── Date range helpers ────────────────────────────────────────────

type Preset = 'today' | 'this_month' | 'custom';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Main Page ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export function MasterBusinessPage() {
  const now = new Date();
  const [tab, setTab] = useState<Tab>('picklists');
  const [preset, setPreset] = useState<Preset>('this_month');
  const [customYear, setCustomYear] = useState(now.getFullYear());
  const [customMonth, setCustomMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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
    } catch { data = []; }
    setRows(data);
    setLoading(false);
  }, [tab, preset, customYear, customMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // Filtered rows
  const filtered = search.trim()
    ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()))
    : rows;

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Business Data</h1>
          <p className="text-sm text-slate-500 mt-0.5">Complete read-only view of all operational data</p>
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
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                  <select value={customYear} onChange={e => setCustomYear(Number(e.target.value))}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              )}
            </>
          )}
          <button onClick={load} disabled={loading}
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors disabled:opacity-40">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 bg-white border border-slate-200 rounded-xl p-1 mb-4 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              tab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Search + count */}
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1 max-w-sm">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Filter rows…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:border-indigo-400"
          />
        </div>
        <div className="text-xs text-slate-400 font-medium">
          {loading ? 'Loading…' : `${filtered.length} row${filtered.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* Period bar for date-based tabs */}
      {['picklists', 'deliveries', 'payments', 'expenses'].includes(tab) && (
        <div className="flex items-center gap-2 mb-3 text-xs text-slate-500">
          <CalendarDays className="h-3.5 w-3.5" />
          <span>
            Period: <strong className="text-slate-700">{getRange().from}</strong> → <strong className="text-slate-700">{getRange().to}</strong>
          </span>
        </div>
      )}

      {/* Data Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              No records found for this period.
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
      <THead cols={['#', 'Picklist No.', 'Date', 'Route', 'Worker', 'Status', 'Parties', 'Total Amt', 'Collected', 'Started', 'Completed']} />
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
            <td className="px-4 py-2.5 text-right font-semibold text-emerald-700 tabular-nums whitespace-nowrap">{fmtCurrency(r.total_collected ?? 0)}</td>
            <td className="px-4 py-2.5 text-slate-400 text-xs whitespace-nowrap">{fmtDateTime(r.started_at)}</td>
            <td className="px-4 py-2.5 text-slate-400 text-xs whitespace-nowrap">{fmtDateTime(r.completed_at)}</td>
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
      <THead cols={['#', 'Date', 'Category', 'Worker', 'Amount', 'Description']} />
      <tbody className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
            <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(r.date)}</td>
            <td className="px-4 py-2.5 font-medium text-slate-800">{r.category}</td>
            <td className="px-4 py-2.5 text-slate-600">{r.worker?.name ?? '—'}</td>
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
      <THead cols={['#', 'SKU', 'Name', 'Category', 'MRP', 'Rate', 'Unit', 'Status']} />
      <tbody className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
            <td className="px-4 py-2.5 font-mono text-xs text-indigo-700">{r.sku}</td>
            <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
            <td className="px-4 py-2.5 text-slate-500">{r.category ?? '—'}</td>
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
