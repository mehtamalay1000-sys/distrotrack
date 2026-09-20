import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { Trash2, Loader2, CheckCircle2, ShieldAlert, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/app/AuthProvider';
import { formatCurrency } from '@/shared/utils/format';
import {
  getAdminResetPreview,
  executeDeleteSapSalesHistory,
  invalidateAllInventoryAndSalesQueries,
  type AdminResetPreview,
} from '../services/adminResetService';

interface AdminDeleteSapSalesModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  importId?: string | null;
  batchRef?: string | null;
}

export function AdminDeleteSapSalesModal({
  open,
  onClose,
  onSuccess,
  importId,
  batchRef,
}: AdminDeleteSapSalesModalProps) {
  const qc = useQueryClient();
  const { profile, role } = useAuth();
  const [confirmationInput, setConfirmationInput] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState<AdminResetPreview | null>(null);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmationInput('');
      setLoadingPreview(true);
      getAdminResetPreview(importId)
        .then((data) => {
          setPreviewData(data);
        })
        .catch((err) => {
          console.error('Failed to load SAP sales delete preview counts:', err);
        })
        .finally(() => {
          setLoadingPreview(false);
        });
    }
  }, [open, importId]);

  const salesCounts = previewData?.sap_sales || {
    batches_count: 0,
    items_count: 0,
    baseline_movements_count: 0,
    total_quantity: 0,
    total_net_amount: 0,
  };

  const hasRecords = salesCounts.batches_count > 0 || salesCounts.items_count > 0 || salesCounts.baseline_movements_count > 0;
  const isConfirmed = hasRecords && confirmationInput.trim() === 'DELETE SAP SALES';

  const handleDelete = async () => {
    if (!isConfirmed || executing) return;

    setExecuting(true);
    try {
      const result = await executeDeleteSapSalesHistory(
        {
          userId: profile?.id,
          userName: profile?.full_name,
          role: role || profile?.role,
        },
        importId || undefined
      );

      await invalidateAllInventoryAndSalesQueries(qc);

      toast.success('SAP Sales History Deleted', {
        description: `Removed ${result.batches_deleted} batch(es), ${result.items_deleted.toLocaleString()} sales lines, and reversed ${result.movements_deleted.toLocaleString()} stock movements.`,
      });

      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Delete SAP Sales History Failed', { description: msg });
    } finally {
      setExecuting(false);
    }
  };


  return (
    <Modal
      open={open}
      onClose={() => {
        if (!executing) onClose();
      }}
      title={batchRef ? `Delete SAP Sales Batch (${batchRef})` : 'Delete SAP Sales History'}
      size="md"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={executing}
          >
            Cancel
          </Button>
          <Button
            id="btn-confirm-delete-sap-sales"
            variant="danger"
            onClick={handleDelete}
            disabled={!hasRecords || !isConfirmed || executing || loadingPreview}
            className="bg-rose-600 hover:bg-rose-700 text-white font-semibold gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {executing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting Sales History…
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Delete SAP Sales History
              </>
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-surface-700 dark:text-surface-300">
        {/* Warning Banner */}
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-200 dark:border-rose-900 rounded-xl space-y-2">
          <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300 font-bold text-sm">
            <ShieldAlert className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>DESTRUCTIVE ACTION — ADMIN / MASTER ONLY</span>
          </div>
          <p className="text-xs text-rose-700 dark:text-rose-300/90 leading-relaxed">
            {batchRef
              ? `This will permanently delete imported SAP sales batch ${batchRef} and immediately remove its stock-out effects from the inventory ledger.`
              : 'This will permanently remove ALL imported SAP Sales Baseline history and atomically erase its associated stock-out effects from current inventory.'}
          </p>
          <div className="space-y-1 pt-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Product Master Catalog remains intact.</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Historical Sales Product Discovery remains intact.</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>SAP Purchase Inward History is NOT deleted.</span>
            </div>
          </div>
        </div>

        {/* Scope Counts */}
        <div className="border border-surface-200 dark:border-surface-800 rounded-xl p-3 bg-surface-50/50 dark:bg-surface-900/40">
          <div className="text-xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-wider mb-2">
            Target Sales Dataset (Will Be Permanently Removed):
          </div>

          {loadingPreview ? (
            <div className="flex items-center justify-center py-4 text-xs text-surface-500 gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              Calculating live SAP sales records…
            </div>
          ) : !hasRecords ? (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300 text-xs space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-amber-900 dark:text-amber-200">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>No SAP Sales Baseline data found.</span>
              </div>
              <p className="text-amber-700 dark:text-amber-400 leading-relaxed">
                {batchRef
                  ? `Batch "${batchRef}" does not contain any active sales transactions or baseline movements.`
                  : 'There are no imported SAP Sales Baseline records currently present in the database.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
                <span className="text-surface-500 block">SAP Import Batches:</span>
                <span className="text-sm font-bold font-mono text-surface-900 dark:text-surface-100">
                  {salesCounts.batches_count.toLocaleString()}
                </span>
              </div>
              <div className="p-2 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
                <span className="text-surface-500 block">Sales Transactions:</span>
                <span className="text-sm font-bold font-mono text-surface-900 dark:text-surface-100">
                  {salesCounts.items_count.toLocaleString()}
                </span>
              </div>
              <div className="p-2 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
                <span className="text-surface-500 block">Stock-Out Movements:</span>
                <span className="text-sm font-bold font-mono text-surface-900 dark:text-surface-100">
                  {salesCounts.baseline_movements_count.toLocaleString()}
                </span>
              </div>
              <div className="p-2 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
                <span className="text-surface-500 block">Total Sales Quantity:</span>
                <span className="text-sm font-bold font-mono text-surface-900 dark:text-surface-100">
                  {salesCounts.total_quantity.toLocaleString()} units
                </span>
              </div>
              <div className="col-span-2 p-2 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700 flex items-center justify-between">
                <span className="text-surface-500">Total Sales Value:</span>
                <span className="text-sm font-bold font-mono text-indigo-600 dark:text-indigo-400">
                  {formatCurrency(salesCounts.total_net_amount)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Confirmation Input Guard */}
        <div className="space-y-1.5 pt-1">
          <label className="block text-xs font-semibold text-surface-700 dark:text-surface-300">
            Type <span className="font-mono font-bold text-rose-600 dark:text-rose-400">DELETE SAP SALES</span> to confirm:
          </label>
          <input
            id="input-confirm-delete-sap-sales"
            type="text"
            value={confirmationInput}
            onChange={(e) => setConfirmationInput(e.target.value)}
            placeholder={hasRecords ? 'DELETE SAP SALES' : 'No records to delete'}
            disabled={!hasRecords || executing || loadingPreview}
            className="w-full px-3 py-2 text-sm font-mono border-2 border-surface-300 dark:border-surface-600 rounded-xl focus:border-rose-500 dark:focus:border-rose-500 outline-none bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-surface-100 disabled:opacity-50 disabled:cursor-not-allowed"
            autoComplete="off"
            spellCheck="false"
          />
        </div>
      </div>
    </Modal>
  );
}
