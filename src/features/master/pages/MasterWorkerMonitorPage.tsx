import { useState, useEffect, useCallback } from 'react';
import {
  Users, RefreshCw, ChevronRight,
  Clock, CheckCircle2,
  MapPin, CalendarDays, History,
  TrendingUp,
} from 'lucide-react';
import {
  getWorkerMonitorData, getAllWorkers, monthRange, getRouteProfitability,
  type WorkerMonitorData, type DateRange, type RouteProfitabilityResponse,
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
    discrepancy: 'bg-rose-50 text-rose-700 border-rose-200',
    reconciled: 'bg-emerald-50 text-emerald-700 border-emerald-200',
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
  const [workerProfitability, setWorkerProfitability] = useState<RouteProfitabilityResponse | null>(null);
  const [allWorkersProfitability, setAllWorkersProfitability] = useState<RouteProfitabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [workersLoading, setWorkersLoading] = useState(true);
  const [histYear, setHistYear] = useState(now.getFullYear());
  const [histMonth, setHistMonth] = useState(now.getMonth() + 1);
  const [histRange, setHistRange] = useState<DateRange>(monthRange(now.getFullYear(), now.getMonth() + 1));
  const [viewMode, setViewMode] = useState<'individual' | 'comparison'>('individual');
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
    const [monitorData, profData, allProfData] = await Promise.all([
      getWorkerMonitorData(wId, range),
      getRouteProfitability({ worker_id: wId, start_date: range.from, end_date: range.to }),
      getRouteProfitability({ start_date: range.from, end_date: range.to }),
    ]);
    setData(monitorData);
    setWorkerProfitability(profData);
    setAllWorkersProfitability(allProfData);
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

  // Cross-worker comparison aggregation
  const workerComparisonList = (() => {
    if (!allWorkersProfitability?.routes) return [];
    const map: Record<string, {
      workerId: string;
      workerName: string;
      routesCount: number;
      sales: number;
      collections: number;
      cash: number;
      upi: number;
      cheque: number;
      credit: number;
      expenses: number;
      contribution: number;
      expectedCash: number;
      actualCash: number;
      cashDiscrepancy: number;
      discrepantRoutes: number;
    }> = {};

    for (const r of allWorkersProfitability.routes) {
      const wId = r.worker_id || 'unassigned';
      const wName = r.worker_name || 'Unassigned';
      if (!map[wId]) {
        map[wId] = {
          workerId: wId,
          workerName: wName,
          routesCount: 0,
          sales: 0,
          collections: 0,
          cash: 0,
          upi: 0,
          cheque: 0,
          credit: 0,
          expenses: 0,
          contribution: 0,
          expectedCash: 0,
          actualCash: 0,
          cashDiscrepancy: 0,
          discrepantRoutes: 0,
        };
      }
      map[wId].routesCount += 1;
      map[wId].sales += Number(r.sales ?? 0);
      map[wId].collections += Number(r.total_collected ?? 0);
      map[wId].cash += Number(r.cash_collected ?? 0);
      map[wId].upi += Number(r.upi_collected ?? 0);
      map[wId].cheque += Number((r.cheque_cleared ?? 0) + (r.cheque_pending ?? 0));
      map[wId].credit += Number(r.credit_sales ?? 0);
      map[wId].expenses += Number(r.approved_expenses ?? 0);
      map[wId].contribution += Number(r.contribution_before_cogs ?? 0);
      map[wId].expectedCash += Number(r.expected_cash ?? 0);
      map[wId].actualCash += Number(r.actual_cash_returned ?? 0);
      map[wId].cashDiscrepancy += Number(r.cash_discrepancy ?? 0);
      if (r.cash_discrepancy !== 0 || r.financial_status === 'discrepancy') {
        map[wId].discrepantRoutes += 1;
      }
    }
    return Object.values(map).sort((a, b) => b.sales - a.sales);
  })();

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
          <h1 className="text-xl font-bold text-slate-900">Worker Performance & Accountability Monitor</h1>
          <p className="text-sm text-slate-500 mt-0.5">Authoritative delivery execution, route profitability & cross-worker oversight</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* View switcher */}
          <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden text-xs font-semibold">
            <button
              onClick={() => setViewMode('individual')}
              className={`px-3 py-1.5 cursor-pointer transition-colors ${
                viewMode === 'individual' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Individual Worker
            </button>
            <button
              onClick={() => setViewMode('comparison')}
              className={`px-3 py-1.5 cursor-pointer transition-colors ${
                viewMode === 'comparison' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Cross-Worker Comparison
            </button>
          </div>

          <button
            onClick={() => selectedWorkerId && loadWorkerData(selectedWorkerId, histRange)}
            disabled={loading}
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors disabled:opacity-40 cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── CROSS-WORKER COMPARISON VIEW ────────────────────────── */}
      {viewMode === 'comparison' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Fleet Accountability & Contribution Comparison</h2>
              <p className="text-xs text-slate-400 mt-0.5">Commercial sales delivered, approved route costs & cash variances</p>
            </div>
            <span className="text-xs text-slate-400 font-medium">
              Period: {histRange.from} → {histRange.to}
            </span>
          </div>
          {workerComparisonList.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <th className="text-left px-3 py-2.5">Worker Name</th>
                    <th className="text-center px-3 py-2.5">Routes</th>
                    <th className="text-right px-3 py-2.5">Delivered Sales</th>
                    <th className="text-right px-3 py-2.5">Cash</th>
                    <th className="text-right px-3 py-2.5">UPI</th>
                    <th className="text-right px-3 py-2.5">Cheque</th>
                    <th className="text-right px-3 py-2.5 text-amber-700">Credit</th>
                    <th className="text-right px-3 py-2.5">Total Collected</th>
                    <th className="text-right px-3 py-2.5 text-rose-600">Approved Exp.</th>
                    <th className="text-right px-3 py-2.5 text-indigo-700">Contribution</th>
                    <th className="text-right px-3 py-2.5">Exp. Cash</th>
                    <th className="text-right px-3 py-2.5">Act. Cash</th>
                    <th className="text-right px-3 py-2.5">Variance</th>
                    <th className="text-center px-3 py-2.5">Exceptions</th>
                    <th className="text-center px-3 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workerComparisonList.map(w => (
                    <tr key={w.workerId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2.5 font-semibold text-slate-900">{w.workerName}</td>
                      <td className="px-3 py-2.5 text-center text-slate-700 font-medium">{w.routesCount}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900">{fmt(w.sales)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(w.cash)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(w.upi)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(w.cheque)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{fmt(w.credit)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 font-medium">{fmt(w.collections)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">{fmt(w.expenses)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-indigo-700">{fmt(w.contribution)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmt(w.expectedCash)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{fmt(w.actualCash)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${
                        w.cashDiscrepancy !== 0 ? 'text-rose-600' : 'text-emerald-600'
                      }`}>
                        {fmt(w.cashDiscrepancy)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {w.discrepantRoutes > 0 ? (
                          <span className="bg-rose-100 text-rose-800 text-[10px] font-bold px-1.5 py-0.5 rounded">
                            {w.discrepantRoutes} Discrepant
                          </span>
                        ) : (
                          <span className="text-emerald-600 font-semibold text-xs">Clean</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => {
                            setSelectedWorkerId(w.workerId);
                            setViewMode('individual');
                          }}
                          className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
                        >
                          Inspect →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 text-sm">
              No worker route profitability data for the selected period.
            </div>
          )}
        </div>
      )}

      {/* ── INDIVIDUAL WORKER VIEW ──────────────────────────────── */}
      {viewMode === 'individual' && (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
          {/* Worker Selector */}
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

          {/* Worker Detail */}
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

                {/* Authoritative Route Profitability Summary for this worker */}
                {workerProfitability?.totals && (
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <TrendingUp className="h-4 w-4 text-indigo-600" />
                        Authoritative Period Profitability & Cash Handover
                      </span>
                      <span className="text-[11px] text-slate-400 font-normal">
                        get_route_profitability ({histRange.from} → {histRange.to})
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                      <div className="bg-slate-50 p-2.5 rounded-lg">
                        <div className="text-[11px] text-slate-500">Delivered Commercial Sales</div>
                        <div className="text-base font-bold text-slate-900 tabular-nums">{fmt(workerProfitability.totals.sales)}</div>
                      </div>
                      <div className="bg-slate-50 p-2.5 rounded-lg">
                        <div className="text-[11px] text-slate-500">Cash Collections</div>
                        <div className="text-base font-bold text-slate-900 tabular-nums">{fmt(workerProfitability.totals.cash_collected)}</div>
                      </div>
                      <div className="bg-slate-50 p-2.5 rounded-lg">
                        <div className="text-[11px] text-slate-500">UPI Collections</div>
                        <div className="text-base font-bold text-slate-900 tabular-nums">{fmt(workerProfitability.totals.upi_collected)}</div>
                      </div>
                      <div className="bg-slate-50 p-2.5 rounded-lg">
                        <div className="text-[11px] text-slate-500">Cheque Collections</div>
                        <div className="text-base font-bold text-slate-900 tabular-nums">{fmt((workerProfitability.totals.cheque_cleared ?? 0) + (workerProfitability.totals.cheque_pending ?? 0))}</div>
                      </div>
                      <div className="bg-slate-50 p-2.5 rounded-lg">
                        <div className="text-[11px] text-slate-500">Contribution (Before COGS)</div>
                        <div className="text-base font-bold text-indigo-700 tabular-nums">{fmt(workerProfitability.totals.contribution_before_cogs)}</div>
                      </div>
                      <div className="bg-slate-50 p-2.5 rounded-lg">
                        <div className="text-[11px] text-slate-500">Cash Handover Variance</div>
                        <div className={`text-base font-bold tabular-nums ${workerProfitability.totals.cash_discrepancy !== 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                          {fmt(workerProfitability.totals.cash_discrepancy)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Operational Chain Today */}
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
                    <MapPin className="h-3.5 w-3.5" /> Active Picklist / Route Today
                  </div>
                  {data.activePicklist ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { label: 'Picklist No.', value: data.activePicklist.picklist_number },
                        { label: 'Date', value: fmtDate(data.activePicklist.date) },
                        { label: 'Route', value: data.activePicklist.route_name ?? '—' },
                        { label: 'Status', value: <StatusChip status={data.activePicklist.status} /> },
                        { label: 'Parties Visited', value: `${data.activePicklist.completed_parties}/${data.activePicklist.total_parties}` },
                        { label: 'Route Value', value: fmt(data.activePicklist.total_amount) },
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

                {/* Authoritative Route Profitability History for this worker */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="w-full px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <History className="h-4 w-4 text-slate-400" />
                      <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                        Authoritative Route Execution & Reconciliation History
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs">
                      <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                      <select value={histMonth} onChange={e => setHistMonth(Number(e.target.value))}
                        className="border border-slate-200 rounded px-1.5 py-1 bg-white text-slate-700">
                        {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                      </select>
                      <select value={histYear} onChange={e => setHistYear(Number(e.target.value))}
                        className="border border-slate-200 rounded px-1.5 py-1 bg-white text-slate-700">
                        {years.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                      <button
                        onClick={applyHistRange}
                        className="px-2 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 transition-colors cursor-pointer">
                        Go
                      </button>
                    </div>
                  </div>

                  {workerProfitability?.routes && workerProfitability.routes.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                            <th className="text-left px-3 py-2">Date / Picklist</th>
                            <th className="text-left px-3 py-2">Route</th>
                            <th className="text-right px-3 py-2">Delivered Sales</th>
                            <th className="text-right px-3 py-2">Collections</th>
                            <th className="text-right px-3 py-2 text-rose-600">Approved Exp.</th>
                            <th className="text-right px-3 py-2 text-indigo-700">Contribution</th>
                            <th className="text-right px-3 py-2">Expected Cash</th>
                            <th className="text-right px-3 py-2">Actual Cash</th>
                            <th className="text-right px-3 py-2">Variance</th>
                            <th className="text-center px-3 py-2">Reconciliation</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {workerProfitability.routes.map(r => (
                            <tr key={r.picklist_id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-3 py-2 font-semibold text-slate-900 whitespace-nowrap">
                                {r.date} <span className="text-slate-400 font-normal">({r.picklist_number})</span>
                              </td>
                              <td className="px-3 py-2 text-slate-700 font-medium">{r.route_name || '—'}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{fmt(r.sales)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-medium">{fmt(r.total_collected)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-rose-600">{fmt(r.approved_expenses)}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-bold text-indigo-700">{fmt(r.contribution_before_cogs)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmt(r.expected_cash)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-slate-900">{fmt(r.actual_cash_returned)}</td>
                              <td className={`px-3 py-2 text-right tabular-nums font-bold ${
                                r.cash_discrepancy !== 0 ? 'text-rose-600' : 'text-slate-400'
                              }`}>
                                {fmt(r.cash_discrepancy)}
                              </td>
                              <td className="px-3 py-2 text-center whitespace-nowrap">
                                <StatusChip status={r.financial_status || 'pending'} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-6 text-center text-slate-400 text-xs">
                      No historical route profitability records found for this worker in the selected period.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
