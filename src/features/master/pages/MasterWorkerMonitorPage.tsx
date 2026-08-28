import { useState, useEffect, useCallback } from 'react';
import {
  Users, RefreshCw, ChevronDown, ChevronRight,
  Truck, CreditCard, Package, Clock, CheckCircle2,
  XCircle, AlertCircle, MapPin, CalendarDays, History,
} from 'lucide-react';
import {
  getWorkerMonitorData, getAllWorkers, monthRange,
  type WorkerMonitorData, type DateRange,
} from '@/features/master/services/masterService';

// ── Helpers ──────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (s: string | null) => {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return s; }
};

const fmtTime = (s: string | null) => {
  if (!s) return '—';
  try { return new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }
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

function deliveryStatusIcon(status: string) {
  if (status === 'delivered') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-rose-500" />;
  if (status === 'partial') return <AlertCircle className="h-4 w-4 text-orange-500" />;
  if (status === 'out_for_delivery') return <Truck className="h-4 w-4 text-sky-500" />;
  return <Clock className="h-4 w-4 text-amber-500" />;
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    inactive: 'bg-slate-100 text-slate-500 border-slate-200',
    assigned: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    out_for_delivery: 'bg-sky-50 text-sky-700 border-sky-200',
    delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    failed: 'bg-rose-50 text-rose-700 border-rose-200',
    partial: 'bg-orange-50 text-orange-700 border-orange-200',
    cash: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cheque: 'bg-sky-50 text-sky-700 border-sky-200',
    credit: 'bg-amber-50 text-amber-700 border-amber-200',
    upi: 'bg-violet-50 text-violet-700 border-violet-200',
    confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
    draft: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  const cls = map[status?.toLowerCase()] ?? 'bg-slate-100 text-slate-500 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${cls} uppercase tracking-wide`}>
      {status ?? '—'}
    </span>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Main Page ─────────────────────────────────────────────────────

export function MasterWorkerMonitorPage() {
  const now = new Date();
  const [workers, setWorkers] = useState<{ id: string; name: string; phone: string | null; status: string }[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [data, setData] = useState<WorkerMonitorData | null>(null);
  const [loading, setLoading] = useState(false);
  const [workersLoading, setWorkersLoading] = useState(true);
  const [histYear, setHistYear] = useState(now.getFullYear());
  const [histMonth, setHistMonth] = useState(now.getMonth() + 1);
  const [histRange, setHistRange] = useState<DateRange>(monthRange(now.getFullYear(), now.getMonth() + 1));
  const [showHistory, setShowHistory] = useState(false);
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  useEffect(() => {
    setWorkersLoading(true);
    getAllWorkers().then(ws => {
      setWorkers(ws);
      setWorkersLoading(false);
      if (ws.length > 0) setSelectedWorkerId(ws[0].id);
    });
  }, []);

  const loadWorkerData = useCallback(async (wId: string, range: DateRange) => {
    setLoading(true);
    const d = await getWorkerMonitorData(wId, range);
    setData(d);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedWorkerId) loadWorkerData(selectedWorkerId, histRange);
  }, [selectedWorkerId, histRange, loadWorkerData]);

  const applyHistRange = () => {
    const r = monthRange(histYear, histMonth);
    setHistRange(r);
  };

  const selectedWorker = workers.find(w => w.id === selectedWorkerId);

  // Operational chain steps
  const chainSteps = [
    { label: 'Picklist Imported', done: !!data?.activePicklist },
    { label: 'Assigned to Worker', done: !!data?.activePicklist && ['assigned', 'in_progress', 'completed'].includes(data.activePicklist.status) },
    { label: 'Route Started', done: !!data?.activePicklist?.started_at },
    { label: 'Deliveries Underway', done: (data?.deliveries?.length ?? 0) > 0 },
    { label: 'Parties Visited', done: (data?.deliveries?.filter(d => d.status !== 'pending').length ?? 0) > 0 },
    { label: 'Payments Collected', done: (data?.payments?.length ?? 0) > 0 },
    { label: 'Route Completed', done: !!data?.activePicklist?.completed_at },
  ];

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Worker Monitor</h1>
          <p className="text-sm text-slate-500 mt-0.5">Inspect worker operations — read-only view</p>
        </div>
        <button
          onClick={() => selectedWorkerId && loadWorkerData(selectedWorkerId, histRange)}
          disabled={loading}
          className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors disabled:opacity-40 self-start"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        {/* ── Worker Selector ──────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Workers</span>
          </div>
          {workersLoading ? (
            <div className="p-4 text-xs text-slate-400 text-center">Loading…</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {workers.map(w => (
                <button
                  key={w.id}
                  onClick={() => setSelectedWorkerId(w.id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors flex items-center gap-2 cursor-pointer ${
                    selectedWorkerId === w.id ? 'bg-indigo-50 border-l-2 border-indigo-500' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                    ${w.status === 'active' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                    {w.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800 truncate">{w.name}</div>
                    <div className="text-[11px] text-slate-400">{w.phone ?? 'No phone'}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Worker Detail ────────────────────────────────────── */}
        <div className="space-y-4">
          {loading && !data && (
            <div className="bg-white rounded-xl border border-slate-200 h-32 flex items-center justify-center text-slate-400 text-sm">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading worker data…
            </div>
          )}

          {!loading && !data && selectedWorkerId && (
            <div className="bg-white rounded-xl border border-slate-200 h-32 flex items-center justify-center text-slate-400 text-sm">
              No data found for this worker.
            </div>
          )}

          {data && (
            <>
              {/* Worker Info Bar */}
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-4 flex-wrap">
                <div className="h-10 w-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {selectedWorker?.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900">{data.worker.name}</div>
                  <div className="text-xs text-slate-500">{data.worker.phone ?? 'No phone'}</div>
                </div>
                <StatusChip status={data.worker.status} />
              </div>

              {/* Operational Chain */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Operational Chain — Today</div>
                <div className="flex flex-wrap gap-0">
                  {chainSteps.map((step, i) => (
                    <div key={step.label} className="flex items-center gap-1 mb-2">
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border
                        ${step.done ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
                        {step.done
                          ? <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          : <Clock className="h-3 w-3 text-slate-300" />}
                        {step.label}
                      </div>
                      {i < chainSteps.length - 1 && (
                        <ChevronRight className="h-3 w-3 text-slate-300 flex-shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Active Picklist */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5" /> Active Picklist / Route
                </div>
                {data.activePicklist ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: 'Picklist No.', value: data.activePicklist.picklist_number },
                      { label: 'Date', value: fmtDate(data.activePicklist.date) },
                      { label: 'Route', value: data.activePicklist.route_name ?? '—' },
                      { label: 'Status', value: <StatusChip status={data.activePicklist.status} /> },
                      { label: 'Parties', value: `${data.activePicklist.completed_parties}/${data.activePicklist.total_parties}` },
                      { label: 'Total Value', value: fmt(data.activePicklist.total_amount) },
                      { label: 'Route Start', value: fmtTime(data.activePicklist.started_at) },
                      { label: 'Route End', value: fmtTime(data.activePicklist.completed_at) },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-slate-50 rounded-lg px-3 py-2">
                        <div className="text-[11px] text-slate-400 font-medium mb-0.5">{label}</div>
                        <div className="text-sm font-semibold text-slate-800">{value}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-400 py-4 text-center">No active picklist or route today.</div>
                )}
              </div>

              {/* Deliveries */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                  <Truck className="h-4 w-4 text-slate-400" />
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    Today's Deliveries ({data.deliveries.length})
                  </span>
                </div>
                {data.deliveries.length === 0 ? (
                  <div className="p-4 text-sm text-slate-400 text-center">No deliveries recorded today.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          {['Seq', 'Party', 'Status', 'Total', 'Delivered', 'Collected', 'Payment', 'Time', 'Notes'].map(c => (
                            <th key={c} className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.deliveries.map(d => (
                          <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-3 py-2.5 text-slate-400 text-xs text-center">{d.sequence_order}</td>
                            <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">{d.party_name}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                {deliveryStatusIcon(d.status)}
                                <StatusChip status={d.status} />
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 whitespace-nowrap">{fmt(d.total_amount)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 whitespace-nowrap">{fmt(d.delivered_amount)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-700 whitespace-nowrap">{fmt(d.collected_amount)}</td>
                            <td className="px-3 py-2.5">{d.payment_mode ? <StatusChip status={d.payment_mode} /> : <span className="text-slate-300">—</span>}</td>
                            <td className="px-3 py-2.5 text-slate-400 text-xs whitespace-nowrap">{fmtTime(d.delivered_at)}</td>
                            <td className="px-3 py-2.5 text-slate-400 text-xs max-w-[120px] truncate">{d.notes ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Payments */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-slate-400" />
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    Today's Collections ({data.payments.length})
                  </span>
                  {data.payments.length > 0 && (
                    <span className="ml-auto text-xs font-bold text-emerald-700">
                      Total: {fmt(data.payments.reduce((s, p) => s + p.amount, 0))}
                    </span>
                  )}
                </div>
                {data.payments.length === 0 ? (
                  <div className="p-4 text-sm text-slate-400 text-center">No payments collected today.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          {['Party', 'Mode', 'Amount', 'Notes'].map(c => (
                            <th key={c} className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.payments.map(p => (
                          <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-3 py-2.5 font-medium text-slate-800">{p.party_name ?? '—'}</td>
                            <td className="px-3 py-2.5"><StatusChip status={p.payment_mode} /></td>
                            <td className="px-3 py-2.5 text-right font-bold text-emerald-700 tabular-nums whitespace-nowrap">{fmt(p.amount)}</td>
                            <td className="px-3 py-2.5 text-slate-400 text-xs">{p.notes ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Payment Summary by Mode */}
              {data.payments.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Package className="h-3.5 w-3.5" /> Payment Summary by Mode
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {['cash', 'cheque', 'credit', 'upi'].map(mode => {
                      const total = data.payments
                        .filter(p => p.payment_mode === mode)
                        .reduce((s, p) => s + p.amount, 0);
                      return (
                        <div key={mode} className="bg-slate-50 rounded-lg px-3 py-2.5 text-center">
                          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{mode}</div>
                          <div className="text-sm font-bold text-slate-900 tabular-nums">{fmt(total)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Route History */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="w-full px-4 py-3 border-b border-slate-100 flex items-center gap-2 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <History className="h-4 w-4 text-slate-400" />
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Route History</span>
                  <div className="ml-auto flex items-center gap-3">
                    {/* Period filter */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                      <select value={histMonth} onChange={e => setHistMonth(Number(e.target.value))}
                        onClick={e => e.stopPropagation()}
                        className="border border-slate-200 rounded px-1.5 py-1 bg-white text-slate-700">
                        {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                      </select>
                      <select value={histYear} onChange={e => setHistYear(Number(e.target.value))}
                        onClick={e => e.stopPropagation()}
                        className="border border-slate-200 rounded px-1.5 py-1 bg-white text-slate-700">
                        {years.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                      <button
                        onClick={e => { e.stopPropagation(); applyHistRange(); }}
                        className="px-2 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 transition-colors">
                        Go
                      </button>
                    </div>
                    {showHistory ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </div>
                </button>

                {showHistory && (
                  data.routeHistory.length === 0 ? (
                    <div className="p-4 text-sm text-slate-400 text-center">No route history for this period.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            {['Date', 'Picklist', 'Status', 'Parties', 'Total Value', 'Collected', 'Start', 'End'].map(c => (
                              <th key={c} className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.routeHistory.map((h, i) => (
                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                              <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(h.date)}</td>
                              <td className="px-3 py-2.5 font-mono text-xs text-indigo-700">{h.picklist_number}</td>
                              <td className="px-3 py-2.5"><StatusChip status={h.status} /></td>
                              <td className="px-3 py-2.5 text-center text-slate-700">
                                {h.completed_parties}/{h.total_parties}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900 whitespace-nowrap">{fmt(h.total_amount)}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-700 whitespace-nowrap">{fmt(h.total_collected)}</td>
                              <td className="px-3 py-2.5 text-slate-400 text-xs whitespace-nowrap">{fmtDateTime(h.started_at)}</td>
                              <td className="px-3 py-2.5 text-slate-400 text-xs whitespace-nowrap">{fmtDateTime(h.completed_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
