import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Truck, CheckCircle2, Boxes, AlertTriangle, ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
import { PageHeader, Button, StatusBadge, Card, LoadingState, ErrorState } from '@/shared/ui';
import {
  getPicklist,
  updatePicklistStatus,
  assignPicklistWorker,
  adminAuthorizeRouteReconciliation,
  getRouteStockExceptions,
} from '../services/picklistService';
import { getWorkers } from '@/features/workers/services/workerService';
import { getRouteStockCheck } from '@/features/worker/services/workerRouteService';
import { getOfficialProductName } from '@/features/products/data/productMaster';
import { formatCurrency, formatDate } from '@/shared/utils/format';
import { supabase } from '@/lib/supabase';

export function PicklistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [adjustmentQty, setAdjustmentQty] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');

  const { data: picklist, isLoading, error } = useQuery({
    queryKey: ['picklist', id],
    queryFn: () => getPicklist(id!),
    enabled: !!id,
  });

  const { data: workers = [] } = useQuery({ queryKey: ['workers'], queryFn: getWorkers });

  // Query route stock ledger check if picklist is in progress, pending reconciliation, or completed
  const { data: stockCheck, refetch: refetchStock } = useQuery({
    queryKey: ['picklist-stock-check', id],
    queryFn: () => getRouteStockCheck(id!),
    enabled: !!id && (picklist?.status === 'in_progress' || picklist?.status === 'completed' || picklist?.status === 'pending_reconciliation'),
  });

  // Query route stock exceptions (discrepancies reported by workers)
  const { data: exceptions = [], refetch: refetchExceptions } = useQuery({
    queryKey: ['picklist-exceptions', id],
    queryFn: () => getRouteStockExceptions(id!),
    enabled: !!id,
  });

  // Admin/Master authorization mutation (NO PIN REQUIRED — uses authenticated session)
  const authorizeMut = useMutation({
    mutationFn: async ({ action, notes }: { action: 'approve' | 'reject'; notes?: string }) => {
      return await adminAuthorizeRouteReconciliation(id!, action, notes);
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['picklist', id] });
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['picklist-stock-check', id] });
      qc.invalidateQueries({ queryKey: ['picklist-exceptions', id] });
      refetchStock();
      refetchExceptions();
      toast.success(
        variables.action === 'approve'
          ? 'Route reconciliation authorized & closed successfully'
          : 'Reconciliation rejected and held for review'
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: (status: 'assigned' | 'in_progress' | 'completed') => updatePicklistStatus(id!, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picklist', id] });
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('Picklist status updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignMut = useMutation({
    mutationFn: (workerId: string | null) => assignPicklistWorker(id!, workerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picklist', id] });
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      toast.success('Worker assigned to picklist');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Admin inventory adjustment mutation
  const adjustMut = useMutation({
    mutationFn: async () => {
      if (!selectedProductId || !adjustmentQty || !adjustmentReason.trim()) {
        throw new Error('Please select product, quantity, and reason');
      }
      const qty = parseFloat(adjustmentQty);
      if (isNaN(qty) || qty === 0) {
        throw new Error('Adjustment quantity must be a non-zero number');
      }

      const selectedItem = stockCheck?.items.find((it) => it.product_id === selectedProductId);
      if (!selectedItem) throw new Error('Product not found in load manifest');

      const { error: insErr } = await supabase.from('inventory_movements').insert({
        product_id: selectedProductId,
        sku: selectedItem.sku,
        movement_type: 'inventory_adjustment',
        quantity: Math.abs(qty),
        direction: qty > 0 ? 'in' : 'out',
        from_location: qty > 0 ? 'adjustment' : 'warehouse',
        to_location: qty > 0 ? 'warehouse' : 'adjustment',
        picklist_id: id,
        route_id: picklist?.route_id || null,
        reference_number: picklist?.picklist_number || null,
        idempotency_key: `admin_adj:${id}:${selectedProductId}:${Date.now()}`,
        notes: `Admin adjustment: ${adjustmentReason.trim()}`,
      });

      if (insErr) throw new Error(insErr.message);
    },
    onSuccess: () => {
      toast.success('Inventory adjustment recorded in ledger');
      setShowAdjustModal(false);
      setSelectedProductId('');
      setAdjustmentQty('');
      setAdjustmentReason('');
      refetchStock();
      qc.invalidateQueries({ queryKey: ['picklist-stock-check', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <LoadingState />;
  if (error || !picklist) return <ErrorState message={error ? (error as Error).message : 'Picklist not found'} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/admin/picklists')}>
          Back to Picklists
        </Button>
      </div>

      <PageHeader
        title={`Picklist #${picklist.picklist_number}`}
        description={`Imported SAP Picklist created on ${formatDate(picklist.date)}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={picklist.status} />
            {picklist.status === 'confirmed' && (
              <Button size="sm" icon={<Truck className="h-4 w-4" />} onClick={() => statusMut.mutate('in_progress')}>
                Start Delivery
              </Button>
            )}
            {picklist.status === 'in_progress' && (
              <Button size="sm" variant="secondary" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => statusMut.mutate('completed')}>
                Mark Complete
              </Button>
            )}
          </div>
        }
      />

      {/* Header Info */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase">Route</div>
          <div className="text-sm font-semibold text-surface-900 dark:text-surface-100 mt-1">{picklist.route ? picklist.route.name : '—'}</div>
          {picklist.route && <div className="font-mono text-xs text-surface-400 mt-0.5">{picklist.route.code}</div>}
        </Card>
        <Card className="p-4">
          <div className="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase">Assigned Worker</div>
          <select
            value={picklist.worker_id || ''}
            onChange={(e) => assignMut.mutate(e.target.value || null)}
            className="mt-1 text-sm font-semibold bg-surface-50 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 text-surface-900 dark:text-surface-100 rounded px-2 py-1 outline-none w-full cursor-pointer"
          >
            <option value="">-- Unassigned --</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase">Total Line Items</div>
          <div className="text-sm font-semibold text-surface-900 dark:text-surface-100 mt-1">{picklist.total_items || picklist.items?.length || 0} SKUs</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase">Total Value</div>
          <div className="text-base font-bold text-primary-700 dark:text-primary-400 mt-1">{formatCurrency(picklist.total_amount)}</div>
        </Card>
      </div>

      {/* ── Route Reconciliation Review Panel (Admin/Master Session) ── */}
      {(picklist.status === 'pending_reconciliation' || (exceptions && exceptions.length > 0)) && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-3 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              <div>
                <h3 className="font-bold text-sm text-amber-900 dark:text-amber-200">
                  Route Stock & Cash Reconciliation Review Required
                </h3>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Worker completed field deliveries and submitted check-in report. Discrepancies require supervisor authorization.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {picklist.status === 'pending_reconciliation' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => authorizeMut.mutate({ action: 'reject' })}
                    disabled={authorizeMut.isPending}
                  >
                    Reject Recount
                  </Button>
                  <Button
                    size="sm"
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    onClick={() => authorizeMut.mutate({ action: 'approve' })}
                    disabled={authorizeMut.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {authorizeMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Authorize & Close Route'}
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-white dark:bg-surface-800 p-3 rounded-lg border border-amber-200 dark:border-amber-800/60">
            <div>
              <span className="text-surface-500">Worker Notes / Reason:</span>
              <div className="font-semibold text-surface-900 dark:text-white mt-0.5">
                {picklist.notes || 'No note provided'}
              </div>
            </div>
            <div>
              <span className="text-surface-500">Declared Cash:</span>
              <div className="font-semibold text-surface-900 dark:text-white mt-0.5">
                ₹{Number(picklist.actual_cash_returned ?? 0).toLocaleString('en-IN')}{' '}
                {picklist.cash_discrepancy ? (
                  <span className={picklist.cash_discrepancy < 0 ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold'}>
                    (Diff: ₹{Number(picklist.cash_discrepancy).toFixed(2)})
                  </span>
                ) : null}
              </div>
            </div>
            <div>
              <span className="text-surface-500">Recorded Discrepancies:</span>
              <div className="font-semibold text-surface-900 dark:text-white mt-0.5">
                {exceptions.length} exception(s) logged
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STAGE 4B INVENTORY & VEHICLE STOCK LEDGER VIEW ─────────── */}
      {stockCheck && (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden shadow-xs">
          <div className="p-4 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-blue-600" />
              <div>
                <h3 className="font-bold text-sm text-surface-900 dark:text-surface-100">
                  Route Inventory & Vehicle Stock Ledger (Stage 4B)
                </h3>
                <p className="text-xs text-surface-400">
                  Authoritative stock movements calculated from append-only ledger
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                icon={<AlertTriangle className="h-3.5 w-3.5" />}
                onClick={() => setShowAdjustModal(true)}
              >
                Record Adjustment
              </Button>
            </div>
          </div>

          {/* Ledger Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 bg-surface-50 dark:bg-surface-900/50 border-b border-surface-200 dark:border-surface-700">
            <div className="p-2.5 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
              <div className="text-[10px] uppercase font-bold text-surface-400">Loaded from WH</div>
              <div className="text-base font-black text-surface-900 dark:text-white mt-0.5">
                {stockCheck.total_loaded} pcs
              </div>
            </div>
            <div className="p-2.5 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
              <div className="text-[10px] uppercase font-bold text-emerald-600">Delivered to Retailers</div>
              <div className="text-base font-black text-emerald-700 dark:text-emerald-300 mt-0.5">
                {stockCheck.total_delivered} pcs
              </div>
            </div>
            <div className="p-2.5 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
              <div className="text-[10px] uppercase font-bold text-rose-500">Damaged in Transit</div>
              <div className="text-base font-black text-rose-600 mt-0.5">
                {stockCheck.total_damaged} pcs
              </div>
            </div>
            <div className="p-2.5 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
              <div className="text-[10px] uppercase font-bold text-blue-600">Returned to WH</div>
              <div className="text-base font-black text-blue-700 dark:text-blue-300 mt-0.5">
                {stockCheck.total_returned} pcs
              </div>
            </div>
            <div className="p-2.5 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
              <div className="text-[10px] uppercase font-bold text-amber-600">Expected on Truck</div>
              <div className="text-base font-black text-amber-700 dark:text-amber-300 mt-0.5">
                {stockCheck.vehicle_balance} pcs
              </div>
            </div>
          </div>

          {/* Stock by SKU Table */}
          <div className="overflow-x-auto">
            <table className="dt-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Product Name</th>
                  <th className="text-right">Loaded</th>
                  <th className="text-right">Delivered</th>
                  <th className="text-right">Damaged</th>
                  <th className="text-right">Returned</th>
                  <th className="text-right">Vehicle Balance</th>
                </tr>
              </thead>
              <tbody>
                {stockCheck.items.map((item) => (
                  <tr key={item.product_id}>
                    <td>
                      <span className="font-mono text-xs bg-surface-100 dark:bg-surface-700 px-1.5 py-0.5 rounded font-bold">
                        {item.sku}
                      </span>
                    </td>
                    <td className="font-medium text-surface-900 dark:text-surface-100">
                      {getOfficialProductName(item.sku, item.product_name)}
                    </td>
                    <td className="text-right font-semibold text-surface-800 dark:text-surface-200">
                      {item.loaded_qty}
                    </td>
                    <td className="text-right font-semibold text-emerald-600">
                      {item.delivered_qty}
                    </td>
                    <td className="text-right font-semibold text-rose-500">
                      {item.damaged_transit_qty}
                    </td>
                    <td className="text-right font-semibold text-blue-600">
                      {item.route_return_qty}
                    </td>
                    <td className="text-right font-bold text-surface-900 dark:text-white">
                      {item.expected_vehicle_qty}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Adjustment Modal ────────────────────────────────────────── */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-surface-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              Record Inventory Adjustment
            </h3>
            <p className="text-xs text-surface-400">
              Create an auditable stock adjustment ledger movement for discrepancy resolution.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-surface-500 font-medium mb-1">Select Product / SKU</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full h-9 px-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800"
                >
                  <option value="">-- Choose Product --</option>
                  {(stockCheck?.items || []).map((it) => (
                    <option key={it.product_id} value={it.product_id}>
                      {it.sku} - {it.product_name} (Current Truck: {it.expected_vehicle_qty})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-surface-500 font-medium mb-1">
                  Adjustment Quantity (+ to add, - to subtract)
                </label>
                <input
                  type="number"
                  placeholder="e.g. -2 or 5"
                  value={adjustmentQty}
                  onChange={(e) => setAdjustmentQty(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 font-bold"
                />
              </div>

              <div>
                <label className="block text-surface-500 font-medium mb-1">Mandatory Adjustment Reason</label>
                <input
                  type="text"
                  placeholder="e.g. Physical carton breakage on route check-in"
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAdjustModal(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => adjustMut.mutate()}
                disabled={adjustMut.isPending}
              >
                {adjustMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Record in Ledger'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Items Table */}
      <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-surface-200 dark:border-surface-700 font-semibold text-sm text-surface-900 dark:text-surface-100">
          Picklist Product Items
          {picklist.notes && <span className="ml-2 text-xs font-normal text-surface-400">— {picklist.notes}</span>}
        </div>
        {(picklist.items || []).length === 0 ? (
          <div className="p-8 text-center text-xs text-surface-400">
            No item lines found for this picklist. Items appear here when imported with PDF parsing.
          </div>
        ) : (
          <table className="dt-table">
            <thead>
              <tr>
                <th>Customer / Party</th>
                <th>SKU</th>
                <th>Product Name</th>
                <th className="text-right">Quantity</th>
                <th className="text-right">Rate</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(picklist.items || []).map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="font-medium text-surface-900 dark:text-surface-100">{item.party ? item.party.name : 'General Customer'}</span>
                    {item.party?.code && <div className="font-mono text-xs text-surface-400">{item.party.code}</div>}
                  </td>
                  <td><span className="font-mono text-xs bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-200 px-1.5 py-0.5 rounded font-medium">{item.sku}</span></td>
                  <td className="font-medium text-surface-900 dark:text-surface-100">{getOfficialProductName(item.sku, item.product_name)}</td>
                  <td className="text-right font-medium text-surface-900 dark:text-surface-100">{item.quantity}</td>
                  <td className="text-right text-surface-700 dark:text-surface-300">{formatCurrency(item.rate)}</td>
                  <td className="text-right font-semibold text-surface-900 dark:text-surface-100">{formatCurrency(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
