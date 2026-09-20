import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Clock, CreditCard, IndianRupee, Package, X, Truck, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  getMasterExceptions, getMasterInventoryExceptions, getPendingRouteReconciliations,
  monthRange, type MasterExceptions,
} from '../services/masterService';
import { QK } from '@/lib/queryKeys';
import { formatCurrency } from '@/shared/utils/format';

function SeverityBadge({ level }: { level: 'critical' | 'warning' | 'info' | 'high' | 'medium' | 'low' }) {
  const map: Record<string, { label: string; cls: string }> = {
    critical: { label: 'Critical', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
    high: { label: 'High', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
    warning: { label: 'Warning', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    medium: { label: 'Medium', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    info: { label: 'Info', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
    low: { label: 'Low', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  };
  const { label, cls } = map[level] ?? map.low;
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${cls}`}>
      {level === 'critical' || level === 'high' ? '⚠ ' : ''}{label}
    </span>
  );
}

function ExSection({ title, icon: Icon, iconColor, children }: { title: string; icon: React.ElementType; iconColor: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${iconColor}`} />
        <h2 className="font-semibold text-slate-800 text-sm">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export function MasterExceptionsPage() {
  const now = new Date();
  const dateRange = monthRange(now.getFullYear(), now.getMonth() + 1);
  const { data: exceptions, isLoading, refetch, isFetching } = useQuery({
    queryKey: QK.masterExceptions(dateRange.from, dateRange.to),
    queryFn: () => getMasterExceptions(dateRange),
    refetchInterval: 30000,
  });

  const { data: inventoryExceptions = [] } = useQuery({
    queryKey: ['master-inventory-exceptions'],
    queryFn: getMasterInventoryExceptions,
    refetchInterval: 60000,
  });

  const { data: pendingReconciliations = [] } = useQuery({
    queryKey: ['master-pending-reconciliations'],
    queryFn: getPendingRouteReconciliations,
    refetchInterval: 30000,
  });

  const ex = exceptions as MasterExceptions | undefined;

  const hasAnyException = (
    (ex?.cashDiscrepancies.count ?? 0) > 0 ||
    (ex?.bouncedCheques.count ?? 0) > 0 ||
    (ex?.pendingExpenses.count ?? 0) > 0 ||
    inventoryExceptions.length > 0 ||
    pendingReconciliations.length > 0
  );

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Exception Center</h1>
          <p className="text-sm text-slate-500 mt-0.5">All active exceptions across cash, cheques, expenses, and inventory</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* No exceptions state */}
      {!isLoading && !hasAnyException && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 text-center">
          <div className="h-12 w-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <X className="h-6 w-6 text-emerald-600" />
          </div>
          <p className="font-semibold text-emerald-700">All Clear — No Active Exceptions</p>
          <p className="text-sm text-emerald-600 mt-1">No cash discrepancies, bounced cheques, pending expenses, or inventory exceptions detected.</p>
        </div>
      )}

      {/* Pending Route Reconciliations */}
      {pendingReconciliations.length > 0 && (
        <ExSection title={`Routes Pending Stock / Financial Reconciliation (${pendingReconciliations.length})`} icon={Truck} iconColor="text-indigo-500">
          <div className="divide-y divide-slate-100">
            {pendingReconciliations.map((route: any) => (
              <div key={route.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <SeverityBadge level="high" />
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 text-sm">
                      {route.routeName} — {route.workerName}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Picklist #{route.picklist_number} · Declared Cash: {formatCurrency(route.actual_cash_returned || 0)}
                      {route.cash_discrepancy ? ` · Cash Diff: ${formatCurrency(route.cash_discrepancy)}` : ''}
                    </div>
                    {route.notes && (
                      <div className="text-xs text-amber-700 font-medium mt-1">
                        Reason: {route.notes}
                      </div>
                    )}
                    {route.exceptions?.length > 0 && (
                      <div className="text-xs text-rose-600 mt-0.5">
                        {route.exceptions.length} stock discrepancy item(s) logged
                      </div>
                    )}
                  </div>
                </div>
                <Link
                  to={`/admin/picklists/${route.id}`}
                  className="px-3 py-1.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold flex items-center gap-1 flex-shrink-0 transition-colors"
                >
                  Review & Authorize <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            ))}
          </div>
        </ExSection>
      )}

      {/* Cash Discrepancies */}
      {ex && ex.cashDiscrepancies.count > 0 && (
        <ExSection title={`Cash Discrepancies (${ex.cashDiscrepancies.count})`} icon={IndianRupee} iconColor="text-rose-500">
          <div className="divide-y divide-slate-100">
            {ex.cashDiscrepancies.routes.map((route, i: number) => (
              <div key={route.id || i} className="px-4 py-3 flex items-start gap-3">
                <SeverityBadge level="critical" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-sm">{route.workerName || 'Unknown Worker'}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {route.routeName} · Expected: {formatCurrency(route.expectedCash)} · Actual: {formatCurrency(route.actualCash)}
                  </div>
                  <div className="text-xs font-semibold text-rose-600 mt-0.5">
                    Discrepancy: {formatCurrency(Math.abs(route.discrepancy))}
                    {route.status && ` (${route.status})`}
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 flex-shrink-0">
                  {route.date || ''}
                </div>
              </div>
            ))}
          </div>
        </ExSection>
      )}

      {/* Bounced Cheques */}
      {ex && ex.bouncedCheques.count > 0 && (
        <ExSection title={`Bounced / Pending Cheques (${ex.bouncedCheques.count})`} icon={CreditCard} iconColor="text-amber-500">
          <div className="divide-y divide-slate-100">
            {ex.bouncedCheques.items.map((item, i: number) => (
              <div key={item.id || i} className="px-4 py-3 flex items-start gap-3">
                <SeverityBadge level="warning" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-sm">{item.partyName || '—'}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Cheque #{item.chequeNumber || '—'} · Due: {item.date || '—'}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-amber-700">{formatCurrency(item.amount)}</div>
                  <div className="text-[11px] text-slate-400">{item.bounceReason || 'Bounced'}</div>
                </div>
              </div>
            ))}
          </div>
        </ExSection>
      )}

      {/* Pending Expenses */}
      {ex && ex.pendingExpenses.count > 0 && (
        <ExSection title={`Pending Expense Approvals (${ex.pendingExpenses.count})`} icon={Clock} iconColor="text-blue-500">
          <div className="divide-y divide-slate-100">
            {ex.pendingExpenses.items.map((item, i: number) => (
              <div key={item.id || i} className="px-4 py-3 flex items-start gap-3">
                <SeverityBadge level="info" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-sm">{item.category} — {item.workerName || '—'}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{item.description || 'No description'}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-slate-700">{formatCurrency(item.amount)}</div>
                  <div className="text-[11px] text-slate-400">{item.date || ''}</div>
                </div>
              </div>
            ))}
          </div>
        </ExSection>
      )}

      {/* Inventory Exceptions */}
      {inventoryExceptions.length > 0 && (
        <ExSection title={`Inventory Exceptions (${inventoryExceptions.length})`} icon={Package} iconColor="text-violet-500">
          <div className="divide-y divide-slate-100">
            {inventoryExceptions.map((ex) => (
              <div key={ex.id} className="px-4 py-3 flex items-start gap-3">
                <SeverityBadge level={ex.severity as any} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-sm">{ex.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{ex.detail}</div>
                </div>
                {ex.timestamp && (
                  <div className="text-[11px] text-slate-400 flex-shrink-0">
                    {new Date(ex.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ExSection>
      )}
    </div>
  );
}
