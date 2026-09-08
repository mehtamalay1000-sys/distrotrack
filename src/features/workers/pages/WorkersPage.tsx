import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Search, Phone, Mail, Edit2, Trash2, Target,
  User, MoreVertical, CheckCircle2, XCircle, IndianRupee,
  TrendingUp, Calendar, X, Loader2, Sparkles,
  MapPin, Truck, ChevronDown, ChevronUp,
} from 'lucide-react';
import { getWorkers, createWorker, updateWorker, deleteWorker } from '../services/workerService';
import { getRoutes } from '@/features/routes/services/routeService';
import { getPicklists } from '@/features/picklists/services/picklistService';
import { getDeliveries } from '@/features/deliveries/services/deliveryService';
import { getPayments } from '@/features/payments/services/paymentService';
import { getParties } from '@/features/parties/services/partyService';
import { formatCurrency } from '@/shared/utils/format';
import { addNotification } from '@/features/notifications/services/notificationService';
import type { Worker } from '@/lib/database.types';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function WorkersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'cards' | 'routes'>('cards');
  const [expandedWorkerId, setExpandedWorkerId] = useState<string | null>(null);

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

  const { data: routes = [] } = useQuery({
    queryKey: ['routes'],
    queryFn: getRoutes,
  });

  const { data: picklists = [] } = useQuery({
    queryKey: ['picklists'],
    queryFn: getPicklists,
  });

  const { data: deliveries = [] } = useQuery({
    queryKey: ['deliveries'],
    queryFn: getDeliveries,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: getPayments,
  });

  const { data: parties = [] } = useQuery({
    queryKey: ['parties'],
    queryFn: getParties,
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
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Dedicated Target Assignment Mutation with Notifications
  const setTargetMutation = useMutation({
    mutationFn: async ({
      id,
      name,
      phone,
      target,
      month,
    }: {
      id: string;
      name: string;
      phone: string | null;
      target: number;
      month: string;
    }) => {
      const updated = await updateWorker(id, { name, phone: phone || undefined, monthly_target: target });
      return { updated: { ...updated, name }, target, month };
    },
    onSuccess: ({ updated, target, month }) => {
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      queryClient.invalidateQueries({ queryKey: ['worker-dashboard-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });

      const [y, m] = month.split('-');
      const monthName = MONTHS[parseInt(m, 10) - 1] || 'Current Month';
      const monthYearLabel = `${monthName} ${y}`;

      // Notify Worker
      addNotification({
        recipient_role: 'worker',
        recipient_worker_id: updated.id,
        title: `🎯 Monthly Target Set: ${formatCurrency(target)}`,
        message: `Admin assigned a sales target of ${formatCurrency(target)} for ${monthYearLabel}.`,
        type: 'system',
        link: '/w',
      });

      // Notify Admin
      addNotification({
        recipient_role: 'admin',
        title: `Target Assigned: ${updated.name}`,
        message: `Set monthly target of ${formatCurrency(target)} for ${monthYearLabel}.`,
        type: 'system',
        link: '/workers',
      });

      toast.success(`Target of ${formatCurrency(target)} assigned to ${updated.name} for ${monthYearLabel}`);
      setTargetWorker(null);
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to update target'),
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
    const num = Number(targetAmount);
    if (!num || num <= 0) {
      toast.error('Please enter a valid target amount');
      return;
    }
    setTargetMutation.mutate({
      id: targetWorker.id,
      name: targetWorker.name,
      phone: targetWorker.phone,
      target: num,
      month: targetMonth,
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

  // Helper: compute total market done by worker as per their routes
  function getWorkerMarketStats(worker: Worker) {
    const workerPicklists = picklists.filter(
      (pl) => pl.worker_id === worker.id || (pl.worker as any)?.id === worker.id
    );
    const workerDeliveries = deliveries.filter(
      (d) => d.worker_id === worker.id || (d.worker as any)?.id === worker.id
    );
    const workerPayments = payments.filter(
      (p) => p.worker_id === worker.id || (p as any)?.received_by_worker_id === worker.id
    );

    // Identify all routes for this worker
    const assignedRoutes = routes.filter((r) => {
      const isAssigned = r.assigned_worker_id === worker.id;
      const hasPicklist = workerPicklists.some((pl) => pl.route_id === r.id || pl.route?.code === r.code);
      const hasDelivery = workerDeliveries.some(
        (d) => d.picklist?.route_id === r.id || (d.party && d.party.route_id === r.id)
      );
      return isAssigned || hasPicklist || hasDelivery;
    });

    const routeList = assignedRoutes.length > 0
      ? assignedRoutes
      : routes.filter((r) => workerPicklists.some((pl) => pl.route_id === r.id));

    // Per-route breakdown
    const routeBreakdown = routeList.map((r) => {
      const rPicklists = picklists.filter((pl) => pl.route_id === r.id || pl.route?.code === r.code);
      const rParties = parties.filter((p) => p.route_id === r.id || p.route?.code === r.code);
      const rPartyIds = new Set(rParties.map((p) => p.id));
      const rDeliveries = deliveries.filter(
        (d) => rPartyIds.has(d.party_id) || d.picklist?.route_id === r.id
      );

      const routeMarketSales =
        rPicklists.reduce((sum, pl) => sum + Number(pl.total_amount || 0), 0) ||
        rDeliveries.reduce((sum, d) => sum + Number(d.delivered_amount || d.total_amount || 0), 0) ||
        rParties.reduce((sum, p) => sum + Number(p.outstanding_amount || 0), 0);

      const routeCash =
        rPicklists.reduce((sum, pl) => sum + Number(pl.total_cash || 0), 0) ||
        rDeliveries.reduce((sum, d) => {
          if (d.status === 'delivered' || d.status === 'partial') {
            return sum + Number(d.collected_amount || 0);
          }
          return sum;
        }, 0);

      const routeUpi =
        rPicklists.reduce((sum, pl) => sum + Number(pl.total_upi || 0), 0) ||
        workerPayments
          .filter((p) => p.payment_mode === 'upi' && p.status !== 'reversed' && p.status !== 'bounced' && (p.delivery?.picklist?.route_id === r.id || p.party?.route_id === r.id))
          .reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const routeCheque =
        rPicklists.reduce((sum, pl) => sum + Number(pl.total_cheque || 0), 0) ||
        workerPayments
          .filter((p) => p.payment_mode === 'cheque' && p.status !== 'reversed' && p.status !== 'bounced' && (p.delivery?.picklist?.route_id === r.id || p.party?.route_id === r.id))
          .reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const routeCredit =
        rPicklists.reduce((sum, pl) => sum + Number(pl.total_credit || 0), 0) ||
        rDeliveries.reduce((sum, d) => {
          if (d.status === 'delivered' || d.status === 'partial') {
            return sum + Math.max(0, Number(d.delivered_amount || 0) - Number(d.collected_amount || 0));
          }
          return sum;
        }, 0);

      const completedCount = rDeliveries.filter((d) => d.status === 'delivered').length;
      const totalDeliveries = rDeliveries.length;

      return {
        route: r,
        marketSales: routeMarketSales,
        cashCollected: routeCash,
        upiCollected: routeUpi,
        chequeCollected: routeCheque,
        creditExtended: routeCredit,
        totalCollected: routeCash + routeUpi + routeCheque,
        completedDeliveries: completedCount,
        totalDeliveries: totalDeliveries,
        partiesCount: rParties.length,
      };
    });

    const totalMarketDone = routeBreakdown.reduce((sum, rb) => sum + rb.marketSales, 0) ||
      workerPicklists.reduce((sum, pl) => sum + Number(pl.total_amount || 0), 0);
    const totalCashCollected = routeBreakdown.reduce((sum, rb) => sum + rb.cashCollected, 0) ||
      workerPayments.filter((p) => p.payment_mode === 'cash').reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalUpiCollected = routeBreakdown.reduce((sum, rb) => sum + rb.upiCollected, 0) ||
      workerPayments.filter((p) => p.payment_mode === 'upi').reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalCreditExtended = routeBreakdown.reduce((sum, rb) => sum + rb.creditExtended, 0) ||
      workerPayments.filter((p) => p.payment_mode === 'credit').reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalChequeCollected = routeBreakdown.reduce((sum, rb) => sum + rb.chequeCollected, 0);

    const target = Number(worker.monthly_target || 50000);
    const achievementPercent = target > 0 ? Math.min(100, Math.round((totalMarketDone / target) * 100)) : 0;

    return {
      routes: routeBreakdown,
      totalMarketDone,
      totalCashCollected,
      totalUpiCollected,
      totalCreditExtended,
      totalChequeCollected,
      totalCollected: totalCashCollected + totalUpiCollected + totalChequeCollected,
      achievementPercent,
      target,
    };
  }

  const activeCount = workers.filter((w) => w.status === 'active').length;
  const totalTarget = workers.reduce((s, w) => s + (Number(w.monthly_target) || 50000), 0);

  // Compute aggregate market stats
  const workerMarketMap = new Map<string, ReturnType<typeof getWorkerMarketStats>>();
  let totalAllMarketDone = 0;
  let totalAllCashCollected = 0;
  let totalAllCreditExtended = 0;

  for (const w of workers) {
    const stats = getWorkerMarketStats(w);
    workerMarketMap.set(w.id, stats);
    totalAllMarketDone += stats.totalMarketDone;
    totalAllCashCollected += stats.totalCashCollected;
    totalAllCreditExtended += stats.totalCreditExtended;
  }

  const [year, month] = targetMonth.split('-');
  const selectedMonthLabel = `${MONTHS[parseInt(month) - 1]} ${year}`;

  return (
    <div className="space-y-6">

      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-white">Salesmen & Staff</h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
            Manage salesmen, track market turnover by routes, and assign monthly targets
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Total Staff */}
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

        {/* Total Monthly Target */}
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-100 dark:border-amber-800/40">
              <Target className="h-4 w-4" />
            </div>
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">Monthly Target</span>
          </div>
          <div className="text-2xl font-extrabold text-amber-600 dark:text-amber-400">{formatCurrency(totalTarget)}</div>
          <div className="text-[11px] text-surface-400 mt-0.5">combined staff target</div>
        </div>

        {/* Total Market Done */}
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center border border-indigo-100 dark:border-indigo-800/40">
              <Truck className="h-4 w-4" />
            </div>
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">Total Market Done</span>
          </div>
          <div className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400">{formatCurrency(totalAllMarketDone)}</div>
          <div className="text-[11px] text-surface-400 mt-0.5">
            {totalTarget > 0 ? Math.round((totalAllMarketDone / totalTarget) * 100) : 0}% of target achieved
          </div>
        </div>

        {/* Cash Collected in Market */}
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-100 dark:border-emerald-800/40">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">Cash Collected</span>
          </div>
          <div className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalAllCashCollected)}</div>
          <div className="text-[11px] text-surface-400 mt-0.5">realized in-hand</div>
        </div>

        {/* Market Credit / Udhar */}
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs col-span-2 sm:col-span-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-xl bg-orange-50 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400 flex items-center justify-center border border-orange-100 dark:border-orange-800/40">
              <TrendingUp className="h-4 w-4" />
            </div>
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">Market Credit (Udhar)</span>
          </div>
          <div className="text-2xl font-extrabold text-orange-600 dark:text-orange-400">{formatCurrency(totalAllCreditExtended)}</div>
          <div className="text-[11px] text-surface-400 mt-0.5">pending from parties</div>
        </div>
      </div>

      {/* ── Tabs & Search Bar ───────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl bg-surface-200/70 dark:bg-surface-800 border border-surface-300/60 dark:border-surface-700 text-xs font-bold">
          <button
            onClick={() => setActiveTab('cards')}
            className={`px-4 py-2 rounded-lg transition-all cursor-pointer ${
              activeTab === 'cards'
                ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-xs'
                : 'text-surface-600 dark:text-surface-400 hover:text-surface-900'
            }`}
          >
            Staff Overview ({workers.length})
          </button>
          <button
            onClick={() => setActiveTab('routes')}
            className={`px-4 py-2 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'routes'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-surface-600 dark:text-surface-400 hover:text-blue-600'
            }`}
          >
            <MapPin className="h-3.5 w-3.5" />
            Market Done by Routes
          </button>
        </div>

        {/* Search */}
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
          <input
            type="text"
            placeholder="Search salesmen by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-4 text-sm border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>
      </div>

      {/* ── TAB 1: WORKER CARDS ───────────────────────────────────────── */}
      {activeTab === 'cards' && (
        <>
          {filtered.length === 0 ? (
            <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-12 text-center shadow-xs">
              <div className="h-12 w-12 rounded-xl bg-surface-100 dark:bg-surface-700 flex items-center justify-center mx-auto mb-3">
                <User className="h-6 w-6 text-surface-400" />
              </div>
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white">No salesmen found</h3>
              <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
                {search ? 'Try a different search term.' : 'Add your first salesman to get started.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {filtered.map((worker) => {
                const initials = worker.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
                const isActive = worker.status === 'active';
                const marketStats = workerMarketMap.get(worker.id) || getWorkerMarketStats(worker);
                const isExpanded = expandedWorkerId === worker.id;

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
                    <div className="space-y-1 text-xs text-surface-600 dark:text-surface-400">
                      {worker.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-3.5 w-3.5 text-surface-400 flex-shrink-0" />
                          <span>{worker.phone}</span>
                        </div>
                      )}
                      {worker.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="h-3.5 w-3.5 text-surface-400 flex-shrink-0" />
                          <span className="truncate">{worker.email}</span>
                        </div>
                      )}
                    </div>

                    {/* ── Market Performance as per Routes ─────────────────── */}
                    <div className="bg-surface-50 dark:bg-surface-850/60 rounded-xl p-3.5 border border-surface-200/80 dark:border-surface-700/80 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-surface-500 dark:text-surface-400 flex items-center gap-1.5">
                          <Truck className="h-3.5 w-3.5 text-blue-500" />
                          Market Done
                        </span>
                        <span className="text-base font-black text-blue-600 dark:text-blue-400">
                          {formatCurrency(marketStats.totalMarketDone)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-surface-200/60 dark:border-surface-700/60">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-surface-400 block">Cash Collected</span>
                          <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(marketStats.totalCashCollected)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-surface-400 block">Market Credit</span>
                          <span className="text-xs font-black text-amber-600 dark:text-amber-400">
                            {formatCurrency(marketStats.totalCreditExtended)}
                          </span>
                        </div>
                      </div>

                      {/* Target Achievement Bar */}
                      <div className="space-y-1 pt-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-semibold text-surface-500 dark:text-surface-400">
                            Target: {formatCurrency(marketStats.target)}
                          </span>
                          <span className="font-black text-surface-800 dark:text-surface-200">
                            {marketStats.achievementPercent}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-500"
                            style={{ width: `${marketStats.achievementPercent}%` }}
                          />
                        </div>
                      </div>

                      {/* Routes Handled */}
                      {marketStats.routes.length > 0 && (
                        <div className="pt-2 border-t border-surface-200/60 dark:border-surface-700/60">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-bold text-surface-400 uppercase flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              Routes ({marketStats.routes.length})
                            </span>
                            <button
                              type="button"
                              onClick={() => setExpandedWorkerId(isExpanded ? null : worker.id)}
                              className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                            >
                              {isExpanded ? 'Hide Routes' : 'View Route Details'}
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-1.5">
                            {marketStats.routes.map((rb) => (
                              <span
                                key={rb.route.id}
                                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-white dark:bg-surface-800 text-surface-700 dark:text-surface-300 border border-surface-200 dark:border-surface-700 shadow-2xs"
                              >
                                <span className="font-mono text-primary-600 dark:text-primary-400">{rb.route.code}</span>
                                <span>•</span>
                                <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(rb.marketSales)}</span>
                              </span>
                            ))}
                          </div>

                          {/* Expandable Route Details Table */}
                          {isExpanded && (
                            <div className="mt-2.5 overflow-x-auto rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800">
                              <table className="w-full text-[11px] text-surface-700 dark:text-surface-300">
                                <thead>
                                  <tr className="bg-surface-100 dark:bg-surface-750 text-[10px] text-surface-500 border-b border-surface-200 dark:border-surface-700 uppercase font-bold">
                                    <th className="p-1.5 text-left">Route</th>
                                    <th className="p-1.5 text-center">Deliveries</th>
                                    <th className="p-1.5 text-right">Market Done</th>
                                    <th className="p-1.5 text-right">Cash</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {marketStats.routes.map((rb) => (
                                    <tr key={rb.route.id} className="border-b border-surface-100 dark:border-surface-800/60">
                                      <td className="p-1.5 font-semibold text-surface-900 dark:text-white">
                                        <div className="font-mono text-[9px] text-surface-400">{rb.route.code}</div>
                                        {rb.route.name}
                                      </td>
                                      <td className="p-1.5 text-center font-medium text-[10px]">
                                        {rb.completedDeliveries} / {rb.totalDeliveries}
                                      </td>
                                      <td className="p-1.5 text-right font-black text-blue-600 dark:text-blue-400">
                                        {formatCurrency(rb.marketSales)}
                                      </td>
                                      <td className="p-1.5 text-right font-bold text-emerald-600 dark:text-emerald-400">
                                        {formatCurrency(rb.cashCollected)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-1 mt-auto">
                      <button
                        onClick={() => openSetTarget(worker)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-all active:scale-[0.97] cursor-pointer"
                      >
                        <Target className="h-3.5 w-3.5" />
                        Give Target
                      </button>

                      <button
                        onClick={() => openEdit(worker)}
                        title="Edit"
                        className="p-2.5 rounded-xl bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 text-surface-600 dark:text-surface-300 transition-all cursor-pointer"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>

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
        </>
      )}

      {/* ── TAB 2: TOTAL MARKET DONE AS PER ROUTES (DEDICATED TABLE VIEW) ─ */}
      {activeTab === 'routes' && (
        <div className="space-y-6">
          {filtered.map((worker) => {
            const marketStats = workerMarketMap.get(worker.id) || getWorkerMarketStats(worker);
            const initials = worker.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

            return (
              <div
                key={worker.id}
                className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl overflow-hidden shadow-xs"
              >
                {/* Salesman Route Header */}
                <div className="p-4 bg-surface-50 dark:bg-surface-850 border-b border-surface-200 dark:border-surface-700 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0">
                      {initials}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-base text-surface-900 dark:text-white">{worker.name}</h3>
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          {marketStats.routes.length} {marketStats.routes.length === 1 ? 'Route' : 'Routes'}
                        </span>
                      </div>
                      <p className="text-xs text-surface-500 dark:text-surface-400">
                        {worker.phone ? `Phone: ${worker.phone}` : 'No phone'} • Target: {formatCurrency(marketStats.target)} ({marketStats.achievementPercent}% achieved)
                      </p>
                    </div>
                  </div>

                  {/* Worker Total Market Badges */}
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold text-surface-400 block">Total Market Done</span>
                      <span className="text-base font-black text-blue-600 dark:text-blue-400">{formatCurrency(marketStats.totalMarketDone)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold text-surface-400 block">Cash In-Hand</span>
                      <span className="text-base font-black text-emerald-600 dark:text-emerald-400">{formatCurrency(marketStats.totalCashCollected)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold text-surface-400 block">Market Credit</span>
                      <span className="text-base font-black text-amber-600 dark:text-amber-400">{formatCurrency(marketStats.totalCreditExtended)}</span>
                    </div>
                  </div>
                </div>

                {/* Routes Table */}
                {marketStats.routes.length === 0 ? (
                  <div className="p-8 text-center text-xs text-surface-400">
                    No routes assigned to {worker.name} yet. Assign routes in Route Management.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="dt-table w-full">
                      <thead>
                        <tr>
                          <th>Route Code</th>
                          <th>Route Name</th>
                          <th>Parties</th>
                          <th>Deliveries Done</th>
                          <th className="text-right">Total Market Billed</th>
                          <th className="text-right">Cash Collected</th>
                          <th className="text-right">Market Credit</th>
                          <th className="text-right">Realization</th>
                        </tr>
                      </thead>
                      <tbody>
                        {marketStats.routes.map((rb) => {
                          const realizationRate = rb.marketSales > 0 ? Math.round((rb.cashCollected / rb.marketSales) * 100) : 0;
                          return (
                            <tr key={rb.route.id}>
                              <td className="font-mono text-xs font-bold text-primary-700 dark:text-primary-300">
                                {rb.route.code}
                              </td>
                              <td className="font-semibold text-surface-900 dark:text-white">
                                {rb.route.name}
                              </td>
                              <td className="text-xs text-surface-600 dark:text-surface-400 font-medium">
                                {rb.partiesCount} stores
                              </td>
                              <td>
                                <span className={`text-xs font-bold ${rb.completedDeliveries === rb.totalDeliveries && rb.totalDeliveries > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                  {rb.completedDeliveries} / {rb.totalDeliveries} Completed
                                </span>
                              </td>
                              <td className="text-right font-black text-blue-600 dark:text-blue-400">
                                {formatCurrency(rb.marketSales)}
                              </td>
                              <td className="text-right font-black text-emerald-600 dark:text-emerald-400">
                                {formatCurrency(rb.cashCollected)}
                              </td>
                              <td className="text-right font-black text-amber-600 dark:text-amber-400">
                                {formatCurrency(rb.creditExtended)}
                              </td>
                              <td className="text-right">
                                <span className="inline-flex items-center gap-1 font-bold text-xs px-2 py-0.5 rounded-md bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-200">
                                  {realizationRate}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Set Monthly Target Modal (Fully Responsive & Screen Contained) ──────────────── */}
      {targetWorker && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in fade-in zoom-in-95 duration-200">
            
            {/* Modal Header (Fixed) */}
            <div className="p-4 sm:p-5 border-b border-surface-100 dark:border-surface-700/60 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/25 shadow-sm">
                  <Target className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-extrabold tracking-tight leading-tight">Set Monthly Target</h2>
                  <p className="text-xs text-blue-100 font-medium">Salesman: {targetWorker.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTargetWorker(null)}
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body (Scrollable if screen is small) */}
            <form onSubmit={handleSetTarget} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              
              {/* Salesman Context Pill */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-surface-50 dark:bg-surface-900 border border-surface-200/80 dark:border-surface-700 text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-xs">
                    {targetWorker.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-bold text-surface-900 dark:text-surface-100 leading-tight">{targetWorker.name}</div>
                    <div className="text-surface-400 font-mono text-[10px]">{targetWorker.phone || 'Field Sales'}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[9px] uppercase font-bold text-surface-400">Current</div>
                  <div className="font-extrabold text-amber-600 dark:text-amber-400 text-xs">
                    {formatCurrency(targetWorker.monthly_target ?? 50000)}
                  </div>
                </div>
              </div>

              {/* Month Selection */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wide">
                    Target Period
                  </label>
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                    {selectedMonthLabel}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {(() => {
                    const now = new Date();
                    const curMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                    const nextMonthKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
                    const curLabel = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
                    const nextLabel = `${MONTHS[nextDate.getMonth()]} ${nextDate.getFullYear()}`;

                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => setTargetMonth(curMonthKey)}
                          className={`p-2 rounded-xl text-xs font-bold border transition-all text-center cursor-pointer ${
                            targetMonth === curMonthKey
                              ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 border-blue-400 dark:border-blue-700 shadow-xs'
                              : 'bg-surface-50 dark:bg-surface-900 text-surface-600 dark:text-surface-400 border-surface-200 dark:border-surface-700 hover:border-surface-300'
                          }`}
                        >
                          <div className="text-[9px] text-surface-400 uppercase font-semibold">This Month</div>
                          <div className="text-xs truncate">{curLabel}</div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setTargetMonth(nextMonthKey)}
                          className={`p-2 rounded-xl text-xs font-bold border transition-all text-center cursor-pointer ${
                            targetMonth === nextMonthKey
                              ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 border-blue-400 dark:border-blue-700 shadow-xs'
                              : 'bg-surface-50 dark:bg-surface-900 text-surface-600 dark:text-surface-400 border-surface-200 dark:border-surface-700 hover:border-surface-300'
                          }`}
                        >
                          <div className="text-[9px] text-surface-400 uppercase font-semibold">Next Month</div>
                          <div className="text-xs truncate">{nextLabel}</div>
                        </button>
                      </>
                    );
                  })()}
                </div>

                <div className="relative pt-0.5">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-400" />
                  <input
                    type="month"
                    value={targetMonth}
                    onChange={(e) => setTargetMonth(e.target.value)}
                    required
                    className="w-full h-9 pl-9 pr-3 text-xs font-semibold border border-surface-200 dark:border-surface-700 rounded-xl bg-white dark:bg-surface-900 text-surface-800 dark:text-surface-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              {/* Target Amount Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wide">
                    Target Amount (₹)
                  </label>
                  <span className="text-[10px] text-surface-400 font-mono">Min: ₹1,000</span>
                </div>

                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 font-bold text-sm">
                    ₹
                  </div>
                  <input
                    type="number"
                    min="1000"
                    step="500"
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(e.target.value)}
                    placeholder="75000"
                    required
                    className="w-full h-11 pl-8 pr-3 text-base font-black tracking-tight border-2 border-surface-200 dark:border-surface-700 rounded-xl bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:border-blue-600 dark:focus:border-blue-500 transition-all shadow-xs"
                  />
                </div>

                {/* Quick Increment Steppers */}
                <div className="flex items-center gap-1 pt-0.5">
                  {[
                    { label: '-5k', val: -5000 },
                    { label: '+5k', val: 5000 },
                    { label: '+10k', val: 10000 },
                    { label: '+25k', val: 25000 },
                  ].map((step) => (
                    <button
                      key={step.label}
                      type="button"
                      onClick={() => {
                        const current = Number(targetAmount || 0);
                        const nextVal = Math.max(1000, current + step.val);
                        setTargetAmount(String(nextVal));
                      }}
                      className="px-2 py-0.5 rounded-lg bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 text-[10px] font-bold text-surface-600 dark:text-surface-300 transition-all cursor-pointer"
                    >
                      {step.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Presets Chips */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-surface-400 uppercase tracking-wider">
                  Presets
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[50000, 60000, 75000, 100000, 125000, 150000].map((amt) => {
                    const isSelected = Number(targetAmount) === amt;
                    return (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setTargetAmount(String(amt))}
                        className={`py-1.5 px-2 rounded-xl text-xs font-bold border transition-all text-center cursor-pointer ${
                          isSelected
                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-500/30'
                            : 'bg-surface-50 dark:bg-surface-900/60 text-surface-700 dark:text-surface-300 border-surface-200/90 dark:border-surface-700 hover:border-blue-400'
                        }`}
                      >
                        {formatCurrency(amt)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Real-time Target Insights Card */}
              {Number(targetAmount) > 0 && (
                <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-50/80 via-indigo-50/50 to-surface-50 dark:from-blue-950/30 dark:via-indigo-950/20 dark:to-surface-900 border border-blue-200/70 dark:border-blue-800/40 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] uppercase font-extrabold tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1">
                      <Sparkles className="h-2.5 w-2.5" />
                      Target Projection
                    </span>
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                      {selectedMonthLabel}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between pt-0.5">
                    <div>
                      <div className="text-xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">
                        {formatCurrency(Number(targetAmount))}
                      </div>
                      <div className="text-[10px] text-surface-500 dark:text-surface-400">
                        {targetWorker.name}
                      </div>
                    </div>

                    {/* Daily run rate estimation */}
                    <div className="text-right">
                      <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                        {formatCurrency(Math.round(Number(targetAmount) / 26))} / day
                      </div>
                      <div className="text-[9px] text-surface-400">
                        ~26 working days
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal Actions (Sticky bottom inside modal) */}
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setTargetWorker(null)}
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-surface-300 dark:border-surface-600 text-xs font-bold text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-all cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={setTargetMutation.isPending || !Number(targetAmount)}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-blue-600/20 transition-all cursor-pointer"
                >
                  {setTargetMutation.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <>
                      <Target className="h-3.5 w-3.5" />
                      <span>Assign Target</span>
                    </>
                  )}
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
