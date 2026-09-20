import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Receipt, User, CheckCircle2,
  XCircle, RotateCcw, AlertTriangle, Truck, Banknote,
  CreditCard, Check, X
} from 'lucide-react';
import { PageHeader, Button, Input, Select, Modal, EmptyState, LoadingState, ErrorState } from '@/shared/ui';
import {
  getExpenses, createExpense, approveExpense, rejectExpense, reverseExpense
} from '../services/expenseService';
import { getWorkers } from '@/features/workers/services/workerService';
import { getRoutes } from '@/features/routes/services/routeService';
import { formatCurrency, formatDate, getLocalDateString } from '@/shared/utils/format';
import { QK } from '@/lib/queryKeys';
import type { Expense, ExpenseStatus, ExpensePaymentMethod } from '@/lib/database.types';

export const EXPENSE_CATEGORIES = [
  { value: 'fuel', label: 'Fuel & Diesel' },
  { value: 'toll', label: 'Toll Plaza Charges' },
  { value: 'parking', label: 'Parking Fees' },
  { value: 'loading_unloading', label: 'Loading / Unloading (Hamali)' },
  { value: 'vehicle_maintenance', label: 'Vehicle Repair & Maintenance' },
  { value: 'food', label: 'Tea, Food & Refreshment' },
  { value: 'lodging', label: 'Night Stay / Lodging Allowance' },
  { value: 'delivery_misc', label: 'Delivery Misc / Packaging' },
  { value: 'other', label: 'Other Operational Expense' },
];

export function ExpensesPage() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | ExpenseStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');

  // Reject / Reverse modal states
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [reverseModalOpen, setReverseModalOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [actionReason, setActionReason] = useState('');

  const [form, setForm] = useState({
    category: EXPENSE_CATEGORIES[0].value,
    amount: '',
    payment_method: 'cash' as ExpensePaymentMethod,
    date: getLocalDateString(),
    description: '',
    route_id: '',
    worker_id: '',
    visible_to_worker: true,
  });

  const { data: expenses = [], isLoading, error } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => getExpenses(),
  });
  const { data: workers = [] } = useQuery({ queryKey: ['workers'], queryFn: getWorkers });
  const { data: routes = [] } = useQuery({ queryKey: ['routes'], queryFn: getRoutes });

  const createMut = useMutation({
    mutationFn: createExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.expenses });
      qc.invalidateQueries({ queryKey: QK.dashboardStats });
      qc.invalidateQueries({ queryKey: ['route-profitability'] });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterKpisAny });
      qc.invalidateQueries({ queryKey: QK.masterExceptionsAny });
      toast.success('Expense recorded successfully');
      closeModal();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => approveExpense(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.expenses });
      qc.invalidateQueries({ queryKey: QK.dashboardStats });
      qc.invalidateQueries({ queryKey: ['route-profitability'] });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterKpisAny });
      qc.invalidateQueries({ queryKey: QK.masterExceptionsAny });
      toast.success('Expense approved and incorporated into route totals');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectExpense(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.expenses });
      qc.invalidateQueries({ queryKey: QK.dashboardStats });
      qc.invalidateQueries({ queryKey: ['route-profitability'] });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterExceptionsAny });
      toast.success('Expense rejected');
      closeRejectModal();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reverseMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => reverseExpense(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.expenses });
      qc.invalidateQueries({ queryKey: QK.dashboardStats });
      qc.invalidateQueries({ queryKey: ['route-profitability'] });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterKpisAny });
      qc.invalidateQueries({ queryKey: QK.masterExceptionsAny });
      toast.success('Approved expense reversed successfully');
      closeReverseModal();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openCreate() {
    setForm({
      category: EXPENSE_CATEGORIES[0].value,
      amount: '',
      payment_method: 'cash',
      date: getLocalDateString(),
      description: '',
      route_id: '',
      worker_id: '',
      visible_to_worker: true,
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function openRejectModal(expense: Expense) {
    setSelectedExpense(expense);
    setActionReason('');
    setRejectModalOpen(true);
  }

  function closeRejectModal() {
    setSelectedExpense(null);
    setActionReason('');
    setRejectModalOpen(false);
  }

  function openReverseModal(expense: Expense) {
    setSelectedExpense(expense);
    setActionReason('');
    setReverseModalOpen(true);
  }

  function closeReverseModal() {
    setSelectedExpense(null);
    setActionReason('');
    setReverseModalOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = parseFloat(form.amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error('Amount must be greater than zero');
      return;
    }
    const selectedWorker = workers.find((w) => w.id === form.worker_id);
    createMut.mutate({
      category: form.category,
      amount: parsedAmount,
      payment_method: form.payment_method,
      date: form.date,
      description: form.description || undefined,
      route_id: form.route_id || undefined,
      worker_id: form.worker_id || undefined,
      worker_name: selectedWorker ? selectedWorker.name : undefined,
      visible_to_worker: form.visible_to_worker,
    });
  }

  // ── Filtered Expenses & Calculations ──────────────────────────────
  const filteredExpenses = expenses.filter((e) => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
    if (methodFilter !== 'all' && e.payment_method !== methodFilter) return false;
    return true;
  });

  const approvedExpenses = expenses.filter((e) => e.status === 'approved');
  const totalApproved = approvedExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalApprovedCash = approvedExpenses
    .filter((e) => e.payment_method === 'cash')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalApprovedNonCash = approvedExpenses
    .filter((e) => e.payment_method !== 'cash')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const pendingExpenses = expenses.filter((e) => e.status === 'pending');
  const totalPending = pendingExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;

  const getStatusBadge = (status: ExpenseStatus) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="h-3 w-3" /> Approved
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-3 w-3" /> Pending Review
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <XCircle className="h-3 w-3" /> Rejected
          </span>
        );
      case 'reversed':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600">
            <RotateCcw className="h-3 w-3" /> Reversed
          </span>
        );
      default:
        return null;
    }
  };

  const getPaymentMethodBadge = (method: ExpensePaymentMethod) => {
    switch (method) {
      case 'cash':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-green-50 dark:bg-green-950/60 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
            <Banknote className="h-2.5 w-2.5" /> Cash (Route Impact)
          </span>
        );
      case 'upi':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <CreditCard className="h-2.5 w-2.5" /> UPI / Online
          </span>
        );
      case 'bank':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
            Bank Transfer
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300 border border-surface-200 dark:border-surface-600">
            {method || 'Other'}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operating Expenses"
        description="Authoritative expense tracking, multi-tier approval workflow, and route cost allocation"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
            Record Expense
          </Button>
        }
      />

      {/* ── KPI Summary Cards ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Approved Expenses */}
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide">
              Approved Expenses
            </span>
            <div className="h-8 w-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-100 dark:border-emerald-800/40">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-surface-900 dark:text-surface-100">
            {formatCurrency(totalApproved)}
          </div>
          <div className="text-[11px] text-surface-400 mt-0.5">
            Deducted from Route Contribution
          </div>
        </div>

        {/* Approved Cash Expenses */}
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide">
              Approved Cash Expenses
            </span>
            <div className="h-8 w-8 rounded-xl bg-green-50 dark:bg-green-950/50 text-green-600 dark:text-green-400 flex items-center justify-center border border-green-100 dark:border-green-800/40">
              <Banknote className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(totalApprovedCash)}
          </div>
          <div className="text-[11px] text-surface-400 mt-0.5">
            Reduces driver cash handover
          </div>
        </div>

        {/* Approved Non-Cash Expenses */}
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide">
              Approved Non-Cash (UPI/Bank)
            </span>
            <div className="h-8 w-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-100 dark:border-blue-800/40">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {formatCurrency(totalApprovedNonCash)}
          </div>
          <div className="text-[11px] text-surface-400 mt-0.5">
            Does NOT reduce physical cash
          </div>
        </div>

        {/* Pending Review Expenses */}
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide">
              Pending Review
            </span>
            <div className="h-8 w-8 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-100 dark:border-amber-800/40">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {formatCurrency(totalPending)}
          </div>
          <div className="text-[11px] text-surface-400 mt-0.5">
            {pendingExpenses.length} awaiting admin decision
          </div>
        </div>
      </div>

      {/* ── Filters Bar ─────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* Status Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(['all', 'pending', 'approved', 'rejected', 'reversed'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all capitalize cursor-pointer ${
                statusFilter === st
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700'
              }`}
            >
              {st}
              {st === 'pending' && pendingExpenses.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-900 text-[10px] font-black">
                  {pendingExpenses.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Category & Payment Method dropdowns */}
        <div className="flex items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-8 px-2.5 text-xs font-medium border border-surface-300 dark:border-surface-600 rounded-lg bg-surface-50 dark:bg-surface-900 text-surface-800 dark:text-surface-200 outline-none"
          >
            <option value="all">All Categories</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>

          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="h-8 px-2.5 text-xs font-medium border border-surface-300 dark:border-surface-600 rounded-lg bg-surface-50 dark:bg-surface-900 text-surface-800 dark:text-surface-200 outline-none"
          >
            <option value="all">All Payment Methods</option>
            <option value="cash">Cash Only</option>
            <option value="upi">UPI / Online</option>
            <option value="bank">Bank Transfer</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* ── Table View ───────────────────────────────────────────────── */}
      {filteredExpenses.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-10 w-10" />}
          title="No expenses found"
          description="No expenses match the current filter selection"
          action={
            <Button size="sm" onClick={openCreate}>
              Record Expense
            </Button>
          }
        />
      ) : (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="dt-table w-full">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Route / Trip</th>
                  <th>Description / Notes</th>
                  <th>Recorded By</th>
                  <th>Payment Method</th>
                  <th>Status</th>
                  <th className="text-right">Amount</th>
                  <th className="text-center w-36">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map((e) => {
                  const workerDisplayName = e.worker?.name || e.worker_name || 'Admin';
                  const isWorkerSubmitted = !!(e.worker_id || e.worker_name);
                  const catObj = EXPENSE_CATEGORIES.find((c) => c.value === e.category);
                  const catLabel = catObj ? catObj.label : e.category;

                  return (
                    <tr key={e.id} className="hover:bg-surface-50/70 dark:hover:bg-surface-700/50">
                      <td className="text-xs font-semibold text-surface-700 dark:text-surface-300 whitespace-nowrap">
                        {formatDate(e.date)}
                      </td>
                      <td>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-200">
                          {catLabel}
                        </span>
                      </td>
                      <td>
                        {e.route ? (
                          <div className="flex items-center gap-1 text-xs font-medium text-surface-800 dark:text-surface-200">
                            <Truck className="h-3.5 w-3.5 text-primary-500" />
                            <span className="font-mono text-primary-600 dark:text-primary-400 font-bold">{e.route.code}</span>
                            <span className="truncate max-w-[120px]">{e.route.name}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-surface-400">—</span>
                        )}
                      </td>
                      <td className="text-xs text-surface-600 dark:text-surface-400 max-w-xs truncate">
                        {e.description || '—'}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-surface-900 dark:text-white">
                          <User className="h-3.5 w-3.5 text-surface-400" />
                          <span>{workerDisplayName}</span>
                          {isWorkerSubmitted && (
                            <span className="text-[9px] bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 px-1.5 py-0.2 rounded font-semibold border border-blue-200 dark:border-blue-800">
                              Salesman
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        {getPaymentMethodBadge(e.payment_method)}
                      </td>
                      <td>
                        <div className="space-y-0.5">
                          {getStatusBadge(e.status)}
                          {e.status === 'rejected' && e.rejection_reason && (
                            <div className="text-[10px] text-rose-500 max-w-xs truncate" title={e.rejection_reason}>
                              Reason: {e.rejection_reason}
                            </div>
                          )}
                          {e.status === 'reversed' && e.reversal_reason && (
                            <div className="text-[10px] text-slate-500 max-w-xs truncate" title={e.reversal_reason}>
                              Reversed: {e.reversal_reason}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="text-right font-black text-rose-600 dark:text-rose-400 whitespace-nowrap">
                        {formatCurrency(e.amount)}
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {e.status === 'pending' && (
                            <>
                              <button
                                onClick={() => approveMut.mutate(e.id)}
                                disabled={approveMut.isPending}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-2xs transition-colors cursor-pointer"
                                title="Approve expense"
                              >
                                <Check className="h-3 w-3" /> Approve
                              </button>
                              <button
                                onClick={() => openRejectModal(e)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 border border-rose-200 dark:border-rose-800 text-xs font-bold transition-colors cursor-pointer"
                                title="Reject expense"
                              >
                                <X className="h-3 w-3" /> Reject
                              </button>
                            </>
                          )}
                          {e.status === 'approved' && (
                            <button
                              onClick={() => openReverseModal(e)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 hover:text-surface-900 text-xs font-medium transition-colors cursor-pointer"
                              title="Reverse approved expense (creates auditable reversal)"
                            >
                              <RotateCcw className="h-3 w-3" /> Reverse
                            </button>
                          )}
                          {(e.status === 'rejected' || e.status === 'reversed') && (
                            <span className="text-[11px] text-surface-400 italic">Archived</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Record Expense Modal ─────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title="Record Operating Expense"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              loading={createMut.isPending}
              onClick={() => (document.getElementById('expense-form') as HTMLFormElement)?.requestSubmit()}
            >
              Record Expense
            </Button>
          </>
        }
      >
        <form id="expense-form" onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-surface-700 dark:text-surface-300 mb-1">
              Expense Category
            </label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full h-10 px-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-medium text-surface-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Input
                label="Amount (₹)"
                type="number"
                step="0.01"
                placeholder="e.g. 500"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
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
                <option value="cash">Cash (Reduces driver cash handover)</option>
                <option value="upi">UPI / Online</option>
                <option value="bank">Bank Transfer</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <Input
            label="Date"
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            required
          />

          <div>
            <label className="block text-xs font-semibold text-surface-700 dark:text-surface-300 mb-1">
              Associate with Route (Optional)
            </label>
            <select
              value={form.route_id}
              onChange={(e) => setForm({ ...form, route_id: e.target.value })}
              className="w-full h-10 px-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-medium text-surface-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">-- General / Warehouse Overhead --</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} - {r.name}
                </option>
              ))}
            </select>
          </div>

          <Select
            label="Worker / Salesman (Optional)"
            value={form.worker_id}
            onChange={(e) => setForm({ ...form, worker_id: e.target.value })}
            placeholder="Select worker (optional)"
            options={workers.map((w) => ({ value: w.id, label: w.name }))}
          />

          <Input
            label="Description / Notes"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="e.g. Fuel for Van MH-12 or Toll tax receipt"
          />

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
          </div>
        </form>
      </Modal>

      {/* ── Rejection Reason Modal ───────────────────────────────────── */}
      {rejectModalOpen && selectedExpense && (
        <Modal
          open={rejectModalOpen}
          onClose={closeRejectModal}
          title="Reject Expense"
          footer={
            <>
              <Button variant="secondary" onClick={closeRejectModal}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={rejectMut.isPending}
                onClick={() => {
                  if (!actionReason.trim()) {
                    toast.error('Please enter a rejection reason');
                    return;
                  }
                  rejectMut.mutate({ id: selectedExpense.id, reason: actionReason.trim() });
                }}
              >
                Confirm Rejection
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-surface-600 dark:text-surface-300">
              Rejecting this expense of <strong className="text-rose-600">{formatCurrency(selectedExpense.amount)}</strong> will ensure it does NOT affect route profitability or cash reconciliation.
            </p>
            <Input
              label="Rejection Reason"
              placeholder="e.g. Ineligible bill, duplicate submission, missing receipt"
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              required
            />
          </div>
        </Modal>
      )}

      {/* ── Reversal Reason Modal ────────────────────────────────────── */}
      {reverseModalOpen && selectedExpense && (
        <Modal
          open={reverseModalOpen}
          onClose={closeReverseModal}
          title="Reverse Approved Expense"
          footer={
            <>
              <Button variant="secondary" onClick={closeReverseModal}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={reverseMut.isPending}
                onClick={() => {
                  if (!actionReason.trim()) {
                    toast.error('Please enter a reversal reason');
                    return;
                  }
                  reverseMut.mutate({ id: selectedExpense.id, reason: actionReason.trim() });
                }}
              >
                Confirm Reversal
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-surface-600 dark:text-surface-300">
              Reversing this approved expense of <strong className="text-rose-600">{formatCurrency(selectedExpense.amount)}</strong> will safely remove its financial effects from route profitability and cash reconciliation while preserving an auditable trail.
            </p>
            <Input
              label="Reversal Reason"
              placeholder="e.g. Wrong route assigned, erroneous amount entered"
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              required
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
