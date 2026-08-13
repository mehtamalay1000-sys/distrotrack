import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Search, Phone, Mail, Edit2, Trash2, Target,
  User, MoreVertical, CheckCircle2, XCircle, IndianRupee,
  TrendingUp, Calendar, ChevronRight, X, Loader2,
} from 'lucide-react';
import { getWorkers, createWorker, updateWorker, deleteWorker } from '../services/workerService';
import { formatCurrency } from '@/shared/utils/format';
import type { Worker } from '@/lib/database.types';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function WorkersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  // Add/Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Worker | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '', monthly_target: '50000' });

  // Target modal
  const [targetWorker, setTargetWorker] = useState<Worker | null>(null);
  const [targetAmount, setTargetAmount] = useState('');
  const [targetMonth, setTargetMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const { data: workers = [], isLoading, error } = useQuery({
    queryKey: ['workers'],
    queryFn: getWorkers,
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) =>
      createWorker({ ...data, monthly_target: Number(data.monthly_target || 50000) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      toast.success('Salesman added successfully');
      closeModal();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Worker> }) => updateWorker(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      toast.success('Updated successfully');
      closeModal();
      setTargetWorker(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWorker,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      toast.success('Salesman removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = workers.filter(
    (w) =>
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      (w.phone ?? '').includes(search),
  );

  function openCreate() {
    setEditing(null);
    setForm({ name: '', phone: '', email: '', notes: '', monthly_target: '50000' });
    setModalOpen(true);
  }

  function openEdit(worker: Worker) {
    setEditing(worker);
    setForm({
      name: worker.name,
      phone: worker.phone ?? '',
      email: worker.email ?? '',
      notes: worker.notes ?? '',
      monthly_target: String(worker.monthly_target ?? 50000),
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
  }

  function openSetTarget(worker: Worker) {
    setTargetWorker(worker);
    setTargetAmount(String(worker.monthly_target ?? 50000));
    const now = new Date();
    setTargetMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name,
      phone: form.phone || null,
      email: form.email || null,
      notes: form.notes || null,
      monthly_target: Number(form.monthly_target || 50000),
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload });
    } else {
      createMutation.mutate(form);
    }
  }

  function handleSetTarget(e: React.FormEvent) {
    e.preventDefault();
    if (!targetWorker) return;
    updateMutation.mutate({
      id: targetWorker.id,
      data: { monthly_target: Number(targetAmount || 50000) },
    });
  }

  function toggleStatus(worker: Worker) {
    updateMutation.mutate({
      id: worker.id,
      data: { status: worker.status === 'active' ? 'inactive' : 'active' },
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6 text-center text-danger-600 dark:text-danger-400">
        Error: {(error as Error).message}
      </div>
    );
  }

  const activeCount = workers.filter((w) => w.status === 'active').length;
  const totalTarget = workers.reduce((s, w) => s + (w.monthly_target ?? 0), 0);

  const [year, month] = targetMonth.split('-');
  const selectedMonthLabel = `${MONTHS[parseInt(month) - 1]} ${year}`;

  return (
    <div className="space-y-6">

      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-white">Salesmen & Staff</h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
            Manage salesmen, assign monthly targets, and track performance
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm transition-all active:scale-[0.98] cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Add Salesman
        </button>
      </div>

      {/* ── Summary Stats ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-100 dark:border-blue-800/40">
              <User className="h-4 w-4" />
            </div>
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">Total Staff</span>
          </div>
          <div className="text-2xl font-extrabold text-surface-900 dark:text-white">{workers.length}</div>
          <div className="text-[11px] text-surface-400 mt-0.5">{activeCount} active</div>
        </div>

        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-100 dark:border-emerald-800/40">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">Active</span>
          </div>
          <div className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{activeCount}</div>
          <div className="text-[11px] text-surface-400 mt-0.5">{workers.length - activeCount} inactive</div>
        </div>

        <div className="col-span-2 sm:col-span-1 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-100 dark:border-amber-800/40">
              <Target className="h-4 w-4" />
            </div>
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">Total Monthly Target</span>
          </div>
          <div className="text-2xl font-extrabold text-amber-600 dark:text-amber-400">{formatCurrency(totalTarget)}</div>
          <div className="text-[11px] text-surface-400 mt-0.5">across all salesmen</div>
        </div>
      </div>

      {/* ── Search ──────────────────────────────────────────────────── */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
        <input
          type="text"
          placeholder="Search salesmen by name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-10 pl-9 pr-4 text-sm border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
      </div>

      {/* ── Worker Cards ────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-12 text-center shadow-xs">
          <div className="h-12 w-12 rounded-xl bg-surface-100 dark:bg-surface-700 flex items-center justify-center mx-auto mb-3">
            <User className="h-6 w-6 text-surface-400" />
          </div>
          <h3 className="text-sm font-semibold text-surface-900 dark:text-white">No salesmen found</h3>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
            {search ? 'Try a different search term.' : 'Add your first salesman to get started.'}
          </p>
          {!search && (
            <button
              onClick={openCreate}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-all cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" /> Add Salesman
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((worker) => {
            const initials = worker.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
            const isActive = worker.status === 'active';
            return (
              <div
                key={worker.id}
                className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col gap-4"
              >
                {/* Card Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0">
                      {initials}
                    </div>
                    <div>
                      <div className="font-bold text-surface-900 dark:text-white text-sm leading-tight">{worker.name}</div>
                      {worker.notes && (
                        <div className="text-[11px] text-surface-500 dark:text-surface-400 mt-0.5 line-clamp-1">{worker.notes}</div>
                      )}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      isActive
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        : 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 border-surface-200 dark:border-surface-600'
                    }`}
                  >
                    {isActive ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                    {isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {/* Contact */}
                <div className="space-y-1.5">
                  {worker.phone && (
                    <div className="flex items-center gap-2 text-xs text-surface-600 dark:text-surface-400">
                      <Phone className="h-3.5 w-3.5 text-surface-400 flex-shrink-0" />
                      <span>{worker.phone}</span>
                    </div>
                  )}
                  {worker.email && (
                    <div className="flex items-center gap-2 text-xs text-surface-600 dark:text-surface-400">
                      <Mail className="h-3.5 w-3.5 text-surface-400 flex-shrink-0" />
                      <span className="truncate">{worker.email}</span>
                    </div>
                  )}
                  {!worker.phone && !worker.email && (
                    <span className="text-xs text-surface-400">No contact details</span>
                  )}
                </div>

                {/* Monthly Target */}
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200/70 dark:border-amber-800/40 rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-amber-500 text-white flex items-center justify-center flex-shrink-0">
                      <Target className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold uppercase tracking-wide">Monthly Target</div>
                      <div className="text-sm font-extrabold text-amber-800 dark:text-amber-300 leading-tight">
                        {formatCurrency(worker.monthly_target ?? 50000)}
                      </div>
                    </div>
                  </div>
                  <TrendingUp className="h-4 w-4 text-amber-400" />
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  {/* Give Target — primary CTA */}
                  <button
                    onClick={() => openSetTarget(worker)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-all active:scale-[0.97] cursor-pointer"
                  >
                    <Target className="h-3.5 w-3.5" />
                    Give Target
                  </button>

                  {/* Edit */}
                  <button
                    onClick={() => openEdit(worker)}
                    title="Edit"
                    className="p-2.5 rounded-xl bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 text-surface-600 dark:text-surface-300 transition-all cursor-pointer"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>

                  {/* Toggle Status */}
                  <button
                    onClick={() => toggleStatus(worker)}
                    title={isActive ? 'Deactivate' : 'Activate'}
                    className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                      isActive
                        ? 'bg-surface-100 dark:bg-surface-700 hover:bg-danger-50 dark:hover:bg-danger-950/40 text-surface-600 dark:text-surface-300 hover:text-danger-600'
                        : 'bg-surface-100 dark:bg-surface-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-surface-600 dark:text-surface-300 hover:text-emerald-600'
                    }`}
                  >
                    {isActive ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => deleteMutation.mutate(worker.id)}
                    title="Delete"
                    className="p-2.5 rounded-xl bg-surface-100 dark:bg-surface-700 hover:bg-danger-50 dark:hover:bg-danger-950/40 text-surface-600 dark:text-surface-300 hover:text-danger-600 transition-all cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Give Target Modal ────────────────────────────────────────── */}
      {targetWorker && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/25">
                  <Target className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Set Monthly Target</h2>
                  <p className="text-xs text-blue-100">{targetWorker.name}</p>
                </div>
              </div>
              <button
                onClick={() => setTargetWorker(null)}
                className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4 text-white" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSetTarget} className="p-5 space-y-5">
              
              {/* Month Selector */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wide">
                  Select Month
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
                  <input
                    type="month"
                    value={targetMonth}
                    onChange={(e) => setTargetMonth(e.target.value)}
                    required
                    className="w-full h-11 pl-9 pr-4 text-sm border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
                <p className="text-[11px] text-surface-400">Target will apply for: <strong className="text-surface-700 dark:text-surface-300">{selectedMonthLabel}</strong></p>
              </div>

              {/* Target Amount */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wide">
                  Sales Target Amount (₹)
                </label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
                  <input
                    type="number"
                    min="1000"
                    step="500"
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(e.target.value)}
                    placeholder="e.g. 75000"
                    required
                    className="w-full h-11 pl-9 pr-4 text-sm border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 font-semibold"
                  />
                </div>
                <p className="text-[11px] text-surface-400">
                  Current target:{' '}
                  <strong className="text-amber-600 dark:text-amber-400">
                    {formatCurrency(targetWorker.monthly_target ?? 50000)}
                  </strong>
                </p>
              </div>

              {/* Quick Presets */}
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wide">
                  Quick Presets
                </label>
                <div className="flex flex-wrap gap-2">
                  {[50000, 60000, 75000, 100000, 125000, 150000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setTargetAmount(String(amt))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        targetAmount === String(amt)
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-surface-50 dark:bg-surface-900 text-surface-700 dark:text-surface-300 border-surface-200 dark:border-surface-600 hover:border-blue-400'
                      }`}
                    >
                      {formatCurrency(amt)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              {targetAmount && (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200/70 dark:border-blue-800/40 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wide">Target Preview</div>
                    <div className="text-lg font-extrabold text-blue-700 dark:text-blue-300 mt-0.5">
                      {formatCurrency(Number(targetAmount))}
                    </div>
                    <div className="text-[11px] text-blue-500 dark:text-blue-400">{selectedMonthLabel} • {targetWorker.name}</div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-blue-400" />
                </div>
              )}

              {/* Submit */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setTargetWorker(null)}
                  className="flex-1 px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-600 text-sm font-semibold text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold shadow-sm transition-all cursor-pointer"
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Target className="h-4 w-4" />
                  )}
                  Assign Target
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Add/Edit Salesman Modal ──────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-surface-900 dark:text-white">
                    {editing ? 'Edit Salesman' : 'Add New Salesman'}
                  </h2>
                  <p className="text-xs text-surface-500 dark:text-surface-400">
                    {editing ? 'Update salesman details' : 'Fill in the details below'}
                  </p>
                </div>
              </div>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            <form id="worker-form" onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Name */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-surface-700 dark:text-surface-300">
                  Salesman Name <span className="text-danger-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="e.g. Ramesh Patil"
                  className="w-full h-10 px-3.5 text-sm border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-surface-700 dark:text-surface-300">Phone</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="e.g. 9876543210"
                    className="w-full h-10 px-3.5 text-sm border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-surface-700 dark:text-surface-300">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="email@example.com"
                    className="w-full h-10 px-3.5 text-sm border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
              </div>

              {/* Monthly Target */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-surface-700 dark:text-surface-300">
                  Monthly Sales Target (₹) <span className="text-danger-500">*</span>
                </label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
                  <input
                    type="number"
                    min="1000"
                    value={form.monthly_target}
                    onChange={(e) => setForm({ ...form, monthly_target: e.target.value })}
                    required
                    placeholder="e.g. 75000"
                    className="w-full h-10 pl-9 pr-4 text-sm border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 font-semibold"
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-surface-700 dark:text-surface-300">Notes</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional notes about this salesman"
                  className="w-full h-10 px-3.5 text-sm border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-600 text-sm font-semibold text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold shadow-sm transition-all cursor-pointer"
                >
                  {(createMutation.isPending || updateMutation.isPending) ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreVertical className="h-4 w-4" />
                  )}
                  {editing ? 'Save Changes' : 'Add Salesman'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
