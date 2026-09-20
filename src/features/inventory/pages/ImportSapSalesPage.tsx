import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QK } from '@/lib/queryKeys';
import { toast } from 'sonner';
import { Link, useNavigate } from 'react-router-dom';
import {
  FileUp, RefreshCw, CheckCircle2, History,
  ArrowRight, ShieldCheck, Search, ShieldAlert,
  AlertCircle, FileSpreadsheet, Calendar, DollarSign,
  Package, Receipt, RotateCcw, Trash2
} from 'lucide-react';
import { PageHeader, Card, Button, LoadingState, EmptyState, Modal } from '@/shared/ui';
import { useAuth } from '@/app/AuthProvider';
import { formatCurrency } from '@/shared/utils/format';
import { AdminDeleteSapSalesModal } from '../components/AdminDeleteSapSalesModal';
import {
  parseSapSalesWorkbook,
  annotateSalesRowsStatus,
  confirmSapSalesImport,
  getSapSalesImports,
  getSapSalesImportItems,
  type SapSalesPreview,
  type ParsedSapSalesRow,
  type ConfirmSapSalesImportResult,
} from '../services/sapSalesImportService';

export function ImportSapSalesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { profile, role } = useAuth();
  const isAuthorized =
    role === 'owner' ||
    role === 'master' ||
    (role as any) === 'admin' ||
    profile?.role === 'owner' ||
    profile?.role === 'master' ||
    (profile?.role as any) === 'admin';

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedDeleteBatch, setSelectedDeleteBatch] = useState<{ id: string; ref: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'import' | 'history'>('import');

  // File & Parsing State
  const [_file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<SapSalesPreview | null>(null);
  const [annotatedRows, setAnnotatedRows] = useState<ParsedSapSalesRow[]>([]);
  const [cutoffDate, setCutoffDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState<string>('');
  const [duplicateCount, setDuplicateCount] = useState<number>(0);
  const [unmappedCount, setUnmappedCount] = useState<number>(0);
  const [matchedCount, setMatchedCount] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Table Search & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'matched' | 'duplicate' | 'unmapped' | 'cancellation'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  // Confirmation Modal
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [importResult, setImportResult] = useState<ConfirmSapSalesImportResult | null>(null);

  // History Tab: Selected Batch
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  // ── History Query ──────────────────────────────────────────────
  const { data: historyImports = [], isLoading: loadingHistory, refetch: refetchHistory } = useQuery({
    queryKey: ['sap_sales_imports'],
    queryFn: getSapSalesImports,
    enabled: activeTab === 'history',
  });

  const { data: batchItems = [], isLoading: loadingBatchItems } = useQuery({
    queryKey: ['sap_sales_import_items', selectedBatchId],
    queryFn: () => (selectedBatchId ? getSapSalesImportItems(selectedBatchId) : Promise.resolve([])),
    enabled: Boolean(selectedBatchId),
  });

  // ── File Selection & Parsing ────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    await processFile(selected);
  };

  const processFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setParsing(true);
    setImportResult(null);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const parsed = parseSapSalesWorkbook(buffer, selectedFile.name);

      // Auto-set cutoff date to latest date found in file if available
      if (parsed.dateRange.maxDate) {
        setCutoffDate(parsed.dateRange.maxDate);
      }

      // Check existing transactions for duplicate detection
      const annotation = await annotateSalesRowsStatus(parsed.allRows);

      setPreview(parsed);
      setAnnotatedRows(annotation.annotatedRows);
      setDuplicateCount(annotation.duplicateCount);
      setUnmappedCount(annotation.unmappedCount);
      setMatchedCount(annotation.matchedCount);
      setCurrentPage(1);

      toast.success(`Successfully parsed ${parsed.validRowsCount.toLocaleString()} SAP sales rows.`);
    } catch (err: any) {
      console.error('Error parsing SAP sales file:', err);
      toast.error(err.message || 'Failed to parse SAP sales workbook.');
      setFile(null);
      setPreview(null);
      setAnnotatedRows([]);
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Import Mutation ─────────────────────────────────────────────
  const importMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error('No preview loaded.');
      return confirmSapSalesImport({
        preview: { ...preview, allRows: annotatedRows },
        cutoffDate,
        notes,
      });
    },
    onSuccess: (res) => {
      setImportResult(res);
      setConfirmModalOpen(false);
      qc.invalidateQueries({ queryKey: ['inventory_stock'] });
      qc.invalidateQueries({ queryKey: ['inventory_movements'] });
      qc.invalidateQueries({ queryKey: ['quantity_register'] });
      qc.invalidateQueries({ queryKey: ['product_monthly_analytics'] });
      qc.invalidateQueries({ queryKey: ['sap_sales_imports'] });
      qc.invalidateQueries({ queryKey: ['dashboard_stats'] });
      // Propagate to Master Command Center
      qc.invalidateQueries({ queryKey: QK.masterSapImports });
      qc.invalidateQueries({ queryKey: QK.masterInventory });
      qc.invalidateQueries({ queryKey: QK.masterKpisAny });
      qc.invalidateQueries({ queryKey: QK.dashboardStats });
      qc.invalidateQueries({ queryKey: QK.sapSalesImports });
      toast.success(res.message);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to confirm SAP sales baseline import.');
    },
  });

  // ── Filtered & Paginated Table Rows ─────────────────────────────
  const filteredRows = annotatedRows.filter((r) => {
    const q = searchQuery.toLowerCase().trim();
    const matchSearch =
      !q ||
      r.sku.toLowerCase().includes(q) ||
      r.invoiceNo.toLowerCase().includes(q) ||
      r.productName.toLowerCase().includes(q) ||
      (r.custName || '').toLowerCase().includes(q) ||
      (r.custCode || '').toLowerCase().includes(q);

    let matchStatus = true;
    if (statusFilter === 'matched') matchStatus = r.status === 'matched';
    else if (statusFilter === 'duplicate') matchStatus = r.status === 'duplicate';
    else if (statusFilter === 'unmapped') matchStatus = r.status === 'unmapped';
    else if (statusFilter === 'cancellation') matchStatus = r.isCancellation;

    return matchSearch && matchStatus;
  });

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
  const paginatedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (!isAuthorized) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center max-w-md mx-auto">
          <ShieldAlert className="h-12 w-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-surface-900 dark:text-white mb-2">Access Restricted</h2>
          <p className="text-sm text-surface-500 mb-4">
            Only Owner or Master roles have authority to import SAP Sales Baseline data.
          </p>
          <Link to="/admin/inventory">
            <Button variant="outline" size="sm">Back to Inventory</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* ── Page Header with Clear Context ──────────────────────────── */}
      <PageHeader
        title="Import SAP Sales Baseline"
        description="Upload pre-go-live SAP sales data to establish an authoritative inventory baseline and unified monthly sales."
        actions={
          <div className="flex items-center gap-2">
            {isAuthorized && (
              <Button
                id="btn-delete-sap-sales"
                variant="outline"
                size="sm"
                className="border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 gap-1.5 text-xs font-semibold"
                onClick={() => {
                  setSelectedDeleteBatch(null);
                  setDeleteModalOpen(true);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                Delete SAP Sales History
              </Button>
            )}
            <Link to="/admin/inventory/import-stock">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <Package className="h-3.5 w-3.5 text-emerald-600" />
                SAP Purchase Import
              </Button>
            </Link>
            <Link to="/admin/inventory/reconciliation">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <RefreshCw className="h-3.5 w-3.5 text-amber-600" />
                SAP Reconciliation
              </Button>
            </Link>
            <Link to="/admin/inventory/register">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <Receipt className="h-3.5 w-3.5 text-indigo-600" />
                Quantity Register
              </Button>
            </Link>
          </div>
        }
      />

      {/* ── Top Tabs: Import vs History ──────────────────────────────── */}
      <div className="flex border-b border-surface-200 dark:border-surface-700 gap-6">
        <button
          onClick={() => setActiveTab('import')}
          className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'import'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Import Sales File
        </button>
        <button
          onClick={() => {
            setActiveTab('history');
            refetchHistory();
          }}
          className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'history'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
          }`}
        >
          <History className="h-4 w-4" />
          Import History & Ledger
        </button>
      </div>

      {activeTab === 'import' ? (
        <div className="space-y-6">
          {/* ── Success Summary Banner (After Confirm) ────────────────── */}
          {importResult && (
            <div className="p-5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-start gap-4">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-bold text-emerald-900 dark:text-emerald-200 text-sm">
                  SAP Sales Baseline Successfully Integrated
                </h4>
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                  {importResult.message}
                </p>
                <div className="flex items-center gap-4 mt-2 text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                  <span>Batch: <span className="font-mono">{importResult.batchRef}</span></span>
                  <span>•</span>
                  <span>Movements: {importResult.movementsCreated} created</span>
                  <span>•</span>
                  <span>Duplicates: {importResult.skippedDuplicate} skipped</span>
                  <span>•</span>
                  <span>Total Qty: {importResult.totalQuantity.toLocaleString()} units</span>
                </div>
                <div className="pt-2 flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate('/admin/inventory')}
                    className="text-xs gap-1"
                  >
                    View Updated Inventory <ArrowRight className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate('/admin/inventory/register')}
                    className="text-xs gap-1"
                  >
                    Open Quantity Register <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── Upload Area Card ─────────────────────────────────────── */}
          {!preview && (
            <Card className="p-8 border-2 border-dashed border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/20 dark:bg-indigo-950/10">
              <div className="flex flex-col items-center justify-center text-center space-y-4">
                <div className="h-16 w-16 rounded-full bg-indigo-100 dark:bg-indigo-950/80 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <FileUp className="h-8 w-8" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-surface-900 dark:text-surface-100">
                    Upload SAP Monthly Sales / Billing File
                  </h3>
                  <p className="text-xs text-surface-500 max-w-md mt-1">
                    Select your SAP sales export (<span className="font-mono">sale.xlsx</span> or <span className="font-mono">.csv</span>).
                    Transaction lines will establish the pre-go-live sales baseline and participate in monthly reporting.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                  />
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={parsing}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 text-sm font-semibold shadow-sm"
                  >
                    {parsing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                    {parsing ? 'Parsing SAP File…' : 'Choose SAP Sales File'}
                  </Button>
                </div>

                <div className="text-[11px] text-surface-400">
                  Supported formats: Microsoft Excel (.xlsx, .xls), CSV • Auto-detects columns: Order_invoice_no, SKU Code, Quantity, Net Value, Customer
                </div>
              </div>
            </Card>
          )}

          {/* ── Preview & Configuration Section ──────────────────────── */}
          {preview && (
            <div className="space-y-6">
              {/* Top Configuration & Actions Bar */}
              <div className="bg-white dark:bg-surface-800 p-5 rounded-xl border border-surface-200 dark:border-surface-700 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-indigo-100 dark:bg-indigo-950 rounded-lg text-indigo-600 dark:text-indigo-400">
                    <FileSpreadsheet className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-surface-900 dark:text-surface-100 text-sm">
                      {preview.fileName}
                    </h3>
                    <p className="text-xs text-surface-500">
                      {preview.validRowsCount.toLocaleString()} sales transactions parsed • Date range: {preview.dateRange.minDate || 'N/A'} to {preview.dateRange.maxDate || 'N/A'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Required Cutoff Date Picker */}
                  <div className="flex items-center gap-2 bg-surface-50 dark:bg-surface-900 px-3 py-1.5 rounded-lg border border-surface-200 dark:border-surface-700">
                    <Calendar className="h-4 w-4 text-indigo-600" />
                    <label className="text-xs font-semibold text-surface-600 dark:text-surface-400">
                      Cutoff Date:
                    </label>
                    <input
                      type="date"
                      value={cutoffDate}
                      onChange={(e) => setCutoffDate(e.target.value)}
                      className="bg-transparent text-xs font-bold text-surface-900 dark:text-surface-100 outline-none cursor-pointer"
                    />
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPreview(null);
                      setFile(null);
                      setAnnotatedRows([]);
                    }}
                    className="text-xs"
                  >
                    Change File
                  </Button>

                  <Button
                    onClick={() => setConfirmModalOpen(true)}
                    disabled={importMutation.isPending || duplicateCount === preview.validRowsCount}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 text-xs font-bold shadow-sm"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Confirm Baseline Import ({preview.validRowsCount - duplicateCount} New)
                  </Button>
                </div>
              </div>

              {/* ── PROMINENT GRAND TOTAL BANNER ────────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {/* Total Quantity */}
                <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white p-4 rounded-xl shadow-sm col-span-2 sm:col-span-1 lg:col-span-2">
                  <div className="flex items-center justify-between text-indigo-100 text-xs font-medium uppercase tracking-wider mb-1">
                    <span>Total Sales Quantity</span>
                    <Package className="h-4 w-4" />
                  </div>
                  <div className="text-3xl font-extrabold tracking-tight">
                    {preview.totalQuantity.toLocaleString()}
                    <span className="text-xs font-semibold ml-1.5 text-indigo-200">TOTAL UNITS</span>
                  </div>
                  <div className="text-[11px] text-indigo-100 mt-2 flex flex-wrap gap-1">
                    {Object.entries(preview.unitBreakdown).map(([uom, data]) => (
                      <span key={uom} className="bg-indigo-700/50 px-1.5 py-0.5 rounded font-mono">
                        {data.quantity.toLocaleString()} {uom}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Total Net Value */}
                <div className="bg-white dark:bg-surface-800 p-4 rounded-xl border border-surface-200 dark:border-surface-700 shadow-sm col-span-2 sm:col-span-1 lg:col-span-2">
                  <div className="flex items-center justify-between text-surface-500 text-xs font-semibold uppercase tracking-wider mb-1">
                    <span>Total Net Sales Value</span>
                    <DollarSign className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(preview.totalNetValue)}
                  </div>
                  <div className="text-[11px] text-surface-400 mt-1">
                    Gross: {formatCurrency(preview.totalGrossValue)}
                  </div>
                </div>

                {/* Unique SKUs */}
                <div className="bg-white dark:bg-surface-800 p-4 rounded-xl border border-surface-200 dark:border-surface-700 shadow-sm">
                  <div className="text-surface-500 text-xs font-semibold uppercase tracking-wider mb-1">
                    Unique SKUs
                  </div>
                  <div className="text-2xl font-bold text-surface-900 dark:text-surface-100">
                    {preview.uniqueSkusCount}
                  </div>
                  <div className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold mt-1">
                    {matchedCount} in Master
                  </div>
                </div>

                {/* Invoices & Parties */}
                <div className="bg-white dark:bg-surface-800 p-4 rounded-xl border border-surface-200 dark:border-surface-700 shadow-sm">
                  <div className="text-surface-500 text-xs font-semibold uppercase tracking-wider mb-1">
                    Invoices / Parties
                  </div>
                  <div className="text-2xl font-bold text-surface-900 dark:text-surface-100">
                    {preview.uniqueInvoicesCount}
                  </div>
                  <div className="text-[11px] text-surface-500 mt-1">
                    {preview.uniqueCustomersCount} Customers
                  </div>
                </div>
              </div>

              {/* ── Status Breakdown Bar ────────────────────────────── */}
              <div className="bg-surface-50 dark:bg-surface-900/50 p-4 rounded-xl border border-surface-200 dark:border-surface-700 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    {matchedCount} Matched in Master
                  </div>
                  <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
                    <AlertCircle className="h-4 w-4" />
                    {duplicateCount} Already Imported (Duplicates)
                  </div>
                  {unmappedCount > 0 && (
                    <div className="flex items-center gap-1.5 font-semibold text-rose-700 dark:text-rose-400">
                      <AlertCircle className="h-4 w-4" />
                      {unmappedCount} Unmapped SKUs
                    </div>
                  )}
                  {preview.cancellationCount > 0 && (
                    <div className="flex items-center gap-1.5 font-semibold text-purple-700 dark:text-purple-400">
                      <RotateCcw className="h-4 w-4" />
                      {preview.cancellationCount} Cancellations / Returns
                    </div>
                  )}
                </div>

                <div className="text-surface-500">
                  Deduction Rule: Only new transactions on or before cutoff date (<span className="font-mono font-bold text-surface-900 dark:text-surface-100">{cutoffDate}</span>) affect baseline inventory.
                </div>
              </div>

              {/* ── Transactions Preview Table ──────────────────────── */}
              <Card className="overflow-hidden border border-surface-200 dark:border-surface-700 shadow-sm">
                <div className="p-4 border-b border-surface-200 dark:border-surface-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 w-full sm:w-80">
                    <div className="relative w-full">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-400" />
                      <input
                        type="text"
                        placeholder="Search invoice, SKU, product, party…"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setCurrentPage(1);
                        }}
                        className="w-full h-8 pl-8 pr-3 text-xs border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
                    {(['all', 'matched', 'duplicate', 'unmapped', 'cancellation'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => {
                          setStatusFilter(filter);
                          setCurrentPage(1);
                        }}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold capitalize transition-all ${
                          statusFilter === filter
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200'
                        }`}
                      >
                        {filter === 'all' ? `All (${annotatedRows.length})` : filter}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-surface-700 dark:text-surface-300">
                    <thead className="bg-surface-50 dark:bg-surface-900/60 uppercase font-semibold text-surface-500 border-b border-surface-200 dark:border-surface-700">
                      <tr>
                        <th className="px-3 py-2.5">#</th>
                        <th className="px-3 py-2.5">Date</th>
                        <th className="px-3 py-2.5">Invoice No</th>
                        <th className="px-3 py-2.5">Customer</th>
                        <th className="px-3 py-2.5">SKU</th>
                        <th className="px-3 py-2.5">Product Description</th>
                        <th className="px-3 py-2.5 text-right">Quantity</th>
                        <th className="px-3 py-2.5 text-right">Net Rate</th>
                        <th className="px-3 py-2.5 text-right">Net Value</th>
                        <th className="px-3 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                      {paginatedRows.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="px-4 py-8 text-center text-surface-400 italic">
                            No transactions match the selected filter.
                          </td>
                        </tr>
                      ) : (
                        paginatedRows.map((row) => (
                          <tr
                            key={row.idempotencyKey}
                            className={`hover:bg-surface-50/50 dark:hover:bg-surface-800/40 transition-colors ${
                              row.isCancellation ? 'bg-purple-50/30 dark:bg-purple-950/10' : ''
                            }`}
                          >
                            <td className="px-3 py-2 font-mono text-surface-400">{row.index}</td>
                            <td className="px-3 py-2 whitespace-nowrap font-mono">{row.invoiceDate || '—'}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                              {row.invoiceNo}
                            </td>
                            <td className="px-3 py-2 truncate max-w-[160px]" title={row.custName || ''}>
                              {row.custName || row.custCode || '—'}
                            </td>
                            <td className="px-3 py-2 font-mono font-bold text-surface-900 dark:text-surface-100">
                              {row.sku}
                            </td>
                            <td className="px-3 py-2 truncate max-w-[200px]" title={row.productName}>
                              {row.productName}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-surface-900 dark:text-surface-100">
                              {row.quantity} <span className="font-normal text-surface-500">{row.uom}</span>
                            </td>
                            <td className="px-3 py-2 text-right">{formatCurrency(row.rate)}</td>
                            <td className="px-3 py-2 text-right font-bold text-surface-900 dark:text-surface-100">
                              {formatCurrency(row.netVal)}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {row.isDuplicate ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
                                  Duplicate
                                </span>
                              ) : row.isCancellation ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300">
                                  Cancellation
                                </span>
                              ) : row.status === 'unmapped' ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300">
                                  Unmapped
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                                  Ready
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div className="p-3 border-t border-surface-200 dark:border-surface-700 flex items-center justify-between text-xs text-surface-500">
                  <div>
                    Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length.toLocaleString()} transactions
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="text-xs h-7 px-2"
                    >
                      Previous
                    </Button>
                    <span className="font-semibold">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className="text-xs h-7 px-2"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      ) : (
        /* ── HISTORY TAB ─────────────────────────────────────────────── */
        <div className="space-y-6">
          {loadingHistory ? (
            <LoadingState message="Loading past SAP sales imports…" />
          ) : historyImports.length === 0 ? (
            <Card className="p-12 text-center">
              <EmptyState
                icon={<History className="h-10 w-10 text-surface-400" />}
                title="No SAP Sales Imports Yet"
                description="Upload and confirm your first SAP monthly sales file to populate the baseline ledger."
                action={
                  <Button size="sm" onClick={() => setActiveTab('import')} className="bg-indigo-600 text-white mt-2">
                    Go to Import Tab
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Batch list */}
              <div className="space-y-3 lg:col-span-1">
                <h3 className="text-xs font-bold uppercase tracking-wider text-surface-500">
                  Import Batches ({historyImports.length})
                </h3>
                <div className="space-y-2">
                  {historyImports.map((batch) => (
                    <div
                      key={batch.id}
                      onClick={() => setSelectedBatchId(batch.id)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all ${
                        selectedBatchId === batch.id
                          ? 'bg-indigo-50/50 dark:bg-indigo-950/30 border-indigo-500 shadow-sm'
                          : 'bg-white dark:bg-surface-800 border-surface-200 dark:border-surface-700 hover:border-surface-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                          {batch.batch_ref}
                        </span>
                        <span className="text-[10px] text-surface-400">
                          {new Date(batch.imported_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">
                        {batch.file_name || 'sale.xlsx'}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-surface-500 pt-2 border-t border-surface-100 dark:border-surface-700/60">
                        <span>Cutoff: <span className="font-mono font-medium">{batch.cutoff_date}</span></span>
                        <span className="font-bold text-surface-900 dark:text-surface-100">
                          {batch.movements_created} movements
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Selected Batch Item Details */}
              <div className="lg:col-span-2">
                {selectedBatchId ? (
                  <Card className="overflow-hidden border border-surface-200 dark:border-surface-700">
                    <div className="p-4 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/50 flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-sm text-surface-900 dark:text-surface-100">
                          Transaction Items in Batch
                        </h4>
                        <span className="text-xs text-surface-500 font-mono">
                          {batchItems.length} records
                        </span>
                      </div>
                      {isAuthorized && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs gap-1 font-semibold"
                          onClick={() => {
                            const b = historyImports.find((x) => x.id === selectedBatchId);
                            setSelectedDeleteBatch({ id: selectedBatchId, ref: b?.batch_ref || selectedBatchId });
                            setDeleteModalOpen(true);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                          Delete This Batch
                        </Button>
                      )}
                    </div>

                    {loadingBatchItems ? (
                      <div className="p-8"><LoadingState /></div>
                    ) : batchItems.length === 0 ? (
                      <div className="p-8 text-center text-surface-400 italic text-xs">
                        No item records stored for this batch.
                      </div>
                    ) : (
                      <div className="overflow-x-auto max-h-[500px]">
                        <table className="w-full text-left text-xs text-surface-700 dark:text-surface-300">
                          <thead className="bg-surface-50 dark:bg-surface-900 text-surface-500 uppercase sticky top-0 font-semibold">
                            <tr>
                              <th className="px-3 py-2">Invoice</th>
                              <th className="px-3 py-2">SKU</th>
                              <th className="px-3 py-2">Product Name</th>
                              <th className="px-3 py-2 text-right">Qty</th>
                              <th className="px-3 py-2 text-right">Net Value</th>
                              <th className="px-3 py-2">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                            {batchItems.map((it) => (
                              <tr key={it.id} className="hover:bg-surface-50/50">
                                <td className="px-3 py-1.5 font-mono text-indigo-600">{it.invoice_no}</td>
                                <td className="px-3 py-1.5 font-mono font-bold">{it.sku}</td>
                                <td className="px-3 py-1.5 truncate max-w-[180px]">{it.product_name}</td>
                                <td className="px-3 py-1.5 text-right font-bold">{it.quantity} {it.uom}</td>
                                <td className="px-3 py-1.5 text-right">{formatCurrency(it.net_val || 0)}</td>
                                <td className="px-3 py-1.5 capitalize font-semibold text-[10px]">
                                  {it.status}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                ) : (
                  <Card className="p-12 text-center text-surface-400 text-xs italic">
                    Select an import batch on the left to inspect its individual line items.
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Confirmation Modal ──────────────────────────────────────── */}
      <Modal
        open={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        title="Confirm Go-Live SAP Sales Baseline Import"
      >
        <div className="space-y-4 text-sm">
          <p className="text-surface-600 dark:text-surface-300 text-xs leading-relaxed">
            You are about to establish the pre-go-live sales baseline in DistroTrack:
          </p>

          <div className="bg-surface-50 dark:bg-surface-900 p-4 rounded-xl space-y-2 border border-surface-200 dark:border-surface-700 text-xs">
            <div className="flex justify-between">
              <span className="text-surface-500">Sales Cutoff Date:</span>
              <span className="font-mono font-bold text-indigo-600">{cutoffDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Total Valid Transactions:</span>
              <span className="font-bold">{preview?.validRowsCount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">New Inbound Stock-Outs:</span>
              <span className="font-bold text-emerald-600">
                {preview ? preview.validRowsCount - duplicateCount : 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Total Baseline Quantity:</span>
              <span className="font-bold">{preview?.totalQuantity.toLocaleString()} units</span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Total Net Value:</span>
              <span className="font-bold">{formatCurrency(preview?.totalNetValue || 0)}</span>
            </div>
          </div>

          <div className="text-[11px] text-surface-500 bg-amber-50 dark:bg-amber-950/40 p-3 rounded-lg border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
            <strong>Stock Integrity Guarantee:</strong>
            <ul className="list-disc pl-4 mt-1 space-y-0.5">
              <li>Creates append-only <span className="font-mono">sap_sales_baseline</span> movements.</li>
              <li>Transactions are protected by transaction-level idempotency keys.</li>
              <li>Future Worker Deliveries after cutoff remain independent and will not be double-deducted.</li>
            </ul>
          </div>

          <div>
            <label className="block text-xs font-semibold text-surface-700 dark:text-surface-300 mb-1">
              Optional Audit Notes:
            </label>
            <input
              type="text"
              placeholder={`Go-live sales baseline through ${cutoffDate}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full text-xs p-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmModalOpen(false)}
              disabled={importMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
            >
              {importMutation.isPending ? 'Integrating Baseline…' : 'Confirm & Record Baseline'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Admin Delete SAP Sales History Modal ───────────────────── */}
      <AdminDeleteSapSalesModal
        open={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setSelectedDeleteBatch(null);
        }}
        importId={selectedDeleteBatch?.id}
        batchRef={selectedDeleteBatch?.ref}
        onSuccess={() => {
          refetchHistory();
          setSelectedBatchId(null);
        }}
      />
    </div>
  );
}
