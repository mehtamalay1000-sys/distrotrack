import { useState } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, CreditCard, DollarSign, Search, Filter, CheckCircle2,
  Clock, ArrowUpRight, ArrowDownRight, Loader2, X, Wifi,
} from 'lucide-react';
import { getWorkerPayments, createPayment } from '@/features/payments/services/paymentService';
import { recordPaymentOffline } from '@/lib/offline/worker/index.ts';
import { getParties } from '@/features/parties/services/partyService';
import { getRoutes } from '@/features/routes/services/routeService';
import { formatCurrency, formatDate } from '@/shared/utils/format';
import { UPIQRPayment } from '@/shared/ui/UPIQRPayment';
import type { Payment, PaymentMode } from '@/lib/database.types';

export function WorkerPaymentsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const workerId = profile?.id || '';
  const workerName = profile?.full_name || '';

  const [search, setSearch] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState<string>('all');
  const [statusTab, setStatusTab] = useState<'all' | 'paid' | 'remaining'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [showUpiQR, setShowUpiQR] = useState(false);
  const [pendingUpiForm, setPendingUpiForm] = useState<typeof form | null>(null);
  const [upiPartyName, setUpiPartyName] = useState('');

  const [form, setForm] = useState({
    party_id: '',
    amount: 0,
    payment_mode: 'cash' as PaymentMode,
    cheque_number: '',
    cheque_date: '',
    cheque_bank: '',
    notes: '',
  });

  // Fetch only this worker's payments — auto-refresh every 30 seconds
  const { data: payments = [], isLoading, error, isFetching } = useQuery({
    queryKey: ['worker-payments', workerId, workerName],
    queryFn: () => getWorkerPayments(workerId, workerName),
    // Only fetch after profile is fully resolved; workerId derived from profile.id
    enabled: !!workerId && !!profile,
    refetchInterval: 30_000,          // auto-refresh every 30s
    refetchIntervalInBackground: false, // pause when tab is hidden
    staleTime: 20_000,
  });

  const { data: allRoutes = [] } = useQuery({ queryKey: ['routes'], queryFn: getRoutes });
  const { data: parties = [] } = useQuery({ queryKey: ['parties'], queryFn: getParties });

  // Filter routes to only those assigned to this worker or present in their payments
  const myRoutes = allRoutes.filter((r) => {
    if (r.assigned_worker_id === workerId) return true;
    return payments.some((p) => getPaymentRouteId(p) === r.id);
  });

  const createMut = useMutation({
    mutationFn: async (data: typeof form) => {
      // 1. Commit to IndexedDB and queue RECORD_PAYMENT outbox mutation
      const offlineRes = await recordPaymentOffline({
        partyId: data.party_id,
        amount: Number(data.amount),
        paymentMethod: data.payment_mode,
        workerId,
        chequeNumber: data.cheque_number || undefined,
        chequeDate: data.cheque_date || undefined,
        chequeBank: data.cheque_bank || undefined,
        notes: data.notes || undefined,
      });

      // 2. Best-effort online call if connected
      try {
        await createPayment({
          ...data,
          worker_id: workerId,
        });
      } catch {
        // Safe: outbox will replay when connectivity returns
      }

      return offlineRes;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worker-payments'] });
      qc.invalidateQueries({ queryKey: ['worker-performance-metrics'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
      toast.success(isOnline ? 'Payment collection recorded' : 'Payment saved locally — sync pending');
      closeModal();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openCreate() {
    setForm({
      party_id: '',
      amount: 0,
      payment_mode: 'cash',
      cheque_number: '',
      cheque_date: '',
      cheque_bank: '',
      notes: '',
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.party_id) {
      toast.error('Please select a customer / party');
      return;
    }
    if (!form.amount || form.amount <= 0) {
      toast.error('Please enter a valid amount');
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

  function getPaymentRouteId(p: Payment): string | null {
    const dPicklist = (p.delivery as any)?.picklist;
    if (dPicklist?.route_id) return dPicklist.route_id;
    if (dPicklist?.route?.id) return dPicklist.route.id;
    const pParty = p.party as any;
    if (pParty?.route_id) return pParty.route_id;
    if (pParty?.route?.id) return pParty.route.id;
    return null;
  }

  // 1. Route Filter
  const routeFiltered = payments.filter((p) => {
    if (selectedRouteId === 'all') return true;
    const rId = getPaymentRouteId(p);
    return rId === selectedRouteId;
  });

  // 2. Metrics for Worker's Selected Route
  const totalPaid = routeFiltered
    .filter((p) => p.payment_mode !== 'credit')
    .reduce((acc, p) => acc + Number(p.amount || 0), 0);

  const totalRemaining = routeFiltered
    .filter((p) => p.payment_mode === 'credit')
    .reduce((acc, p) => acc + Number(p.amount || 0), 0);

  const totalCash = routeFiltered
    .filter((p) => p.payment_mode === 'cash')
    .reduce((acc, p) => acc + Number(p.amount || 0), 0);

  const totalChequeUpi = routeFiltered
    .filter((p) => p.payment_mode === 'cheque' || p.payment_mode === 'upi')
    .reduce((acc, p) => acc + Number(p.amount || 0), 0);

  // 3. Tab & Search Filter
  const finalFiltered = routeFiltered.filter((p) => {
    if (statusTab === 'paid' && p.payment_mode === 'credit') return false;
    if (statusTab === 'remaining' && p.payment_mode !== 'credit') return false;

    const matchesSearch =
      (p.party?.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (p.cheque_number ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (p.party?.code ?? '').toLowerCase().includes(search.toLowerCase());

    return matchesSearch;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-red-500 font-semibold">
        Error loading payments: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-lg font-bold text-surface-900 dark:text-white">Route Payments</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-surface-500 dark:text-surface-400">
              Your collections, paid & remaining balances
            </p>
            {isFetching ? (
              <span className="flex items-center gap-1 text-[10px] text-blue-500 font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-ping" />
                Syncing
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Live
              </span>
            )}
          </div>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
        >
          <Plus className="h-4 w-4" /> Collect
        </button>
      </div>

      {/* ── Route Filter ──────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-3.5 shadow-xs flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-100 dark:border-blue-800/40 flex-shrink-0">
            <Filter className="h-4 w-4" />
          </div>
          <span className="text-xs font-bold text-surface-700 dark:text-surface-300 truncate">
            My Routes
          </span>
        </div>

        <select
          value={selectedRouteId}
          onChange={(e) => setSelectedRouteId(e.target.value)}
          className="h-9 px-3 text-xs border border-surface-300 dark:border-surface-600 rounded-xl bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-surface-100 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/30 max-w-[170px]"
        >
          <option value="all">📍 All My Routes ({payments.length})</option>
          {myRoutes.map((r) => {
            const count = payments.filter((p) => getPaymentRouteId(p) === r.id).length;
            return (
              <option key={r.id} value={r.id}>
                {r.name} ({count})
              </option>
            );
          })}
        </select>
      </div>

      {/* ── Summary Stats Grid ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {/* Paid Payment */}
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl p-4 shadow-md space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-100">
              Paid (Collected)
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-200" />
          </div>
          <div className="text-xl font-black tracking-tight">{formatCurrency(totalPaid)}</div>
          <div className="text-[10px] text-emerald-100 font-medium flex items-center gap-1">
            <ArrowUpRight className="h-3 w-3" />
            Cash, Cheque & UPI
          </div>
        </div>

        {/* Remaining Payment */}
        <div className="bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-2xl p-4 shadow-md space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-100">
              Remaining (Credit)
            </span>
            <Clock className="h-4 w-4 text-amber-200" />
          </div>
          <div className="text-xl font-black tracking-tight">{formatCurrency(totalRemaining)}</div>
          <div className="text-[10px] text-amber-100 font-medium flex items-center gap-1">
            <ArrowDownRight className="h-3 w-3" />
            Pending Udhar
          </div>
        </div>
      </div>

      {/* Cash & Cheque Breakdown */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3 flex items-center justify-between">
          <span className="text-surface-500 dark:text-surface-400 font-medium">Cash Collected</span>
          <span className="font-extrabold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalCash)}</span>
        </div>
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3 flex items-center justify-between">
          <span className="text-surface-500 dark:text-surface-400 font-medium">Cheque / UPI</span>
          <span className="font-extrabold text-blue-600 dark:text-blue-400">{formatCurrency(totalChequeUpi)}</span>
        </div>
      </div>

      {/* ── Status Tabs & Search ──────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-1 bg-surface-200/70 dark:bg-surface-800 p-1 rounded-xl border border-surface-300/60 dark:border-surface-700 text-xs font-bold">
          <button
            onClick={() => setStatusTab('all')}
            className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer text-center ${
              statusTab === 'all'
                ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-xs'
                : 'text-surface-500 dark:text-surface-400'
            }`}
          >
            All ({routeFiltered.length})
          </button>
          <button
            onClick={() => setStatusTab('paid')}
            className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer text-center ${
              statusTab === 'paid'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-surface-500 dark:text-surface-400'
            }`}
          >
            Paid ({routeFiltered.filter((p) => p.payment_mode !== 'credit').length})
          </button>
          <button
            onClick={() => setStatusTab('remaining')}
            className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer text-center ${
              statusTab === 'remaining'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-surface-500 dark:text-surface-400'
            }`}
          >
            Credit ({routeFiltered.filter((p) => p.payment_mode === 'credit').length})
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-400" />
          <input
            type="text"
            placeholder="Search party or cheque #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-8 pr-3 text-xs border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>
      </div>

      {/* ── Payments List ─────────────────────────────────────────────── */}
      {finalFiltered.length === 0 ? (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-8 text-center shadow-xs">
          <div className="h-10 w-10 rounded-xl bg-surface-100 dark:bg-surface-700 flex items-center justify-center mx-auto mb-2">
            <CreditCard className="h-5 w-5 text-surface-400" />
          </div>
          <h3 className="text-xs font-bold text-surface-900 dark:text-white">No payments recorded</h3>
          <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-0.5">
            {search ? 'No payments match your search query.' : 'Record payment collections from your route drops.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {finalFiltered.map((p) => {
            const isPaid = p.payment_mode !== 'credit';
            const routeName =
              (p.delivery?.picklist?.route as any)?.name ||
              p.party?.route?.name ||
              'Assigned Route';

            return (
              <div
                key={p.id}
                className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-3.5 flex items-center justify-between shadow-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`h-9 w-9 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                      isPaid
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 border border-emerald-100 dark:border-emerald-800/40'
                        : 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 border border-amber-100 dark:border-amber-800/40'
                    }`}
                  >
                    {p.payment_mode === 'cash' ? (
                      <DollarSign className="h-4 w-4" />
                    ) : p.payment_mode === 'cheque' ? (
                      <CreditCard className="h-4 w-4" />
                    ) : (
                      <Clock className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-surface-900 dark:text-white truncate">
                      {p.party ? p.party.name : 'Customer'}
                    </div>
                    <div className="text-[10px] text-surface-500 dark:text-surface-400 flex items-center gap-1.5 mt-0.5">
                      <span>{formatDate(p.payment_date)}</span>
                      <span>•</span>
                      <span className="truncate">{routeName}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right flex-shrink-0 ml-2">
                  <div
                    className={`text-xs font-black ${
                      isPaid ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {formatCurrency(p.amount)}
                  </div>
                  <div className="text-[9px] font-bold text-surface-400 uppercase">
                    {isPaid ? p.payment_mode : 'Credit / Udhar'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Record Payment Modal ──────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-t-3xl sm:rounded-2xl max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between bg-surface-50 dark:bg-surface-900/50 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                  <CreditCard className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-surface-900 dark:text-white">Record Payment</h3>
                  <p className="text-xs text-surface-500 dark:text-surface-400">Record cash/cheque/credit from party</p>
                </div>
              </div>
              <button
                onClick={closeModal}
                className="p-1 rounded-lg text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 overflow-y-auto space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-surface-700 dark:text-surface-300">Customer / Party *</label>
                <select
                  value={form.party_id}
                  onChange={(e) => setForm({ ...form, party_id: e.target.value })}
                  required
                  className="w-full h-10 px-3 text-xs border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 font-semibold"
                >
                  <option value="">Select customer</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-surface-700 dark:text-surface-300">Payment Mode</label>
                <select
                  value={form.payment_mode}
                  onChange={(e) => setForm({ ...form, payment_mode: e.target.value as PaymentMode })}
                  className="w-full h-10 px-3 text-xs border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 font-semibold"
                >
                  <option value="cash">💵 Cash Collection</option>
                  <option value="cheque">🧾 Cheque Collection</option>
                  <option value="upi">📲 Online / UPI (Show QR Code)</option>
                  <option value="credit">📋 Credit / Udhar (Remaining)</option>
                </select>
                {form.payment_mode === 'upi' && (
                  <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800/40 rounded-xl px-3 py-2 mt-1">
                    <Wifi className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                    <p className="text-[11px] text-orange-700 dark:text-orange-300 font-medium">
                      Clicking <strong>Save Payment</strong> will show Sanghavi Traders' QR code for the customer to scan.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-surface-700 dark:text-surface-300">Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={form.amount || ''}
                  onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                  placeholder="e.g. 5000"
                  required
                  className="w-full h-10 px-3 text-xs font-bold border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100"
                />
              </div>

              {form.payment_mode === 'cheque' && (
                <div className="space-y-2 bg-surface-50 dark:bg-surface-900/60 p-3 rounded-xl border border-surface-200 dark:border-surface-700">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-surface-700 dark:text-surface-300">Cheque Number *</label>
                    <input
                      value={form.cheque_number}
                      onChange={(e) => setForm({ ...form, cheque_number: e.target.value })}
                      required
                      className="w-full h-9 px-3 text-xs border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-surface-700 dark:text-surface-300">Bank Name</label>
                    <input
                      value={form.cheque_bank}
                      onChange={(e) => setForm({ ...form, cheque_bank: e.target.value })}
                      placeholder="e.g. SBI / HDFC"
                      className="w-full h-9 px-3 text-xs border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-bold text-surface-700 dark:text-surface-300">Notes / Remarks</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional remarks"
                  className="w-full h-10 px-3 text-xs border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-2.5 rounded-xl border border-surface-300 dark:border-surface-600 text-xs font-bold text-surface-700 dark:text-surface-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMut.isPending}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {createMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── UPI QR Overlay ────────────────────────────────────────────── */}
      {showUpiQR && pendingUpiForm && (
        <UPIQRPayment
          amount={pendingUpiForm.amount}
          partyName={upiPartyName}
          onClose={() => {
            setShowUpiQR(false);
            setModalOpen(true); // Re-open form if cancelled
          }}
          onMarkDone={handleUpiConfirm}
        />
      )}
    </div>
  );
}
