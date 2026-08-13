import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/app/AuthProvider';
import { toast } from 'sonner';
import { ArrowLeft, Package, User, CreditCard, CheckCircle2, Loader2, Banknote, FileText, AlertTriangle, Smartphone, Wifi } from 'lucide-react';
import { getDeliveryDetail, completePartyDelivery } from '../services/workerRouteService';
import { formatCurrency } from '@/shared/utils/format';
import { UPIQRPayment } from '@/shared/ui/UPIQRPayment';
import type { PaymentMode } from '@/lib/database.types';

type Step = 'products' | 'payment';

export function WorkerPartyDeliveryPage() {
  const { deliveryId } = useParams<{ deliveryId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();

  const [step, setStep] = useState<Step>('products');
  const [deliveredQtys, setDeliveredQtys] = useState<Record<string, number>>({});
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [chequeBank, setChequeBank] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [showUpiQR, setShowUpiQR] = useState(false);

  const { data: delivery, isLoading } = useQuery({
    queryKey: ['delivery-detail', deliveryId],
    queryFn: () => getDeliveryDetail(deliveryId!),
    enabled: !!deliveryId,
  });

  const completeMut = useMutation({
    mutationFn: () => {
      if (!delivery || !profile) throw new Error('Missing data');
      const items = (delivery.items || []).map(item => ({
        id: item.id,
        delivered_qty: deliveredQtys[item.id] ?? item.ordered_qty,
      }));
      const amount = Number(paymentAmount) > 0 ? Number(paymentAmount) : deliveredTotal;
      return completePartyDelivery({
        deliveryId: delivery.id,
        picklistId: delivery.picklist_id || '',
        partyId: delivery.party_id,
        invoiceId: delivery.invoice_id,
        workerId: profile.id,
        deliveredItems: items,
        payment: {
          mode: paymentMode,
          amount,
          cheque_number: chequeNumber || undefined,
          cheque_date: chequeDate || undefined,
          cheque_bank: chequeBank || undefined,
          notes: paymentNotes || undefined,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worker-route-deliveries'] });
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      qc.invalidateQueries({ queryKey: ['delivery-detail'] });
      toast.success('Delivery completed!');
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

  const items = delivery.items || [];

  // Official SAP Net Payable bill total (including tax)
  const officialBillTotal = Number(delivery.total_amount || delivery.invoice?.net_amount || 0);

  // Pre-tax sum of items as ordered
  const fullOrderedPreTax = items.reduce((sum, item) => sum + Number(item.ordered_qty || 0) * Number(item.rate || 0), 0);

  // Current pre-tax sum based on delivered quantities
  const currentDeliveredPreTax = items.reduce((sum, item) => {
    const effectiveQty = Number(item.ordered_qty) > 0 ? Number(item.ordered_qty) : Number(item.free_quantity || 0);
    const qty = deliveredQtys[item.id] !== undefined ? deliveredQtys[item.id] : effectiveQty;
    return sum + qty * Number(item.rate || 0);
  }, 0);

  // Delivered Total calculation: default to official Net Payable total (₹9,471), scale proportionally if partial delivery
  let deliveredTotal = officialBillTotal;
  if (officialBillTotal > 0 && fullOrderedPreTax > 0 && currentDeliveredPreTax < fullOrderedPreTax) {
    const ratio = currentDeliveredPreTax / fullOrderedPreTax;
    deliveredTotal = Math.round(officialBillTotal * ratio * 100) / 100;
  } else if (officialBillTotal === 0) {
    deliveredTotal = currentDeliveredPreTax;
  }

  // Initialize delivered qtys (support free scheme items where ordered_qty == 0)
  if (Object.keys(deliveredQtys).length === 0 && items.length > 0) {
    const initial: Record<string, number> = {};
    items.forEach(item => {
      const effectiveQty = Number(item.ordered_qty) > 0 ? Number(item.ordered_qty) : Number(item.free_quantity || 0);
      const delQty = Number(item.delivered_qty || 0);
      initial[item.id] = delQty > 0 ? delQty : effectiveQty;
    });
    setDeliveredQtys(initial);
  }

  // Pre-fill payment amount if empty
  if (!paymentAmount && deliveredTotal > 0) {
    setPaymentAmount(String(deliveredTotal));
  }

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="sticky top-0 bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800 px-4 py-3 z-10 flex items-center gap-3">
        <button onClick={() => navigate('/w/route')} className="p-1 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-surface-900 dark:text-white truncate">{delivery.party?.name || 'Party'}</h1>
          <p className="text-[10px] text-surface-500 dark:text-surface-400">{delivery.party?.code} • {delivery.invoice?.invoice_number || 'No Invoice'}</p>
        </div>
        <span className="text-xs font-bold text-surface-900 dark:text-white">{formatCurrency(officialBillTotal)}</span>
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
          className={`flex-1 py-2.5 text-xs font-semibold text-center border-b-2 transition-colors ${step === 'products'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-surface-400 hover:text-surface-600'
            }`}
        >
          1. Products
        </button>
        <button
          onClick={() => items.length > 0 && setStep('payment')}
          className={`flex-1 py-2.5 text-xs font-semibold text-center border-b-2 transition-colors ${step === 'payment'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-surface-400 hover:text-surface-600'
            }`}
        >
          2. Payment
        </button>
      </div>

      {/* Step 1: Products */}
      {step === 'products' && (
        <div className="p-4 space-y-3">
          {items.length > 0 ? (
            <>
              {items.map((item) => {
                const isFreeItem = Number(item.ordered_qty) === 0 || Number(item.rate) === 0 || Number(item.free_quantity) > 0;
                const effectiveOrdered = Number(item.ordered_qty) > 0 ? item.ordered_qty : (item.free_quantity || 0);
                const currentDelivered = (deliveredQtys[item.id] !== undefined && (deliveredQtys[item.id] > 0 || !isFreeItem))
                  ? deliveredQtys[item.id]
                  : effectiveOrdered;

                return (
                  <div key={item.id} className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-surface-900 dark:text-white truncate">{item.product_name}</div>
                          {isFreeItem && (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              FREE SCHEME
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-surface-500 dark:text-surface-400 font-mono">
                          {item.sku} • {Number(item.rate) === 0 ? '₹0/pc (Scheme)' : `₹${item.rate}/pc`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-surface-500 dark:text-surface-400">
                        Ordered: <span className="font-semibold text-surface-900 dark:text-white">
                          {item.ordered_qty > 0 ? item.ordered_qty : `${item.free_quantity || 0} Free`}
                        </span>
                      </span>
                      <div className="flex items-center gap-1.5 bg-surface-50 dark:bg-surface-900/60 px-3 py-1 rounded-lg border border-surface-200/80 dark:border-surface-700">
                        <span className="text-xs text-surface-500 dark:text-surface-400">Delivered:</span>
                        <span className="text-xs font-bold text-surface-900 dark:text-white">
                          {currentDelivered} pcs
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Total and next */}
              <div className="bg-surface-50 dark:bg-surface-800/50 rounded-xl p-3 flex items-center justify-between">
                <span className="text-xs font-medium text-surface-500 dark:text-surface-400">Delivered Total</span>
                <span className="text-sm font-bold text-surface-900 dark:text-white">{formatCurrency(deliveredTotal)}</span>
              </div>

              <button
                onClick={() => setStep('payment')}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-colors"
              >
                Proceed to Payment →
              </button>
            </>
          ) : (
            <div className="text-center py-8">
              <Package className="h-10 w-10 mx-auto text-surface-300 dark:text-surface-600 mb-2" />
              <p className="text-sm text-surface-500 dark:text-surface-400">No product items found for this delivery.</p>
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
              <span className="font-medium text-surface-900 dark:text-white">{formatCurrency(delivery.total_amount)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-surface-500 dark:text-surface-400">Delivered Amount</span>
              <span className="font-semibold text-surface-900 dark:text-white">{formatCurrency(deliveredTotal)}</span>
            </div>
          </div>

          {/* Payment mode selection */}
          <div>
            <label className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide block mb-2">Payment Method</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                { mode: 'cash' as PaymentMode, label: 'Cash', icon: Banknote, color: 'emerald' },
                { mode: 'cheque' as PaymentMode, label: 'Cheque', icon: FileText, color: 'blue' },
                { mode: 'upi' as PaymentMode, label: 'Online / UPI', icon: Smartphone, color: 'orange' },
                { mode: 'credit' as PaymentMode, label: 'Credit', icon: CreditCard, color: 'amber' },
              ]).map(({ mode, label, icon: Icon, color }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setPaymentMode(mode);
                    setPaymentAmount(String(deliveredTotal));
                    if (mode === 'upi') {
                      setShowUpiQR(true);
                    }
                  }}
                  className={`p-2.5 rounded-xl border-2 text-center transition-all cursor-pointer ${paymentMode === mode
                      ? `border-${color}-500 bg-${color}-50 dark:bg-${color}-950/30`
                      : 'border-surface-200 dark:border-surface-700 hover:border-surface-300'
                    }`}
                >
                  <Icon className={`h-4 w-4 mx-auto mb-1 ${paymentMode === mode ? `text-${color}-600 dark:text-${color}-400` : 'text-surface-400'
                    }`} />
                  <div className={`text-[11px] font-bold ${paymentMode === mode ? `text-${color}-700 dark:text-${color}-300` : 'text-surface-600 dark:text-surface-400'
                    }`}>{label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Amount input for Cash, Cheque, UPI, and Credit/Udhari */}
          <div>
            <label className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide block mb-1.5">
              {paymentMode === 'cash' ? 'Cash Amount Collected' : paymentMode === 'cheque' ? 'Cheque Amount' : paymentMode === 'upi' ? 'UPI Amount Collected' : 'Credit / Udhari Amount'}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-surface-400 font-medium">₹</span>
              <input
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="w-full pl-7 pr-3 py-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm font-semibold text-surface-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                placeholder="0"
              />
            </div>
          </div>

          {/* Online / UPI details banner */}
          {paymentMode === 'upi' && (
            <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center gap-2 text-orange-700 dark:text-orange-300 font-bold text-xs">
                <Smartphone className="h-4 w-4 text-orange-500" />
                <span>Sanghavi Traders UPI QR (amish0044@icici)</span>
              </div>
              <p className="text-[11px] text-orange-600 dark:text-orange-400 font-medium">
                Show the QR code to customer to collect {formatCurrency(Number(paymentAmount) || deliveredTotal)} directly into Sanghavi Traders account.
              </p>
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
                <label className="text-xs text-surface-500 dark:text-surface-400 block mb-1">Cheque Number</label>
                <input
                  type="text"
                  value={chequeNumber}
                  onChange={(e) => setChequeNumber(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white outline-none focus:border-blue-500"
                  placeholder="Enter cheque number"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-surface-500 dark:text-surface-400 block mb-1">Bank</label>
                  <input
                    type="text"
                    value={chequeBank}
                    onChange={(e) => setChequeBank(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white outline-none focus:border-blue-500"
                    placeholder="Bank name"
                  />
                </div>
                <div>
                  <label className="text-xs text-surface-500 dark:text-surface-400 block mb-1">Date</label>
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

          {/* Credit warning */}
          {paymentMode === 'credit' && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-amber-700 dark:text-amber-300">
                <p className="font-semibold">Credit / Udhari</p>
                <p className="mt-0.5">{formatCurrency(deliveredTotal)} will be added to {delivery.party?.name}'s outstanding balance.</p>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs text-surface-500 dark:text-surface-400 block mb-1">Notes (optional)</label>
            <textarea
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white outline-none focus:border-blue-500 resize-none"
              placeholder="Any notes about this delivery..."
            />
          </div>

          {/* Complete button */}
          <button
            onClick={() => completeMut.mutate()}
            disabled={completeMut.isPending}
            className="w-full py-3.5 rounded-xl font-semibold text-sm text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md"
          >
            {completeMut.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
            ) : (
              <><CheckCircle2 className="h-4 w-4" /> Complete Delivery</>
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
              setPaymentNotes((prev) => (prev ? `${prev} | UPI Ref: ${refNumber}` : `UPI Ref: ${refNumber}`));
            }
            toast.success('UPI Payment verified! You can complete delivery now.');
          }}
        />
      )}
    </div>
  );
}
