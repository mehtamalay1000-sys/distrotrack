import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/app/AuthProvider';
import { toast } from 'sonner';
import {
  Plus, Receipt, Calendar, Coffee, Car, Truck,
  Wrench, Loader2, Eye, CheckCircle2, Clock, XCircle,
  RotateCcw
} from 'lucide-react';
import { getWorkerExpenses, createExpense } from '@/features/expenses/services/expenseService';
import { formatCurrency, formatDate, getLocalDateString } from '@/shared/utils/format';
import type { ExpensePaymentMethod } from '@/lib/database.types';
import { QK } from '@/lib/queryKeys';

const WORKER_CATEGORIES = [
  { value: 'fuel', label: 'Fuel & Diesel' },
  { value: 'toll', label: 'Toll Charges' },
  { value: 'parking', label: 'Parking Fees' },
  { value: 'loading_unloading', label: 'Loading / Hamali' },
  { value: 'vehicle_maintenance', label: 'Vehicle Repair' },
  { value: 'food', label: 'Tea & Refreshment' },
  { value: 'lodging', label: 'Stay / Lodging' },
  { value: 'delivery_misc', label: 'Delivery Misc' },
  { value: 'other', label: 'Other' },
];

export function WorkerExpensesPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const workerId = profile?.worker_id || profile?.id || '';
  const workerName = profile?.full_name || '';

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    category: WORKER_CATEGORIES[0].value,
    amount: '',
    payment_method: 'cash' as ExpensePaymentMethod,
    date: getLocalDateString(),
    description: '',
  });

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['worker-expenses', workerId, workerName],
    queryFn: () => getWorkerExpenses(workerId, workerName),
    enabled: !!workerId,
  });

  const createMut = useMutation({
    mutationFn: async (input: any) => {
      return await createExpense(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worker-expenses'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.expenses });
      toast.success('Expense submitted for admin review');
      setModalOpen(false);
      setForm({
        category: WORKER_CATEGORIES[0].value,
        amount: '',
        payment_method: 'cash',
        date: getLocalDateString(),
        description: '',
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(form.amount);
    if (!numAmount || numAmount <= 0) {
      toast.error('Please enter a valid expense amount');
      return;
    }

    createMut.mutate({
      category: form.category,
      amount: numAmount,
      payment_method: form.payment_method,
      date: form.date,
      description: form.description || undefined,
      worker_id: workerId,
      worker_name: workerName,
      visible_to_worker: true,
    });
  };

  const todayStr = getLocalDateString();
  const myExpenses = expenses.filter(
    (e) => e.worker_id === workerId || (e.worker_name && e.worker_name.toLowerCase().includes(workerName.toLowerCase()))
  );

  const totalMyApproved = myExpenses
    .filter((e) => e.status === 'approved')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const totalMyPending = myExpenses
    .filter((e) => e.status === 'pending')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const todayMyExpenses = myExpenses
    .filter((e) => e.date === todayStr && e.status === 'approved')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const getCategoryIcon = (cat: string) => {
    if (cat.includes('food') || cat.includes('tea') || cat.includes('Refreshment')) return Coffee;
    if (cat.includes('toll') || cat.includes('travel') || cat.includes('parking')) return Car;
    if (cat.includes('fuel')) return Truck;
    if (cat.includes('repair') || cat.includes('maintenance')) return Wrench;
    return Receipt;
  };

  const getCategoryLabel = (val: string) => {
    const found = WORKER_CATEGORIES.find((c) => c.value === val);
    return found ? found.label : val;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-white">Route Expenses</h1>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
            Log fuel, tolls, refreshments & delivery expenses for approval
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs shadow-sm transition-all cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Log Expense
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="bg-white dark:bg-surface-800 border border-surface-200/80 dark:border-surface-700 rounded-2xl p-3 shadow-xs">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-[10px] font-bold text-surface-500 dark:text-surface-400 uppercase">Approved</span>
          </div>
          <div className="text-base font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalMyApproved)}</div>
          <div className="text-[9px] text-surface-400 mt-0.5">Settled route costs</div>
        </div>

        <div className="bg-white dark:bg-surface-800 border border-surface-200/80 dark:border-surface-700 rounded-2xl p-3 shadow-xs">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-[10px] font-bold text-surface-500 dark:text-surface-400 uppercase">Pending</span>
          </div>
          <div className="text-base font-bold text-amber-600 dark:text-amber-400">{formatCurrency(totalMyPending)}</div>
          <div className="text-[9px] text-surface-400 mt-0.5">In admin review</div>
        </div>

        <div className="bg-white dark:bg-surface-800 border border-surface-200/80 dark:border-surface-700 rounded-2xl p-3 shadow-xs">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-[10px] font-bold text-surface-500 dark:text-surface-400 uppercase">Today</span>
          </div>
          <div className="text-base font-bold text-surface-900 dark:text-white">{formatCurrency(todayMyExpenses)}</div>
          <div className="text-[9px] text-surface-400 mt-0.5">Approved today</div>
        </div>
      </div>

      {/* Expense List */}
      <div className="space-y-2.5">
        <h2 className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide">
          Expense History ({myExpenses.length})
        </h2>

        {myExpenses.length === 0 ? (
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-6 text-center shadow-xs">
            <Receipt className="h-8 w-8 text-surface-300 dark:text-surface-600 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">No Expenses Logged</h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
              Click 'Log Expense' above to add fuel, tolls, or refreshment expenses.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {myExpenses.map((exp) => {
              const IconComp = getCategoryIcon(exp.category);
              const isMine = exp.worker_id === workerId || (exp.worker_name && exp.worker_name.toLowerCase().includes(workerName.toLowerCase()));

              return (
                <div
                  key={exp.id}
                  className="bg-white dark:bg-surface-800 border border-surface-200/80 dark:border-surface-700 rounded-2xl p-3.5 flex items-center gap-3 shadow-xs"
                >
                  <div className="h-9 w-9 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-100 dark:border-blue-800/40 flex-shrink-0">
                    <IconComp className="h-4.5 w-4.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-surface-900 dark:text-white truncate">
                        {getCategoryLabel(exp.category)}
                      </span>
                      {!isMine && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                          <Eye className="h-2.5 w-2.5" /> Notice
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-surface-500 dark:text-surface-400 mt-0.5 truncate">
                      {exp.description || 'Route operational expense'}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-surface-400 mt-1">
                      <span>{formatDate(exp.date)}</span>
                      <span>•</span>
                      <span className="uppercase font-semibold text-[9px]">
                        {exp.payment_method === 'cash' ? '💵 Cash' : '💳 UPI'}
                      </span>
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-black text-surface-900 dark:text-white">
                      {formatCurrency(exp.amount)}
                    </div>
                    <div className="mt-1">
                      {exp.status === 'approved' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Approved
                        </span>
                      )}
                      {exp.status === 'pending' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                          <Clock className="h-2.5 w-2.5" /> In Review
                        </span>
                      )}
                      {exp.status === 'rejected' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 rounded-full border border-rose-200 dark:border-rose-800" title={exp.rejection_reason || ''}>
                          <XCircle className="h-2.5 w-2.5" /> Rejected
                        </span>
                      )}
                      {exp.status === 'reversed' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border border-slate-300 dark:border-slate-600">
                          <RotateCcw className="h-2.5 w-2.5" /> Reversed
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Log Expense Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-surface-200 dark:border-surface-700 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                  <Receipt className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-bold text-surface-900 dark:text-white">Log Route Expense</h3>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 text-sm font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-surface-700 dark:text-surface-300 mb-1">
                  Expense Category
                </label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-medium text-surface-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {WORKER_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-surface-700 dark:text-surface-300 mb-1">
                    Amount (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 150"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    required
                    className="w-full h-10 px-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-medium text-surface-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-surface-700 dark:text-surface-300 mb-1">
                    Payment Method
                  </label>
                  <select
                    value={form.payment_method}
                    onChange={(e) => setForm({ ...form, payment_method: e.target.value as ExpensePaymentMethod })}
                    className="w-full h-10 px-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-medium text-surface-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="cash">💵 Cash (In-Hand)</option>
                    <option value="upi">💳 UPI / QR Code</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-surface-700 dark:text-surface-300 mb-1">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                  className="w-full h-10 px-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-medium text-surface-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-surface-700 dark:text-surface-300 mb-1">Description / Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Toll tax at Ghoti plaza or fuel receipt"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-medium text-surface-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 text-[11px] text-blue-700 dark:text-blue-300">
                ℹ️ Expenses submitted by salesmen will be verified by the admin before affecting final route cash settlement.
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-surface-300 dark:border-surface-600 text-xs font-semibold text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMut.isPending}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
                >
                  {createMut.isPending ? 'Submitting...' : 'Submit Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
