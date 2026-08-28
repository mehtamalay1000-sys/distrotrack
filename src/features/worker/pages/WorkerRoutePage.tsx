import { useAuth } from '@/app/AuthProvider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { MapPin, Play, Square, ChevronRight, CheckCircle2, Clock, AlertCircle, Loader2, Package } from 'lucide-react';
import { getWorkerTodayRoute, getRouteDeliveries, startRoute, endRoute } from '../services/workerRouteService';
import { createExpense } from '@/features/expenses/services/expenseService';
import { formatCurrency } from '@/shared/utils/format';
import type { Delivery } from '@/lib/database.types';
import { useState } from 'react';

interface RouteExpenseItem {
  id: string;
  category: string;
  amount: string;
  notes: string;
}

export function WorkerRoutePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const workerId = profile?.id || '';
  const workerName = profile?.full_name || '';
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  const [expenseItems, setExpenseItems] = useState<RouteExpenseItem[]>([
    { id: '1', category: 'Tea & Refreshment', amount: '', notes: '' },
  ]);

  const addExpenseRow = () => {
    setExpenseItems((prev) => [
      ...prev,
      { id: Date.now().toString(), category: 'Fuel & Vehicle', amount: '', notes: '' },
    ]);
  };

  const removeExpenseRow = (id: string) => {
    if (expenseItems.length > 1) {
      setExpenseItems((prev) => prev.filter((i) => i.id !== id));
    } else {
      setExpenseItems([{ id: '1', category: 'Tea & Refreshment', amount: '', notes: '' }]);
    }
  };

  const updateExpenseRow = (id: string, field: keyof RouteExpenseItem, value: string) => {
    setExpenseItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, [field]: value } : i))
    );
  };

  const { data: picklist, isLoading: plLoading } = useQuery({
    queryKey: ['worker-today-route', workerId, workerName],
    queryFn: () => getWorkerTodayRoute(workerId, workerName),
    enabled: !!workerId,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const { data: deliveries = [], isLoading: delLoading } = useQuery({
    queryKey: ['worker-route-deliveries', picklist?.id],
    queryFn: () => getRouteDeliveries(picklist!.id),
    enabled: !!picklist?.id,
  });

  const startMut = useMutation({
    mutationFn: () => startRoute(picklist!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      qc.invalidateQueries({ queryKey: ['worker-route-deliveries'] });
      toast.success('Route started!');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const endMut = useMutation({
    mutationFn: async () => {
      const validExpenses = expenseItems.filter((i) => parseFloat(i.amount) > 0);
      for (const exp of validExpenses) {
        await createExpense({
          category: exp.category,
          amount: parseFloat(exp.amount),
          date: new Date().toISOString().split('T')[0],
          description: exp.notes
            ? `${exp.notes} (Route: ${picklist?.route?.name || 'Assigned Route'})`
            : `Route expense for ${picklist?.route?.name || 'Assigned Route'}`,
          worker_id: workerId,
          worker_name: workerName,
          route_id: picklist?.route_id || picklist?.id || undefined,
          visible_to_worker: true,
        });
      }
      return endRoute(picklist!.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      qc.invalidateQueries({ queryKey: ['worker-recent-routes'] });
      qc.invalidateQueries({ queryKey: ['worker-expenses'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      const validExpenses = expenseItems.filter((i) => parseFloat(i.amount) > 0);
      const totalExp = validExpenses.reduce((sum, i) => sum + parseFloat(i.amount), 0);
      if (totalExp > 0) {
        toast.success(`Route ended! ${validExpenses.length} expense(s) totaling ${formatCurrency(totalExp)} recorded.`);
      } else {
        toast.success('Route completed!');
      }
      setShowEndConfirm(false);
      navigate('/w');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleEndRouteWithExpense = () => {
    endMut.mutate();
  };

  if (plLoading || delLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!picklist) {
    return (
      <div className="p-4 flex flex-col items-center justify-center h-64 text-center">
        <Package className="h-10 w-10 text-surface-300 dark:text-surface-600 mb-3" />
        <h2 className="text-sm font-semibold text-surface-900 dark:text-white">No Active Route</h2>
        <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">No route has been assigned to you yet.</p>
      </div>
    );
  }

  const completed = deliveries.filter(d => d.status === 'delivered' || d.status === 'partial').length;
  const total = deliveries.length;
  const isStarted = picklist.status === 'in_progress';
  const allDone = completed === total && total > 0;

  // Elapsed time
  let elapsed = '';
  if (picklist.started_at) {
    const diff = Date.now() - new Date(picklist.started_at).getTime();
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    elapsed = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  const getStatusIcon = (d: Delivery) => {
    if (d.status === 'delivered') return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
    if (d.status === 'partial') return <AlertCircle className="h-5 w-5 text-amber-500" />;
    if (d.status === 'out_for_delivery') return <ChevronRight className="h-5 w-5 text-blue-500" />;
    return <Clock className="h-5 w-5 text-surface-400" />;
  };

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      {/* Route header */}
      <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-500" />
            <h1 className="text-sm font-semibold text-surface-900 dark:text-white">{picklist.route?.name || picklist.picklist_number}</h1>
          </div>
          {elapsed && (
            <span className="text-xs text-surface-500 dark:text-surface-400 flex items-center gap-1">
              <Clock className="h-3 w-3" /> {elapsed}
            </span>
          )}
        </div>

        {/* Progress */}
        <div className="flex items-center justify-between text-xs text-surface-500 dark:text-surface-400 mb-1.5">
          <span>{completed} of {total} parties completed</span>
          <span>{total > 0 ? Math.round((completed / total) * 100) : 0}%</span>
        </div>
        <div className="h-2 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
          />
        </div>

        {/* Start / End button */}
        {!isStarted ? (
          <button
            onClick={() => startMut.mutate()}
            disabled={startMut.isPending}
            className="w-full mt-4 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 transition-colors"
          >
            {startMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Start Route
          </button>
        ) : allDone ? (
          <button
            onClick={() => setShowEndConfirm(true)}
            disabled={endMut.isPending}
            className="w-full mt-4 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition-colors"
          >
            {endMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            End Route
          </button>
        ) : (
          <div className="mt-4 flex gap-2">
            <div className="flex-1 py-2.5 rounded-xl text-center text-xs font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              Route in progress — {total - completed} parties remaining
            </div>
            <button
              onClick={() => setShowEndConfirm(true)}
              className="px-3 py-2.5 rounded-xl text-xs font-medium text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700"
            >
              End
            </button>
          </div>
        )}
      </div>

      {/* End route modal with expense logging */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-surface-200 dark:border-surface-700 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-surface-900 dark:text-white">End Route & Save Expenses</h3>
                  <p className="text-xs text-surface-500 dark:text-surface-400">{picklist.route?.name || 'Current Route'}</p>
                </div>
              </div>
              <button
                onClick={() => setShowEndConfirm(false)}
                className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 text-sm font-bold p-1"
              >
                ✕
              </button>
            </div>

            {!allDone && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                ⚠️ {total - completed} out of {total} parties are still pending.
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleEndRouteWithExpense();
              }}
              className="space-y-3 max-h-[60vh] overflow-y-auto pr-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-surface-700 dark:text-surface-300">
                  Route Expenses (Fuel, Tea/Food, Rent, Fare)
                </span>
                <button
                  type="button"
                  onClick={addExpenseRow}
                  className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  + Add Expense Item
                </button>
              </div>

              {expenseItems.map((item, idx) => (
                <div key={item.id} className="p-3 rounded-xl bg-surface-50 dark:bg-surface-900/60 border border-surface-200 dark:border-surface-700 space-y-2 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-surface-500">Expense #{idx + 1}</span>
                    {expenseItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeExpenseRow(item.id)}
                        className="text-[10px] text-red-500 hover:underline font-semibold"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-surface-500 dark:text-surface-400 mb-0.5">Category</label>
                      <select
                        value={item.category}
                        onChange={(e) => updateExpenseRow(item.id, 'category', e.target.value)}
                        className="w-full h-8 px-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-xs font-medium text-surface-900 dark:text-white outline-none"
                      >
                        <option value="Tea & Refreshment">Tea & Refreshment</option>
                        <option value="Fuel & Vehicle">Fuel & Vehicle</option>
                        <option value="Rent / Travel">Rent / Travel</option>
                        <option value="Auto / Bus Fare">Auto / Bus Fare</option>
                        <option value="Vehicle Repair">Vehicle Repair</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-surface-500 dark:text-surface-400 mb-0.5">Amount (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={item.amount}
                        onChange={(e) => updateExpenseRow(item.id, 'amount', e.target.value)}
                        className="w-full h-8 px-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-xs font-bold text-surface-900 dark:text-white outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <input
                      type="text"
                      placeholder="Notes / Description (e.g. Tea for 2 people)"
                      value={item.notes}
                      onChange={(e) => updateExpenseRow(item.id, 'notes', e.target.value)}
                      className="w-full h-7 px-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-[11px] text-surface-900 dark:text-white outline-none"
                    />
                  </div>
                </div>
              ))}

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="submit"
                  disabled={endMut.isPending}
                  className="w-full py-2.5 rounded-xl font-semibold text-xs text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {endMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {expenseItems.some((i) => parseFloat(i.amount) > 0)
                    ? `End Route & Save ${expenseItems.filter((i) => parseFloat(i.amount) > 0).length} Expense(s)`
                    : 'End Route (No Expenses)'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEndConfirm(false)}
                  className="w-full py-2 rounded-xl text-xs font-semibold text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Party list */}
      {isStarted && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide">
            Delivery Parties
          </h2>
          {deliveries.map((d, idx) => {
            const isDone = d.status === 'delivered' || d.status === 'partial';
            const canOpen = isStarted && !isDone;

            return (
              <button
                key={d.id}
                onClick={() => canOpen && navigate(`/w/route/deliver/${d.id}`)}
                disabled={!canOpen && !isDone}
                className={`w-full text-left bg-white dark:bg-surface-800 border rounded-xl p-3.5 flex items-center gap-3 transition-colors ${
                  isDone
                    ? 'border-emerald-200 dark:border-emerald-800/50 opacity-80'
                    : canOpen
                      ? 'border-surface-200 dark:border-surface-700 hover:border-blue-300 dark:hover:border-blue-700 active:bg-surface-50 dark:active:bg-surface-700'
                      : 'border-surface-200 dark:border-surface-700 opacity-60'
                }`}
              >
                <div className="text-xs font-bold text-surface-400 w-5 text-center">{idx + 1}</div>
                {getStatusIcon(d)}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium truncate ${isDone ? 'text-surface-500 dark:text-surface-400 line-through' : 'text-surface-900 dark:text-white'}`}>
                    {d.party?.name || 'Unknown Party'}
                  </div>
                  <div className="text-[10px] text-surface-500 dark:text-surface-400 mt-0.5">
                    {d.party?.code} • {formatCurrency(d.total_amount)}
                    {isDone && d.payment_mode && ` • ${d.payment_mode}`}
                  </div>
                </div>
                {isDone ? (
                  <div className="text-right">
                    <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(d.collected_amount)}</div>
                  </div>
                ) : canOpen ? (
                  <ChevronRight className="h-4 w-4 text-surface-400" />
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
