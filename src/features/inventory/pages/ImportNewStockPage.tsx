import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import {
  FileUp, RefreshCw, CheckCircle2,
  History, PackagePlus, ArrowRight, ShieldCheck,
  Search, AlertCircle, FileSpreadsheet, Plus
} from 'lucide-react';
import { PageHeader, Card, Button, LoadingState, EmptyState, Modal } from '@/shared/ui';
import { useAuth } from '@/app/AuthProvider';
import {
  parseSapPurchaseFile,
  validateAndMatchPurchaseRows,
  confirmPurchaseImport,
  getRecentPurchaseImports,
  extractSapProductDetails,
  type PurchaseImportPreview,
  type PurchaseImportResult,
  type ParsedPurchaseRow,
  type ExtractedSapProduct,
  type PurchaseImportPreviewRow,
} from '../services/purchaseImportService';
import {
  addUnmappedSapProduct,
  addBulkUnmappedSapProducts,
  updateProductMrp,
  updateBulkProductMrp,
} from '@/features/products/services/productService';

export function ImportNewStockPage() {
  const qc = useQueryClient();
  const { profile, role } = useAuth();
  const isAuthorized = role === 'owner' || role === 'master' || profile?.role === 'owner' || profile?.role === 'master';

  const [activeTab, setActiveTab] = useState<'import' | 'history'>('import');

  // File & parsing state
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<PurchaseImportPreview | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedPurchaseRow[]>([]);
  const [batchRef, setBatchRef] = useState('');
  const [fileName, setFileName] = useState('');
  const [notes, setNotes] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Table filter & search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'MATCHED' | 'MRP_UPDATE' | 'CONFLICTING_MRP' | 'UNMAPPED' | 'INVALID_QTY' | 'EXCLUDED_STATUS' | 'DUPLICATE'>('all');

  // Confirmation modal for stock import
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [importResult, setImportResult] = useState<PurchaseImportResult | null>(null);

  // Single Add Product Modal state
  const [singleAddModalOpen, setSingleAddModalOpen] = useState(false);
  const [extractedProduct, setExtractedProduct] = useState<ExtractedSapProduct | null>(null);
  const [addingProduct, setAddingProduct] = useState(false);

  // Bulk Add Modal state
  const [bulkAddModalOpen, setBulkAddModalOpen] = useState(false);
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bulkStats, setBulkStats] = useState<{
    totalUnmapped: number;
    validList: ExtractedSapProduct[];
    missingSkuCount: number;
    missingNameCount: number;
    duplicateSkuCount: number;
    invalidCount: number;
  }>({
    totalUnmapped: 0,
    validList: [],
    missingSkuCount: 0,
    missingNameCount: 0,
    duplicateSkuCount: 0,
    invalidCount: 0,
  });

  // Single MRP Review Modal state
  const [singleMrpModalOpen, setSingleMrpModalOpen] = useState(false);
  const [selectedMrpRow, setSelectedMrpRow] = useState<PurchaseImportPreviewRow | null>(null);
  const [updatingMrp, setUpdatingMrp] = useState(false);

  // Bulk MRP Review Modal state
  const [bulkMrpModalOpen, setBulkMrpModalOpen] = useState(false);
  const [bulkUpdatingMrp, setBulkUpdatingMrp] = useState(false);

  const handleConfirmSingleMrp = async () => {
    if (!selectedMrpRow || selectedMrpRow.incomingMrp === undefined) return;
    setUpdatingMrp(true);
    try {
      const res = await updateProductMrp({
        sku: selectedMrpRow.sku,
        newMrp: selectedMrpRow.incomingMrp,
        source: 'SAP_PURCHASE_IMPORT',
        importReference: batchRef,
      });
      if (res.success) {
        toast.success(`Updated SKU ${selectedMrpRow.sku} current MRP to ₹${selectedMrpRow.incomingMrp}. Historical transactions remain unchanged.`);
        setSingleMrpModalOpen(false);
        setSelectedMrpRow(null);
        await reRunMatching(parsedRows, batchRef);
      } else {
        toast.error(res.message || 'Failed to update MRP');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update MRP');
    } finally {
      setUpdatingMrp(false);
    }
  };

  const handleConfirmBulkMrp = async () => {
    if (!preview) return;
    const mrpUpdateRows = preview.rows.filter((r) => r.matchStatus === 'MRP_UPDATE' && r.incomingMrp);
    if (mrpUpdateRows.length === 0) return;

    const uniqueBySku = new Map<string, number>();
    for (const r of mrpUpdateRows) {
      if (r.incomingMrp) {
        uniqueBySku.set(r.sku.trim().toUpperCase(), r.incomingMrp);
      }
    }

    const updates = Array.from(uniqueBySku.entries()).map(([sku, newMrp]) => ({
      sku,
      newMrp,
    }));

    setBulkUpdatingMrp(true);
    try {
      const res = await updateBulkProductMrp(updates, batchRef);
      toast.success(`Updated ${res.updatedCount} products to new SAP MRP. Historical transactions remain unchanged.`);
      setBulkMrpModalOpen(false);
      await reRunMatching(parsedRows, batchRef);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to bulk update MRP');
    } finally {
      setBulkUpdatingMrp(false);
    }
  };

  // History query
  const { data: historyList = [], isLoading: loadingHistory, refetch: refetchHistory } = useQuery({
    queryKey: ['recent_purchase_imports'],
    queryFn: getRecentPurchaseImports,
    enabled: activeTab === 'history',
  });

  // Immediate in-memory re-matching without re-uploading file
  const reRunMatching = async (currentRows: ParsedPurchaseRow[], currentBatchRef: string) => {
    const valPreview = await validateAndMatchPurchaseRows(currentRows, currentBatchRef);
    valPreview.fileName = fileName;
    setPreview(valPreview);
  };

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
      setParsedRows(parsed.rows);
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
        sku: '61054028',
        productName: 'CDC 500g NF (200g*2+100g)',
        uom: 'DOZ',
        orderedQty: 4,
        receivedQty: 4,
        grStatus: 'Completed',
        grDate: new Date().toISOString().split('T')[0],
        grDocNo: '3024574206',
        poNumber: '4500123456',
        invoiceNo: '81D0001541',
        invoiceDate: '02.09.2026',
        batch: '99',
        rawRow: {
          'Article No': '61054028',
          'Description': 'CDC 500g NF (200g*2+100g)',
          'UOM': 'DOZ',
          'Confirmed Qty': 4,
          'GR Status': 'Completed',
          'Category': 'Oral Care',
          'Variant': '500g NF',
        },
      },
    ];

    const ref = `SAMPLE-GR-${Date.now()}`;
    setBatchRef(ref);
    setFileName('colgate_weekly_purchase_sample.xlsx');
    setParsedRows(sampleRows);
    const valPreview = await validateAndMatchPurchaseRows(sampleRows, ref);
    valPreview.fileName = 'colgate_weekly_purchase_sample.xlsx';
    setPreview(valPreview);
    setParsing(false);
    toast.success('Loaded Colgate-Palmolive sample purchase rows');
  };

  // Handlers for Single Add to Product Master
  const handleOpenAddModal = (row: ParsedPurchaseRow) => {
    if (!isAuthorized) {
      toast.error('Only authenticated Owner/Admin users may add products to Product Master.');
      return;
    }
    const extracted = extractSapProductDetails(row);
    setExtractedProduct(extracted);
    setSingleAddModalOpen(true);
  };

  const handleConfirmSingleAdd = async () => {
    if (!extractedProduct) return;
    setAddingProduct(true);
    try {
      const res = await addUnmappedSapProduct({
        sku: extractedProduct.sku,
        name: extractedProduct.name,
        uom: extractedProduct.uom,
        category: extractedProduct.category,
        subCategory: extractedProduct.subCategory,
        brand: extractedProduct.brand,
        subBrand: extractedProduct.subBrand,
        variant: extractedProduct.variant,
        ppg: extractedProduct.ppg,
        ppgDescription: extractedProduct.ppgDescription,
        materialGroup: extractedProduct.materialGroup,
        prodHierarchy: extractedProduct.prodHierarchy,
        mrp: extractedProduct.mrp,
        rate: extractedProduct.rate,
        unit: extractedProduct.unit,
      }, batchRef);

      if (res.status === 'already_exists') {
        toast.info(res.message || `SKU ${extractedProduct.sku} already exists in Product Master.`);
      } else if (res.status === 'created') {
        toast.success(res.message || `Product ${extractedProduct.name} (${extractedProduct.sku}) added to Product Master.`);
      } else {
        toast.error(res.error || 'Failed to add product.');
        return;
      }

      setSingleAddModalOpen(false);
      qc.invalidateQueries({ queryKey: ['products'] });

      // Immediately re-run matching without requiring re-upload!
      await reRunMatching(parsedRows, batchRef);
    } catch (err: any) {
      toast.error(err?.message || 'Error adding product to Master');
    } finally {
      setAddingProduct(false);
    }
  };

  // Handlers for Bulk Add All Valid Unmapped Products
  const handleOpenBulkModal = () => {
    if (!isAuthorized) {
      toast.error('Only authenticated Owner/Admin users may add products to Product Master.');
      return;
    }
    if (!preview) return;

    const unmappedRows = preview.rows.filter((r) => r.matchStatus === 'UNMAPPED');
    const validList: ExtractedSapProduct[] = [];
    const seenSkus = new Set<string>();
    let missingSkuCount = 0;
    let missingNameCount = 0;
    let duplicateSkuCount = 0;
    let invalidCount = 0;

    for (const r of unmappedRows) {
      const extracted = extractSapProductDetails(r);
      const cleanSku = (extracted.sku || '').trim();
      const cleanName = (extracted.name || '').trim();

      if (!cleanSku) {
        missingSkuCount++;
        invalidCount++;
        continue;
      }
      if (!cleanName) {
        missingNameCount++;
        invalidCount++;
        continue;
      }
      if (seenSkus.has(cleanSku.toUpperCase())) {
        duplicateSkuCount++;
        continue;
      }

      seenSkus.add(cleanSku.toUpperCase());
      validList.push(extracted);
    }

    setBulkStats({
      totalUnmapped: unmappedRows.length,
      validList,
      missingSkuCount,
      missingNameCount,
      duplicateSkuCount,
      invalidCount,
    });
    setBulkAddModalOpen(true);
  };

  const handleConfirmBulkAdd = async () => {
    if (bulkStats.validList.length === 0) {
      toast.error('No valid unmapped products to add.');
      return;
    }
    setBulkAdding(true);
    try {
      const res = await addBulkUnmappedSapProducts(bulkStats.validList, batchRef);
      toast.success(
        `Added ${res.createdCount} products to Master. ${res.alreadyExistsCount} already existed. ${res.invalidCount} skipped.`
      );
      setBulkAddModalOpen(false);
      qc.invalidateQueries({ queryKey: ['products'] });

      // Immediately re-run matching without requiring re-upload!
      await reRunMatching(parsedRows, batchRef);
    } catch (err: any) {
      toast.error(err?.message || 'Bulk add failed');
    } finally {
      setBulkAdding(false);
    }
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
    if (statusFilter === 'MATCHED') matchStatus = (r.matchStatus === 'MATCHED' || r.matchStatus === 'MRP_UPDATE') && !r.isDuplicate;
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
    (r) => (r.matchStatus === 'MATCHED' || r.matchStatus === 'MRP_UPDATE') && !r.isDuplicate
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
              onClick={() => {
                setActiveTab('import');
                fileInputRef.current?.click();
              }}
              className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors bg-blue-600 text-white shadow-sm hover:bg-blue-700 flex items-center"
              title="Select Weekly SAP Purchase / GR File (.xlsx, .xls, .csv)"
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
                    ref={fileInputRef}
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
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
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
                  <div className="text-xs text-amber-700 dark:text-amber-400 font-medium">MRP Updates</div>
                  <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                    {preview.mrpUpdatesCount}
                  </div>
                </div>

                {preview.conflictingMrpCount > 0 ? (
                  <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50/20">
                    <div className="text-xs text-red-700 dark:text-red-400 font-medium">Conflicting MRP</div>
                    <div className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
                      {preview.conflictingMrpCount}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/20">
                    <div className="text-xs text-amber-700 dark:text-amber-400 font-medium">Unmapped SKUs</div>
                    <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                      {preview.unmapped}
                    </div>
                  </div>
                )}

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

              {/* MRP Updates Notification Banner */}
              {preview.mrpUpdatesCount > 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/80 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
                        MRP Updates Detected: {preview.mrpUpdatesCount} SKU{preview.mrpUpdatesCount > 1 ? 's' : ''}
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300/90 mt-0.5">
                        SAP contains new MRP values for existing catalog items. Historical sales will strictly retain transaction-time pricing.
                      </p>
                    </div>
                  </div>
                  {isAuthorized && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setBulkMrpModalOpen(true)}
                      className="border-amber-400 text-amber-800 bg-amber-100/60 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:bg-amber-950 text-xs shrink-0 font-medium"
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1 text-amber-600" />
                      Review MRP Updates ({preview.mrpUpdatesCount})
                    </Button>
                  )}
                </div>
              )}

              {/* Conflicting MRP Warning Banner */}
              {preview.conflictingMrpCount > 0 && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-xl p-4 flex items-center gap-3 shadow-sm">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-red-900 dark:text-red-200 text-sm">
                      Conflicting MRP Values Detected ({preview.conflictingMrpCount} rows)
                    </p>
                    <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                      The same SKU appears with different MRPs in this batch. Conflicting rows cannot be automatically imported until resolved.
                    </p>
                  </div>
                </div>
              )}

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
                    <option value="MRP_UPDATE">MRP Updates ({preview.mrpUpdatesCount})</option>
                    {preview.conflictingMrpCount > 0 && (
                      <option value="CONFLICTING_MRP">Conflicting MRP ({preview.conflictingMrpCount})</option>
                    )}
                    <option value="DUPLICATE">Already Imported ({preview.duplicateCount})</option>
                    <option value="UNMAPPED">Unmapped SKUs ({preview.unmapped})</option>
                    <option value="EXCLUDED_STATUS">Excluded / Pending ({preview.excluded})</option>
                    <option value="INVALID_QTY">Invalid Qty ({preview.invalid})</option>
                  </select>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto justify-end flex-wrap">
                  {preview.mrpUpdatesCount > 0 && isAuthorized && (
                    <Button
                      variant="outline"
                      onClick={() => setBulkMrpModalOpen(true)}
                      className="text-xs px-3 py-2 border-amber-300 text-amber-800 bg-amber-50/50 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:bg-amber-950/30 shadow-sm"
                    >
                      <RefreshCw className="w-4 h-4 mr-1.5 text-amber-600" />
                      Review MRP Updates ({preview.mrpUpdatesCount})
                    </Button>
                  )}

                  {preview.unmapped > 0 && isAuthorized && (
                    <Button
                      variant="outline"
                      onClick={handleOpenBulkModal}
                      className="text-xs px-3 py-2 border-amber-300 text-amber-800 bg-amber-50/50 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:bg-amber-950/30 shadow-sm"
                    >
                      <PackagePlus className="w-4 h-4 mr-1.5 text-amber-600" />
                      Add All Valid Unmapped Products ({preview.unmapped})
                    </Button>
                  )}

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
                        <th className="py-3 px-4 font-semibold">Validation Notes & Actions</th>
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
                          const isMrpUpdate = r.matchStatus === 'MRP_UPDATE';
                          const isConflictingMrp = r.matchStatus === 'CONFLICTING_MRP';
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
                                ) : isConflictingMrp ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                                    CONFLICTING MRP
                                  </span>
                                ) : isMrpUpdate ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                    MRP UPDATE
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
                                {isMrpUpdate ? (
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-amber-700 dark:text-amber-300 font-medium">
                                      Current ₹{r.currentMrp ?? '—'} → SAP ₹{r.incomingMrp ?? '—'}
                                    </span>
                                    {isAuthorized && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedMrpRow(r);
                                          setSingleMrpModalOpen(true);
                                        }}
                                        className="inline-flex items-center px-2 py-1 text-[11px] font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-md hover:bg-amber-200 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900 transition-colors shrink-0 shadow-sm"
                                        title="Review and update Product Master MRP"
                                      >
                                        <RefreshCw className="w-3 h-3 mr-1" />
                                        Review MRP Update
                                      </button>
                                    )}
                                  </div>
                                ) : isConflictingMrp ? (
                                  <span className="text-red-600 dark:text-red-400 font-medium">
                                    {r.validationError || 'Conflicting MRP values for SKU in file.'}
                                  </span>
                                ) : r.validationError ? (
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                                      {r.validationError}
                                    </span>
                                    {isUnmapped && isAuthorized && (
                                      <button
                                        type="button"
                                        onClick={() => handleOpenAddModal(r)}
                                        className="inline-flex items-center px-2 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900 transition-colors shrink-0 shadow-sm"
                                        title="Add this unmapped SAP product to Product Master"
                                      >
                                        <Plus className="w-3 h-3 mr-1" />
                                        + Add to Product Master
                                      </button>
                                    )}
                                  </div>
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

      {/* Modal: Single Add Unmapped Product to Master */}
      <Modal
        open={singleAddModalOpen}
        onClose={() => !addingProduct && setSingleAddModalOpen(false)}
        title="Add to Product Master"
      >
        <div className="space-y-4 py-2 text-xs text-gray-700 dark:text-gray-300">
          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <span className="text-[11px] font-semibold text-blue-900 dark:text-blue-200 uppercase tracking-wide block">
              Source: SAP Purchase/GR Import
            </span>
            <p className="text-[11px] text-blue-700 dark:text-blue-300 mt-1">
              Registering this unmapped product into the authoritative Colgate-Palmolive Product Master.
              Adding a product alone will NOT create inventory movements.
            </p>
          </div>

          {extractedProduct && (
            <div className="space-y-3 bg-gray-50 dark:bg-gray-800/60 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-gray-400 font-medium">Material / SKU:</span>
                  <div className="font-mono font-bold text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                    {extractedProduct.sku}
                  </div>
                </div>
                <div>
                  <span className="text-gray-400 font-medium">UOM:</span>
                  <div className="font-mono font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
                    {extractedProduct.uom}
                  </div>
                </div>
              </div>

              <div>
                <span className="text-gray-400 font-medium">Product Description / Name:</span>
                <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm mt-0.5">
                  {extractedProduct.name}
                </div>
              </div>

              {/* Display available SAP fields only if present in source */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                {extractedProduct.brand && (
                  <div>
                    <span className="text-gray-400">Brand:</span>
                    <div className="font-medium text-gray-800 dark:text-gray-200">{extractedProduct.brand}</div>
                  </div>
                )}
                {extractedProduct.category && (
                  <div>
                    <span className="text-gray-400">Category:</span>
                    <div className="font-medium text-gray-800 dark:text-gray-200">{extractedProduct.category}</div>
                  </div>
                )}
                {extractedProduct.subCategory && (
                  <div>
                    <span className="text-gray-400">Sub Category:</span>
                    <div className="font-medium text-gray-800 dark:text-gray-200">{extractedProduct.subCategory}</div>
                  </div>
                )}
                {extractedProduct.variant && (
                  <div>
                    <span className="text-gray-400">Variant:</span>
                    <div className="font-medium text-gray-800 dark:text-gray-200">{extractedProduct.variant}</div>
                  </div>
                )}
                {extractedProduct.ppg && (
                  <div>
                    <span className="text-gray-400">PPG:</span>
                    <div className="font-medium text-gray-800 dark:text-gray-200">{extractedProduct.ppg}</div>
                  </div>
                )}
                {extractedProduct.ppgDescription && (
                  <div>
                    <span className="text-gray-400">PPG Description:</span>
                    <div className="font-medium text-gray-800 dark:text-gray-200">{extractedProduct.ppgDescription}</div>
                  </div>
                )}
                {extractedProduct.materialGroup && (
                  <div>
                    <span className="text-gray-400">Material Group:</span>
                    <div className="font-medium text-gray-800 dark:text-gray-200">{extractedProduct.materialGroup}</div>
                  </div>
                )}
                {extractedProduct.prodHierarchy && (
                  <div>
                    <span className="text-gray-400">Product Hierarchy:</span>
                    <div className="font-medium text-gray-800 dark:text-gray-200">{extractedProduct.prodHierarchy}</div>
                  </div>
                )}
                {extractedProduct.mrp !== null && extractedProduct.mrp !== undefined && (
                  <div>
                    <span className="text-gray-400">MRP:</span>
                    <div className="font-medium text-gray-800 dark:text-gray-200">₹{extractedProduct.mrp}</div>
                  </div>
                )}
                {extractedProduct.rate !== null && extractedProduct.rate !== undefined && (
                  <div>
                    <span className="text-gray-400">Invoice / Purchase Rate:</span>
                    <div className="font-medium text-gray-800 dark:text-gray-200">₹{extractedProduct.rate}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSingleAddModalOpen(false)}
              disabled={addingProduct}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={addingProduct}
              onClick={handleConfirmSingleAdd}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Confirm & Add to Product Master
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Bulk Add All Valid Unmapped Products */}
      <Modal
        open={bulkAddModalOpen}
        onClose={() => !bulkAdding && setBulkAddModalOpen(false)}
        title="Add All Valid Unmapped Products"
      >
        <div className="space-y-4 py-2 text-xs text-gray-700 dark:text-gray-300">
          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="font-semibold text-blue-900 dark:text-blue-200">
              Bulk Product Master Registration
            </p>
            <p className="mt-1 text-blue-800 dark:text-blue-300 text-[11px]">
              Found <strong>{bulkStats.totalUnmapped} unmapped products</strong> in the current import preview. Review the validation breakdown below before confirming.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
              <div className="text-gray-500 text-[11px]">Valid Records</div>
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {bulkStats.validList.length}
              </div>
            </div>

            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="text-gray-500 text-[11px]">Duplicate SKUs</div>
              <div className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                {bulkStats.duplicateSkuCount}
              </div>
            </div>

            <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="text-gray-500 text-[11px]">Invalid / Missing</div>
              <div className="text-xl font-bold text-red-600 dark:text-red-400 mt-0.5">
                {bulkStats.missingSkuCount + bulkStats.missingNameCount}
              </div>
            </div>
          </div>

          {bulkStats.validList.length > 0 && (
            <div>
              <span className="font-semibold text-gray-700 dark:text-gray-300 block mb-1">
                Valid Products to be Added ({bulkStats.validList.length}):
              </span>
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                {bulkStats.validList.map((item, i) => (
                  <div key={i} className="p-2 flex items-center justify-between text-[11px]">
                    <div>
                      <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">{item.sku}</span>
                      <span className="mx-2 text-gray-400">·</span>
                      <span className="text-gray-700 dark:text-gray-300">{item.name}</span>
                    </div>
                    <span className="font-mono text-gray-500">{item.uom}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkAddModalOpen(false)}
              disabled={bulkAdding}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={bulkAdding}
              disabled={bulkStats.validList.length === 0}
              onClick={handleConfirmBulkAdd}
            >
              <PackagePlus className="w-3.5 h-3.5 mr-1" />
              Confirm & Add {bulkStats.validList.length} Valid Products
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Single MRP Update Review */}
      <Modal
        open={singleMrpModalOpen}
        onClose={() => !updatingMrp && setSingleMrpModalOpen(false)}
        title="Review Product MRP Update"
      >
        <div className="space-y-4 py-2 text-xs text-gray-700 dark:text-gray-300">
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-lg p-3">
            <span className="text-[11px] font-semibold text-amber-900 dark:text-amber-200 uppercase tracking-wide block">
              MRP Mismatch Detected
            </span>
            <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-1">
              SAP Purchase Import provides a newer MRP for this product. Confirming this update changes the current Product Master MRP, but <strong>all historical sales, deliveries, and transactions remain strictly unchanged at their historical transaction-time MRP</strong>.
            </p>
          </div>

          {selectedMrpRow && (
            <div className="space-y-3 bg-gray-50 dark:bg-gray-800/60 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-gray-400 font-medium">Material / SKU:</span>
                  <div className="font-mono font-bold text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                    {selectedMrpRow.sku}
                  </div>
                </div>
                <div>
                  <span className="text-gray-400 font-medium">Source / Reference:</span>
                  <div className="font-mono text-gray-800 dark:text-gray-200 mt-0.5">
                    SAP Purchase Import ({batchRef || selectedMrpRow.grDocNo || 'Weekly Batch'})
                  </div>
                </div>
              </div>

              <div>
                <span className="text-gray-400 font-medium">Product Name:</span>
                <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm mt-0.5">
                  {selectedMrpRow.canonicalName || selectedMrpRow.productName}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <div className="p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <span className="text-gray-500 font-medium block">Current Product Master MRP:</span>
                  <span className="text-xl font-bold text-gray-700 dark:text-gray-300 mt-1 block">
                    ₹{selectedMrpRow.currentMrp ?? '—'}
                  </span>
                </div>
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-lg">
                  <span className="text-amber-800 dark:text-amber-300 font-medium block">New SAP MRP:</span>
                  <span className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1 block">
                    ₹{selectedMrpRow.incomingMrp ?? '—'}
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-gray-500 pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-between">
                <span>Effective Date: <strong>{selectedMrpRow.grDate || new Date().toISOString().split('T')[0]}</strong></span>
                <span>UOM: <strong>{selectedMrpRow.uom}</strong></span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSingleMrpModalOpen(false)}
              disabled={updatingMrp}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={updatingMrp}
              onClick={handleConfirmSingleMrp}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              Confirm MRP Update
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Bulk MRP Updates Review */}
      <Modal
        open={bulkMrpModalOpen}
        onClose={() => !bulkUpdatingMrp && setBulkMrpModalOpen(false)}
        title="Review & Confirm Bulk MRP Updates"
      >
        <div className="space-y-4 py-2 text-xs text-gray-700 dark:text-gray-300">
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-lg p-3">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              Bulk MRP Versioning Confirmation
            </p>
            <p className="mt-1 text-amber-800 dark:text-amber-300 text-[11px]">
              Found <strong>{preview?.mrpUpdatesCount || 0} product(s)</strong> with updated MRP in this SAP import. Confirming updates will set the new MRP for future sales only. <strong>Historical transactions will NEVER be modified.</strong>
            </p>
          </div>

          {preview && preview.mrpUpdatesCount > 0 && (
            <div>
              <span className="font-semibold text-gray-700 dark:text-gray-300 block mb-1">
                Products to be Updated:
              </span>
              <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                {preview.rows
                  .filter((r) => r.matchStatus === 'MRP_UPDATE' && r.incomingMrp)
                  .map((item, i) => (
                    <div key={i} className="p-2.5 flex items-center justify-between text-[11px]">
                      <div className="max-w-[65%]">
                        <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">{item.sku}</span>
                        <span className="mx-1.5 text-gray-400">·</span>
                        <span className="text-gray-700 dark:text-gray-300 truncate">{item.canonicalName || item.productName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 line-through">₹{item.currentMrp}</span>
                        <span className="text-gray-400">→</span>
                        <span className="font-bold text-amber-600 dark:text-amber-400">₹{item.incomingMrp}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkMrpModalOpen(false)}
              disabled={bulkUpdatingMrp}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={bulkUpdatingMrp}
              onClick={handleConfirmBulkMrp}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              Confirm All MRP Updates
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

