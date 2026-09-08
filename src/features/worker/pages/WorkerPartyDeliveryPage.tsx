import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/app/AuthProvider';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Package,
  User,
  CreditCard,
  CheckCircle2,
  Loader2,
  Banknote,
  FileText,
  AlertTriangle,
  Smartphone,
  Wifi,
  ShieldAlert,
  CheckCheck,
  XCircle,
} from 'lucide-react';
import { getDeliveryDetail, completePartyDelivery } from '../services/workerRouteService';
import { formatCurrency } from '@/shared/utils/format';
import { UPIQRPayment } from '@/shared/ui/UPIQRPayment';
import type { PaymentMode } from '@/lib/database.types';

type Step = 'products' | 'payment';

interface ItemDisposition {
  delivered_qty: number;
  delivered_free_qty: number;
  damaged_qty: number;
  damaged_free_qty: number;
  showDamageInput?: boolean;
}

export function WorkerPartyDeliveryPage() {
  const { deliveryId } = useParams<{ deliveryId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();

  const [step, setStep] = useState<Step>('products');
  const [itemDispositions, setItemDispositions] = useState<Record<string, ItemDisposition>>({});
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [chequeBank, setChequeBank] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [showUpiQR, setShowUpiQR] = useState(false);
  const [upiReference, setUpiReference] = useState('');
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [splitCashAmount, setSplitCashAmount] = useState('');
  const [splitUpiAmount, setSplitUpiAmount] = useState('');
  const [splitUpiReference, setSplitUpiReference] = useState('');

  const { data: delivery, isLoading } = useQuery({
    queryKey: ['delivery-detail', deliveryId],
    queryFn: () => getDeliveryDetail(deliveryId!),
    enabled: !!deliveryId,
  });

  const items = delivery?.items || [];

  // Helper to get or initialize an item's disposition
  const getDisp = (itemId: string, defaultDelivered = 0, defaultFree = 0): ItemDisposition => {
    return (
      itemDispositions[itemId] || {
        delivered_qty: defaultDelivered,
        delivered_free_qty: defaultFree,
        damaged_qty: 0,
        damaged_free_qty: 0,
        showDamageInput: false,
      }
    );
  };

  const updateDisp = (itemId: string, patch: Partial<ItemDisposition>) => {
    setItemDispositions((prev) => ({
      ...prev,
      [itemId]: {
        ...getDisp(itemId),
        ...patch,
      },
    }));
  };

  // Quick Action: Mark All Fully Delivered
  const handleMarkAllDelivered = () => {
    const updated: Record<string, ItemDisposition> = {};
    items.forEach((it) => {
      updated[it.id] = {
        delivered_qty: Number(it.ordered_qty || 0),
        delivered_free_qty: Number(it.free_quantity || 0),
        damaged_qty: 0,
        damaged_free_qty: 0,
        showDamageInput: false,
      };
    });
    setItemDispositions(updated);
    toast.success('All items set to Full Delivery');
  };

  // Quick Action: Mark All Refused / Zero Delivered
  const handleMarkAllRefused = () => {
    const updated: Record<string, ItemDisposition> = {};
    items.forEach((it) => {
      updated[it.id] = {
        delivered_qty: 0,
        delivered_free_qty: 0,
        damaged_qty: 0,
        damaged_free_qty: 0,
        showDamageInput: false,
      };
    });
    setItemDispositions(updated);
    toast.info('All items set to Refused (Remaining in vehicle)');
  };

  // Calculations
  const officialBillTotal = Number(delivery?.total_amount || delivery?.invoice?.net_amount || 0);
  const fullOrderedPreTax = items.reduce(
    (sum, item) => sum + Number(item.ordered_qty || 0) * Number(item.rate || 0),
    0
  );

  const currentDeliveredPreTax = items.reduce((sum, item) => {
    const disp = itemDispositions[item.id];
    // Default to ordered_qty if worker hasn't touched (or current saved delivered_qty)
    const delQty = disp !== undefined ? disp.delivered_qty : Number(item.delivered_qty || 0);
    return sum + delQty * Number(item.rate || 0);
  }, 0);

  let deliveredTotal = officialBillTotal;
  if (officialBillTotal > 0 && fullOrderedPreTax > 0 && currentDeliveredPreTax < fullOrderedPreTax) {
    const ratio = currentDeliveredPreTax / fullOrderedPreTax;
    deliveredTotal = Math.round(officialBillTotal * ratio * 100) / 100;
  } else if (officialBillTotal === 0) {
    deliveredTotal = currentDeliveredPreTax;
  }

  // Pre-fill payment amount when transitioning
  const handleProceedToPayment = () => {
    // Validate quantities
    for (const item of items) {
      const disp = getDisp(item.id, Number(item.delivered_qty || 0), Number(item.delivered_free_qty || 0));
      if (disp.delivered_qty > item.ordered_qty) {
        toast.error(`Delivered qty for ${item.sku} cannot exceed ordered (${item.ordered_qty})`);
        return;
      }
      if (disp.delivered_free_qty > (item.free_quantity || 0)) {
        toast.error(`Delivered free qty for ${item.sku} cannot exceed scheme (${item.free_quantity || 0})`);
        return;
      }
      if (disp.delivered_qty + disp.damaged_qty > item.ordered_qty) {
        toast.error(`Delivered + Damaged for ${item.sku} exceeds ordered (${item.ordered_qty})`);
        return;
      }
      if (disp.delivered_free_qty + disp.damaged_free_qty > (item.free_quantity || 0)) {
        toast.error(`Delivered + Damaged free for ${item.sku} exceeds scheme (${item.free_quantity || 0})`);
        return;
      }
    }

    if (!paymentAmount || Number(paymentAmount) === 0) {
      setPaymentAmount(String(deliveredTotal));
    }
    setStep('payment');
  };

  const completeMut = useMutation({
    mutationFn: () => {
      if (!delivery || !profile) throw new Error('Missing delivery or profile data');

      const deliveredItemsPayload = items.map((item) => {
        // If not explicitly set yet, default to full ordered if delivered_qty was not zero
        const disp = itemDispositions[item.id] || {
          delivered_qty: Number(item.delivered_qty || 0),
          delivered_free_qty: Number(item.delivered_free_qty || 0),
          damaged_qty: Number(item.damaged_qty || 0),
          damaged_free_qty: Number(item.damaged_free_qty || 0),
        };

        const retQty = Math.max(0, item.ordered_qty - disp.delivered_qty - disp.damaged_qty);
        const retFree = Math.max(
          0,
          (item.free_quantity || 0) - disp.delivered_free_qty - disp.damaged_free_qty
        );

        return {
          delivery_item_id: item.id,
          delivered_qty: disp.delivered_qty,
          delivered_free_qty: disp.delivered_free_qty,
          returned_qty: retQty,
          returned_free_qty: retFree,
          damaged_qty: disp.damaged_qty,
          damaged_free_qty: disp.damaged_free_qty,
        };
      });

      let splitPaymentsPayload: Array<{
        mode: PaymentMode;
        amount: number;
        reference_number?: string;
        cheque_number?: string;
        cheque_date?: string;
        cheque_bank?: string;
        notes?: string;
      }> | undefined = undefined;

      let primaryMode = paymentMode;
      let primaryAmount = 0;

      if (isSplitMode) {
        const cashAmt = Number(splitCashAmount || 0);
        const upiAmt = Number(splitUpiAmount || 0);
        const totalSplit = cashAmt + upiAmt;

        if (totalSplit > deliveredTotal) {
          throw new Error(`Total split payment (₹${totalSplit}) exceeds delivered commercial value (₹${deliveredTotal})`);
        }

        if (upiAmt > 0 && !splitUpiReference.trim()) {
          throw new Error('UPI transaction reference / UTR number is required for split UPI payment');
        }

        splitPaymentsPayload = [];
        if (cashAmt > 0) {
          splitPaymentsPayload.push({
            mode: 'cash',
            amount: cashAmt,
            notes: paymentNotes || undefined,
          });
        }
        if (upiAmt > 0) {
          splitPaymentsPayload.push({
            mode: 'upi',
            amount: upiAmt,
            reference_number: splitUpiReference.trim(),
            notes: paymentNotes || undefined,
          });
        }

        primaryMode = splitPaymentsPayload.length > 1 ? ('credit' as any) : (splitPaymentsPayload[0]?.mode || 'credit');
        primaryAmount = totalSplit;
      } else {
        if (paymentMode === 'upi' && Number(paymentAmount || deliveredTotal) > 0) {
          if (!upiReference.trim()) {
            throw new Error('UPI transaction reference / UTR number is required for UPI payment');
          }
        }
        if (paymentMode === 'cheque' && Number(paymentAmount || deliveredTotal) > 0) {
          if (!chequeNumber.trim()) {
            throw new Error('Cheque number is required for cheque payment');
          }
        }
        primaryAmount = paymentMode === 'credit' ? 0 : Number(paymentAmount) >= 0 ? Number(paymentAmount) : deliveredTotal;
        if (primaryAmount > deliveredTotal) {
          throw new Error(`Payment amount (₹${primaryAmount}) exceeds delivered commercial value (₹${deliveredTotal})`);
        }
      }

      return completePartyDelivery({
        deliveryId: delivery.id,
        picklistId: delivery.picklist_id || '',
        partyId: delivery.party_id,
        invoiceId: delivery.invoice_id,
        workerId: profile.id,
        deliveredItems: deliveredItemsPayload,
        payment: {
          mode: primaryMode,
          amount: primaryAmount,
          reference_number: upiReference.trim() || undefined,
          cheque_number: chequeNumber.trim() || undefined,
          cheque_date: chequeDate || undefined,
          cheque_bank: chequeBank.trim() || undefined,
          notes: paymentNotes || undefined,
        },
        payments: splitPaymentsPayload,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worker-route-deliveries'] });
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      qc.invalidateQueries({ queryKey: ['delivery-detail'] });
      toast.success('Delivery recorded in inventory ledger!');
      navigate('/w/route');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!delivery) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-surface-500">Delivery not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-12">
      {/* Header */}
      <div className="sticky top-0 bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800 px-4 py-3 z-10 flex items-center gap-3">
        <button
          onClick={() => navigate('/w/route')}
          className="p-1 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-surface-900 dark:text-white truncate">
            {delivery.party?.name || 'Party'}
          </h1>
          <p className="text-[10px] text-surface-500 dark:text-surface-400">
            {delivery.party?.code} • {delivery.invoice?.invoice_number || 'No Invoice'}
          </p>
        </div>
        <span className="text-xs font-bold text-surface-900 dark:text-white">
          {formatCurrency(officialBillTotal)}
        </span>
      </div>

      {/* Party Info */}
      <div className="p-4 border-b border-surface-100 dark:border-surface-800">
        <div className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
          <User className="h-3.5 w-3.5" />
          <span>{delivery.party?.contact_person || delivery.party?.name}</span>
          {delivery.party?.phone && <span>• {delivery.party.phone}</span>}
        </div>
        {delivery.party?.address && (
          <p className="text-xs text-surface-400 mt-1 ml-5">{delivery.party.address}</p>
        )}
        {(delivery.party?.outstanding_amount || 0) > 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-1 rounded-lg w-fit">
            <AlertTriangle className="h-3 w-3" />
            Outstanding: {formatCurrency(delivery.party?.outstanding_amount || 0)}
          </div>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex border-b border-surface-200 dark:border-surface-800">
        <button
          onClick={() => setStep('products')}
          className={`flex-1 py-2.5 text-xs font-semibold text-center border-b-2 transition-colors ${
            step === 'products'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-surface-400 hover:text-surface-600'
          }`}
        >
          1. Physical Quantities
        </button>
        <button
          onClick={() => items.length > 0 && handleProceedToPayment()}
          className={`flex-1 py-2.5 text-xs font-semibold text-center border-b-2 transition-colors ${
            step === 'payment'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-surface-400 hover:text-surface-600'
          }`}
        >
          2. Payment / Settlement
        </button>
      </div>

      {/* Step 1: Products */}
      {step === 'products' && (
        <div className="p-4 space-y-4">
          {items.length > 0 ? (
            <>
              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleMarkAllDelivered}
                  className="flex-1 py-2 px-3 rounded-lg text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 flex items-center justify-center gap-1.5 hover:bg-emerald-100 transition-colors"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  All Delivered (Full)
                </button>
                <button
                  type="button"
                  onClick={handleMarkAllRefused}
                  className="flex-1 py-2 px-3 rounded-lg text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 flex items-center justify-center gap-1.5 hover:bg-rose-100 transition-colors"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  All Refused (Return)
                </button>
              </div>

              {/* Items List */}
              {items.map((item) => {
                const isFreeItem =
                  Number(item.ordered_qty) === 0 ||
                  Number(item.rate) === 0 ||
                  Number(item.free_quantity) > 0;
                const disp = getDisp(
                  item.id,
                  Number(item.ordered_qty || 0),
                  Number(item.free_quantity || 0)
                );

                const remQty = Math.max(0, item.ordered_qty - disp.delivered_qty - disp.damaged_qty);
                const remFree = Math.max(
                  0,
                  (item.free_quantity || 0) - disp.delivered_free_qty - disp.damaged_free_qty
                );

                const isFullyDelivered =
                  disp.delivered_qty === item.ordered_qty &&
                  disp.delivered_free_qty === (item.free_quantity || 0) &&
                  disp.damaged_qty === 0 &&
                  disp.damaged_free_qty === 0;

                const isRefused =
                  disp.delivered_qty === 0 &&
                  disp.delivered_free_qty === 0 &&
                  disp.damaged_qty === 0;

                return (
                  <div
                    key={item.id}
                    className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3.5 space-y-3 shadow-xs"
                  >
                    {/* Item header */}
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-surface-900 dark:text-white truncate">
                            {item.product_name}
                          </span>
                          {isFreeItem && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              FREE SCHEME
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-surface-500 dark:text-surface-400 font-mono mt-0.5">
                          SKU: {item.sku} • ₹{item.rate}/pc
                        </div>
                      </div>

                      {/* Status Tag */}
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isFullyDelivered
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : isRefused
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {isFullyDelivered ? 'FULL' : isRefused ? 'REFUSED' : 'PARTIAL'}
                      </span>
                    </div>

                    {/* Quantity Manifest Info */}
                    <div className="grid grid-cols-4 gap-2 text-center text-xs py-1.5 px-2 bg-surface-50 dark:bg-surface-900/50 rounded-lg border border-surface-100 dark:border-surface-700/50">
                      <div>
                        <div className="text-[10px] text-surface-400 uppercase">Ordered</div>
                        <div className="font-bold text-surface-800 dark:text-surface-200">
                          {item.ordered_qty}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-surface-400 uppercase">Free</div>
                        <div className="font-bold text-emerald-600 dark:text-emerald-400">
                          {item.free_quantity || 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-surface-400 uppercase">Delivered</div>
                        <div className="font-bold text-blue-600 dark:text-blue-400">
                          {disp.delivered_qty}
                          {disp.delivered_free_qty > 0 ? ` (+${disp.delivered_free_qty})` : ''}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-surface-400 uppercase">Remain</div>
                        <div
                          className={`font-bold ${
                            remQty + remFree > 0
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-surface-500'
                          }`}
                        >
                          {remQty}
                          {remFree > 0 ? ` (+${remFree})` : ''}
                        </div>
                      </div>
                    </div>

                    {/* Quantity Inputs */}
                    <div className="space-y-2 pt-1">
                      {/* Commercial Delivered */}
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-xs font-medium text-surface-700 dark:text-surface-300">
                          Commercial Delivered:
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            max={item.ordered_qty}
                            value={disp.delivered_qty}
                            onChange={(e) => {
                              const val = Math.min(
                                item.ordered_qty,
                                Math.max(0, parseInt(e.target.value, 10) || 0)
                              );
                              updateDisp(item.id, { delivered_qty: val });
                            }}
                            className="w-20 px-2.5 py-1 text-right text-sm font-bold rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-700 text-surface-900 dark:text-white outline-none focus:border-blue-500"
                          />
                          <span className="text-xs text-surface-400">/ {item.ordered_qty}</span>
                        </div>
                      </div>

                      {/* Scheme Free Delivered */}
                      {(item.free_quantity || 0) > 0 && (
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            Free Scheme Delivered:
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              max={item.free_quantity}
                              value={disp.delivered_free_qty}
                              onChange={(e) => {
                                const val = Math.min(
                                  item.free_quantity,
                                  Math.max(0, parseInt(e.target.value, 10) || 0)
                                );
                                updateDisp(item.id, { delivered_free_qty: val });
                              }}
                              className="w-20 px-2.5 py-1 text-right text-sm font-bold rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 outline-none focus:border-emerald-500"
                            />
                            <span className="text-xs text-surface-400">/ {item.free_quantity}</span>
                          </div>
                        </div>
                      )}

                      {/* Damage reporting toggle */}
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateDisp(item.id, { showDamageInput: !disp.showDamageInput })
                          }
                          className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <ShieldAlert className="h-3.5 w-3.5" />
                          {disp.showDamageInput
                            ? 'Hide Transit Damage Input'
                            : disp.damaged_qty > 0 || disp.damaged_free_qty > 0
                            ? `Damaged in Transit: ${disp.damaged_qty} pcs (+${disp.damaged_free_qty} free)`
                            : 'Report Damaged in Transit...'}
                        </button>

                        {disp.showDamageInput && (
                          <div className="mt-2 p-2.5 rounded-lg bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-rose-700 dark:text-rose-300">Damaged Commercial:</span>
                              <input
                                type="number"
                                min="0"
                                max={item.ordered_qty - disp.delivered_qty}
                                value={disp.damaged_qty}
                                onChange={(e) => {
                                  const maxDam = Math.max(0, item.ordered_qty - disp.delivered_qty);
                                  const val = Math.min(
                                    maxDam,
                                    Math.max(0, parseInt(e.target.value, 10) || 0)
                                  );
                                  updateDisp(item.id, { damaged_qty: val });
                                }}
                                className="w-20 px-2 py-0.5 text-right text-xs font-bold rounded border border-rose-300 dark:border-rose-800 bg-white dark:bg-surface-800 text-rose-900 dark:text-rose-200"
                              />
                            </div>
                            {(item.free_quantity || 0) > 0 && (
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-rose-700 dark:text-rose-300">Damaged Free:</span>
                                <input
                                  type="number"
                                  min="0"
                                  max={(item.free_quantity || 0) - disp.delivered_free_qty}
                                  value={disp.damaged_free_qty}
                                  onChange={(e) => {
                                    const maxDamFree = Math.max(
                                      0,
                                      (item.free_quantity || 0) - disp.delivered_free_qty
                                    );
                                    const val = Math.min(
                                      maxDamFree,
                                      Math.max(0, parseInt(e.target.value, 10) || 0)
                                    );
                                    updateDisp(item.id, { damaged_free_qty: val });
                                  }}
                                  className="w-20 px-2 py-0.5 text-right text-xs font-bold rounded border border-rose-300 dark:border-rose-800 bg-white dark:bg-surface-800 text-rose-900 dark:text-rose-200"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Total and next */}
              <div className="bg-surface-50 dark:bg-surface-800/50 rounded-xl p-3 flex items-center justify-between border border-surface-200/60 dark:border-surface-700">
                <span className="text-xs font-medium text-surface-500 dark:text-surface-400">
                  Delivered Total Payable
                </span>
                <span className="text-sm font-bold text-surface-900 dark:text-white">
                  {formatCurrency(deliveredTotal)}
                </span>
              </div>

              <button
                onClick={handleProceedToPayment}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-xs"
              >
                Proceed to Payment / Settlement →
              </button>
            </>
          ) : (
            <div className="text-center py-8">
              <Package className="h-10 w-10 mx-auto text-surface-300 dark:text-surface-600 mb-2" />
              <p className="text-sm text-surface-500 dark:text-surface-400">
                No product items found for this delivery.
              </p>
              <button
                onClick={() => setStep('payment')}
                className="mt-4 px-4 py-2 rounded-lg text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
              >
                Skip to Payment
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Payment */}
      {step === 'payment' && (
        <div className="p-4 space-y-4">
          {/* Amounts */}
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-surface-500 dark:text-surface-400">Invoice Amount</span>
              <span className="font-medium text-surface-900 dark:text-white">
                {formatCurrency(officialBillTotal)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-surface-500 dark:text-surface-400">Actual Delivered Amount</span>
              <span className="font-bold text-surface-900 dark:text-white">
                {formatCurrency(deliveredTotal)}
              </span>
            </div>
          </div>

          {/* Single vs Split payment toggle */}
          <div className="flex items-center justify-between bg-surface-100 dark:bg-surface-800 p-1.5 rounded-xl border border-surface-200 dark:border-surface-700">
            <button
              type="button"
              onClick={() => setIsSplitMode(false)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                !isSplitMode
                  ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-xs'
                  : 'text-surface-500 hover:text-surface-900'
              }`}
            >
              Single Payment
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSplitMode(true);
                if (!splitCashAmount && !splitUpiAmount) {
                  setSplitCashAmount(String(Math.round(deliveredTotal / 2)));
                  setSplitUpiAmount(String(deliveredTotal - Math.round(deliveredTotal / 2)));
                }
              }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                isSplitMode
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-surface-500 hover:text-surface-900'
              }`}
            >
              ⚡ Split (Cash + UPI)
            </button>
          </div>

          {!isSplitMode ? (
            <>
              {/* Payment mode selection */}
              <div>
                <label className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide block mb-2">
                  Payment Method
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { mode: 'cash' as PaymentMode, label: 'Cash', icon: Banknote, color: 'emerald' },
                    { mode: 'cheque' as PaymentMode, label: 'Cheque', icon: FileText, color: 'blue' },
                    { mode: 'upi' as PaymentMode, label: 'Online / UPI', icon: Smartphone, color: 'orange' },
                    { mode: 'credit' as PaymentMode, label: 'Credit / Refused', icon: CreditCard, color: 'amber' },
                  ].map(({ mode, label, icon: Icon, color }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setPaymentMode(mode);
                        if (mode === 'credit') {
                          setPaymentAmount('0');
                        } else {
                          setPaymentAmount(String(deliveredTotal));
                        }
                        if (mode === 'upi') {
                          setShowUpiQR(true);
                        }
                      }}
                      className={`p-2.5 rounded-xl border-2 text-center transition-all cursor-pointer ${
                        paymentMode === mode
                          ? `border-${color}-500 bg-${color}-50 dark:bg-${color}-950/30`
                          : 'border-surface-200 dark:border-surface-700 hover:border-surface-300'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 mx-auto mb-1 ${
                          paymentMode === mode
                            ? `text-${color}-600 dark:text-${color}-400`
                            : 'text-surface-400'
                        }`}
                      />
                      <div
                        className={`text-[11px] font-bold ${
                          paymentMode === mode
                            ? `text-${color}-700 dark:text-${color}-300`
                            : 'text-surface-600 dark:text-surface-400'
                        }`}
                      >
                        {label}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount input */}
              {paymentMode !== 'credit' && (
                <div>
                  <label className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide block mb-1.5">
                    {paymentMode === 'cash'
                      ? 'Cash Amount Collected'
                      : paymentMode === 'cheque'
                      ? 'Cheque Amount'
                      : 'UPI Amount Collected'}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-surface-400 font-medium">
                      ₹
                    </span>
                    <input
                      type="number"
                      min="0"
                      max={deliveredTotal}
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      className="w-full pl-7 pr-3 py-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm font-semibold text-surface-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      placeholder="0"
                    />
                  </div>
                  {Number(paymentAmount) < deliveredTotal && Number(paymentAmount) > 0 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
                      Remaining ₹{deliveredTotal - Number(paymentAmount)} will be added to customer's outstanding balance.
                    </p>
                  )}
                </div>
              )}

              {/* UPI details */}
              {paymentMode === 'upi' && (
                <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-orange-700 dark:text-orange-300 font-bold text-xs">
                    <Smartphone className="h-4 w-4 text-orange-500" />
                    <span>Sanghavi Traders UPI QR (amish0044@icici)</span>
                  </div>
                  <div>
                    <label className="text-xs text-orange-800 dark:text-orange-300 block mb-1 font-bold">
                      UPI UTR / Reference ID (Mandatory)
                    </label>
                    <input
                      type="text"
                      value={upiReference}
                      onChange={(e) => setUpiReference(e.target.value)}
                      placeholder="e.g. 423512345678"
                      className="w-full px-3 py-2 text-xs rounded-lg border border-orange-300 dark:border-orange-700 bg-white dark:bg-surface-900 text-surface-900 dark:text-white font-mono"
                      required
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowUpiQR(true)}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-xs font-black shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all"
                  >
                    <Wifi className="h-4 w-4" />
                    Show QR Code for Customer to Scan
                  </button>
                </div>
              )}

              {/* Cheque details */}
              {paymentMode === 'cheque' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-surface-500 dark:text-surface-400 block mb-1">
                      Cheque Number (Mandatory)
                    </label>
                    <input
                      type="text"
                      value={chequeNumber}
                      onChange={(e) => setChequeNumber(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white outline-none focus:border-blue-500"
                      placeholder="Enter cheque number"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-surface-500 dark:text-surface-400 block mb-1">
                        Bank
                      </label>
                      <input
                        type="text"
                        value={chequeBank}
                        onChange={(e) => setChequeBank(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white outline-none focus:border-blue-500"
                        placeholder="Bank name"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-surface-500 dark:text-surface-400 block mb-1">
                        Date
                      </label>
                      <input
                        type="date"
                        value={chequeDate}
                        onChange={(e) => setChequeDate(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Split Payment UI */
            <div className="space-y-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 rounded-xl p-3.5">
              <div className="flex items-center gap-2 text-xs font-bold text-blue-700 dark:text-blue-300">
                <CreditCard className="h-4 w-4" />
                <span>Split Payment Collection</span>
              </div>
              <div>
                <label className="text-xs text-surface-600 dark:text-surface-400 block mb-1 font-semibold">
                  💵 Cash Portion (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  max={deliveredTotal}
                  value={splitCashAmount}
                  onChange={(e) => setSplitCashAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 font-semibold text-surface-900 dark:text-white"
                  placeholder="Cash amount"
                />
              </div>
              <div>
                <label className="text-xs text-surface-600 dark:text-surface-400 block mb-1 font-semibold">
                  📲 UPI Portion (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  max={deliveredTotal}
                  value={splitUpiAmount}
                  onChange={(e) => setSplitUpiAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 font-semibold text-surface-900 dark:text-white"
                  placeholder="UPI amount"
                />
              </div>
              {Number(splitUpiAmount) > 0 && (
                <div>
                  <label className="text-xs text-surface-600 dark:text-surface-400 block mb-1 font-semibold">
                    UPI Reference / UTR Number (Mandatory)
                  </label>
                  <input
                    type="text"
                    value={splitUpiReference}
                    onChange={(e) => setSplitUpiReference(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 font-mono text-surface-900 dark:text-white"
                    placeholder="Enter UPI UTR / Ref ID"
                  />
                  <button
                    type="button"
                    onClick={() => setShowUpiQR(true)}
                    className="mt-2 text-xs text-orange-600 font-bold underline cursor-pointer"
                  >
                    Open UPI QR for ₹{splitUpiAmount}
                  </button>
                </div>
              )}
              <div className="pt-2 border-t border-blue-200/50 dark:border-blue-900/50 flex justify-between text-xs font-bold">
                <span>Total Collected:</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(Number(splitCashAmount || 0) + Number(splitUpiAmount || 0))}
                </span>
              </div>
              {deliveredTotal > (Number(splitCashAmount || 0) + Number(splitUpiAmount || 0)) && (
                <div className="flex justify-between text-xs text-amber-600 dark:text-amber-400 font-semibold">
                  <span>Balance added to Credit:</span>
                  <span>
                    {formatCurrency(deliveredTotal - (Number(splitCashAmount || 0) + Number(splitUpiAmount || 0)))}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Credit warning */}
          {paymentMode === 'credit' && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-amber-700 dark:text-amber-300">
                <p className="font-semibold">Credit / Refused Settlement</p>
                <p className="mt-0.5">
                  {deliveredTotal > 0
                    ? `${formatCurrency(deliveredTotal)} will be added to ${delivery.party?.name}'s outstanding balance.`
                    : 'All goods refused. Zero balance will be collected, and goods remain on vehicle for route check-in.'}
                </p>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs text-surface-500 dark:text-surface-400 block mb-1">
              Notes (optional)
            </label>
            <textarea
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white outline-none focus:border-blue-500 resize-none"
              placeholder="Any notes about this delivery (e.g. refused reasons, damaged packaging)..."
            />
          </div>

          {/* Complete button */}
          <button
            onClick={() => completeMut.mutate()}
            disabled={completeMut.isPending}
            className="w-full py-3.5 rounded-xl font-semibold text-sm text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md"
          >
            {completeMut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Processing Ledger Movement...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" /> Confirm & Complete Delivery
              </>
            )}
          </button>
        </div>
      )}

      {/* ── UPI QR Code Overlay Modal ─────────────────────────────────────── */}
      {showUpiQR && (
        <UPIQRPayment
          amount={Number(paymentAmount) || deliveredTotal}
          partyName={delivery.party?.name}
          onClose={() => setShowUpiQR(false)}
          onMarkDone={(refNumber) => {
            setShowUpiQR(false);
            if (refNumber) {
              setPaymentNotes((prev) =>
                prev ? `${prev} | UPI Ref: ${refNumber}` : `UPI Ref: ${refNumber}`
              );
            }
            toast.success('UPI Payment verified! You can complete delivery now.');
          }}
        />
      )}
    </div>
  );
}
