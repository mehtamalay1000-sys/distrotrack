import { useAuth } from '@/app/AuthProvider';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Loader2, ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { supabase, isMockMode } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import { formatCurrency } from '@/shared/utils/format';
import type { Picklist, Delivery } from '@/lib/database.types';
import { useState } from 'react';

async function getWorkerHistory(workerId: string): Promise<Picklist[]> {
  let dbPicklists: Picklist[] = [];
  try {
    const { data, error } = await supabase
      .from('picklists')
      .select('*, route:routes(*), deliveries(*, party:parties(*), payments(*))')
      .eq('worker_id', workerId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(20);
    if (!error && data) {
      dbPicklists = data as Picklist[];
    }
  } catch {
    // fallback
  }

  if (!isMockMode()) {
    return dbPicklists;
  }

  const mockPicklists = mockStore.getPicklists().filter(
    (p) => p.worker_id === workerId && (p.status === 'completed' || p.status === 'confirmed')
  );

  const mockDeliveries = mockStore.getDeliveries();
  const mockParties = mockStore.getParties();
  const mockRoutes = mockStore.getRoutes();

  const hydratedMock = mockPicklists.map((p) => {
    const dels = mockDeliveries
      .filter((d) => d.picklist_id === p.id)
      .map((d) => ({
        ...d,
        party: mockParties.find((pt) => pt.id === d.party_id) || null,
      }));

    return {
      ...p,
      route: mockRoutes.find((r) => r.id === p.route_id) || null,
      deliveries: dels,
    } as Picklist;
  });

  const seen = new Set<string>();
  const merged: Picklist[] = [];

  for (const pl of dbPicklists) {
    seen.add(pl.id);
    merged.push(pl);
  }

  for (const mpl of hydratedMock) {
    if (!seen.has(mpl.id)) {
      seen.add(mpl.id);
      merged.push(mpl);
    }
  }

  return merged;
}

export function WorkerHistoryPage() {
  const { profile } = useAuth();
  const workerId = profile?.worker_id || profile?.id || '';
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ['worker-history', workerId],
    queryFn: () => getWorkerHistory(workerId),
    enabled: !!workerId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <h1 className="text-lg font-bold text-surface-900 dark:text-white">Route History</h1>

      {routes.length === 0 ? (
        <div className="text-center py-12">
          <Clock className="h-10 w-10 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
          <p className="text-sm text-surface-500 dark:text-surface-400">No completed routes yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {routes.map((r) => {
            const isOpen = expanded === r.id;
            const deliveries = (r.deliveries || []) as Delivery[];

            // ── Dynamic robust totals calculation with fallback ────────────────
            let totalCash = Number(r.total_cash || 0);
            let totalCheque = Number(r.total_cheque || 0);
            let totalCredit = Number(r.total_credit || 0);

            if (totalCash === 0 && totalCheque === 0 && totalCredit === 0 && deliveries.length > 0) {
              deliveries.forEach((d) => {
                const collected = Number(d.collected_amount || 0);
                const delivered = Number(d.delivered_amount || d.total_amount || 0);
                const amt = collected > 0 ? collected : delivered;

                if (d.payment_mode === 'cash') totalCash += amt;
                else if (d.payment_mode === 'cheque' || d.payment_mode === 'upi') totalCheque += amt;
                else if (d.payment_mode === 'credit') totalCredit += delivered;
              });
            }

            const totalCollected = (Number(r.total_collected || 0) > 0)
              ? Number(r.total_collected)
              : (totalCash + totalCheque);

            const duration = r.started_at && r.completed_at
              ? (() => {
                  const diff = new Date(r.completed_at).getTime() - new Date(r.started_at).getTime();
                  const h = Math.floor(diff / 3600000);
                  const m = Math.floor((diff % 3600000) / 60000);
                  return h > 0 ? `${h}h ${m}m` : `${m}m`;
                })()
              : '--';

            return (
              <div key={r.id} className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden shadow-xs">
                <button
                  onClick={() => setExpanded(isOpen ? null : r.id)}
                  className="w-full p-3.5 flex items-center gap-3 text-left hover:bg-surface-50/60 dark:hover:bg-surface-700/50 transition-colors cursor-pointer"
                >
                  <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-surface-900 dark:text-white truncate">
                      {r.route?.name || r.picklist_number}
                    </div>
                    <div className="text-[10px] text-surface-500 dark:text-surface-400 flex items-center gap-2 mt-0.5">
                      <span>{new Date(r.completed_at || r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      <span>•</span>
                      <span>{r.completed_parties || deliveries.length}/{r.total_parties || deliveries.length} parties</span>
                      <span>•</span>
                      <span>{duration}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 mr-1">
                    <div className="text-xs font-black text-emerald-700 dark:text-emerald-400">{formatCurrency(totalCollected)}</div>
                    <div className="text-[10px] text-surface-400 font-medium">collected</div>
                  </div>
                  {isOpen ? <ChevronUp className="h-4 w-4 text-surface-400" /> : <ChevronDown className="h-4 w-4 text-surface-400" />}
                </button>

                {isOpen && (
                  <div className="border-t border-surface-200 dark:border-surface-700">
                    {/* Collection breakdown */}
                    <div className="grid grid-cols-3 border-b border-surface-100 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-900/30">
                      <div className="p-2.5 text-center">
                        <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalCash)}</div>
                        <div className="text-[9px] font-bold text-surface-400 uppercase tracking-wider">Cash</div>
                      </div>
                      <div className="p-2.5 text-center border-x border-surface-100 dark:border-surface-700">
                        <div className="text-xs font-bold text-blue-600 dark:text-blue-400">{formatCurrency(totalCheque)}</div>
                        <div className="text-[9px] font-bold text-surface-400 uppercase tracking-wider">Cheque / UPI</div>
                      </div>
                      <div className="p-2.5 text-center">
                        <div className="text-xs font-bold text-amber-600 dark:text-amber-400">{formatCurrency(totalCredit)}</div>
                        <div className="text-[9px] font-bold text-surface-400 uppercase tracking-wider">Credit</div>
                      </div>
                    </div>

                    {/* Per-party breakdown */}
                    <div className="divide-y divide-surface-100 dark:divide-surface-700 max-h-72 overflow-y-auto">
                      {deliveries.map((d) => {
                        const isCredit = d.payment_mode === 'credit';
                        const amount = isCredit
                          ? Number(d.delivered_amount || d.total_amount || 0)
                          : Number(d.collected_amount || d.delivered_amount || d.total_amount || 0);

                        return (
                          <div key={d.id} className="px-3.5 py-2.5 flex items-center gap-2 text-xs">
                            <MapPin className="h-3 w-3 text-surface-400 flex-shrink-0" />
                            <span className="flex-1 text-surface-800 dark:text-surface-200 font-medium truncate">
                              {d.party?.name || 'Customer'}
                            </span>
                            <span className={`font-bold ${d.status === 'delivered' ? 'text-emerald-600 dark:text-emerald-400' : d.status === 'partial' ? 'text-amber-600 dark:text-amber-400' : 'text-surface-400'}`}>
                              {d.status === 'delivered' ? '✓' : d.status === 'partial' ? '◐' : '–'}
                            </span>
                            <span className={`font-bold text-right tabular-nums w-24 ${isCredit ? 'text-amber-600 dark:text-amber-400' : 'text-surface-900 dark:text-white'}`}>
                              {formatCurrency(amount)}
                            </span>
                            {d.payment_mode && (
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                isCredit
                                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                                  : d.payment_mode === 'cash'
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                              }`}>
                                {d.payment_mode}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
