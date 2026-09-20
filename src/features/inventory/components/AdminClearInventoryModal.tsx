import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { AlertTriangle, Loader2, CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/app/AuthProvider';
import {
  getAdminResetPreview,
  executeResetTestInventory,
  invalidateAllInventoryAndSalesQueries,
  type AdminResetPreview,
} from '../services/adminResetService';

interface AdminClearInventoryModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AdminClearInventoryModal({
  open,
  onClose,
  onSuccess,
}: AdminClearInventoryModalProps) {
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
      getAdminResetPreview()
        .then((data) => {
          setPreviewData(data);
        })
        .catch((err) => {
          console.error('Failed to load reset preview counts:', err);
        })
        .finally(() => {
          setLoadingPreview(false);
        });
    }
  }, [open]);

  const liveCount = previewData?.live_operational_transactions_count ?? 0;
  const isBlocked = previewData?.can_reset === false || liveCount > 0;
  const isConfirmed =
    !isBlocked &&
    (confirmationInput.trim().toUpperCase() === 'RESET TEST INVENTORY' ||
      confirmationInput.trim().toUpperCase() === 'CLEAR INVENTORY');

  const handleReset = async () => {
    if (isBlocked || !isConfirmed || executing) return;

    setExecuting(true);
    try {
      const result = await executeResetTestInventory({
        userId: profile?.id,
        userName: profile?.full_name,
        role: role || profile?.role,
      });

      await invalidateAllInventoryAndSalesQueries(qc);

      toast.success('Test Inventory Reset Complete', {
        description: `Removed ${result.movements_deleted.toLocaleString()} test movements. Operational stock reset cleanly.`,
      });

      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Reset Test Inventory Failed', { description: msg });
    } finally {
      setExecuting(false);
    }
  };

  const invCounts = previewData?.inventory || {
    movements_count: 0,
    stock_exceptions_count: 0,
    vehicle_stock_records_count: 0,
    reconciliations_count: 0,
  };

  const breakdown = previewData?.live_breakdown;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!executing) onClose();
      }}
      title="Reset Test Inventory"
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
            id="btn-confirm-clear-inventory"
            variant="danger"
            onClick={handleReset}
            disabled={isBlocked || !isConfirmed || executing}
            className="bg-rose-600 hover:bg-rose-700 text-white font-semibold gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {executing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Resetting Test Inventory…
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4" />
                Reset Test Inventory
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
            <span>RESET TEST INVENTORY — PRE-GO-LIVE ONLY</span>
          </div>
          <p className="text-xs text-rose-700 dark:text-rose-300/90 leading-relaxed font-medium">
            This removes test/import inventory data. It is unavailable after live operational history exists.
          </p>
          <div className="pt-1 flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Product Master Catalog is PRESERVED (no products will be deleted).</span>
          </div>
        </div>

        {/* Live Operational Guard Warning if blocked */}
        {isBlocked && (
          <div className="p-4 bg-amber-50 dark:bg-amber-950/50 border-2 border-amber-300 dark:border-amber-800 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-bold text-sm">
              <XCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>Reset Unavailable: Live Operational History Exists</span>
            </div>
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              Inventory reset is unavailable because live operational history exists ({liveCount} live transactions recorded).
              The ledger cannot be wiped after business operations have begun.
            </p>
            {breakdown && (
              <div className="text-[11px] grid grid-cols-2 gap-1.5 pt-1 text-amber-900 dark:text-amber-200 font-mono">
                {breakdown.deliveries > 0 && <div>• Deliveries: {breakdown.deliveries}</div>}
                {breakdown.payments > 0 && <div>• Payments: {breakdown.payments}</div>}
                {breakdown.expenses > 0 && <div>• Expenses: {breakdown.expenses}</div>}
                {breakdown.closedRoutes > 0 && <div>• Closed Routes: {breakdown.closedRoutes}</div>}
                {breakdown.closedPicklists > 0 && <div>• Closed Picklists: {breakdown.closedPicklists}</div>}
                {breakdown.operationalMovements > 0 && <div>• Delivery Movements: {breakdown.operationalMovements}</div>}
              </div>
            )}
          </div>
        )}

        {/* Scope Counts */}
        <div className="border border-surface-200 dark:border-surface-800 rounded-xl p-3 bg-surface-50/50 dark:bg-surface-900/40">
          <div className="text-xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-wider mb-2">
            Confirmation Scope:
          </div>

          {loadingPreview ? (
            <div className="flex items-center justify-center py-4 text-xs text-surface-500 gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
              Calculating live inventory records…
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
                <span className="text-surface-500 block">Test Inventory Movements:</span>
                <span className="text-sm font-bold font-mono text-surface-900 dark:text-surface-100">
                  {invCounts.movements_count.toLocaleString()}
                </span>
              </div>
              <div className="p-2 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
                <span className="text-surface-500 block">Test Stock Exceptions:</span>
                <span className="text-sm font-bold font-mono text-surface-900 dark:text-surface-100">
                  {invCounts.stock_exceptions_count.toLocaleString()}
                </span>
              </div>
              <div className="p-2 bg-white dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
                <span className="text-surface-500 block">Test Reconciliation Data:</span>
                <span className="text-sm font-bold font-mono text-surface-900 dark:text-surface-100">
                  {invCounts.reconciliations_count.toLocaleString()}
                </span>
              </div>
              <div className={`p-2 rounded-lg border ${
                liveCount > 0
                  ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800'
                  : 'bg-white dark:bg-surface-800 border-surface-200 dark:border-surface-700'
              }`}>
                <span className={`${liveCount > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-surface-500'} block`}>
                  Live Operational Transactions:
                </span>
                <span className={`text-sm font-bold font-mono ${
                  liveCount > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-surface-900 dark:text-surface-100'
                }`}>
                  {liveCount.toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Confirmation Input Guard */}
        <div className="space-y-1.5 pt-1">
          <label className="block text-xs font-semibold text-surface-700 dark:text-surface-300">
            Type <span className="font-mono font-bold text-rose-600 dark:text-rose-400">RESET TEST INVENTORY</span> to confirm:
          </label>
          <input
            id="input-confirm-clear-inventory"
            type="text"
            value={confirmationInput}
            onChange={(e) => setConfirmationInput(e.target.value)}
            placeholder={isBlocked ? 'RESET UNAVAILABLE' : 'RESET TEST INVENTORY'}
            disabled={isBlocked || executing}
            className="w-full px-3 py-2 text-sm font-mono border-2 border-surface-300 dark:border-surface-600 rounded-xl focus:border-rose-500 dark:focus:border-rose-500 outline-none bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-surface-100 disabled:opacity-50 disabled:bg-surface-100 dark:disabled:bg-surface-800 disabled:cursor-not-allowed"
            autoComplete="off"
            spellCheck="false"
          />
        </div>
      </div>
    </Modal>
  );
}
