/**
 * PendingCollectionsPanel — Admin/Master actionable credit receivables queue.
 *
 * Shows all deliveries where delivered_amount > collected_amount (i.e., credit
 * sales not yet fully collected). Admin can "Mark Collected" from here, which
 * calls record_party_payment_with_ledger — the existing authoritative payment RPC.
 *
 * FINANCIAL IDENTITY:
 *   Sale = delivered_amount (immutable — stays fixed even after collection)
 *   Collected = collected_amount (increases as payments recorded)
 *   Pending = delivered_amount - collected_amount (decreases toward 0)
 *
 * Collection does NOT change Sales. It only moves Pending → Collected.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queryKeys';
import { formatCurrency } from '@/shared/utils/format';
import { toast } from 'sonner';
import {
  Clock, CheckCircle2, IndianRupee, X, Loader2,
  AlertCircle, Building2, FileText,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────

export interface PendingCreditItem {
  delivery_id: string;
  delivery_date: string;
  delivery_status: string;
  sale_amount: number;
  collected_amount: number;
  pending_amount: number;
  payment_mode: string | null;
  picklist_id: string;
  worker_id: string;
  party_id: string;
  party_name: string;
  party_code: string | null;
  invoice_number: string | null;
  invoice_amount: number | null;
  route_id: string | null;
  route_name: string | null;
  route_code: string | null;
  worker_name: string | null;
  picklist_number: string;
  route_date: string;
  days_outstanding: number;
}

// ── Data fetcher ────────────────────────────────────────────────────

async function fetchPendingCreditDeliveries(): Promise<PendingCreditItem[]> {
  try {
    const { data, error } = await supabase.rpc('get_pending_credit_deliveries', {
      p_limit: 100,
      p_offset: 0,
    });
    if (error) throw error;
    return (Array.isArray(data) ? data : []) as PendingCreditItem[];
  } catch {
    // Fallback: direct query (for environments where migration 038 not yet applied)
    const { data } = await supabase
      .from('deliveries')
      .select(`
        id,
        delivery_date,
        status,
        delivered_amount,
        collected_amount,
        payment_mode,
        picklist_id,
        worker_id,
        party:parties(id, name, code),
        invoice:invoices(invoice_number, net_amount),
        picklist:picklists(picklist_number, date, route:routes(id, name, code)),
        worker:workers!deliveries_worker_id_fkey(name)
      `)
      .in('status', ['delivered', 'partial'])
      .order('delivery_date', { ascending: true })
      .limit(100);

    return ((data as any[]) || [])
      .filter((d: any) => Number(d.delivered_amount ?? 0) > Number(d.collected_amount ?? 0))
      .map((d: any) => ({
        delivery_id: d.id,
        delivery_date: d.delivery_date,
        delivery_status: d.status,
        sale_amount: Number(d.delivered_amount ?? 0),
        collected_amount: Number(d.collected_amount ?? 0),
        pending_amount: Math.max(0, Number(d.delivered_amount ?? 0) - Number(d.collected_amount ?? 0)),
        payment_mode: d.payment_mode,
        picklist_id: d.picklist_id,
        worker_id: d.worker_id,
        party_id: d.party?.id ?? '',
        party_name: d.party?.name ?? 'Unknown',
        party_code: d.party?.code ?? null,
        invoice_number: d.invoice?.invoice_number ?? null,
        invoice_amount: d.invoice?.net_amount ?? null,
        route_id: d.picklist?.route?.id ?? null,
        route_name: d.picklist?.route?.name ?? null,
        route_code: d.picklist?.route?.code ?? null,
        worker_name: d.worker?.name ?? null,
        picklist_number: d.picklist?.picklist_number ?? '',
        route_date: d.picklist?.date ?? d.delivery_date,
        days_outstanding: Math.floor(
          (Date.now() - new Date(d.delivery_date).getTime()) / 86400000
        ),
      }));
  }
}

// ── Mark Collected Modal ────────────────────────────────────────────

interface CollectModalProps {
  item: PendingCreditItem;
  onClose: () => void;
  onSuccess: () => void;
}

function CollectModal({ item, onClose, onSuccess }: CollectModalProps) {
  const [amount, setAmount] = useState(item.pending_amount.toFixed(2));
  const [method, setMethod] = useState<'cash' | 'upi' | 'cheque'>('cash');
  const [reference, setReference] = useState('');
  const [chequeNum, setChequeNum] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [chequeBank, setChequeBank] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const collectionDate = new Date().toISOString().split('T')[0];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (amt > item.pending_amount + 0.01) {
      toast.error(`Amount cannot exceed pending ₹${item.pending_amount.toFixed(2)}`);
      return;
    }

    setLoading(true);
    try {
      const idempotencyKey = `collect:${item.delivery_id}:${Date.now()}`;
      const { error } = await supabase.rpc('record_party_payment_with_ledger', {
        p_party_id: item.party_id,
        p_amount: amt,
        p_payment_mode: method,
        p_delivery_id: item.delivery_id,
        p_picklist_id: item.picklist_id || null,
        p_route_id: item.route_id || null,
        p_worker_id: item.worker_id || null,
        p_reference_number: reference || null,
        p_cheque_number: method === 'cheque' ? chequeNum : null,
        p_cheque_date: method === 'cheque' ? chequeDate : null,
        p_cheque_bank: method === 'cheque' ? chequeBank : null,
        p_notes: notes || `Credit collection: ${item.party_name} — ${item.invoice_number || item.delivery_id}`,
        p_payment_date: collectionDate,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      toast.success(`₹${amt.toFixed(2)} collected from ${item.party_name}`);
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || 'Collection failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Mark Credit Collected</h3>
            <p className="text-xs text-slate-500 mt-0.5">{item.party_name} {item.party_code ? `(${item.party_code})` : ''}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        {/* Sale Summary */}
        <div className="mx-5 mt-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <div className="text-[10px] text-slate-500 uppercase font-semibold mb-0.5">Sale</div>
            <div className="font-bold text-slate-900 dark:text-white">{formatCurrency(item.sale_amount)}</div>
            <div className="text-[9px] text-slate-400">immutable</div>
          </div>
          <div>
            <div className="text-[10px] text-emerald-600 uppercase font-semibold mb-0.5">Collected</div>
            <div className="font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(item.collected_amount)}</div>
          </div>
          <div>
            <div className="text-[10px] text-amber-600 uppercase font-semibold mb-0.5">Pending</div>
            <div className="font-bold text-amber-700 dark:text-amber-300">{formatCurrency(item.pending_amount)}</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Amount */}
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1.5">
              Collection Amount (max: {formatCurrency(item.pending_amount)})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">₹</span>
              <input
                type="number"
                min="0.01"
                max={item.pending_amount}
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full pl-7 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl text-sm font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1.5">Payment Method</label>
            <div className="grid grid-cols-3 gap-2">
              {(['cash', 'upi', 'cheque'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    method === m
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-600 hover:border-blue-400'
                  }`}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Cheque fields */}
          {method === 'cheque' && (
            <div className="space-y-2 p-3 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-xl">
              <div className="text-xs font-semibold text-sky-700 dark:text-sky-400 mb-1">Cheque Details</div>
              <input placeholder="Cheque No." value={chequeNum} onChange={e => setChequeNum(e.target.value)}
                className="w-full px-3 py-2 border border-sky-300 dark:border-sky-700 rounded-lg text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500" />
              <input type="date" value={chequeDate} onChange={e => setChequeDate(e.target.value)}
                className="w-full px-3 py-2 border border-sky-300 dark:border-sky-700 rounded-lg text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500" />
              <input placeholder="Bank Name" value={chequeBank} onChange={e => setChequeBank(e.target.value)}
                className="w-full px-3 py-2 border border-sky-300 dark:border-sky-700 rounded-lg text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
          )}

          {/* UPI Reference */}
          {method === 'upi' && (
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1.5">UPI Reference (optional)</label>
              <input placeholder="UTR / Transaction ID" value={reference} onChange={e => setReference(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1.5">Notes (optional)</label>
            <input placeholder="Collection notes..." value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Invariant reminder */}
          <div className="flex items-start gap-2 p-2.5 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800">
            <AlertCircle className="h-3.5 w-3.5 text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-blue-700 dark:text-blue-400">
              Sale remains <strong>{formatCurrency(item.sale_amount)}</strong>. This collection only moves Pending → Collected. Sales do not change.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-colors cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {loading ? 'Saving…' : 'Collect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Panel ──────────────────────────────────────────────────────

interface PendingCollectionsPanelProps {
  /** If true, shows compact mode (for dashboard sidebar). If false, shows full table. */
  compact?: boolean;
  maxRows?: number;
}

export function PendingCollectionsPanel({ compact = false, maxRows = 10 }: PendingCollectionsPanelProps) {
  const qc = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<PendingCreditItem | null>(null);
  const [search, setSearch] = useState('');

  const { data: items = [], isLoading, error } = useQuery({
    queryKey: QK.pendingCollections,
    queryFn: fetchPendingCreditDeliveries,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  function handleSuccess() {
    setSelectedItem(null);
    qc.invalidateQueries({ queryKey: QK.pendingCollections });
    qc.invalidateQueries({ queryKey: QK.payments });
    qc.invalidateQueries({ queryKey: QK.deliveries });
    qc.invalidateQueries({ queryKey: QK.dashboardStats });
    qc.invalidateQueries({ queryKey: QK.masterKpisAny });
    qc.invalidateQueries({ queryKey: QK.masterOperations });
  }

  const filtered = items
    .filter(i =>
      !search ||
      i.party_name.toLowerCase().includes(search.toLowerCase()) ||
      (i.party_code?.toLowerCase().includes(search.toLowerCase())) ||
      (i.invoice_number?.toLowerCase().includes(search.toLowerCase()))
    )
    .slice(0, maxRows);

  const totalPending = items.reduce((s, i) => s + i.pending_amount, 0);

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-6 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
        <span className="ml-2 text-sm text-surface-500">Loading pending collections…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-surface-800 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-4 w-4" />
          <span className="text-xs font-semibold">Could not load pending collections</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-surface-200 dark:border-surface-700 bg-amber-50 dark:bg-amber-950/20 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-sm">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Pending Collections</h3>
              <p className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold">
                {items.length} credit {items.length === 1 ? 'sale' : 'sales'} • {formatCurrency(totalPending)} receivable
              </p>
            </div>
          </div>
          {!compact && (
            <div className="text-[10px] font-semibold text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-1 rounded-full border border-amber-200 dark:border-amber-800">
              Credit Receivable
            </div>
          )}
        </div>

        {/* Search (non-compact) */}
        {!compact && items.length > 5 && (
          <div className="px-4 py-2.5 border-b border-surface-100 dark:border-surface-700">
            <input
              placeholder="Search party, code, or invoice..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-surface-200 dark:border-surface-600 rounded-xl bg-surface-50 dark:bg-surface-900/60 text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        )}

        {/* Items */}
        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-surface-900 dark:text-white">All Collected</p>
            <p className="text-xs text-surface-500 mt-1">No pending credit receivables</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-100 dark:divide-surface-700">
            {filtered.map(item => (
              <div key={item.delivery_id} className="p-3.5 flex items-center gap-3 hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors">
                {/* Party Icon */}
                <div className="h-9 w-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-4 w-4" />
                </div>

                {/* Party + Invoice info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-surface-900 dark:text-white truncate">{item.party_name}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {item.party_code && (
                      <span className="text-[10px] text-surface-500 font-mono">{item.party_code}</span>
                    )}
                    {item.invoice_number && (
                      <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-0.5">
                        <FileText className="h-2.5 w-2.5" />{item.invoice_number}
                      </span>
                    )}
                    {item.route_name && (
                      <span className="text-[10px] text-surface-400">{item.route_name}</span>
                    )}
                    {item.days_outstanding > 0 && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        item.days_outstanding > 7
                          ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                      }`}>
                        {item.days_outstanding}d
                      </span>
                    )}
                  </div>
                </div>

                {/* Amounts */}
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-extrabold text-amber-700 dark:text-amber-300">
                    {formatCurrency(item.pending_amount)}
                  </div>
                  <div className="text-[10px] text-surface-400">
                    of {formatCurrency(item.sale_amount)}
                  </div>
                </div>

                {/* Action */}
                <button
                  onClick={() => setSelectedItem(item)}
                  className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-sm"
                >
                  <IndianRupee className="h-3 w-3" />
                  Collect
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Footer: totals */}
        {filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/40 flex items-center justify-between">
            <span className="text-xs text-surface-500 dark:text-surface-400">
              {items.length > maxRows ? `Showing ${maxRows} of ${items.length} pending` : `${items.length} pending`}
            </span>
            <div className="text-xs font-bold text-amber-700 dark:text-amber-300">
              Total: {formatCurrency(totalPending)}
            </div>
          </div>
        )}
      </div>

      {/* Collect Modal */}
      {selectedItem && (
        <CollectModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onSuccess={handleSuccess}
        />
      )}
    </>
  );
}
