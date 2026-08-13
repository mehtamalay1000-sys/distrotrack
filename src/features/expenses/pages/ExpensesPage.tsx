import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Receipt, Trash2, Eye, EyeOff, User } from 'lucide-react';
import { PageHeader, Button, Input, Select, Modal, EmptyState, LoadingState, ErrorState } from '@/shared/ui';
import { getExpenses, createExpense, deleteExpense } from '../services/expenseService';
import { getWorkers } from '@/features/workers/services/workerService';
import { formatCurrency, formatDate } from '@/shared/utils/format';

const CATEGORIES = ['Fuel & Vehicle', 'Rent / Travel', 'Tea & Refreshment', 'Worker Allowance', 'Loading / Unloading', 'Office Supplies', 'Misc Repair', 'Other'];

export function ExpensesPage() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    category: CATEGORIES[0],
    amount: 0,
    date: new Date().toISOString().split('T')[0],
    description: '',
    worker_id: '',
    visible_to_worker: false,
  });

  const { data: expenses = [], isLoading, error } = useQuery({ queryKey: ['expenses'], queryFn: getExpenses });
  const { data: workers = [] } = useQuery({ queryKey: ['workers'], queryFn: getWorkers });

  const createMut = useMutation({
    mutationFn: createExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('Expense recorded');
      closeModal();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('Expense deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openCreate() {
    setForm({
      category: CATEGORIES[0],
      amount: 0,
      date: new Date().toISOString().split('T')[0],
      description: '',
      worker_id: '',
      visible_to_worker: false,
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const selectedWorker = workers.find((w) => w.id === form.worker_id);
    createMut.mutate({
      ...form,
      worker_id: form.worker_id || undefined,
      worker_name: selectedWorker ? selectedWorker.name : undefined,
    });
  }

  const totalExpense = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Track daily operational expenses, fuel, tea/food allowance, and salesman receipts"
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Record Expense</Button>}
      />

      <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-4 mb-6 flex justify-between items-center max-w-sm">
        <div>
          <span className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide">Total Expenses</span>
          <div className="text-2xl font-bold text-surface-900 dark:text-surface-100">{formatCurrency(totalExpense)}</div>
        </div>
        <Receipt className="h-8 w-8 text-surface-300 dark:text-surface-600" />
      </div>

      {expenses.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-10 w-10" />}
          title="No expenses recorded"
          description="Click 'Record Expense' to add fuel, allowances, or route expenses"
          action={<Button size="sm" onClick={openCreate}>Record Expense</Button>}
        />
      ) : (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden shadow-xs">
          <table className="dt-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th>Submitted By / Worker</th>
                <th>Salesman Portal Visibility</th>
                <th>Amount</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => {
                const workerDisplayName = e.worker?.name || e.worker_name || 'Admin';
                const isWorkerSubmitted = !!(e.worker_id || e.worker_name);

                return (
                  <tr key={e.id}>
                    <td className="text-xs font-medium text-surface-700 dark:text-surface-300">{formatDate(e.date)}</td>
                    <td>
                      <span className="text-xs font-medium bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300 px-2.5 py-0.5 rounded-full border border-surface-200 dark:border-surface-600">
                        {e.category}
                      </span>
                    </td>
                    <td className="text-sm text-surface-600 dark:text-surface-400">{e.description || '—'}</td>
                    <td>
                      <div className="flex items-center gap-1.5 text-xs font-medium text-surface-900 dark:text-white">
                        <User className="h-3.5 w-3.5 text-surface-400" />
                        <span>{workerDisplayName}</span>
                        {isWorkerSubmitted && (
                          <span className="text-[10px] bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-semibold border border-blue-200 dark:border-blue-800">
                            Salesman
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      {e.visible_to_worker ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                          <Eye className="h-3 w-3" /> Visible on Portal
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-surface-400 bg-surface-100 dark:bg-surface-900 px-2 py-0.5 rounded-full">
                          <EyeOff className="h-3 w-3" /> Admin Only
                        </span>
                      )}
                    </td>
                    <td className="font-bold text-danger-600 dark:text-danger-400">{formatCurrency(e.amount)}</td>
                    <td>
                      <button
                        onClick={() => deleteMut.mutate(e.id)}
                        className="p-1 rounded hover:bg-danger-50 dark:hover:bg-danger-950/40 text-surface-400 hover:text-danger-600 dark:hover:text-danger-500 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title="Record Expense"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button><Button loading={createMut.isPending} onClick={() => (document.getElementById('expense-form') as HTMLFormElement)?.requestSubmit()}>Record Expense</Button></>}>
        <form id="expense-form" onSubmit={handleSubmit} className="space-y-3">
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={CATEGORIES.map(c => ({ value: c, label: c }))} />
          <Input label="Amount (₹)" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} required />
          <Input label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          <Input label="Description / Notes" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Fuel for Van MH-12 or Tea & Refreshment" />
          <Select label="Worker / Salesman (Optional)" value={form.worker_id} onChange={(e) => setForm({ ...form, worker_id: e.target.value })} placeholder="Select worker" options={workers.map(w => ({ value: w.id, label: w.name }))} />
          
          <div className="pt-2 border-t border-surface-200 dark:border-surface-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.visible_to_worker}
                onChange={(e) => setForm({ ...form, visible_to_worker: e.target.checked })}
                className="h-4 w-4 rounded border-surface-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs font-semibold text-surface-900 dark:text-white">
                Show this expense on Salesman Portal
              </span>
            </label>
            <p className="text-[11px] text-surface-500 dark:text-surface-400 ml-6 mt-0.5">
              When checked, salesmen can see this expense in their worker portal dashboard.
            </p>
          </div>
        </form>
      </Modal>
    </div>
  );
}
