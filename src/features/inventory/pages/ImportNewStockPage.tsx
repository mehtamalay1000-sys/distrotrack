import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import {
  FileUp, RefreshCw, CheckCircle2,
  History, PackagePlus, ArrowRight, ShieldCheck,
  Search, AlertCircle, FileSpreadsheet
} from 'lucide-react';
import { PageHeader, Card, Button, LoadingState, EmptyState, Modal } from '@/shared/ui';
import {
  parseSapPurchaseFile,
  validateAndMatchPurchaseRows,
  confirmPurchaseImport,
  getRecentPurchaseImports,
  type PurchaseImportPreview,
  type PurchaseImportResult,
  type ParsedPurchaseRow,
} from '../services/purchaseImportService';

export function ImportNewStockPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'import' | 'history'>('import');

  // File & parsing state
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<PurchaseImportPreview | null>(null);
  const [batchRef, setBatchRef] = useState('');
  const [fileName, setFileName] = useState('');
  const [notes, setNotes] = useState('');

  // Table filter & search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'MATCHED' | 'UNMAPPED' | 'INVALID_QTY' | 'EXCLUDED_STATUS' | 'DUPLICATE'>('all');

  // Confirmation modal
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [importResult, setImportResult] = useState<PurchaseImportResult | null>(null);

  // History query
  const { data: historyList = [], isLoading: loadingHistory, refetch: refetchHistory } = useQuery({
    queryKey: ['recent_purchase_imports'],
    queryFn: getRecentPurchaseImports,
    enabled: activeTab === 'history',
  });

  // Handle file selection and parsing
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploaded = e.target.files?.[0];
    if (!uploaded) return;
    setFile(uploaded);
    setFileName(uploaded.name);
    setParsing(true);
    setImportResult(null);

    try {
      const parsed = await parseSapPurchaseFile(uploaded);
      if (parsed.error) {
        toast.error(parsed.error);
        setParsing(false);
        return;
      }

      if (parsed.rows.length === 0) {
        toast.error('No valid rows found in file.');
        setParsing(false);
        return;
      }

      setBatchRef(parsed.batchRef);
      const valPreview = await validateAndMatchPurchaseRows(parsed.rows, parsed.batchRef);
      valPreview.fileName = uploaded.name;
      setPreview(valPreview);

      toast.success(
        `Parsed ${valPreview.totalRows} rows: ${valPreview.matched} matched, ${valPreview.unmapped} unmapped, ${valPreview.duplicateCount} duplicates.`
      );
    } catch (err: any) {
      toast.error(err?.message || 'Failed to process purchase spreadsheet');
    } finally {
      setParsing(false);
    }
  };

  // Sample data loader (Colgate-Palmolive Goods Receipts from weekly purchase batch)
  const handleLoadSampleData = async () => {
    setParsing(true);
    setImportResult(null);
    const sampleRows: ParsedPurchaseRow[] = [
      {
        sku: '1600908',
        productName: 'Col ActSalt Tpst200',
        uom: 'DOZ',
        orderedQty: 100,
        receivedQty: 100,
        grStatus: 'Completed',
        grDate: new Date().toISOString().split('T')[0],
        grDocNo: '3025221175',
        poNumber: '4500123456',
        invoiceNo: '81D0001878',
        invoiceDate: '09.09.2026',
        batch: '44',
        rawRow: {},
      },
      {
        sku: '61059907',
        productName: 'CDC 40g NF 12 +1 CMF 20B/R',
        uom: 'DOZ',
        orderedQty: 360,
        receivedQty: 360,
        grStatus: 'Completed',
        grDate: new Date().toISOString().split('T')[0],
        grDocNo: '3024574206',
        poNumber: '4500123456',
        invoiceNo: '81D0001541',
        invoiceDate: '02.09.2026',
        batch: '2',
        rawRow: {},
      },
      {
        sku: '61050878',
        productName: 'CDC 200 NF',
        uom: 'DOZ',
        orderedQty: 36,
        receivedQty: 36,
        grStatus: 'Completed',
        grDate: new Date().toISOString().split('T')[0],
        grDocNo: '3024574206',
        poNumber: '4500123456',
        invoiceNo: '81D0001541',
        invoiceDate: '02.09.2026',
        batch: '38',
        rawRow: {},
      },
      {
        sku: '61042330',
        productName: 'Sensitive 6 + 1 (PO2)',
        uom: 'DOZ',
        orderedQty: 2,
        receivedQty: 2,
        grStatus: 'Pending', // Unconfirmed GR -> will be safely excluded!
        grDate: new Date().toISOString().split('T')[0],
        grDocNo: '3024574206',
        poNumber: '4500123456',
        invoiceNo: '81D0001541',
        invoiceDate: '02.09.2026',
        batch: '14',
        rawRow: {},
      },
      {
        sku: 'UNKNOWN-999999',
        productName: 'Unmapped Colgate Mystery Sample',
        uom: 'DOZ',
        orderedQty: 10,
        receivedQty: 10,
        grStatus: 'Completed',
        grDate: new Date().toISOString().split('T')[0],
        grDocNo: '3024574206',
        poNumber: '4500123456',
        invoiceNo: '81D0001541',
        invoiceDate: '02.09.2026',
        batch: '99',
        rawRow: {},
      },
    ];

    const ref = `SAMPLE-GR-${Date.now()}`;
    setBatchRef(ref);
    setFileName('colgate_weekly_purchase_sample.xlsx');
    const valPreview = await validateAndMatchPurchaseRows(sampleRows, ref);
    valPreview.fileName = 'colgate_weekly_purchase_sample.xlsx';
    setPreview(valPreview);
    setParsing(false);
    toast.success('Loaded Colgate-Palmolive sample purchase rows');
  };

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error('No preview data available');
      return await confirmPurchaseImport(preview, batchRef, fileName, notes);
    },
    onSuccess: (res) => {
      setImportResult(res);
      setConfirmModalOpen(false);
      qc.invalidateQueries({ queryKey: ['recent_purchase_imports'] });
      qc.invalidateQueries({ queryKey: ['inventory_movements'] });
      qc.invalidateQueries({ queryKey: ['sap_reconciliation_history'] });

      if (res.success) {
        toast.success(
          `Inbound Stock Recorded: ${res.movementsCreated} movements created in authoritative ledger!`
        );
      } else {
        toast.error(res.errors?.[0] || 'Import failed');
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Error recording inbound stock');
    },
  });

  // Filter preview rows
  const filteredRows = (preview?.rows || []).filter((r) => {
    let matchStatus = true;
    if (statusFilter === 'MATCHED') matchStatus = r.matchStatus === 'MATCHED' && !r.isDuplicate;
    else if (statusFilter === 'DUPLICATE') matchStatus = Boolean(r.isDuplicate);
    else if (statusFilter !== 'all') matchStatus = r.matchStatus === statusFilter;

    const q = searchQuery.toLowerCase().trim();
    const matchSearch =
      !q ||
      r.sku.toLowerCase().includes(q) ||
      r.productName.toLowerCase().includes(q) ||
      (r.canonicalName || '').toLowerCase().includes(q) ||
      (r.grDocNo || '').toLowerCase().includes(q) ||
      (r.invoiceNo || '').toLowerCase().includes(q);

    return matchStatus && matchSearch;
  });

  const readyToImportCount = (preview?.rows || []).filter(
    (r) => r.matchStatus === 'MATCHED' && !r.isDuplicate
  ).length;

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Import New Stock"
        description="Weekly SAP Purchase & Goods Receipt (GR) authoritative stock inward."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('import')}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'import'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              <PackagePlus className="w-4 h-4 inline mr-1.5" />
              Import Stock
            </button>
            <button
              onClick={() => {
                setActiveTab('history');
                refetchHistory();
              }}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'history'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              <History className="w-4 h-4 inline mr-1.5" />
              Import History
            </button>
          </div>
        }
      />

      {/* Critical Invariant Banner */}
      <div className="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-6 h-6 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-semibold text-blue-900 dark:text-blue-200">
              Authoritative Inventory Inbound Ledger
            </p>
            <p className="text-blue-700 dark:text-blue-300/90 text-xs mt-0.5">
              Confirmed SAP Goods Receipts create permanent <code className="bg-blue-100 dark:bg-blue-900/60 px-1 py-0.5 rounded font-mono">purchase_inward</code> movements
              that increase calculated warehouse stock. Looking for month-end physical stock audit? Use{' '}
              <Link to="/admin/inventory/reconciliation" className="underline font-medium hover:text-blue-800">
                SAP Stock Reconciliation
              </Link>{' '}
              instead.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            Idempotent Protected
          </span>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
            Stage 8 Secure RPC
          </span>
        </div>
      </div>

      {activeTab === 'import' && (
        <>
          {/* File Upload Card */}
          <Card className="p-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 pb-6 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                  Select Weekly SAP Purchase / GR File
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Accepts <span className="font-medium text-gray-700 dark:text-gray-300">.xlsx, .xls, .csv</span>.
                  Auto-detects Article No, Confirmed Qty, Sales Unit, GR Document, and Status.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadSampleData}
                  disabled={parsing}
                  className="text-xs"
                >
                  Load Colgate Sample Data
                </Button>

                <label className="relative inline-flex">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileUpload}
                    disabled={parsing}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <Button variant="primary" size="sm" loading={parsing} className="pointer-events-none text-xs">
                    <FileUp className="w-4 h-4 mr-1.5" />
                    {file ? 'Change File' : 'Browse Excel File'}
                  </Button>
                </label>
              </div>
            </div>

            {/* Parsing Indicator */}
            {parsing && (
              <div className="py-8">
                <LoadingState message="Reading spreadsheet & matching Colgate-Palmolive product master..." />
              </div>
            )}

            {/* File Info Bar */}
            {preview && !parsing && (
              <div className="mt-4 pt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-600 dark:text-gray-400">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{fileName}</span>
                  <span className="text-gray-400">•</span>
                  <span>Batch Reference: <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono text-blue-600">{batchRef}</code></span>
                </div>
                <div className="text-gray-500">
                  Total Parsed Rows: <strong className="text-gray-900 dark:text-gray-100">{preview.totalRows}</strong>
                </div>
              </div>
            )}
          </Card>

          {/* Import Result Banner */}
          {importResult && (
            <div
              className={`rounded-xl p-5 border ${
                importResult.success
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                  : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
              }`}
            >
              <div className="flex items-start gap-3">
                {importResult.success ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-6 h-6 text-red-600 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">
                    {importResult.success ? 'Inbound Stock Imported Successfully' : 'Import Failed'}
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                    {importResult.message}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs">
                    <span className="text-emerald-700 font-medium">
                      Inbound Movements Created: <strong>{importResult.movementsCreated}</strong>
                    </span>
                    <span className="text-amber-700 font-medium">
                      Duplicates Skipped: <strong>{importResult.skippedDuplicate}</strong>
                    </span>
                    <span className="text-gray-500">
                      Unmapped Skipped: <strong>{importResult.skippedUnmapped}</strong>
                    </span>
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <Link to="/admin/inventory/register">
                      <Button size="sm" variant="outline" className="text-xs">
                        View Quantity Register <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    </Link>
                    <Link to="/admin/inventory/reconciliation">
                      <Button size="sm" variant="outline" className="text-xs">
                        Open SAP Reconciliation <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Preview & Stats Deck */}
          {preview && (
            <div className="space-y-6">
              {/* Metric Strips */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800">
                  <div className="text-xs text-gray-500">Total Rows</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                    {preview.totalRows}
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/20">
                  <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">Matched SKUs</div>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    {preview.matched}
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/20">
                  <div className="text-xs text-amber-700 dark:text-amber-400 font-medium">Unmapped SKUs</div>
                  <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                    {preview.unmapped}
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800">
                  <div className="text-xs text-gray-500">Excluded (Pending)</div>
                  <div className="text-2xl font-bold text-gray-600 dark:text-gray-400 mt-1">
                    {preview.excluded}
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-purple-200 dark:border-purple-900/40 bg-purple-50/20">
                  <div className="text-xs text-purple-700 dark:text-purple-400 font-medium">Already Imported</div>
                  <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                    {preview.duplicateCount}
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/20">
                  <div className="text-xs text-blue-700 dark:text-blue-400 font-medium">Total Received Qty</div>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                    {preview.totalReceivedQty.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Action Bar before Table */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800">
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search SKU, Product, GR Doc..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="all">All Rows ({preview.totalRows})</option>
                    <option value="MATCHED">Ready to Import ({readyToImportCount})</option>
                    <option value="DUPLICATE">Already Imported ({preview.duplicateCount})</option>
                    <option value="UNMAPPED">Unmapped SKUs ({preview.unmapped})</option>
                    <option value="EXCLUDED_STATUS">Excluded / Pending ({preview.excluded})</option>
                    <option value="INVALID_QTY">Invalid Qty ({preview.invalid})</option>
                  </select>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  <Button
                    variant="primary"
                    disabled={readyToImportCount === 0 || importMutation.isPending}
                    onClick={() => setConfirmModalOpen(true)}
                    className="text-xs px-4 py-2"
                  >
                    <PackagePlus className="w-4 h-4 mr-1.5" />
                    Confirm & Record {readyToImportCount} Inbound Rows
                  </Button>
                </div>
              </div>

              {/* Preview Table */}
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-800/70 text-gray-500 border-b border-gray-200 dark:border-gray-800">
                      <tr>
                        <th className="py-3 px-4 font-semibold">Status</th>
                        <th className="py-3 px-4 font-semibold">Material / SKU</th>
                        <th className="py-3 px-4 font-semibold">Official Product Name</th>
                        <th className="py-3 px-4 font-semibold text-right">Received Qty</th>
                        <th className="py-3 px-4 font-semibold">UOM</th>
                        <th className="py-3 px-4 font-semibold">GR Status</th>
                        <th className="py-3 px-4 font-semibold">GR Date</th>
                        <th className="py-3 px-4 font-semibold">GR Doc / Invoice</th>
                        <th className="py-3 px-4 font-semibold">Validation Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {filteredRows.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-gray-400">
                            No rows match the selected filter.
                          </td>
                        </tr>
                      ) : (
                        filteredRows.map((r, idx) => {
                          const isDupe = r.isDuplicate;
                          const isMatched = r.matchStatus === 'MATCHED' && !isDupe;
                          const isUnmapped = r.matchStatus === 'UNMAPPED';
                          const isExcluded = r.matchStatus === 'EXCLUDED_STATUS';

                          return (
                            <tr
                              key={idx}
                              className={`hover:bg-gray-50/80 dark:hover:bg-gray-800/40 ${
                                isDupe ? 'bg-purple-50/30 dark:bg-purple-950/10' : ''
                              }`}
                            >
                              <td className="py-2.5 px-4 whitespace-nowrap">
                                {isDupe ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                                    Already Imported
                                  </span>
                                ) : isMatched ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                    Ready to Inward
                                  </span>
                                ) : isUnmapped ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                    UNMAPPED
                                  </span>
                                ) : isExcluded ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                    Excluded (Pending)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                                    Invalid
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 font-mono font-medium text-gray-900 dark:text-gray-100">
                                {r.sku}
                              </td>
                              <td className="py-2.5 px-4 font-medium text-gray-900 dark:text-gray-200 max-w-xs truncate">
                                {r.canonicalName || r.productName || '—'}
                              </td>
                              <td className="py-2.5 px-4 font-mono font-semibold text-right text-gray-900 dark:text-gray-100">
                                {r.receivedQty.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-4 text-gray-500 font-mono">
                                {r.uom}
                              </td>
                              <td className="py-2.5 px-4 text-gray-700 dark:text-gray-300">
                                {r.grStatus || '—'}
                              </td>
                              <td className="py-2.5 px-4 text-gray-500 whitespace-nowrap">
                                {r.grDate || '—'}
                              </td>
                              <td className="py-2.5 px-4 text-gray-600 dark:text-gray-400 font-mono text-[11px]">
                                {r.grDocNo || r.invoiceNo || '—'}
                              </td>
                              <td className="py-2.5 px-4 text-gray-500 text-[11px]">
                                {r.validationError ? (
                                  <span className="text-red-600 dark:text-red-400 font-medium">
                                    {r.validationError}
                                  </span>
                                ) : isDupe ? (
                                  <span className="text-purple-600 dark:text-purple-400">
                                    Deterministic idempotency match: skipped to prevent duplicate stock.
                                  </span>
                                ) : (
                                  <span className="text-emerald-600 dark:text-emerald-400">
                                    Verified canonical Colgate SKU
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <History className="w-5 h-5 text-blue-600" />
              Recent SAP Stock Inward Batches
            </h3>
            <Button size="sm" variant="outline" onClick={() => refetchHistory()} className="text-xs">
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              Refresh
            </Button>
          </div>

          {loadingHistory ? (
            <LoadingState message="Loading import history..." />
          ) : historyList.length === 0 ? (
            <EmptyState
              title="No Inward Imports Yet"
              description="Upload your first weekly SAP purchase/GR spreadsheet to create authoritative inbound stock movements."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800/70 text-gray-500 border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Batch Reference</th>
                    <th className="py-3 px-4 font-semibold">File Name</th>
                    <th className="py-3 px-4 font-semibold">Import Date</th>
                    <th className="py-3 px-4 font-semibold text-right">Total Rows</th>
                    <th className="py-3 px-4 font-semibold text-right text-emerald-600">Movements Created</th>
                    <th className="py-3 px-4 font-semibold text-right text-purple-600">Duplicates Skipped</th>
                    <th className="py-3 px-4 font-semibold text-right text-amber-600">Unmapped Skipped</th>
                    <th className="py-3 px-4 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {historyList.map((h) => (
                    <tr key={h.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="py-3 px-4 font-mono font-medium text-blue-600">
                        {h.batch_ref}
                      </td>
                      <td className="py-3 px-4 text-gray-900 dark:text-gray-200">
                        {h.file_name || '—'}
                      </td>
                      <td className="py-3 px-4 text-gray-500 whitespace-nowrap">
                        {new Date(h.imported_at).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold">
                        {h.total_rows}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-emerald-600">
                        {h.movements_created}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-purple-600">
                        {h.skipped_duplicate}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-amber-600">
                        {h.skipped_unmapped}
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-[11px] max-w-xs truncate">
                        {h.notes || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Confirmation Modal */}
      <Modal
        open={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        title="Confirm Authoritative Stock Inward"
      >
        <div className="space-y-4 py-2 text-xs text-gray-700 dark:text-gray-300">
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              Authoritative Inventory Modification
            </p>
            <p className="mt-1 text-amber-800 dark:text-amber-300 text-[11px]">
              You are about to record <strong className="font-semibold">{readyToImportCount}</strong> verified inbound inventory movements.
              These will directly increase the DistroTrack operational stock ledger.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 bg-gray-50 dark:bg-gray-800/60 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
            <div>
              <span className="text-gray-400">Batch Reference:</span>
              <div className="font-mono font-medium text-gray-900 dark:text-gray-100">{batchRef}</div>
            </div>
            <div>
              <span className="text-gray-400">Movement Type:</span>
              <div className="font-mono font-semibold text-emerald-600">purchase_inward</div>
            </div>
            <div>
              <span className="text-gray-400">Origin / Destination:</span>
              <div className="text-gray-900 dark:text-gray-100 font-medium">supplier → warehouse</div>
            </div>
            <div>
              <span className="text-gray-400">Idempotency Protection:</span>
              <div className="text-blue-600 font-medium">Enabled (Deterministic Key)</div>
            </div>
          </div>

          <div>
            <label className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
              Optional Import Notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Weekly stock receipt for Sangamner depot"
              className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmModalOpen(false)}
              disabled={importMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              Confirm & Post Inbound Movements
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
