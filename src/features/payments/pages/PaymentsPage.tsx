import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, CreditCard, DollarSign, Search, Trash2, Filter,
  CheckCircle2, Clock, MapPin, ArrowUpRight, ArrowDownRight, Wifi,
} from 'lucide-react';
import { PageHeader, Button, Input, Select, Modal, EmptyState, LoadingState, ErrorState, StatusBadge } from '@/shared/ui';
import { UPIQRPayment } from '@/shared/ui/UPIQRPayment';
import { getPayments, createPayment, deletePayment } from '../services/paymentService';
import { getParties } from '@/features/parties/services/partyService';
import { getWorkers } from '@/features/workers/services/workerService';
import { getRoutes } from '@/features/routes/services/routeService';
import { formatCurrency, formatDate } from '@/shared/utils/format';
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
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['parties'] });
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('Payment recorded');
      closeModal();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deletePayment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['parties'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('Payment deleted');
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
  // ── Helper: Get route ID of a payment ─────────────────────────────────
  function getPaymentRouteId(p: Payment): string | null {
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
    // Status tab filter
    if (statusTab === 'paid' && p.payment_mode === 'credit') return false;
    if (statusTab === 'remaining' && p.payment_mode !== 'credit') return false;

    const pt = p.party || parties.find((x) => x.id === p.party_id || x.code === p.party_id);
    // Search filter
    const matchesSearch =
      (pt?.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (p.cheque_number ?? '').toLowerCase().includes(search.toLowerCase()) ||
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
                <th>Details</th>
                <th>Worker</th>
                <th>Amount</th>
                <th className="w-12" />
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

                return (
                  <tr key={p.id}>
                    <td className="text-xs text-surface-600 dark:text-surface-400 font-medium">
                      {formatDate(p.payment_date)}
                    </td>
                    <td>
                      <div className="font-bold text-surface-900 dark:text-surface-100">
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
                    <td className="text-xs text-surface-600 dark:text-surface-400">
                      {p.payment_mode === 'cheque' && (
                        <div className="font-semibold text-blue-600 dark:text-blue-400">
                          Cheque #{p.cheque_number} ({p.cheque_bank || 'Bank'})
                        </div>
                      )}
                      {p.notes && <div className="text-surface-400">{p.notes}</div>}
                      {p.payment_mode !== 'cheque' && !p.notes && '—'}
                    </td>
                    <td className="text-xs text-surface-600 dark:text-surface-400 font-medium">
                      {p.worker ? p.worker.name : '—'}
                    </td>
                    <td>
                      <div
                        className={`font-black text-sm ${
                          isPaid ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {formatCurrency(p.amount)}
                      </div>
                      <div className="text-[9px] font-bold text-surface-400 uppercase">
                        {isPaid ? 'Paid' : 'Remaining'}
                      </div>
                    </td>
                    <td>
                      <button
                        onClick={() => deleteMut.mutate(p.id)}
                        className="p-1.5 rounded-lg hover:bg-danger-50 dark:hover:bg-danger-950/40 text-surface-400 hover:text-danger-600 transition-colors cursor-pointer"
                        title="Delete payment record"
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

      {/* ── RECORD PAYMENT MODAL ────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title="Record Payment Collection"
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
    </div>
  );
}
