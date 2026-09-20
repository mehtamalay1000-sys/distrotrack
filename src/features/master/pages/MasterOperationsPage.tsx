import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity, Users, Truck, CheckCircle2, Clock, AlertTriangle,
  RefreshCw, MapPin, ArrowRight,
} from 'lucide-react';
import { getMasterOperationsOverview } from '../services/masterService';
import { QK } from '@/lib/queryKeys';
import { formatCurrency } from '@/shared/utils/format';

function routeStatusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    no_route: { label: 'No Route Today', cls: 'bg-slate-100 text-slate-500' },
    assigned: { label: 'Assigned', cls: 'bg-amber-100 text-amber-700' },
    in_progress: { label: 'In Progress', cls: 'bg-blue-100 text-blue-700' },
    completed: { label: 'Completed', cls: 'bg-emerald-100 text-emerald-700' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-500' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function progressBar(completed: number, total: number) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct > 50 ? 'bg-blue-500' : 'bg-amber-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">
        {completed}/{total}
      </span>
    </div>
  );
}

export function MasterOperationsPage() {
  const { data: ops, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: QK.masterOperations,
    queryFn: getMasterOperationsOverview,
    refetchInterval: 10000,
  });

  const workers = ops?.workers ?? [];

  const statCards = [
    { label: 'Active Routes', value: ops?.totalInProgress ?? 0, icon: Activity, color: 'text-blue-600 bg-blue-50', borderColor: 'border-blue-200' },
    { label: 'Not Started', value: ops?.totalNotStarted ?? 0, icon: Clock, color: 'text-amber-600 bg-amber-50', borderColor: 'border-amber-200' },
    { label: 'Completed Today', value: ops?.totalCompleted ?? 0, icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50', borderColor: 'border-emerald-200' },
    { label: 'Deliveries Done', value: ops?.completedDeliveries ?? 0, icon: Truck, color: 'text-violet-600 bg-violet-50', borderColor: 'border-violet-200' },
    { label: 'Deliveries Pending', value: ops?.pendingDeliveries ?? 0, icon: AlertTriangle, color: 'text-rose-600 bg-rose-50', borderColor: 'border-rose-200' },
    { label: 'Total Workers', value: workers.length, icon: Users, color: 'text-slate-600 bg-slate-50', borderColor: 'border-slate-200' },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Live Operations</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Today's route & delivery status across all workers
            {ops?.asOf && (
              <span className="ml-2 text-xs text-slate-400">
                as of {new Date(ops.asOf).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map(({ label, value, icon: Icon, color, borderColor }) => (
          <div key={label} className={`bg-white rounded-xl border ${borderColor} p-3`}>
            <div className={`h-8 w-8 rounded-lg ${color} flex items-center justify-center mb-2`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums">{value}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Worker Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="h-6 w-6 animate-spin text-indigo-500" />
          <span className="ml-2 text-slate-500">Loading operations...</span>
        </div>
      ) : error ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700">
          Failed to load operations data. <button onClick={() => refetch()} className="underline ml-1">Retry</button>
        </div>
      ) : workers.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">No active workers found</p>
          <p className="text-sm text-slate-400 mt-1">Workers will appear here when they are active in the system.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 text-sm">Worker Operations Today</h2>
            <Link
              to="/master/workers"
              className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              Full Monitor <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {workers.map((w) => (
              <div key={w.workerId} className="px-4 py-3 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 flex-shrink-0">
                    {w.workerName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900 text-sm">{w.workerName}</span>
                      {routeStatusBadge(w.routeStatus)}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5 flex-wrap">
                      {w.routeName ? (
                        <>
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          <span>{w.routeName}</span>
                          {w.picklistNumber && (
                            <span className="text-slate-400">({w.picklistNumber})</span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">No route assigned today</span>
                      )}
                    </div>
                  </div>
                  {w.totalAmount > 0 && (
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold text-slate-900">{formatCurrency(w.totalCollected)}</div>
                      <div className="text-[11px] text-slate-400">of {formatCurrency(w.totalAmount)}</div>
                    </div>
                  )}
                </div>
                {w.totalParties > 0 && (
                  <div className="ml-11">
                    {progressBar(w.completedParties, w.totalParties)}
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {w.completedParties} of {w.totalParties} parties completed
                      {w.startedAt && (
                        <span className="ml-2">
                          · Started {new Date(w.startedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
