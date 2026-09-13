import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  FileUp, RefreshCw, CheckCircle2, AlertTriangle, HelpCircle,
  Download, FileSpreadsheet, History, Package,
  BookmarkPlus, AlertCircle, Eye
} from 'lucide-react';
import { PageHeader, Card, Button, LoadingState, EmptyState, Modal } from '@/shared/ui';
import {
  parseSapStockFile,
  performSapStockReconciliation,
  saveReconciliationSnapshot,
  getHistoricalSnapshots,
  getSnapshotItems,
  exportReconciliationToCSV,
  exportReconciliationToXLSX,
  type ReconciliationResult,
} from '../services/sapReconciliationService';
import type { SapStockReconciliation } from '@/lib/database.types';

export function SapReconciliationPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'reconcile' | 'history'>('reconcile');

  // Active reconciliation state
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
  });
  const [currentResult, setCurrentResult] = useState<ReconciliationResult | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'MATCHED' | 'VARIANCE' | 'INCOMPLETE DATA' | 'UNMAPPED SKU'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Snapshot modal & inspection state
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<SapStockReconciliation | null>(null);
  const [snapshotDetailOpen, setSnapshotDetailOpen] = useState(false);

  // History query
  const { data: historyList = [], isLoading: loadingHistory, refetch: refetchHistory } = useQuery({
    queryKey: ['sap_reconciliation_history'],
    queryFn: getHistoricalSnapshots,
    enabled: activeTab === 'history',
  });

  // Selected snapshot items query
  const { data: snapshotItems = [], isLoading: loadingSnapshotItems } = useQuery({
    queryKey: ['sap_snapshot_items', selectedSnapshot?.id],
    queryFn: () => getSnapshotItems(selectedSnapshot!.id),
    enabled: !!selectedSnapshot?.id && snapshotDetailOpen,
  });

  // File upload handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploaded = e.target.files?.[0];
    if (!uploaded) return;
    setFile(uploaded);
    setParsing(true);

    try {
      const parsed = await parseSapStockFile(uploaded);
      if (parsed.error) {
        toast.error(parsed.error);
        setParsing(false);
        return;
      }

      if (parsed.rows.length === 0) {
        toast.error('No valid stock rows could be identified in the file.');
        setParsing(false);
        return;
      }

      toast.info(`Parsed ${parsed.rows.length} SAP stock rows. Running reconciliation against DistroTrack ledger…`);
      const result = await performSapStockReconciliation(parsed.rows, period, parsed.fileName);
      setCurrentResult(result);
      toast.success(`Reconciliation complete: ${result.summary.matched} Matched, ${result.summary.variance} Variances, ${result.summary.incomplete} Incomplete`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error processing SAP file');
    } finally {
      setParsing(false);
    }
  };

  // Save Snapshot mutation
  const saveSnapshotMut = useMutation({
    mutationFn: async () => {
      if (!currentResult) throw new Error('No active reconciliation result to preserve');
      const updatedResult = { ...currentResult, period };
      return await saveReconciliationSnapshot(updatedResult);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sap_reconciliation_history'] });
      toast.success(`Preserved reconciliation snapshot for period "${period}"`);
      setSaveModalOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Filtered items
  const filteredItems = (currentResult?.items || []).filter((it) => {
    const matchStatus = statusFilter === 'all' || it.status === statusFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchSearch =
      !q ||
      it.sku.toLowerCase().includes(q) ||
      it.productName.toLowerCase().includes(q) ||
      (it.notes || '').toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <PageHeader
        title="SAP Stock Reconciliation"
        description="Compare uploaded SAP physical stock against DistroTrack operational stock. Reporting & variance tracking only — does not alter ledger movements."
        actions={
          <div className="flex items-center gap-2">
            {currentResult && activeTab === 'reconcile' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  icon={<Download className="h-4 w-4" />}
                  onClick={() => exportReconciliationToCSV(currentResult.items, `SAP_Reconciliation_${period.replace(/\s+/g, '_')}.csv`)}
                >
                  Export CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  icon={<FileSpreadsheet className="h-4 w-4" />}
                  onClick={() => exportReconciliationToXLSX(currentResult.items, `SAP_Reconciliation_${period.replace(/\s+/g, '_')}.xlsx`)}
                >
                  Export XLSX
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<BookmarkPlus className="h-4 w-4" />}
                  onClick={() => setSaveModalOpen(true)}
                >
                  Preserve Snapshot
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Tabs */}
      <div className="border-b border-surface-200 dark:border-surface-700 flex gap-4">
        <button
          onClick={() => setActiveTab('reconcile')}
          className={`pb-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
            activeTab === 'reconcile'
              ? 'border-primary-600 text-primary-700 dark:text-primary-300'
              : 'border-transparent text-surface-500 hover:text-surface-700'
          }`}
        >
          <FileUp className="h-4 w-4" />
          Active Reconciliation
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`pb-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
            activeTab === 'history'
              ? 'border-primary-600 text-primary-700 dark:text-primary-300'
              : 'border-transparent text-surface-500 hover:text-surface-700'
          }`}
        >
          <History className="h-4 w-4" />
          Month-End History
        </button>
      </div>

      {/* TAB 1: ACTIVE RECONCILIATION */}
      {activeTab === 'reconcile' && (
        <div className="space-y-6">
          {/* Upload & Period Card */}
          <Card className="p-4 sm:p-6 bg-gradient-to-r from-surface-50 to-primary-50/20 dark:from-surface-800 dark:to-surface-850">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-surface-900 dark:text-white flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary-600" />
                  Upload SAP Stock Export (XLSX / CSV)
                </h3>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  Matches strictly by Material/SKU. Operational stock is computed from authoritative inventory ledger.
                </p>
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-surface-500 font-medium">Period:</span>
                  <input
                    type="text"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    placeholder="e.g. August 2026"
                    className="w-36 h-8 text-xs font-semibold px-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800"
                  />
                </div>

                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleFileUpload}
                    disabled={parsing}
                  />
                  <span className="inline-flex items-center justify-center font-semibold rounded-lg h-8 px-4 text-xs gap-1.5 bg-primary-600 text-white hover:bg-primary-700 transition-colors shadow-xs">
                    <FileUp className="h-4 w-4" />
                    {parsing ? 'Analyzing…' : file ? 'Replace SAP File' : 'Select SAP Export'}
                  </span>
                </label>
              </div>
            </div>

            {file && (
              <div className="mt-3 pt-3 border-t border-surface-200 dark:border-surface-700 text-xs text-surface-600 dark:text-surface-300 flex items-center gap-2">
                <span className="font-semibold">Loaded:</span> {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </div>
            )}
          </Card>

          {/* Results Section */}
          {parsing ? (
            <LoadingState message="Parsing SAP file and evaluating operational balances across inventory ledger…" />
          ) : !currentResult ? (
            <EmptyState
              icon={<FileUp className="h-10 w-10 text-surface-400" />}
              title="No SAP Reconciliation Active"
              description="Upload a Colgate-Palmolive SAP stock export (XLSX or CSV) to compare against DistroTrack calculated stock."
            />
          ) : (
            <div className="space-y-6">
              {/* Summary Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <Card className="p-4">
                  <div className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Total Products</div>
                  <div className="text-2xl font-bold text-surface-900 dark:text-white mt-1.5 tabular-nums">
                    {currentResult.summary.totalProducts.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-surface-400 mt-0.5">Evaluated SKUs</div>
                </Card>

                <Card className="p-4 border-l-4 border-l-emerald-500">
                  <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Matched
                  </div>
                  <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-1.5 tabular-nums">
                    {currentResult.summary.matched.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-surface-400 mt-0.5">Zero variance</div>
                </Card>

                <Card className="p-4 border-l-4 border-l-rose-500">
                  <div className="text-xs font-semibold text-rose-700 dark:text-rose-400 uppercase tracking-wider flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> Variances
                  </div>
                  <div className="text-2xl font-bold text-rose-700 dark:text-rose-400 mt-1.5 tabular-nums">
                    {currentResult.summary.variance.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-surface-400 mt-0.5">
                    +{currentResult.summary.positiveVariance} SAP / -{currentResult.summary.negativeVariance} DT
                  </div>
                </Card>

                <Card className="p-4 border-l-4 border-l-amber-500">
                  <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
                    <HelpCircle className="h-3.5 w-3.5" /> Incomplete
                  </div>
                  <div className="text-2xl font-bold text-amber-700 dark:text-amber-400 mt-1.5 tabular-nums">
                    {currentResult.summary.incomplete.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-surface-400 mt-0.5">Missing opening stock</div>
                </Card>

                <Card className="p-4 border-l-4 border-l-purple-500">
                  <div className="text-xs font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wider flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" /> Unmapped
                  </div>
                  <div className="text-2xl font-bold text-purple-700 dark:text-purple-400 mt-1.5 tabular-nums">
                    {currentResult.summary.unmapped.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-surface-400 mt-0.5">Not in Product Master</div>
                </Card>
              </div>

              {/* Largest Variances Card */}
              {currentResult.summary.largestVariances.length > 0 && (
                <div className="bg-rose-50/40 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 rounded-xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-800 dark:text-rose-300 uppercase tracking-wider flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 text-rose-600" />
                      Top Stock Discrepancies Requiring Investigation
                    </span>
                    <span className="text-[11px] text-rose-600 dark:text-rose-400">Largest absolute variances</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
                    {currentResult.summary.largestVariances.map((it) => (
                      <div key={it.sku} className="bg-white dark:bg-surface-800 p-2.5 rounded-lg border border-rose-200 dark:border-rose-800 text-xs">
                        <div className="font-bold text-surface-900 dark:text-white truncate" title={it.productName}>
                          {it.productName}
                        </div>
                        <div className="font-mono text-[10px] text-surface-400 mt-0.5">SKU: {it.sku}</div>
                        <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-surface-100 dark:border-surface-700">
                          <span className="text-surface-500">Variance:</span>
                          <span className={`font-bold tabular-nums ${it.variance! > 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                            {it.variance! > 0 ? `+${it.variance}` : it.variance} {it.uom}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Filter Controls */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-surface-800 p-3 rounded-xl border border-surface-200 dark:border-surface-700">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                  {[
                    { id: 'all', label: `All (${currentResult.items.length})` },
                    { id: 'MATCHED', label: `Matched (${currentResult.summary.matched})` },
                    { id: 'VARIANCE', label: `Variance (${currentResult.summary.variance})` },
                    { id: 'INCOMPLETE DATA', label: `Incomplete (${currentResult.summary.incomplete})` },
                    { id: 'UNMAPPED SKU', label: `Unmapped (${currentResult.summary.unmapped})` },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setStatusFilter(m.id as any)}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
                        statusFilter === m.id
                          ? 'bg-primary-600 text-white shadow-xs'
                          : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <div className="w-full sm:w-64">
                  <input
                    type="text"
                    placeholder="Search SKU or name…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-8 px-3 text-xs rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800"
                  />
                </div>
              </div>

              {/* Table */}
              <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="dt-table">
                    <thead>
                      <tr>
                        <th>SKU / Material</th>
                        <th>Official Product Name</th>
                        <th>UOM</th>
                        <th className="text-right">SAP Stock</th>
                        <th className="text-right">DistroTrack Stock</th>
                        <th className="text-right">Variance</th>
                        <th>Status</th>
                        <th>Audit Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((it, idx) => (
                        <tr key={`${it.sku}_${idx}`} className="hover:bg-surface-50 dark:hover:bg-surface-700/50">
                          <td className="text-xs font-mono font-bold text-surface-900 dark:text-surface-100">{it.sku}</td>
                          <td className="text-xs font-medium text-surface-900 dark:text-white max-w-sm truncate" title={it.productName}>
                            {it.productName}
                          </td>
                          <td className="text-xs font-mono text-surface-400">{it.uom}</td>
                          <td className="text-xs text-right font-medium tabular-nums">
                            {it.sapStock != null ? it.sapStock.toLocaleString() : '—'}
                          </td>
                          <td className="text-xs text-right font-medium tabular-nums">
                            {it.distrotrackStock != null ? it.distrotrackStock.toLocaleString() : <span className="text-surface-400 italic">Missing Data</span>}
                          </td>
                          <td className="text-xs text-right font-bold tabular-nums">
                            {it.variance != null ? (
                              <span className={it.variance === 0 ? 'text-emerald-600' : it.variance > 0 ? 'text-blue-600' : 'text-rose-600'}>
                                {it.variance > 0 ? `+${it.variance}` : it.variance}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              it.status === 'MATCHED'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : it.status === 'VARIANCE'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : it.status === 'INCOMPLETE DATA'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-purple-50 text-purple-700 border-purple-200'
                            }`}>
                              {it.status}
                            </span>
                          </td>
                          <td className="text-xs text-surface-500 max-w-xs truncate">{it.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: MONTH-END HISTORY */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-surface-900 dark:text-white">Preserved Month-End Snapshots</h3>
              <p className="text-xs text-surface-500">Historical reconciliation results are immutable and permanently preserved.</p>
            </div>
            <button
              onClick={() => refetchHistory()}
              className="p-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-500 hover:text-primary-600 transition-colors"
              title="Refresh History"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {loadingHistory ? (
            <LoadingState message="Loading historical reconciliation records…" />
          ) : historyList.length === 0 ? (
            <EmptyState
              icon={<History className="h-10 w-10 text-surface-400" />}
              title="No Historical Snapshots Preserved"
              description="When you run an active reconciliation, click 'Preserve Snapshot' to archive month-end records."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {historyList.map((rec) => (
                <Card key={rec.id} className="p-4 space-y-3 hover:border-primary-300 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-bold text-primary-700 dark:text-primary-400 uppercase tracking-wider">
                        {rec.period}
                      </span>
                      <div className="text-[11px] text-surface-400 mt-0.5">
                        Uploaded: {new Date(rec.uploaded_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono bg-surface-100 dark:bg-surface-800 px-2 py-0.5 rounded text-surface-500">
                      {rec.file_name || 'SAP Upload'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 py-2 border-y border-surface-100 dark:border-surface-700 text-center">
                    <div>
                      <div className="text-[10px] text-surface-400">Total</div>
                      <div className="text-sm font-bold text-surface-800 dark:text-surface-100">{rec.total_products}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-emerald-600">Matched</div>
                      <div className="text-sm font-bold text-emerald-600">{rec.matched_count}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-rose-600">Variances</div>
                      <div className="text-sm font-bold text-rose-600">{rec.variance_count}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="text-[11px] text-surface-500">
                      SAP: <strong>{Number(rec.total_sap_stock || 0).toLocaleString()}</strong>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Eye className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setSelectedSnapshot(rec);
                        setSnapshotDetailOpen(true);
                      }}
                    >
                      View Details
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Snapshot Save Confirmation Modal */}
      <Modal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Preserve Reconciliation Snapshot"
      >
        <div className="space-y-4">
          <p className="text-xs text-surface-600 dark:text-surface-300">
            This will archive the current reconciliation analysis as a permanent, immutable snapshot for historical audit.
          </p>

          <div>
            <label className="text-xs font-semibold text-surface-700 dark:text-surface-300 block mb-1">
              Period Identifier (e.g. Month / Year)
            </label>
            <input
              type="text"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-full h-9 px-3 text-xs rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800"
            />
          </div>

          <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-surface-500">Products in snapshot:</span>
              <span className="font-bold">{currentResult?.summary.totalProducts}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-emerald-600">Matched products:</span>
              <span className="font-bold text-emerald-600">{currentResult?.summary.matched}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-rose-600">Discrepancies / Variances:</span>
              <span className="font-bold text-rose-600">{currentResult?.summary.variance}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setSaveModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saveSnapshotMut.isPending}
              onClick={() => saveSnapshotMut.mutate()}
            >
              Confirm & Preserve
            </Button>
          </div>
        </div>
      </Modal>

      {/* Snapshot Detail Modal */}
      <Modal
        open={snapshotDetailOpen}
        onClose={() => setSnapshotDetailOpen(false)}
        title={`Historical Snapshot: ${selectedSnapshot?.period || ''}`}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2 text-center p-3 bg-surface-50 dark:bg-surface-800 rounded-lg text-xs">
            <div>
              <div className="text-surface-400">Total Items</div>
              <div className="text-sm font-bold mt-0.5">{selectedSnapshot?.total_products}</div>
            </div>
            <div>
              <div className="text-emerald-600">Matched</div>
              <div className="text-sm font-bold text-emerald-600 mt-0.5">{selectedSnapshot?.matched_count}</div>
            </div>
            <div>
              <div className="text-rose-600">Variances</div>
              <div className="text-sm font-bold text-rose-600 mt-0.5">{selectedSnapshot?.variance_count}</div>
            </div>
            <div>
              <div className="text-amber-600">Incomplete</div>
              <div className="text-sm font-bold text-amber-600 mt-0.5">{selectedSnapshot?.incomplete_count}</div>
            </div>
          </div>

          {loadingSnapshotItems ? (
            <LoadingState message="Loading snapshot items…" />
          ) : (
            <div className="border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
              <table className="dt-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product Name</th>
                    <th className="text-right">SAP Stock</th>
                    <th className="text-right">DistroTrack Stock</th>
                    <th className="text-right">Variance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshotItems.map((it) => (
                    <tr key={it.id}>
                      <td className="text-xs font-mono font-bold">{it.sku}</td>
                      <td className="text-xs truncate max-w-xs">{it.product_name}</td>
                      <td className="text-xs text-right font-medium">{it.sap_stock != null ? it.sap_stock : '—'}</td>
                      <td className="text-xs text-right font-medium">{it.distrotrack_stock != null ? it.distrotrack_stock : '—'}</td>
                      <td className="text-xs text-right font-bold">
                        <span className={it.variance === 0 ? 'text-emerald-600' : it.variance! > 0 ? 'text-blue-600' : 'text-rose-600'}>
                          {it.variance != null ? (it.variance > 0 ? `+${it.variance}` : it.variance) : '—'}
                        </span>
                      </td>
                      <td>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          it.status === 'MATCHED'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : it.status === 'VARIANCE'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : it.status === 'INCOMPLETE DATA'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-purple-50 text-purple-700 border-purple-200'
                        }`}>
                          {it.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setSnapshotDetailOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
