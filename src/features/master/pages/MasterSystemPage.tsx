import { useState, useEffect, useCallback } from 'react';
import {
  Activity, RefreshCw, Filter, CalendarDays,
  LogIn, LogOut, AlertTriangle, CheckCircle2, XCircle,
  FileText, Truck, CreditCard, User, ShieldAlert,
  Database, Cpu,
} from 'lucide-react';
import {
  getMasterAuditLog, todayRange, monthRange,
  type AuditLogFilter, type DateRange,
} from '@/features/master/services/masterService';
import type { MasterAuditLog } from '@/lib/database.types';

// ── Helpers ──────────────────────────────────────────────────────

const fmtDateTime = (s: string) => {
  try {
    return new Date(s).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return s; }
};

function moduleIcon(module: string) {
  const map: Record<string, React.ReactNode> = {
    auth: <User className="h-3.5 w-3.5" />,
    picklist: <FileText className="h-3.5 w-3.5" />,
    delivery: <Truck className="h-3.5 w-3.5" />,
    payment: <CreditCard className="h-3.5 w-3.5" />,
    expense: <CreditCard className="h-3.5 w-3.5 text-rose-500" />,
    import: <Database className="h-3.5 w-3.5 text-indigo-500" />,
    route: <Activity className="h-3.5 w-3.5" />,
    reconciliation: <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />,
    system: <Activity className="h-3.5 w-3.5" />,
  };
  return map[module?.toLowerCase()] ?? <Activity className="h-3.5 w-3.5" />;
}

function actionIcon(action: string, status: string) {
  if (action === 'login') return <LogIn className="h-3.5 w-3.5 text-emerald-600" />;
  if (action === 'logout') return <LogOut className="h-3.5 w-3.5 text-slate-500" />;
  if (action === 'failed_login') return <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />;
  if (status === 'success') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === 'failure') return <XCircle className="h-3.5 w-3.5 text-rose-500" />;
  if (status === 'warning') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  return <Activity className="h-3.5 w-3.5 text-slate-400" />;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    failure: 'bg-rose-50 text-rose-700 border-rose-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border uppercase tracking-wide ${map[status] ?? 'bg-slate-50 text-slate-500 border-slate-200'}`}>
      {status}
    </span>
  );
}

function RoleBadge({ role }: { role: string | null }) {
  const map: Record<string, string> = {
    master: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    owner: 'bg-blue-50 text-blue-700 border-blue-200',
    admin: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    worker: 'bg-slate-50 text-slate-600 border-slate-200',
    system: 'bg-slate-100 text-slate-500 border-slate-200',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border uppercase tracking-wide ${map[role ?? ''] ?? 'bg-slate-50 text-slate-500 border-slate-200'}`}>
      {role ?? '—'}
    </span>
  );
}

// ── Summary Stat Cards ────────────────────────────────────────────

function StatCard({ label, count, icon, color }: { label: string; count: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3">
      <div className={`h-8 w-8 rounded-lg ${color} flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div>
        <div className="text-xl font-bold text-slate-900 tabular-nums">{count}</div>
        <div className="text-xs text-slate-500 font-medium">{label}</div>
      </div>
    </div>
  );
}

// ── Observable Health Matrix ───────────────────────────────────────

function ObservableHealthDeck({
  dbHealthy,
  failedLogins,
  failuresCount,
  importFailures,
  anomalies,
}: {
  dbHealthy: boolean;
  failedLogins: number;
  failuresCount: number;
  importFailures: number;
  anomalies: Array<{ type: string; count: number; description: string; severity: 'warning' | 'critical' }>;
}) {
  return (
    <div className="space-y-4 mb-5">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-slate-500" />
            <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Observable System Health & Telemetry State
            </h2>
          </div>
          <span className="text-xs text-slate-400">Strict evidence-based observability</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {/* 1. Database Connection */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 text-slate-400" /> Database
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                dbHealthy ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
              }`}>
                {dbHealthy ? 'HEALTHY' : 'ERROR'}
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              PostgreSQL connection verified
            </div>
          </div>

          {/* 2. Authentication Pipeline */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-slate-400" /> Auth Pipeline
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                failedLogins > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {failedLogins > 0 ? 'WARNING' : 'HEALTHY'}
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              {failedLogins > 0 ? `${failedLogins} failed attempts` : 'Logins authenticating cleanly'}
            </div>
          </div>

          {/* 3. Operational Failures */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-slate-400" /> Operations
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                failuresCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {failuresCount > 0 ? 'WARNING' : 'HEALTHY'}
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              {failuresCount > 0 ? `${failuresCount} failures logged` : 'Zero operation failures'}
            </div>
          </div>

          {/* 4. Import Pipeline */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-slate-400" /> Import Health
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                importFailures > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {importFailures > 0 ? 'WARNING' : 'HEALTHY'}
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              {importFailures > 0 ? `${importFailures} failed imports` : 'Import pipeline operational'}
            </div>
          </div>

          {/* 5. Realtime Sync Subsystem */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-slate-400" /> Sync Daemon
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 uppercase">
                NOT OBSERVABLE
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              No standing background sync daemon
            </div>
          </div>

          {/* 6. Host Hardware / CPU / RAM */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-slate-400" /> Host CPU/RAM
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 uppercase">
                NOT OBSERVABLE
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              Serverless cloud — unobservable
            </div>
          </div>
        </div>
      </div>

      {/* Deterministic Anomaly Radar (Section 11) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Deterministic Anomaly & Threat Radar
            </h3>
          </div>
          <span className="text-xs text-slate-400">Explainable signals only — zero artificial predictions</span>
        </div>

        {anomalies.length > 0 ? (
          <div className="space-y-2">
            {anomalies.map((a, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg border flex items-center justify-between ${
                  a.severity === 'critical' ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                <div className="flex items-center gap-2 text-xs">
                  <AlertTriangle className={`h-4 w-4 ${a.severity === 'critical' ? 'text-rose-600' : 'text-amber-600'}`} />
                  <span className="font-semibold">{a.type}:</span>
                  <span>{a.description}</span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  a.severity === 'critical' ? 'bg-rose-200 text-rose-800' : 'bg-amber-200 text-amber-800'
                }`}>
                  {a.count} OCCURRENCE{a.count > 1 ? 'S' : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-800">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            <span>Zero anomalies detected. Authentication, payment operations, and import jobs within normal baseline.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

type Preset = 'today' | 'this_month' | 'custom';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function MasterSystemPage() {
  const now = new Date();
  const [preset, setPreset] = useState<Preset>('today');
  const [customYear, setCustomYear] = useState(now.getFullYear());
  const [customMonth, setCustomMonth] = useState(now.getMonth() + 1);
  const [logs, setLogs] = useState<MasterAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbHealthy, setDbHealthy] = useState(true);
  const [filterRole, setFilterRole] = useState('');
  const [filterModule, setFilterModule] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
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
    const filter: AuditLogFilter = {
      range,
      ...(filterRole ? { role: filterRole } : {}),
      ...(filterModule ? { module: filterModule } : {}),
      ...(filterStatus ? { status: filterStatus } : {}),
      limit: 500,
    };
    try {
      const data = await getMasterAuditLog(filter);
      setLogs(data);
      setDbHealthy(true);
    } catch {
      setDbHealthy(false);
    } finally {
      setLoading(false);
    }
  }, [preset, customYear, customMonth, filterRole, filterModule, filterStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // Filtered by search
  const filtered = search.trim()
    ? logs.filter(l =>
        [l.user_name, l.role, l.module, l.action, l.status, l.detail]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : logs;

  // Stats
  const loginCount = filtered.filter(l => l.action === 'login').length;
  const failedCount = filtered.filter(l => l.action === 'failed_login').length;
  const successCount = filtered.filter(l => l.status === 'success').length;
  const failureCount = filtered.filter(l => l.status === 'failure').length;
  const importFailuresCount = filtered.filter(l => l.module === 'import' && l.status === 'failure').length;

  // Anomaly & Threat Radar derivation (Deterministic & Explainable)
  const anomalies = (() => {
    const list: Array<{ type: string; count: number; description: string; severity: 'warning' | 'critical' }> = [];
    
    // 1. Repeated failed logins
    if (failedCount >= 3) {
      list.push({
        type: 'Authentication Anomaly',
        count: failedCount,
        description: 'Repeated failed login attempts detected in period. Potential credential guessing.',
        severity: failedCount >= 5 ? 'critical' : 'warning',
      });
    }

    // 2. Failed imports
    if (importFailuresCount > 0) {
      list.push({
        type: 'Import Pipeline Disruption',
        count: importFailuresCount,
        description: 'Batch file or bill parsing errors logged during execution.',
        severity: 'warning',
      });
    }

    // 3. Payment anomalies (e.g. reversals, bounces)
    const bouncedOrReversed = filtered.filter(l => l.action === 'cheque_bounced' || l.action === 'payment_reversed');
    if (bouncedOrReversed.length > 0) {
      list.push({
        type: 'Financial Reversal / Dishonor',
        count: bouncedOrReversed.length,
        description: 'Cheques dishonored or payment reversals executed in audit trail.',
        severity: 'warning',
      });
    }

    // 4. Cash discrepancies
    const cashDiscAuth = filtered.filter(l => l.action === 'cash_discrepancy_authorized');
    if (cashDiscAuth.length > 0) {
      list.push({
        type: 'Cash Discrepancy Authorization',
        count: cashDiscAuth.length,
        description: 'Route reconciliation cash discrepancies approved with authorization.',
        severity: 'warning',
      });
    }

    return list;
  })();

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">System Activity & Audit Log</h1>
          <p className="text-sm text-slate-500 mt-0.5">Authoritative system audit log — evidence-based observable state</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period presets */}
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
          <button onClick={load} disabled={loading}
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors disabled:opacity-40 cursor-pointer"
            title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Observable Health Deck (Section 12 compliance) */}
      <ObservableHealthDeck
        dbHealthy={dbHealthy}
        failedLogins={failedCount}
        failuresCount={failureCount}
        importFailures={importFailuresCount}
        anomalies={anomalies}
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard label="Logins" count={loginCount} icon={<LogIn className="h-4 w-4 text-emerald-600" />} color="bg-emerald-50" />
        <StatCard label="Failed Attempts" count={failedCount} icon={<AlertTriangle className="h-4 w-4 text-rose-600" />} color="bg-rose-50" />
        <StatCard label="Successful Events" count={successCount} icon={<CheckCircle2 className="h-4 w-4 text-blue-600" />} color="bg-blue-50" />
        <StatCard label="Failure Events" count={failureCount} icon={<XCircle className="h-4 w-4 text-slate-500" />} color="bg-slate-50" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search logs…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:border-indigo-400 w-44"
          />
        </div>

        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700">
          <option value="">All Roles</option>
          <option value="master">Master</option>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="worker">Worker</option>
          <option value="system">System</option>
        </select>

        <select value={filterModule} onChange={e => setFilterModule(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700">
          <option value="">All Modules</option>
          <option value="auth">Auth</option>
          <option value="picklist">Picklist</option>
          <option value="delivery">Delivery</option>
          <option value="payment">Payment</option>
          <option value="expense">Expense</option>
          <option value="import">Import</option>
          <option value="route">Route</option>
          <option value="system">System</option>
        </select>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700">
          <option value="">All Statuses</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
          <option value="warning">Warning</option>
        </select>

        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <CalendarDays className="h-3.5 w-3.5" />
          <span>{getRange().from} → {getRange().to}</span>
        </div>

        <span className="ml-auto text-xs text-slate-400 font-medium">
          {loading ? 'Loading…' : `${filtered.length} event${filtered.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 mb-4">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <span>
          This log contains only application-level audit events. Passwords, PINs, auth tokens, API keys, and other secrets are never recorded.
        </span>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading events…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              No events recorded for this period.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Timestamp', 'User', 'Role', 'Module', 'Action', 'Status', 'Detail'].map(c => (
                    <th key={c} className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(log => (
                  <tr
                    key={log.id}
                    className={`hover:bg-slate-50 transition-colors ${log.status === 'failure' ? 'bg-rose-50/30' : ''}`}
                  >
                    <td className="px-4 py-2.5 text-xs text-slate-400 font-mono whitespace-nowrap">
                      {fmtDateTime(log.occurred_at)}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                      {log.user_name ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <RoleBadge role={log.role} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <span className="text-slate-400">{moduleIcon(log.module)}</span>
                        <span className="text-xs font-semibold capitalize">{log.module}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {actionIcon(log.action, log.status)}
                        <span className="text-xs font-medium text-slate-700 capitalize">{log.action.replace(/_/g, ' ')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[200px] truncate">
                      {log.detail ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
