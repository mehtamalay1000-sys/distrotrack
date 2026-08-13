import { useAuth } from '@/app/AuthProvider';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Loader2, ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/shared/utils/format';
import type { Picklist, Delivery } from '@/lib/database.types';
import { useState } from 'react';

async function getWorkerHistory(workerId: string): Promise<Picklist[]> {
  try {
    const { data, error } = await supabase
      .from('picklists')
      .select('*, route:routes(*), deliveries(*, party:parties(*), payments(*))')
      .eq('worker_id', workerId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(20);
    if (error || !data) return [];
    return data as Picklist[];
  } catch {
    return [];
  }
}

export function WorkerHistoryPage() {
  const { profile } = useAuth();
  const workerId = profile?.id || '';
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
            const duration = r.started_at && r.completed_at
              ? (() => {
                  const diff = new Date(r.completed_at).getTime() - new Date(r.started_at).getTime();
                  const h = Math.floor(diff / 3600000);
                  const m = Math.floor((diff % 3600000) / 60000);
                  return h > 0 ? `${h}h ${m}m` : `${m}m`;
                })()
              : '--';

            return (
              <div key={r.id} className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : r.id)}
                  className="w-full p-3.5 flex items-center gap-3 text-left"
                >
                  <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-surface-900 dark:text-white truncate">
                      {r.route?.name || r.picklist_number}
                    </div>
                    <div className="text-[10px] text-surface-500 dark:text-surface-400 flex items-center gap-2 mt-0.5">
                      <span>{new Date(r.completed_at || r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      <span>•</span>
                      <span>{r.completed_parties}/{r.total_parties} parties</span>
                      <span>•</span>
                      <span>{duration}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 mr-1">
                    <div className="text-xs font-bold text-surface-900 dark:text-white">{formatCurrency(r.total_collected)}</div>
                    <div className="text-[10px] text-surface-400">collected</div>
                  </div>
                  {isOpen ? <ChevronUp className="h-4 w-4 text-surface-400" /> : <ChevronDown className="h-4 w-4 text-surface-400" />}
                </button>

                {isOpen && (
                  <div className="border-t border-surface-200 dark:border-surface-700">
                    {/* Collection breakdown */}
                    <div className="grid grid-cols-3 border-b border-surface-100 dark:border-surface-700">
                      <div className="p-2.5 text-center">
                        <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(r.total_cash)}</div>
                        <div className="text-[9px] text-surface-400 uppercase">Cash</div>
                      </div>
                      <div className="p-2.5 text-center border-x border-surface-100 dark:border-surface-700">
                        <div className="text-xs font-bold text-blue-600 dark:text-blue-400">{formatCurrency(r.total_cheque)}</div>
                        <div className="text-[9px] text-surface-400 uppercase">Cheque</div>
                      </div>
                      <div className="p-2.5 text-center">
                        <div className="text-xs font-bold text-amber-600 dark:text-amber-400">{formatCurrency(r.total_credit)}</div>
                        <div className="text-[9px] text-surface-400 uppercase">Credit</div>
                      </div>
                    </div>

                    {/* Per-party breakdown */}
                    <div className="divide-y divide-surface-100 dark:divide-surface-700">
                      {deliveries.map((d) => (
                        <div key={d.id} className="px-3.5 py-2.5 flex items-center gap-2 text-xs">
                          <MapPin className="h-3 w-3 text-surface-400 flex-shrink-0" />
                          <span className="flex-1 text-surface-700 dark:text-surface-300 truncate">{d.party?.name || 'Party'}</span>
                          <span className={`font-medium ${d.status === 'delivered' ? 'text-emerald-600 dark:text-emerald-400' : d.status === 'partial' ? 'text-amber-600 dark:text-amber-400' : 'text-surface-400'}`}>
                            {d.status === 'delivered' ? '✓' : d.status === 'partial' ? '◐' : '–'}
                          </span>
                          <span className="font-medium text-surface-900 dark:text-white w-20 text-right">{formatCurrency(d.collected_amount)}</span>
                          {d.payment_mode && (
                            <span className="text-[9px] text-surface-400 w-10 text-right">{d.payment_mode}</span>
                          )}
                        </div>
                      ))}
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
