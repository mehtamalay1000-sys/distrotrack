import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, CreditCard, DollarSign, Search, Filter,
  CheckCircle2, Clock, MapPin, ArrowUpRight, ArrowDownRight, Wifi,
  Eye, RotateCcw, Check, X, ShieldAlert, AlertCircle, Trash2,
} from 'lucide-react';
import { PageHeader, Button, Input, Select, Modal, EmptyState, LoadingState, ErrorState, StatusBadge } from '@/shared/ui';
import { UPIQRPayment } from '@/shared/ui/UPIQRPayment';
import { getPayments, createPayment, reversePayment, deletePayment, updateChequeStatus } from '../services/paymentService';
import { getParties } from '@/features/parties/services/partyService';
import { getWorkers } from '@/features/workers/services/workerService';
import { getRoutes } from '@/features/routes/services/routeService';
import { useAuth } from '@/app/AuthProvider';
import { formatCurrency, formatDate } from '@/shared/utils/format';
import { QK } from '@/lib/queryKeys';
import type { Payment, PaymentMode } from '@/lib/database.types';

export function PaymentsPage() {
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState<string>('all');
  const [statusTab, setStatusTab] = useState<'all' | 'paid' | 'remaining'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [showUpiQR, setShowUpiQR] = useState(false);
  const [pendingUpiForm, setPendingUpiForm] = useState<typeof form | null>(null);
  const [upiPartyName, setUpiPartyName] = useState('');

  // Auth & role check for privileged actions
  const { role, isMaster } = useAuth();
  const canDelete = role === 'owner' || role === 'master' || isMaster;

  // Payment inspection, reversal & deletion states
  const [viewingPayment, setViewingPayment] = useState<Payment | null>(null);
  const [reversingPayment, setReversingPayment] = useState<Payment | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [deletingPayment, setDeletingPayment] = useState<Payment | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [hideReversed, setHideReversed] = useState(false);

  const prePartyId = searchParams.get('party_id') || '';
  const preDeliveryId = searchParams.get('delivery_id') || '';
  const preAmount = parseFloat(searchParams.get('amount') || '0') || 0;

  const [form, setForm] = useState({
    party_id: prePartyId,
    delivery_id: preDeliveryId,
    amount: preAmount,
    payment_mode: 'cash' as PaymentMode,
    cheque_number: '',
    cheque_date: '',
    cheque_bank: '',
    notes: '',
    worker_id: '',
  });

  const { data: payments = [], isLoading, error } = useQuery({ queryKey: ['payments'], queryFn: getPayments });
  const { data: routes = [] } = useQuery({ queryKey: ['routes'], queryFn: getRoutes });
  const { data: parties = [] } = useQuery({ queryKey: ['parties'], queryFn: getParties });
  const { data: workers = [] } = useQuery({ queryKey: ['workers'], queryFn: getWorkers });

  useEffect(() => {
    if (prePartyId || preDeliveryId) {
      setForm((prev) => ({
        ...prev,
        party_id: prePartyId,
        delivery_id: preDeliveryId,
        amount: preAmount,
      }));
      setModalOpen(true);
    }
  }, [prePartyId, preDeliveryId, preAmount]);

  const createMut = useMutation({
    mutationFn: createPayment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.payments });
      qc.invalidateQueries({ queryKey: QK.parties });
      qc.invalidateQueries({ queryKey: QK.deliveries });
      qc.invalidateQueries({ queryKey: QK.dashboardStats });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterKpisAny });
      qc.invalidateQueries({ queryKey: QK.masterExceptionsAny });
      toast.success('Payment recorded');
      closeModal();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reverseMut = useMutation({
    mutationFn: (args: { paymentId: string; reason: string }) =>
      reversePayment(args.paymentId, args.reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.payments });
      qc.invalidateQueries({ queryKey: QK.parties });
      qc.invalidateQueries({ queryKey: QK.deliveries });
      qc.invalidateQueries({ queryKey: QK.dashboardStats });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterKpisAny });
      qc.invalidateQueries({ queryKey: QK.masterExceptionsAny });
      toast.success('Payment successfully reversed with ledger update.');
      setReversingPayment(null);
      setReversalReason('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (args: { paymentId: string; reason: string }) =>
      deletePayment(args.paymentId, args.reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: QK.payments });
      qc.invalidateQueries({ queryKey: QK.parties });
      qc.invalidateQueries({ queryKey: QK.deliveries });
      qc.invalidateQueries({ queryKey: QK.dashboardStats });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterKpisAny });
      qc.invalidateQueries({ queryKey: QK.masterExceptionsAny });
      toast.success('Payment permanently deleted and customer balance recalibrated.');
      setDeletingPayment(null);
      setDeleteReason('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const chequeStatusMut = useMutation({
    mutationFn: (args: { paymentId: string; status: 'cleared' | 'bounced'; notes?: string }) =>
      updateChequeStatus(args.paymentId, args.status, args.notes),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: QK.payments });
      qc.invalidateQueries({ queryKey: QK.parties });
      qc.invalidateQueries({ queryKey: QK.dashboardStats });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterKpisAny });
      qc.invalidateQueries({ queryKey: QK.masterExceptionsAny });
      toast.success(`Cheque marked as ${variables.status.toUpperCase()}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openCreate() {
    setForm({
      party_id: '',
      delivery_id: '',
      amount: 0,
      payment_mode: 'cash',
      cheque_number: '',
      cheque_date: '',
      cheque_bank: '',
      notes: '',
      worker_id: '',
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.party_id) {
      toast.error('Please select a party');
      return;
    }
    // If UPI/Online — show QR instead of saving directly
    if (form.payment_mode === 'upi') {
      const selectedParty = parties.find((p) => p.id === form.party_id);
      setUpiPartyName(selectedParty?.name || '');
      setPendingUpiForm({ ...form });
      setModalOpen(false);
      setShowUpiQR(true);
      return;
    }
    createMut.mutate(form);
  }

  function handleUpiConfirm(refNumber?: string) {
    if (!pendingUpiForm) return;
    createMut.mutate({
      ...pendingUpiForm,
      notes: refNumber ? `UPI Ref: ${refNumber}` : pendingUpiForm.notes,
    });
    setShowUpiQR(false);
    setPendingUpiForm(null);
  }

  // ── Helper: Get route ID of a payment ─────────────────────────────────
  function getPaymentRouteId(p: Payment): string | null {
    if (p.route_id) return p.route_id;
    if (p.route?.id) return p.route.id;
    const dPicklist = (p.delivery as any)?.picklist;
    if (dPicklist?.route_id) return dPicklist.route_id;
    if (dPicklist?.route?.id) return dPicklist.route.id;
    const pt = p.party || parties.find((x) => x.id === p.party_id || x.code === p.party_id);
    if (pt?.route_id) return pt.route_id;
    if (pt?.route?.id) return pt.route.id;
    return null;
  }

  // ── 1. Route Filter ────────────────────────────────────────────────────
  const routeFiltered = payments.filter((p) => {
    if (selectedRouteId === 'all') return true;
    const rId = getPaymentRouteId(p);
    return rId === selectedRouteId;
  });

  // ── 2. Calculate Paid vs Remaining for the selected route filter ────────
  const totalPaid = routeFiltered
    .filter((p) => p.payment_mode !== 'credit')
    .reduce((acc, p) => acc + Number(p.amount || 0), 0);

  const totalRemaining = routeFiltered
    .filter((p) => p.payment_mode === 'credit')
    .reduce((acc, p) => acc + Number(p.amount || 0), 0);

  const totalCash = routeFiltered
    .filter((p) => p.payment_mode === 'cash')
    .reduce((acc, p) => acc + Number(p.amount || 0), 0);

  const totalCheque = routeFiltered
    .filter((p) => p.payment_mode === 'cheque')
    .reduce((acc, p) => acc + Number(p.amount || 0), 0);

  const totalUpi = routeFiltered
    .filter((p) => p.payment_mode === 'upi')
    .reduce((acc, p) => acc + Number(p.amount || 0), 0);

  // ── 3. Apply Tab & Search Filters for Table ──────────────────────────
  const finalFiltered = routeFiltered.filter((p) => {
    // Hide reversed payments if toggled
    if (hideReversed && p.status === 'reversed') return false;

    // Status tab filter
    if (statusTab === 'paid' && p.payment_mode === 'credit') return false;
    if (statusTab === 'remaining' && p.payment_mode !== 'credit') return false;

    const pt = p.party || parties.find((x) => x.id === p.party_id || x.code === p.party_id);
    // Search filter
    const matchesSearch =
      (pt?.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (p.cheque_number ?? '').toLowerCase().includes(search.toLowerCase()) ||
      ((p as any).invoice_number ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (p.invoice?.invoice_number ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (pt?.code ?? '').toLowerCase().includes(search.toLowerCase());

    return matchesSearch;
  });

  const selectedRouteName =
    selectedRouteId === 'all'
      ? 'All Routes'
      : routes.find((r) => r.id === selectedRouteId)?.name || 'Selected Route';

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Collections & Payments"
        description="Record Cash, Cheque, UPI, and Credit/Udhari payments per delivery route"
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Record Payment</Button>}
      />

      {/* ── ROUTE FILTER BAR & CONTROLS ─────────────────────────────────── */}
      <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-100 dark:border-blue-800/40">
              <Filter className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                Filter Payments by Route
              </h2>
              <p className="text-sm font-extrabold text-surface-900 dark:text-white">
                {selectedRouteName}
              </p>
            </div>
          </div>

          {/* Route Dropdown */}
          <div className="w-full sm:w-64">
            <select
              value={selectedRouteId}
              onChange={(e) => setSelectedRouteId(e.target.value)}
              className="w-full h-10 px-3.5 text-sm border border-surface-300 dark:border-surface-600 rounded-xl bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-surface-100 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <option value="all">📍 All Routes ({payments.length} payments)</option>
              {routes.map((r) => {
                const count = payments.filter((p) => getPaymentRouteId(p) === r.id).length;
                return (
                  <option key={r.id} value={r.id}>
                    {r.name} ({count} payments)
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      {/* ── PAID vs REMAINING SUMMARY CARDS ────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Paid Payment (Collected) */}
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-200/80 dark:border-emerald-800/50 rounded-2xl p-4.5 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
              Paid Payment (Collected)
            </span>
            <div className="h-8 w-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-xs">
              <CheckCircle2 className="h-4.5 w-4.5" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-700 dark:text-emerald-300 tracking-tight">
            {formatCurrency(totalPaid)}
          </div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium flex items-center gap-1">
            <ArrowUpRight className="h-3.5 w-3.5" />
            Cash, Cheque & UPI collections
          </div>
        </div>

        {/* Remaining Payment (Credit / Pending) */}
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200/80 dark:border-amber-800/50 rounded-2xl p-4.5 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
              Remaining Payment (Credit)
            </span>
            <div className="h-8 w-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
              <Clock className="h-4.5 w-4.5" />
            </div>
          </div>
          <div className="text-2xl font-black text-amber-700 dark:text-amber-300 tracking-tight">
            {formatCurrency(totalRemaining)}
          </div>
          <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-medium flex items-center gap-1">
            <ArrowDownRight className="h-3.5 w-3.5" />
            Pending / Udhar to collect
          </div>
        </div>

        {/* Cash Collected */}
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase">
              Cash Collected
            </span>
            <div className="h-7 w-7 rounded-lg bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="text-xl font-extrabold text-surface-900 dark:text-white">
            {formatCurrency(totalCash)}
          </div>
          <div className="text-[10px] text-surface-400 mt-0.5">Physical currency</div>
        </div>

        {/* Cheques & UPI */}
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase">
              Cheques & UPI
            </span>
            <div className="h-7 w-7 rounded-lg bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>
          <div className="text-xl font-extrabold text-surface-900 dark:text-white">
            {formatCurrency(totalCheque + totalUpi)}
          </div>
          <div className="text-[10px] text-surface-400 mt-0.5">
            Cheque: {formatCurrency(totalCheque)} • UPI: {formatCurrency(totalUpi)}
          </div>
        </div>
      </div>

      {/* ── TABS & SEARCH BAR ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Payment Status Tabs */}
        <div className="inline-flex p-1 rounded-xl bg-surface-200/70 dark:bg-surface-800 border border-surface-300/60 dark:border-surface-700 text-xs font-bold">
          <button
            onClick={() => setStatusTab('all')}
            className={`px-4 py-2 rounded-lg transition-all cursor-pointer ${
              statusTab === 'all'
                ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-xs'
                : 'text-surface-600 dark:text-surface-400 hover:text-surface-900'
            }`}
          >
            All Payments ({routeFiltered.length})
          </button>
          <button
            onClick={() => setStatusTab('paid')}
            className={`px-4 py-2 rounded-lg transition-all cursor-pointer ${
              statusTab === 'paid'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-surface-600 dark:text-surface-400 hover:text-emerald-600'
            }`}
          >
            Paid / Collected ({routeFiltered.filter((p) => p.payment_mode !== 'credit').length})
          </button>
          <button
            onClick={() => setStatusTab('remaining')}
            className={`px-4 py-2 rounded-lg transition-all cursor-pointer ${
              statusTab === 'remaining'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-surface-600 dark:text-surface-400 hover:text-amber-600'
            }`}
          >
            Remaining / Credit ({routeFiltered.filter((p) => p.payment_mode === 'credit').length})
          </button>
        </div>

        {/* Filters & Search */}
        <div className="flex items-center gap-3">
          {payments.some((p) => p.status === 'reversed') && (
            <label className="flex items-center gap-1.5 text-xs text-surface-600 dark:text-surface-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideReversed}
                onChange={(e) => setHideReversed(e.target.checked)}
                className="rounded border-surface-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Hide Reversed</span>
            </label>
          )}

          {/* Search */}
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
            <input
              type="text"
              placeholder="Search party or cheque #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-3 text-sm border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>
      </div>

      {/* ── PAYMENTS TABLE ──────────────────────────────────────────────── */}
      {finalFiltered.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-10 w-10 text-surface-400" />}
          title="No payments found"
          description={
            search || selectedRouteId !== 'all' || statusTab !== 'all'
              ? 'Try adjusting your filters or search terms'
              : 'Record cash, cheque, or credit collections from delivery routes'
          }
          action={!search ? <Button size="sm" onClick={openCreate}>Record Payment</Button> : undefined}
        />
      ) : (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl overflow-hidden shadow-xs">
          <table className="dt-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Party / Customer</th>
                <th>Route</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Details / Instrument</th>
                <th>Worker</th>
                <th>Amount</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {finalFiltered.map((p) => {
                const isPaid = p.payment_mode !== 'credit';
                const party = p.party || parties.find((x) => x.id === p.party_id || x.code === p.party_id);
                const routeId =
                  (p.delivery as any)?.picklist?.route_id ||
                  (p.delivery as any)?.picklist?.route?.id ||
                  party?.route_id ||
                  party?.route?.id;
                const matchedRoute = routes.find((r) => r.id === routeId);
                const routeName =
                  (p.delivery?.picklist?.route as any)?.name ||
                  party?.route?.name ||
                  matchedRoute?.name ||
                  'Main Route';

                const isReversed = p.status === 'reversed';
                const isChequePending = p.payment_mode === 'cheque' && p.status === 'pending';

                return (
                  <tr key={p.id} className={isReversed ? 'opacity-60 bg-surface-50/60 dark:bg-surface-900/30' : ''}>
                    <td className="text-xs text-surface-600 dark:text-surface-400 font-medium">
                      {formatDate(p.payment_date)}
                    </td>
                    <td>
                      <div className={`font-bold ${isReversed ? 'line-through text-surface-500' : 'text-surface-900 dark:text-surface-100'}`}>
                        {party ? party.name : 'Unknown Customer'}
                      </div>
                      <div className="font-mono text-[11px] text-surface-400">{party?.code}</div>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-lg bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300 border border-surface-200 dark:border-surface-600">
                        <MapPin className="h-3 w-3 text-surface-400" />
                        {routeName}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={p.payment_mode} />
                    </td>
                    <td>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                          p.status === 'collected' || p.status === 'cleared'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : p.status === 'pending'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : p.status === 'bounced'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-300'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="text-xs text-surface-600 dark:text-surface-400">
                      {p.payment_mode === 'upi' && (
                        <div className="font-mono font-medium text-blue-600 dark:text-blue-400">
                          {p.reference_number ? `UPI Ref: ${p.reference_number}` : p.notes || '—'}
                        </div>
                      )}
                      {p.payment_mode === 'cheque' && (
                        <div className="font-semibold text-purple-600 dark:text-purple-400">
                          #{p.cheque_number} ({p.cheque_bank || 'Bank'})
                          {p.cheque_date ? ` • ${formatDate(p.cheque_date)}` : ''}
                        </div>
                      )}
                      {p.payment_mode !== 'upi' && p.payment_mode !== 'cheque' && (
                        <div>{p.notes || '—'}</div>
                      )}
                    </td>
                    <td className="text-xs text-surface-600 dark:text-surface-400 font-medium">
                      {p.worker ? p.worker.name : '—'}
                    </td>
                    <td>
                      <div
                        className={`font-black text-sm ${
                          isReversed
                            ? 'line-through text-surface-400'
                            : isPaid
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {formatCurrency(p.amount)}
                      </div>
                      <div className="text-[9px] font-bold text-surface-400 uppercase">
                        {isReversed ? 'Void / Reversed' : isPaid ? 'Paid' : 'Remaining'}
                      </div>
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Pending Credit Collection Action */}
                        {(p.payment_mode === 'credit' || p.is_pending_credit) && p.status === 'pending' && (
                          <button
                            onClick={() => {
                              setForm({
                                party_id: p.party_id,
                                delivery_id: p.delivery_id || '',
                                amount: p.amount,
                                payment_mode: 'cash',
                                cheque_number: '',
                                cheque_date: '',
                                cheque_bank: '',
                                notes: `Credit collected for ${p.party?.name || 'Customer'}`,
                                worker_id: p.worker_id || '',
                              });
                              setModalOpen(true);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                            title="Collect Payment & Mark Complete"
                          >
                            <Check className="h-3.5 w-3.5" /> Mark Complete
                          </button>
                        )}

                        {/* View Payment Details */}
                        <button
                          onClick={() => setViewingPayment(p)}
                          className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500 hover:text-surface-900 transition-colors cursor-pointer"
                          title="View Payment Details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>

                        {/* Cheque Lifecycle: Clear or Bounce */}
                        {isChequePending && (
                          <>
                            <button
                              onClick={() =>
                                chequeStatusMut.mutate({ paymentId: p.id, status: 'cleared' })
                              }
                              disabled={chequeStatusMut.isPending}
                              className="px-2 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:hover:bg-emerald-900 dark:text-emerald-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                              title="Mark Cheque Cleared"
                            >
                              <Check className="h-3 w-3" /> Clear
                            </button>
                            <button
                              onClick={() =>
                                chequeStatusMut.mutate({ paymentId: p.id, status: 'bounced' })
                              }
                              disabled={chequeStatusMut.isPending}
                              className="px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 dark:bg-rose-950 dark:hover:bg-rose-900 dark:text-rose-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                              title="Mark Cheque Bounced"
                            >
                              <X className="h-3 w-3" /> Bounce
                            </button>
                          </>
                        )}

                        {/* Reverse / Void Action (Settled Payments Only) */}
                        {!p.is_pending_credit && !isReversed && (
                          <button
                            onClick={() => {
                              setReversingPayment(p);
                              setReversalReason('');
                            }}
                            className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/40 text-surface-400 hover:text-amber-600 transition-colors cursor-pointer"
                            title="Reverse Payment (Append-only Ledger)"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}

                        {/* Admin Permanent Delete Action (Settled Payments Only) */}
                        {canDelete && !p.is_pending_credit && (
                          <button
                            onClick={() => {
                              setDeletingPayment(p);
                              setDeleteReason('');
                            }}
                            className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-surface-400 hover:text-rose-600 transition-colors cursor-pointer"
                            title="Delete Payment (Admin Permanent Delete)"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── RECORD PAYMENT MODAL ────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={form.delivery_id ? "Collect Pending Credit Payment" : "Record Payment Collection"}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button
              loading={createMut.isPending}
              onClick={() => (document.getElementById('pay-form') as HTMLFormElement)?.requestSubmit()}
            >
              Record Payment
            </Button>
          </>
        }
      >
        <form id="pay-form" onSubmit={handleSubmit} className="space-y-3">
          {form.delivery_id && (
            <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-xl px-3 py-2.5">
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                Recording this collection will mark the credit payment as collected, reduce pending credit receivables, and update the party ledger.
              </p>
            </div>
          )}
          <Select
            label="Party / Customer"
            value={form.party_id}
            onChange={(e) => setForm({ ...form, party_id: e.target.value })}
            placeholder="Select customer"
            options={parties.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
            required
          />
          <Select
            label="Payment Mode"
            value={form.payment_mode}
            onChange={(e) => setForm({ ...form, payment_mode: e.target.value as PaymentMode })}
            options={[
              { value: 'cash', label: '💵 Cash Collection' },
              { value: 'cheque', label: '🧾 Cheque Collection' },
              { value: 'upi', label: '📲 Online / UPI (Show QR Code)' },
              { value: 'credit', label: '📋 Credit / Udhari (Remaining)' },
            ]}
          />
          {form.payment_mode === 'upi' && (
            <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800/40 rounded-xl px-3 py-2">
              <Wifi className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
              <p className="text-xs text-orange-700 dark:text-orange-300 font-medium">
                Clicking <strong>Record Payment</strong> will display Sanghavi Traders' QR code for the customer to scan.
              </p>
            </div>
          )}
          <Input
            label="Amount Collected (₹)"
            type="number"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
            required
          />

          {form.payment_mode === 'cheque' && (
            <div className="space-y-3 bg-surface-50 dark:bg-surface-700/50 p-3 rounded-xl border border-surface-200 dark:border-surface-600">
              <Input
                label="Cheque Number"
                value={form.cheque_number}
                onChange={(e) => setForm({ ...form, cheque_number: e.target.value })}
                required
              />
              <Input
                label="Cheque Date"
                type="date"
                value={form.cheque_date}
                onChange={(e) => setForm({ ...form, cheque_date: e.target.value })}
              />
              <Input
                label="Bank Name"
                value={form.cheque_bank}
                onChange={(e) => setForm({ ...form, cheque_bank: e.target.value })}
                placeholder="e.g. HDFC Bank"
              />
            </div>
          )}

          <Select
            label="Worker (Who collected)"
            value={form.worker_id}
            onChange={(e) => setForm({ ...form, worker_id: e.target.value })}
            placeholder="Select worker (optional)"
            options={workers.map((w) => ({ value: w.id, label: w.name }))}
          />

          <Input
            label="Notes / Remarks"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Optional remarks"
          />
        </form>
      </Modal>

      {/* ── UPI QR Overlay ────────────────────────────────────────────── */}
      {showUpiQR && pendingUpiForm && (
        <UPIQRPayment
          amount={pendingUpiForm.amount}
          partyName={upiPartyName}
          onClose={() => {
            setShowUpiQR(false);
            setModalOpen(true);
          }}
          onMarkDone={handleUpiConfirm}
        />
      )}

      {/* ── VIEW PAYMENT DETAILS MODAL ────────────────────────────────────── */}
      <Modal
        open={!!viewingPayment}
        onClose={() => setViewingPayment(null)}
        title="Payment Audit Details"
        footer={<Button variant="secondary" onClick={() => setViewingPayment(null)}>Close</Button>}
      >
        {viewingPayment && (
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] uppercase text-surface-400 font-semibold block">Party</span>
                <span className="font-bold text-sm text-surface-900 dark:text-white">
                  {viewingPayment.party?.name || parties.find((p) => p.id === viewingPayment.party_id)?.name || 'Unknown'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-surface-400 font-semibold block">Amount</span>
                <span className="font-black text-sm text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(viewingPayment.amount)}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-surface-400 font-semibold block">Mode</span>
                <span className="font-semibold uppercase text-surface-800 dark:text-surface-200">{viewingPayment.payment_mode}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-surface-400 font-semibold block">Status</span>
                <span className="font-semibold uppercase text-surface-800 dark:text-surface-200">{viewingPayment.status}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-surface-400 font-semibold block">Payment Date</span>
                <span>{formatDate(viewingPayment.payment_date)}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-surface-400 font-semibold block">Recorded At</span>
                <span>{formatDate(viewingPayment.created_at)}</span>
              </div>
            </div>

            {viewingPayment.payment_mode === 'upi' && (
              <div className="p-3 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50">
                <span className="text-[10px] uppercase text-blue-600 font-bold block">UPI Transaction Reference</span>
                <span className="font-mono text-sm font-bold text-blue-900 dark:text-blue-200">
                  {viewingPayment.reference_number || 'No reference recorded'}
                </span>
              </div>
            )}

            {viewingPayment.payment_mode === 'cheque' && (
              <div className="p-3 rounded-xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/50 space-y-1">
                <span className="text-[10px] uppercase text-purple-600 font-bold block">Cheque Instrument Details</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>Number: <span className="font-mono font-bold">#{viewingPayment.cheque_number || '—'}</span></div>
                  <div>Bank: <span className="font-bold">{viewingPayment.cheque_bank || '—'}</span></div>
                  <div>Cheque Date: <span className="font-medium">{viewingPayment.cheque_date ? formatDate(viewingPayment.cheque_date) : '—'}</span></div>
                  <div>Instrument Status: <span className="font-bold uppercase">{viewingPayment.status}</span></div>
                </div>
              </div>
            )}

            {viewingPayment.status === 'reversed' && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 space-y-1">
                <div className="flex items-center gap-1.5 text-rose-800 dark:text-rose-300 font-bold">
                  <ShieldAlert className="h-4 w-4 text-rose-600" />
                  <span>Payment Reversed / Voided</span>
                </div>
                <div className="text-[11px] text-rose-700 dark:text-rose-300">
                  <div>Reason: <span className="font-semibold">{viewingPayment.reversal_reason || 'Not specified'}</span></div>
                  {viewingPayment.reversed_at && <div>Reversed At: {formatDate(viewingPayment.reversed_at)}</div>}
                  {viewingPayment.reversed_by && <div>Reversed By: {viewingPayment.reversed_by}</div>}
                </div>
              </div>
            )}

            <div className="text-[10px] text-surface-400 space-y-0.5 pt-1">
              <div>Payment ID: <span className="font-mono">{viewingPayment.id}</span></div>
              {viewingPayment.delivery_id && <div>Delivery ID: <span className="font-mono">{viewingPayment.delivery_id}</span></div>}
              {viewingPayment.invoice_id && <div>Invoice ID: <span className="font-mono">{viewingPayment.invoice_id}</span></div>}
              {viewingPayment.picklist_id && <div>Picklist ID: <span className="font-mono">{viewingPayment.picklist_id}</span></div>}
            </div>
          </div>
        )}
      </Modal>

      {/* ── REVERSE PAYMENT CONFIRMATION MODAL ────────────────────────────── */}
      <Modal
        open={!!reversingPayment}
        onClose={() => setReversingPayment(null)}
        title="Reverse Payment Transaction"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReversingPayment(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={reverseMut.isPending}
              onClick={() => {
                if (!reversalReason.trim()) {
                  toast.error('Please provide a mandatory reason for reversing this payment');
                  return;
                }
                if (reversingPayment) {
                  reverseMut.mutate({ paymentId: reversingPayment.id, reason: reversalReason.trim() });
                }
              }}
            >
              Confirm Reversal
            </Button>
          </>
        }
      >
        {reversingPayment && (
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-amber-800 dark:text-amber-300 space-y-1">
                <div className="font-bold">Append-Only Financial Reversal</div>
                <div>
                  This action does NOT delete the payment. It will mark the original transaction as reversed
                  and create an authorized double-entry reversal in the financial ledger, restoring customer receivable.
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-surface-400 uppercase font-semibold">Customer</span>
                <div className="font-bold text-surface-900 dark:text-white">
                  {reversingPayment.party?.name || parties.find((p) => p.id === reversingPayment.party_id)?.name}
                </div>
              </div>
              <div>
                <span className="text-[10px] text-surface-400 uppercase font-semibold">Reversal Amount</span>
                <div className="font-black text-rose-600 dark:text-rose-400">
                  {formatCurrency(reversingPayment.amount)}
                </div>
              </div>
              <div>
                <span className="text-[10px] text-surface-400 uppercase font-semibold">Payment Mode</span>
                <div className="font-semibold uppercase">{reversingPayment.payment_mode}</div>
              </div>
              <div>
                <span className="text-[10px] text-surface-400 uppercase font-semibold">Original Date</span>
                <div>{formatDate(reversingPayment.payment_date)}</div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-surface-700 dark:text-surface-300">
                Mandatory Reversal Reason *
              </label>
              <textarea
                rows={3}
                placeholder="e.g. Cheque dishonored, wrong party selected, cash handover dispute..."
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-500/30"
              />
            </div>
          </div>
        )}
      </Modal>

      {/* ── DELETE PAYMENT CONFIRMATION MODAL ────────────────────────────── */}
      <Modal
        open={!!deletingPayment}
        onClose={() => setDeletingPayment(null)}
        title="Delete Payment Record"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeletingPayment(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={deleteMut.isPending}
              onClick={() => {
                if (deletingPayment) {
                  deleteMut.mutate({
                    paymentId: deletingPayment.id,
                    reason: deleteReason.trim() || 'Deleted by admin',
                  });
                }
              }}
            >
              Confirm Delete
            </Button>
          </>
        }
      >
        {deletingPayment && (
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-rose-800 dark:text-rose-300 space-y-1">
                <div className="font-bold">Permanent Payment Deletion</div>
                <div>
                  This action will permanently delete this payment from the system, remove its credit
                  from the ledger, and restore the customer's outstanding debt balance.
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-surface-400 uppercase font-semibold">Customer</span>
                <div className="font-bold text-surface-900 dark:text-white">
                  {deletingPayment.party?.name || parties.find((p) => p.id === deletingPayment.party_id)?.name}
                </div>
              </div>
              <div>
                <span className="text-[10px] text-surface-400 uppercase font-semibold">Payment Amount</span>
                <div className="font-black text-rose-600 dark:text-rose-400">
                  {formatCurrency(deletingPayment.amount)}
                </div>
              </div>
              <div>
                <span className="text-[10px] text-surface-400 uppercase font-semibold">Payment Mode</span>
                <div className="font-semibold uppercase">{deletingPayment.payment_mode}</div>
              </div>
              <div>
                <span className="text-[10px] text-surface-400 uppercase font-semibold">Payment Status</span>
                <div className="font-semibold uppercase">{deletingPayment.status}</div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-surface-700 dark:text-surface-300">
                Reason for Deletion (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Test payment, clerk error, duplicate entry..."
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-500/30"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
