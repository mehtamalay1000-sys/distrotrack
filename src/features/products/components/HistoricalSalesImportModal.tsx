import { useState } from 'react';
import { toast } from 'sonner';
import {
  FileSpreadsheet, ShieldCheck, Database,
  Package, Loader2, ChevronLeft, ChevronRight
} from 'lucide-react';
import { Modal, Button } from '@/shared/ui';
import {
  importHistoricalSalesData,
  type ParsedHistoricalSalesResult
} from '../services/historicalSalesService';

interface HistoricalSalesImportModalProps {
  open: boolean;
  onClose: () => void;
  parsed: ParsedHistoricalSalesResult | null;
  onSuccess?: () => void;
}

export function HistoricalSalesImportModal({
  open,
  onClose,
  parsed,
  onSuccess,
}: HistoricalSalesImportModalProps) {
  const [importing, setImporting] = useState(false);
  const [samplePage, setSamplePage] = useState(1);
  const pageSize = 10;

  if (!parsed) return null;

  const sampleRows = parsed.sampleRows || [];
  const totalSamplePages = Math.max(1, Math.ceil(sampleRows.length / pageSize));
  const displayedSampleRows = sampleRows.slice((samplePage - 1) * pageSize, samplePage * pageSize);

  const handleConfirmImport = async () => {
    setImporting(true);
    try {
      const res = await importHistoricalSalesData(parsed);
      if (res.success) {
        toast.success(res.message || `Successfully imported ${parsed.uniqueSkusCount} historical SKUs!`);
        onSuccess?.();
        onClose();
      } else {
        toast.error(res.message || 'Import failed');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Import failed: ${msg}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Historical Sales Product Discovery Import"
      size="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-xs text-surface-500 dark:text-surface-400 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Operational stock and financial ledgers remain completely untouched</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={importing}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={importing}
              onClick={handleConfirmImport}
              icon={importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            >
              Confirm Import ({parsed.uniqueSkusCount} SKUs)
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Source File and Invariant Banner */}
        <div className="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 rounded-xl p-4 flex items-start gap-3">
          <FileSpreadsheet className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <div className="font-semibold text-blue-950 dark:text-blue-200 flex items-center gap-2">
              <span>Source File: {parsed.fileName}</span>
              <span className="px-2 py-0.5 bg-blue-200/60 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300 rounded font-mono text-[11px]">
                {parsed.totalRows.toLocaleString()} Rows
              </span>
            </div>
            <p className="text-blue-800/90 dark:text-blue-300/90">
              Historical sales are used exclusively for <strong>Product Discovery</strong> (identifying missing Colgate SKUs, historical descriptions, and fallback reference pricing). This import will <strong>NOT</strong> create <code className="font-mono text-xs">purchase_inward</code>, will <strong>NOT</strong> modify current warehouse inventory, and will <strong>NOT</strong> alter customer route balances.
            </p>
          </div>
        </div>

        {/* High-Level Discovery Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-surface-50 dark:bg-surface-800/60 rounded-xl border border-surface-200 dark:border-surface-700">
            <div className="text-[11px] font-medium text-surface-500 dark:text-surface-400">Total Rows</div>
            <div className="text-xl font-bold text-surface-900 dark:text-surface-100 mt-0.5">
              {parsed.totalRows.toLocaleString()}
            </div>
            <div className="text-[10px] text-surface-400 mt-0.5">
              {parsed.validRowsCount.toLocaleString()} valid • {parsed.skippedRowsCount} skipped
            </div>
          </div>

          <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900/50">
            <div className="text-[11px] font-medium text-blue-700 dark:text-blue-400">Unique SKUs</div>
            <div className="text-xl font-bold text-blue-600 dark:text-blue-300 mt-0.5">
              {parsed.uniqueSkusCount}
            </div>
            <div className="text-[10px] text-blue-500/80 dark:text-blue-400/80 mt-0.5">
              {parsed.duplicateRowsCount.toLocaleString()} duplicate lines aggregated
            </div>
          </div>

          <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-xl border border-emerald-200 dark:border-emerald-900/50">
            <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Total Quantity</div>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-300 mt-0.5">
              {parsed.totalHistoricalQty.toLocaleString()}
            </div>
            <div className="text-[10px] text-emerald-500/80 dark:text-emerald-400/80 mt-0.5">
              Historical units sold
            </div>
          </div>

          <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900/50">
            <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Date Range</div>
            <div className="text-sm font-bold text-amber-800 dark:text-amber-300 mt-1 truncate">
              {parsed.dateRange.startDate || 'N/A'} → {parsed.dateRange.endDate || 'N/A'}
            </div>
            <div className="text-[10px] text-amber-600/80 dark:text-amber-400/80 mt-0.5">
              {parsed.uniqueCustomersCount} unique customers
            </div>
          </div>
        </div>

        {/* Product Master Match Status Breakdown */}
        <div className="flex items-center justify-between p-3 bg-surface-50 dark:bg-surface-800/40 rounded-xl border border-surface-200 dark:border-surface-700 text-xs">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-primary-600 dark:text-primary-400" />
            <span className="font-medium text-surface-700 dark:text-surface-300">Catalog Reconciliation:</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
              Matched in Product Master: <strong>{parsed.matchedMasterSkusCount}</strong>
            </span>
            <span className="text-purple-700 dark:text-purple-400 font-medium">
              New Discoverable SKUs: <strong>{parsed.newDiscoverableSkusCount}</strong>
            </span>
          </div>
        </div>

        {/* Sample Rows Preview Section (Capped at 50 rows) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-surface-700 dark:text-surface-300">
              Sample Data Preview <span className="text-surface-400 font-normal">(Showing max {sampleRows.length} sample rows of {parsed.validRowsCount.toLocaleString()} total rows)</span>
            </div>
            {totalSamplePages > 1 && (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={samplePage <= 1}
                  onClick={() => setSamplePage((p) => Math.max(1, p - 1))}
                  className="h-7 px-2 text-xs"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-[11px] text-surface-500">
                  {samplePage} / {totalSamplePages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={samplePage >= totalSamplePages}
                  onClick={() => setSamplePage((p) => Math.min(totalSamplePages, p + 1))}
                  className="h-7 px-2 text-xs"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>

          <div className="border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden">
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-100/70 dark:bg-surface-800 text-surface-600 dark:text-surface-400 sticky top-0 border-b border-surface-200 dark:border-surface-700">
                  <tr>
                    <th className="py-2 px-3 font-semibold">SKU Code</th>
                    <th className="py-2 px-3 font-semibold">Description</th>
                    <th className="py-2 px-3 font-semibold">Date</th>
                    <th className="py-2 px-3 font-semibold text-right">Quantity</th>
                    <th className="py-2 px-3 font-semibold text-right">Gross Val</th>
                    <th className="py-2 px-3 font-semibold">Customer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                  {displayedSampleRows.map((r, idx) => (
                    <tr key={idx} className="hover:bg-surface-50 dark:hover:bg-surface-800/40">
                      <td className="py-1.5 px-3 font-mono font-medium text-surface-900 dark:text-surface-100">
                        {r.sku}
                      </td>
                      <td className="py-1.5 px-3 text-surface-700 dark:text-surface-300 max-w-xs truncate">
                        {r.productName}
                      </td>
                      <td className="py-1.5 px-3 text-surface-500 whitespace-nowrap">
                        {r.date || '—'}
                      </td>
                      <td className="py-1.5 px-3 font-mono font-medium text-right text-surface-900 dark:text-surface-100">
                        {r.quantity}
                      </td>
                      <td className="py-1.5 px-3 font-mono text-right text-surface-600 dark:text-surface-400">
                        ₹{r.grossVal.toLocaleString()}
                      </td>
                      <td className="py-1.5 px-3 text-surface-600 dark:text-surface-400 max-w-[140px] truncate">
                        {r.customerName || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
