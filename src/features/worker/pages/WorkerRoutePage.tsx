import { useAuth } from '@/app/AuthProvider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Play,
  Square,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Package,
  ShieldAlert,
  RotateCcw,
  Boxes,
  ArrowRight,
  IndianRupee,
  Receipt,
  Wallet,
} from 'lucide-react';
import {
  getWorkerTodayRoute,
  getRouteDeliveries,
  startRoute,
  getRouteStockCheck,
  closeRouteReconciliation,
  reconcileRouteFinances,
} from '../services/workerRouteService';
import { formatCurrency } from '@/shared/utils/format';
import { supabase } from '@/lib/supabase';
import type { Delivery, RouteReturnItemInput } from '@/lib/database.types';
import { useState } from 'react';

interface RouteExpenseItem {
  id: string;
  category: string;
  amount: string;
  notes: string;
}

interface ItemReturnEntry {
  returned_qty: number;
  damaged_warehouse_qty: number;
}

export function WorkerRoutePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const workerId = profile?.id || '';
  const workerName = profile?.full_name || '';

  // Modals state
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [checkInStep, setCheckInStep] = useState<'stock' | 'finance'>('stock');

  // Stock check-in state
  const [returnEntries, setReturnEntries] = useState<Record<string, ItemReturnEntry>>({});
  const [adminPin, setAdminPin] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [approvedAdminId, setApprovedAdminId] = useState<string | null>(null);
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);

  // Financial check-in state
  const [actualCashHandedOver, setActualCashHandedOver] = useState<string>('');
  const [cashDiscrepancyReason, setCashDiscrepancyReason] = useState<string>('');
  const [cashAdminPin, setCashAdminPin] = useState<string>('');
  const [isVerifyingCashPin, setIsVerifyingCashPin] = useState(false);
  const [approvedCashAdminId, setApprovedCashAdminId] = useState<string | null>(null);

  // Expenses state
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

  // Query authoritative ledger stock for the picklist when closing route
  const { data: stockCheck, isLoading: stockLoading, refetch: refetchStock } = useQuery({
    queryKey: ['route-stock-check', picklist?.id],
    queryFn: () => getRouteStockCheck(picklist!.id),
    enabled: !!picklist?.id && showCheckIn,
  });

  // Query authoritative route financial breakdown
  const { data: routeFinances, refetch: refetchFinances } = useQuery({
    queryKey: ['route-financial-breakdown', picklist?.id],
    queryFn: async () => {
      if (!picklist?.id) return { cash: 0, upi: 0, cheque: 0, credit: 0 };
      const { data: payments = [] } = await supabase
        .from('payments')
        .select('*')
        .eq('picklist_id', picklist.id)
        .not('status', 'in', '("reversed","bounced")');

      const cash = (payments || [])
        .filter((p: any) => p.payment_mode === 'cash')
        .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
      const upi = (payments || [])
        .filter((p: any) => p.payment_mode === 'upi')
        .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
      const cheque = (payments || [])
        .filter((p: any) => p.payment_mode === 'cheque')
        .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);

      const { data: dels = [] } = await supabase
        .from('deliveries')
        .select('delivered_amount, collected_amount')
        .eq('picklist_id', picklist.id)
        .in('status', ['delivered', 'partial']);

      const credit = (dels || []).reduce(
        (sum: number, d: any) =>
          sum + Math.max(0, Number(d.delivered_amount || 0) - Number(d.collected_amount || 0)),
        0
      );

      return { cash, upi, cheque, credit };
    },
    enabled: !!picklist?.id && showCheckIn,
  });

  const startMut = useMutation({
    mutationFn: () => startRoute(picklist!.id, workerId, workerName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      qc.invalidateQueries({ queryKey: ['worker-route-deliveries'] });
      toast.success('Route started! Stock loaded onto vehicle.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeRouteMut = useMutation({
    mutationFn: async () => {
      if (!picklist || !stockCheck) throw new Error('Missing picklist or stock check data');

      // 1. Build return items payload
      const returnPayload: RouteReturnItemInput[] = stockCheck.items.map((item) => {
        const entry = returnEntries[item.product_id] || {
          returned_qty: item.expected_vehicle_qty,
          damaged_warehouse_qty: 0,
        };

        const ret = entry.returned_qty;
        const dam = entry.damaged_warehouse_qty;
        const diff = item.expected_vehicle_qty - (ret + dam);

        return {
          product_id: item.product_id,
          returned_qty: ret,
          damaged_warehouse_qty: dam,
          adjustment_qty: diff !== 0 ? diff : undefined,
          adjustment_reason: diff !== 0 ? adjustmentReason || 'Check-in discrepancy approved' : undefined,
        };
      });

      // 2. Execute atomic closure with stock reconciliation
      const actorId = approvedAdminId || workerId;
      await closeRouteReconciliation(picklist.id, actorId, returnPayload);

      // 3. Format valid route expenses
      const validExpenses = expenseItems
        .filter((i) => parseFloat(i.amount) > 0)
        .map((i) => ({
          category: i.category,
          amount: parseFloat(i.amount),
          description: i.notes || `${i.category} for ${picklist?.route?.name || 'Route'}`,
        }));

      // 4. Calculate expected cash and discrepancy
      const expectedCashAmt = Number(routeFinances?.cash || 0);
      const totalExpensesAmt = validExpenses.reduce((s, i) => s + i.amount, 0);
      const netExpectedCash = Math.max(0, expectedCashAmt - totalExpensesAmt);
      const actualCashNum = actualCashHandedOver === '' ? netExpectedCash : parseFloat(actualCashHandedOver) || 0;
      const discrepancyAmt = actualCashNum - netExpectedCash;
      const isDiscrepancy = Math.abs(discrepancyAmt) > 0.01;

      if (isDiscrepancy && !approvedCashAdminId) {
        throw new Error('Cash discrepancy must be authorized with Admin/Master PIN');
      }

      // 5. Execute atomic route financial reconciliation
      await reconcileRouteFinances({
        picklistId: picklist.id,
        workerId,
        actualCash: actualCashNum,
        expenses: validExpenses,
        discrepancyAuthorized: isDiscrepancy ? !!approvedCashAdminId : false,
        discrepancyReason: isDiscrepancy ? cashDiscrepancyReason || 'Cash discrepancy authorized' : undefined,
        actorId: approvedCashAdminId || approvedAdminId || workerId,
      });

      if (isDiscrepancy && approvedCashAdminId) {
        try {
          await supabase.rpc('log_system_event', {
            p_user_id: approvedCashAdminId,
            p_user_name: 'Admin',
            p_role: 'admin',
            p_module: 'reconciliation',
            p_action: 'cash_discrepancy_authorized',
            p_status: 'warning',
            p_detail: `Cash discrepancy authorized via PIN for picklist ${picklist.picklist_number || picklist.id}: Discrepancy ₹${discrepancyAmt.toFixed(2)}. Reason: ${cashDiscrepancyReason || 'Authorized by Admin'}`,
            p_entity_type: 'picklist',
            p_entity_id: picklist.id,
          });
        } catch {}
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      qc.invalidateQueries({ queryKey: ['worker-recent-routes'] });
      qc.invalidateQueries({ queryKey: ['worker-expenses'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setShowCheckIn(false);
      toast.success('Route closed: Physical stock & finances successfully reconciled!');
      navigate('/w');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleOpenCheckIn = () => {
    // Check if any deliveries remain unresolved
    const unresolved = deliveries.filter(
      (d) => d.status === 'pending' || d.status === 'out_for_delivery'
    );
    if (unresolved.length > 0) {
      toast.error(
        `Cannot end route: ${unresolved.length} delivery(ies) are still unresolved. Mark them delivered or refused first.`
      );
      return;
    }

    setShowCheckIn(true);
    setCheckInStep('stock');
    refetchStock();
    refetchFinances();
  };

  // Helper for return item entry
  const getEntry = (productId: string, defaultExpected = 0): ItemReturnEntry => {
    return (
      returnEntries[productId] || {
        returned_qty: defaultExpected,
        damaged_warehouse_qty: 0,
      }
    );
  };

  const updateEntry = (productId: string, patch: Partial<ItemReturnEntry>) => {
    setReturnEntries((prev) => ({
      ...prev,
      [productId]: {
        ...getEntry(productId),
        ...patch,
      },
    }));
  };

  // Calculate total discrepancy across all items in stockCheck
  const computeDiscrepancy = () => {
    if (!stockCheck?.items) return { totalDiff: 0, hasDiscrepancy: false };
    let totalDiff = 0;
    for (const item of stockCheck.items) {
      const entry = getEntry(item.product_id, item.expected_vehicle_qty);
      const diff = item.expected_vehicle_qty - (entry.returned_qty + entry.damaged_warehouse_qty);
      totalDiff += diff;
    }
    return { totalDiff, hasDiscrepancy: totalDiff !== 0 };
  };

  const { totalDiff, hasDiscrepancy } = computeDiscrepancy();

  // Authorize discrepancy with Admin PIN
  const handleVerifyAdminPin = async () => {
    if (!adminPin) {
      toast.error('Please enter Admin or Master PIN');
      return;
    }
    if (!adjustmentReason.trim()) {
      toast.error('Please provide a mandatory reason for the discrepancy adjustment');
      return;
    }

    setIsVerifyingPin(true);
    try {
      const { data, error } = await supabase.rpc('verify_admin_pin', {
        p_pin: adminPin,
      });

      if (error || !data || !data.valid) {
        toast.error('Invalid Admin or Master PIN. Discrepancy cannot be approved.');
      } else {
        setApprovedAdminId(data.user_id);
        toast.success(`Discrepancy approved by ${data.role.toUpperCase()} (${data.name})`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Verification failed');
    } finally {
      setIsVerifyingPin(false);
    }
  };

  // Authorize cash discrepancy with Admin PIN
  const handleVerifyCashAdminPin = async () => {
    if (!cashAdminPin) {
      toast.error('Please enter Admin or Master PIN');
      return;
    }
    if (!cashDiscrepancyReason.trim()) {
      toast.error('Please provide a mandatory reason for the cash discrepancy');
      return;
    }

    setIsVerifyingCashPin(true);
    try {
      const { data, error } = await supabase.rpc('verify_admin_pin', {
        p_pin: cashAdminPin,
      });

      if (error || !data || !data.valid) {
        toast.error('Invalid Admin or Master PIN. Discrepancy cannot be approved.');
      } else {
        setApprovedCashAdminId(data.user_id);
        toast.success(`Cash discrepancy approved by ${data.role.toUpperCase()} (${data.name})`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Verification failed');
    } finally {
      setIsVerifyingCashPin(false);
    }
  };

  // Financial reconciliation calculations
  const expectedCashAmt = Number(routeFinances?.cash || 0);
  const expectedUpiAmt = Number(routeFinances?.upi || 0);
  const expectedChequeAmt = Number(routeFinances?.cheque || 0);
  const expectedCreditAmt = Number(routeFinances?.credit || 0);
  const totalRouteExpenses = expenseItems
    .filter((i) => parseFloat(i.amount) > 0)
    .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const netExpectedCash = Math.max(0, expectedCashAmt - totalRouteExpenses);
  const enteredActualCash =
    actualCashHandedOver === '' ? netExpectedCash : parseFloat(actualCashHandedOver) || 0;
  const cashDiscrepancy = enteredActualCash - netExpectedCash;
  const hasCashDiscrepancy = Math.abs(cashDiscrepancy) > 0.01;


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
        <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
          No route has been assigned to you yet.
        </p>
      </div>
    );
  }

  const completed = deliveries.filter(
    (d) => d.status === 'delivered' || d.status === 'partial' || d.status === 'refused'
  ).length;
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
    if (d.status === 'refused') return <RotateCcw className="h-5 w-5 text-rose-500" />;
    if (d.status === 'out_for_delivery') return <ChevronRight className="h-5 w-5 text-blue-500" />;
    return <Clock className="h-5 w-5 text-surface-400" />;
  };

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto pb-12">
      {/* Route header */}
      <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-surface-400">
              Assigned Route
            </span>
            <h1 className="text-base font-bold text-surface-900 dark:text-white">
              {picklist.route ? picklist.route.name : 'Daily Delivery Route'}
            </h1>
            <p className="text-xs text-surface-500 dark:text-surface-400">
              Picklist #{picklist.picklist_number}
            </p>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
              isStarted
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300'
            }`}
          >
            {isStarted ? 'In Progress' : 'Not Started'}
          </span>
        </div>

        {/* Progress bar */}
        <div className="space-y-1 mb-4">
          <div className="flex justify-between text-xs text-surface-500 dark:text-surface-400">
            <span>Progress ({completed}/{total} deliveries)</span>
            <span>{total > 0 ? Math.round((completed / total) * 100) : 0}%</span>
          </div>
          <div className="w-full bg-surface-100 dark:bg-surface-700 h-2 rounded-full overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Action button */}
        {!isStarted ? (
          <button
            onClick={() => startMut.mutate()}
            disabled={startMut.isPending}
            className="w-full py-3 rounded-xl font-semibold text-sm text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md"
          >
            {startMut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Loading Stock onto Truck...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" /> Start Route (Load Stock)
              </>
            )}
          </button>
        ) : (
          <div className="flex items-center justify-between pt-2 border-t border-surface-100 dark:border-surface-700">
            <div className="flex items-center gap-2 text-xs text-surface-500">
              <Clock className="h-3.5 w-3.5 text-blue-500" />
              <span>Elapsed: {elapsed || 'Just started'}</span>
            </div>
            <button
              onClick={handleOpenCheckIn}
              className={`px-4 py-2 rounded-lg font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer ${
                allDone
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs'
                  : 'bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-200'
              }`}
            >
              <Square className="h-3.5 w-3.5" /> End Route & Check-in
            </button>
          </div>
        )}
      </div>

      {/* ── ROUTE CHECK-IN & RECONCILIATION MODAL ─────────────────────── */}
      {showCheckIn && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-surface-100 dark:border-surface-700 pb-3">
              <div>
                <h3 className="text-sm font-bold text-surface-900 dark:text-white flex items-center gap-2">
                  <Boxes className="h-4 w-4 text-blue-600" />
                  Route Physical Stock Check-In
                </h3>
                <p className="text-[11px] text-surface-400">
                  Reconcile vehicle stock with warehouse return before closing.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCheckIn(false)}
                className="text-surface-400 hover:text-surface-600 p-1 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Check-In Steps */}
            <div className="flex border-b border-surface-200 dark:border-surface-700 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setCheckInStep('stock')}
                className={`flex-1 py-2 text-center border-b-2 ${
                  checkInStep === 'stock'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-surface-400'
                }`}
              >
                1. Vehicle Stock Check
              </button>
              <button
                type="button"
                onClick={() => {
                  if (hasDiscrepancy && !approvedAdminId) {
                    toast.error('Please resolve or authorize the inventory discrepancy first');
                    return;
                  }
                  setCheckInStep('finance');
                }}
                className={`flex-1 py-2 text-center border-b-2 ${
                  checkInStep === 'finance'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-surface-400'
                }`}
              >
                2. Financial Reconciliation
              </button>
            </div>

            {/* Step 1: Physical Stock Check */}
            {checkInStep === 'stock' && (
              <div className="space-y-3 overflow-y-auto pr-1 flex-1">
                {stockLoading ? (
                  <div className="py-8 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                  </div>
                ) : !stockCheck || stockCheck.items.length === 0 ? (
                  <div className="py-8 text-center text-xs text-surface-400">
                    No ledger stock movements found for this route.
                  </div>
                ) : (
                  <>
                    {/* Summary banner */}
                    <div className="grid grid-cols-4 gap-2 text-center text-xs p-2.5 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700">
                      <div>
                        <div className="text-[10px] text-surface-400">Loaded</div>
                        <div className="font-bold text-surface-800 dark:text-surface-100">
                          {stockCheck.total_loaded}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-surface-400">Delivered</div>
                        <div className="font-bold text-emerald-600">
                          {stockCheck.total_delivered}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-surface-400">Damaged</div>
                        <div className="font-bold text-rose-600">
                          {stockCheck.total_damaged}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-surface-400">Expected Ret</div>
                        <div className="font-bold text-blue-600">
                          {stockCheck.total_expected_return}
                        </div>
                      </div>
                    </div>

                    {/* Product Rows */}
                    <div className="space-y-2.5">
                      {stockCheck.items.map((it) => {
                        const entry = getEntry(it.product_id, it.expected_vehicle_qty);
                        const enteredReturn = entry.returned_qty;
                        const enteredDamWh = entry.damaged_warehouse_qty;
                        const diff = it.expected_vehicle_qty - (enteredReturn + enteredDamWh);

                        return (
                          <div
                            key={it.product_id}
                            className="p-3 rounded-xl bg-surface-50 dark:bg-surface-900/60 border border-surface-200 dark:border-surface-700 space-y-2 text-xs"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="font-bold text-surface-900 dark:text-white">
                                  {it.product_name}
                                </div>
                                <div className="font-mono text-[10px] text-surface-400">
                                  SKU: {it.sku}
                                </div>
                              </div>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  diff === 0
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                    : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                }`}
                              >
                                {diff === 0
                                  ? 'Balanced'
                                  : diff > 0
                                  ? `Shortage: -${diff}`
                                  : `Surplus: +${Math.abs(diff)}`}
                              </span>
                            </div>

                            <div className="grid grid-cols-3 gap-2 text-[11px] text-surface-600 dark:text-surface-400">
                              <div>
                                Loaded: <span className="font-semibold">{it.loaded_qty}</span>
                              </div>
                              <div>
                                Delivered: <span className="font-semibold">{it.delivered_qty}</span>
                              </div>
                              <div>
                                Expected: <span className="font-bold text-blue-600">{it.expected_vehicle_qty}</span>
                              </div>
                            </div>

                            {/* Return Inputs */}
                            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-surface-200/50 dark:border-surface-700/50">
                              <div>
                                <label className="text-[10px] text-surface-500 font-medium block mb-0.5">
                                  Actual Return to Warehouse:
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  value={enteredReturn}
                                  onChange={(e) =>
                                    updateEntry(it.product_id, {
                                      returned_qty: Math.max(0, parseInt(e.target.value, 10) || 0),
                                    })
                                  }
                                  className="w-full h-8 px-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-xs font-bold text-surface-900 dark:text-white"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-rose-600 font-medium block mb-0.5">
                                  Warehouse Damaged:
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  value={enteredDamWh}
                                  onChange={(e) =>
                                    updateEntry(it.product_id, {
                                      damaged_warehouse_qty: Math.max(
                                        0,
                                        parseInt(e.target.value, 10) || 0
                                      ),
                                    })
                                  }
                                  className="w-full h-8 px-2 rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-surface-800 text-xs font-bold text-rose-700 dark:text-rose-300"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Discrepancy Alert & Authorization */}
                    {hasDiscrepancy && (
                      <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-800 space-y-2">
                        <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300 font-bold text-xs">
                          <ShieldAlert className="h-4 w-4 text-rose-600" />
                          <span>Stock Discrepancy Detected (Net: {totalDiff} pcs)</span>
                        </div>
                        <p className="text-[11px] text-rose-700 dark:text-rose-300">
                          The system enforces strict stock conservation. Workers cannot self-approve
                          discrepancies. An Admin or Master PIN is required to authorize this adjustment.
                        </p>

                        {!approvedAdminId ? (
                          <div className="space-y-2 pt-1">
                            <div>
                              <label className="text-[10px] font-bold uppercase text-surface-500">
                                Discrepancy Reason (Mandatory)
                              </label>
                              <input
                                type="text"
                                placeholder="e.g. Broken carton on truck, physical count error"
                                value={adjustmentReason}
                                onChange={(e) => setAdjustmentReason(e.target.value)}
                                className="w-full h-8 px-2 text-xs rounded border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800"
                              />
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="password"
                                maxLength={6}
                                placeholder="Admin PIN"
                                value={adminPin}
                                onChange={(e) => setAdminPin(e.target.value)}
                                className="w-32 h-8 px-2 text-xs font-mono tracking-widest text-center rounded border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800"
                              />
                              <button
                                type="button"
                                onClick={handleVerifyAdminPin}
                                disabled={isVerifyingPin}
                                className="px-3 h-8 rounded bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition-colors cursor-pointer"
                              >
                                {isVerifyingPin ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Authorize'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4" />
                            Adjustment authorized by supervisor. Reason: {adjustmentReason}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Button to proceed to financial check */}
                    <button
                      type="button"
                      onClick={() => {
                        if (hasDiscrepancy && !approvedAdminId) {
                          toast.error('Authorize inventory discrepancy with Admin PIN before proceeding');
                          return;
                        }
                        setCheckInStep('finance');
                      }}
                      className="w-full py-2.5 rounded-xl font-bold text-xs text-white bg-blue-600 hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      Continue to Financial Check <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Step 2: Financial Reconciliation & Handover */}
            {checkInStep === 'finance' && (
              <div className="space-y-3 overflow-y-auto pr-1 flex-1">
                {/* 1. Authoritative Collections Breakdown */}
                <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-900/60 border border-surface-200 dark:border-surface-700 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-surface-700 dark:text-surface-200">
                    <IndianRupee className="h-4 w-4 text-emerald-600" />
                    <span>Authoritative Collections Summary</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
                      <div className="text-[10px] text-surface-400 font-medium uppercase">Cash Collected</div>
                      <div className="font-black text-sm text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(expectedCashAmt)}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
                      <div className="text-[10px] text-surface-400 font-medium uppercase">UPI Collected</div>
                      <div className="font-black text-sm text-blue-600 dark:text-blue-400">
                        {formatCurrency(expectedUpiAmt)}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
                      <div className="text-[10px] text-surface-400 font-medium uppercase">Cheques</div>
                      <div className="font-black text-sm text-purple-600 dark:text-purple-400">
                        {formatCurrency(expectedChequeAmt)}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
                      <div className="text-[10px] text-surface-400 font-medium uppercase">Credit Sales</div>
                      <div className="font-black text-sm text-amber-600 dark:text-amber-400">
                        {formatCurrency(expectedCreditAmt)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Route Expenses */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-surface-700 dark:text-surface-300 flex items-center gap-1">
                      <Receipt className="h-3.5 w-3.5 text-surface-400" />
                      Approved Route Expenses (Fuel, Food, Fare)
                    </span>
                    <button
                      type="button"
                      onClick={addExpenseRow}
                      className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      + Add Expense
                    </button>
                  </div>

                  {expenseItems.map((item, idx) => (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-xl bg-surface-50 dark:bg-surface-900/60 border border-surface-200 dark:border-surface-700 space-y-2 relative"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-surface-500 uppercase">
                          Expense #{idx + 1}
                        </span>
                        {expenseItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeExpenseRow(item.id)}
                            className="text-[10px] text-red-500 hover:underline font-semibold cursor-pointer"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-surface-500 mb-0.5">Category</label>
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
                          <label className="block text-[10px] text-surface-500 mb-0.5">Amount (₹)</label>
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
                          placeholder="Notes / Description"
                          value={item.notes}
                          onChange={(e) => updateExpenseRow(item.id, 'notes', e.target.value)}
                          className="w-full h-7 px-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-[11px] text-surface-900 dark:text-white outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* 3. Expected Physical Cash vs Handover */}
                <div className="p-3.5 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-surface-600 dark:text-surface-400">Cash Collected:</span>
                    <span className="font-semibold text-surface-900 dark:text-white">{formatCurrency(expectedCashAmt)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-surface-600 dark:text-surface-400">Total Route Expenses:</span>
                    <span className="font-semibold text-rose-600 dark:text-rose-400">- {formatCurrency(totalRouteExpenses)}</span>
                  </div>
                  <div className="pt-2 border-t border-blue-200 dark:border-blue-800/50 flex items-center justify-between">
                    <div className="text-xs font-bold text-surface-900 dark:text-white flex items-center gap-1.5">
                      <Wallet className="h-4 w-4 text-blue-600" />
                      Net Cash to Hand Over:
                    </div>
                    <div className="text-base font-black text-blue-700 dark:text-blue-300">
                      {formatCurrency(netExpectedCash)}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-blue-200 dark:border-blue-800/50 space-y-1">
                    <label className="block text-[11px] font-bold text-surface-700 dark:text-surface-300">
                      Actual Cash Handed Over (₹):
                    </label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="number"
                        step="0.01"
                        placeholder={netExpectedCash.toString()}
                        value={actualCashHandedOver}
                        onChange={(e) => setActualCashHandedOver(e.target.value)}
                        className="flex-1 h-9 px-3 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-sm font-black text-surface-900 dark:text-white"
                      />
                      <span
                        className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border whitespace-nowrap ${
                          !hasCashDiscrepancy
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border-rose-200'
                        }`}
                      >
                        {!hasCashDiscrepancy
                          ? 'Balanced'
                          : cashDiscrepancy > 0
                          ? `Surplus: +₹${cashDiscrepancy.toFixed(2)}`
                          : `Shortage: -₹${Math.abs(cashDiscrepancy).toFixed(2)}`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4. Discrepancy Authorization with Admin PIN */}
                {hasCashDiscrepancy && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-800 space-y-2">
                    <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300 font-bold text-xs">
                      <ShieldAlert className="h-4 w-4 text-rose-600" />
                      <span>Cash Discrepancy Authorization Required</span>
                    </div>
                    <p className="text-[11px] text-rose-700 dark:text-rose-300">
                      Declared actual cash differs from net expected cash. A supervisor or admin PIN
                      is required to authorize this difference.
                    </p>

                    {!approvedCashAdminId ? (
                      <div className="space-y-2 pt-1">
                        <div>
                          <label className="text-[10px] font-bold uppercase text-surface-500">
                            Discrepancy Reason (Mandatory)
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Counter change shortage, denomination mismatch"
                            value={cashDiscrepancyReason}
                            onChange={(e) => setCashDiscrepancyReason(e.target.value)}
                            className="w-full h-8 px-2 text-xs rounded border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800"
                          />
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            maxLength={6}
                            placeholder="Admin PIN"
                            value={cashAdminPin}
                            onChange={(e) => setCashAdminPin(e.target.value)}
                            className="w-32 h-8 px-2 text-xs font-mono tracking-widest text-center rounded border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800"
                          />
                          <button
                            type="button"
                            onClick={handleVerifyCashAdminPin}
                            disabled={isVerifyingCashPin}
                            className="px-3 h-8 rounded bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition-colors cursor-pointer"
                          >
                            {isVerifyingCashPin ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Authorize'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4" />
                        Discrepancy authorized by supervisor. Reason: {cashDiscrepancyReason}
                      </div>
                    )}
                  </div>
                )}

                {/* Final Confirmation Button */}
                <div className="pt-2 space-y-2">
                  <button
                    type="button"
                    onClick={() => closeRouteMut.mutate()}
                    disabled={closeRouteMut.isPending || (hasCashDiscrepancy && !approvedCashAdminId)}
                    className="w-full py-3 rounded-xl font-bold text-xs text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md"
                  >
                    {closeRouteMut.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Reconciling Stock & Finances...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" /> Finalize Route & Hand Over Cash
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCheckInStep('stock')}
                    className="w-full py-2 rounded-xl text-xs font-semibold text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-700 hover:bg-surface-100"
                  >
                    ← Back to Stock Counts
                  </button>
                </div>
              </div>
            )}
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
            const isDone =
              d.status === 'delivered' || d.status === 'partial' || d.status === 'refused';
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
                  <div
                    className={`text-sm font-medium truncate ${
                      isDone
                        ? 'text-surface-500 dark:text-surface-400 line-through'
                        : 'text-surface-900 dark:text-white'
                    }`}
                  >
                    {d.party?.name || 'Unknown Party'}
                  </div>
                  <div className="text-[10px] text-surface-500 dark:text-surface-400 mt-0.5">
                    {d.party?.code}
                    {d.invoice?.invoice_number ? ` • Inv #${d.invoice.invoice_number}` : ''}
                    {` • ${formatCurrency(d.total_amount)}`}
                    {isDone && d.payment_mode && ` • ${d.payment_mode.toUpperCase()}`}
                  </div>
                </div>
                {isDone ? (
                  <div className="text-right">
                    <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(d.collected_amount)}
                    </div>
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
