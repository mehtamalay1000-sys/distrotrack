import { useState } from 'react';
import QRCode from 'react-qr-code';
import { CheckCircle2, Copy, Smartphone, X, RefreshCw } from 'lucide-react';

interface UPIQRPaymentProps {
  amount?: number;
  partyName?: string;
  onClose: () => void;
  onMarkDone: (referenceNumber?: string) => void;
}

// ── SANGHAVI TRADERS UPI CONFIG ────────────────────────────────────────────
const UPI_ID = 'amish0044@icici';
const MERCHANT_NAME = 'SANGHAVI TRADERS';

export function UPIQRPayment({ amount, partyName, onClose, onMarkDone }: UPIQRPaymentProps) {
  const [step, setStep] = useState<'qr' | 'confirm'>('qr');
  const [refNumber, setRefNumber] = useState('');
  const [copied, setCopied] = useState(false);

  // Build UPI deep-link string
  const upiString = amount
    ? `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(MERCHANT_NAME)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(partyName ? `Payment from ${partyName}` : 'DistroTrack Payment')}`
    : `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(MERCHANT_NAME)}&cu=INR`;

  function copyUPI() {
    navigator.clipboard.writeText(UPI_ID).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleMarkDone() {
    onMarkDone(refNumber || undefined);
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-surface-900 rounded-t-3xl sm:rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl border border-surface-200 dark:border-surface-700">

        {/* ── ORANGE HEADER (eazypay style) ── */}
        <div
          className="relative px-5 pt-5 pb-6 text-white overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #FF6B00 0%, #FF8C00 40%, #FFA500 70%, #FFBE00 100%)',
          }}
        >
          {/* Decorative circles */}
          <div className="absolute -top-6 -right-6 h-24 w-24 rounded-full bg-white/10" />
          <div className="absolute top-2 right-8 h-12 w-12 rounded-full bg-white/10" />

          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-full bg-white/20 hover:bg-white/30 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4 text-white" />
          </button>

          <div className="flex items-center gap-2 mb-1">
            <div className="h-6 w-6 bg-white rounded flex items-center justify-center">
              <Smartphone className="h-3.5 w-3.5 text-orange-500" />
            </div>
            <span className="text-[11px] font-bold tracking-wider uppercase text-orange-100">
              Online Payment — UPI
            </span>
          </div>

          <div className="text-white font-black text-2xl tracking-tight">
            {MERCHANT_NAME}
          </div>
          <div className="text-orange-100 text-xs mt-0.5 font-medium">
            VPA ID: <span className="font-mono font-bold text-white">{UPI_ID}</span>
          </div>

          {partyName && (
            <div className="mt-2 bg-white/20 rounded-xl px-3 py-1.5 inline-block">
              <span className="text-[11px] font-bold text-white">
                Collecting from: {partyName}
              </span>
            </div>
          )}
        </div>

        {step === 'qr' ? (
          <div className="p-5 space-y-4">
            {/* Amount Display */}
            {amount && amount > 0 && (
              <div className="text-center bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 rounded-2xl py-2">
                <div className="text-2xl font-black text-emerald-700 dark:text-emerald-300">
                  ₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
                <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wider">
                  Amount to Collect
                </div>
              </div>
            )}

            {/* QR Code */}
            <div className="flex flex-col items-center gap-3">
              <div className="bg-white p-4 rounded-2xl shadow-md border-4 border-orange-100">
                <QRCode
                  value={upiString}
                  size={180}
                  bgColor="#ffffff"
                  fgColor="#1a1a1a"
                  level="M"
                />
              </div>
              <p className="text-xs text-surface-500 dark:text-surface-400 text-center font-medium">
                Ask the customer to scan with any UPI app
              </p>
            </div>

            {/* UPI Apps Accepted Banner */}
            <div className="bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3">
              <div className="text-[10px] text-center text-surface-500 dark:text-surface-400 font-bold uppercase tracking-wider mb-2">
                Accepted with all UPI Apps
              </div>
              <div className="flex items-center justify-center gap-3 text-[11px] font-bold text-surface-600 dark:text-surface-300 flex-wrap">
                {['GPay', 'PhonePe', 'Paytm', 'BHIM', 'ICICI iMobile', 'Pockets'].map((app) => (
                  <span key={app} className="bg-white dark:bg-surface-700 rounded-lg px-2 py-0.5 shadow-sm border border-surface-200 dark:border-surface-600">
                    {app}
                  </span>
                ))}
              </div>
            </div>

            {/* Copy UPI ID */}
            <button
              onClick={copyUPI}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-xs font-bold text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors cursor-pointer"
            >
              {copied ? (
                <><CheckCircle2 className="h-4 w-4 text-emerald-500" /> UPI ID Copied!</>
              ) : (
                <><Copy className="h-4 w-4" /> Copy UPI ID: {UPI_ID}</>
              )}
            </button>

            {/* Next Step */}
            <button
              onClick={() => setStep('confirm')}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-sm font-black shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="h-4.5 w-4.5" />
              Customer Paid — Mark as Done
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Confirm Step */}
            <div className="text-center">
              <div className="h-14 w-14 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center mx-auto mb-3 border-4 border-emerald-200 dark:border-emerald-800/50">
                <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="font-black text-surface-900 dark:text-white text-base">
                Confirm UPI Payment
              </h3>
              <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
                Make sure the customer completed the payment before confirming.
              </p>
            </div>

            {amount && amount > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 rounded-xl px-4 py-3 text-center">
                <div className="text-xl font-black text-emerald-700 dark:text-emerald-300">
                  ₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
                {partyName && (
                  <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
                    from {partyName}
                  </div>
                )}
              </div>
            )}

            {/* Optional UTR/Ref number */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-surface-700 dark:text-surface-300">
                UPI Reference / UTR Number (optional)
              </label>
              <input
                type="text"
                value={refNumber}
                onChange={(e) => setRefNumber(e.target.value)}
                placeholder="e.g. 123456789012"
                className="w-full h-10 px-3 text-xs font-mono border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-orange-400/40"
              />
              <p className="text-[10px] text-surface-400">
                Optional: enter the UTR shown in the customer's UPI app after payment
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep('qr')}
                className="flex-1 py-2.5 rounded-xl border border-surface-300 dark:border-surface-600 text-xs font-bold text-surface-700 dark:text-surface-300 cursor-pointer flex items-center justify-center gap-1.5 hover:bg-surface-50 dark:hover:bg-surface-800"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Show QR Again
              </button>
              <button
                onClick={handleMarkDone}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-md cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
              >
                <CheckCircle2 className="h-4 w-4" /> Confirm Payment
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
