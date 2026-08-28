import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/app/AuthProvider';
import { toast } from 'sonner';
import { Plus, Receipt, Trash2, Calendar, Coffee, Car, Truck, Wrench, Loader2, Eye } from 'lucide-react';
import { getWorkerExpenses, createExpense, deleteExpense } from '@/features/expenses/services/expenseService';
import { formatCurrency, formatDate, getLocalDateString } from '@/shared/utils/format';

const WORKER_CATEGORIES = [
  'Tea & Refreshment',
  'Rent / Travel',
  'Fuel & Vehicle',
  'Auto / Bus Fare',
  'Vehicle Repair',
  'Other',
];

export function WorkerExpensesPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const workerId = profile?.id || '';
  const workerName = profile?.full_name || '';

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    category: WORKER_CATEGORIES[0],
    amount: '',
    date: getLocalDateString(),
    description: '',
  });

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['worker-expenses', workerId, workerName],
    queryFn: () => getWorkerExpenses(workerId, workerName),
    enabled: !!workerId,
  });

  const createMut = useMutation({
    mutationFn: createExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worker-expenses'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Expense recorded successfully');
      setModalOpen(false);
      setForm({
        category: WORKER_CATEGORIES[0],
        amount: '',
        date: getLocalDateString(),
        description: '',
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worker-expenses'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Expense deleted');
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
      date: form.date,
      description: form.description || undefined,
      worker_id: workerId,
      worker_name: workerName,
      visible_to_worker: true,
    });
  };

  const todayStr = getLocalDateString();
  const myExpenses = expenses.filter((e) => e.worker_id === workerId || (e.worker_name && e.worker_name.toLowerCase().includes(workerName.toLowerCase())));
  const totalMyExpenses = myExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const todayMyExpenses = myExpenses.filter((e) => e.date === todayStr).reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const getCategoryIcon = (cat: string) => {
    if (cat.includes('Tea') || cat.includes('Refreshment')) return Coffee;
    if (cat.includes('Rent') || cat.includes('Travel') || cat.includes('Bus')) return Car;
    if (cat.includes('Fuel') || cat.includes('Vehicle')) return Truck;
    if (cat.includes('Repair')) return Wrench;
    return Receipt;
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
            Record fuel, tea, food & rent expenses for your routes
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs shadow-sm transition-all"
        >
          <Plus className="h-4 w-4" />
          Log Expense
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-surface-800 border border-surface-200/80 dark:border-surface-700 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="h-7 w-7 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-100 dark:border-blue-800/40">
              <Receipt className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">Total Logged</span>
          </div>
          <div className="text-lg font-bold text-surface-900 dark:text-white">{formatCurrency(totalMyExpenses)}</div>
          <div className="text-[10px] text-surface-400 mt-0.5">Your submitted expenses</div>
        </div>

        <div className="bg-white dark:bg-surface-800 border border-surface-200/80 dark:border-surface-700 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="h-7 w-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-100 dark:border-emerald-800/40">
              <Calendar className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">Today's Expenses</span>
          </div>
          <div className="text-lg font-bold text-surface-900 dark:text-white">{formatCurrency(todayMyExpenses)}</div>
          <div className="text-[10px] text-surface-400 mt-0.5">Logged today</div>
        </div>
      </div>

      {/* Expense List */}
      <div className="space-y-2.5">
        <h2 className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide">Expense History</h2>

        {expenses.length === 0 ? (
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-6 text-center shadow-sm">
            <Receipt className="h-8 w-8 text-surface-300 dark:text-surface-600 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">No Expenses Logged</h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
              Click 'Log Expense' above to add rent, tea, food, or fuel expenses.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {expenses.map((exp) => {
              const IconComp = getCategoryIcon(exp.category);
              const isMine = exp.worker_id === workerId || (exp.worker_name && exp.worker_name.toLowerCase().includes(workerName.toLowerCase()));

              return (
                <div
                  key={exp.id}
                  className="bg-white dark:bg-surface-800 border border-surface-200/80 dark:border-surface-700 rounded-2xl p-3.5 flex items-center gap-3 shadow-sm"
                >
                  <div className="h-9 w-9 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-100 dark:border-blue-800/40">
                    <IconComp className="h-4.5 w-4.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-surface-900 dark:text-white truncate">{exp.category}</span>
                      {!isMine && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                          <Eye className="h-2.5 w-2.5" /> Admin Notice
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-surface-500 dark:text-surface-400 mt-0.5">
                      {exp.description || 'Route expense'}
                    </div>
                    <div className="text-[10px] text-surface-400 mt-0.5">
                      {formatDate(exp.date)}
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <div>
                      <div className="text-sm font-extrabold text-danger-600 dark:text-danger-400">{formatCurrency(exp.amount)}</div>
                      <div className="text-[9px] text-surface-400">{isMine ? 'Submitted' : 'Recorded'}</div>
                    </div>
                    {isMine && (
                      <button
                        onClick={() => deleteMut.mutate(exp.id)}
                        className="p-1.5 rounded-lg text-surface-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                        title="Delete expense"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
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
                className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 text-sm font-bold p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-surface-700 dark:text-surface-300 mb-1">Expense Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-medium text-surface-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {WORKER_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-surface-700 dark:text-surface-300 mb-1">Amount (₹)</label>
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
                  placeholder="e.g. Tea & snacks for 2 people on Sangamner route"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-medium text-surface-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-surface-300 dark:border-surface-600 text-xs font-semibold text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMut.isPending}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white shadow-sm transition-colors"
                >
                  {createMut.isPending ? 'Saving...' : 'Submit Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
