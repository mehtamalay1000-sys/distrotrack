import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  Upload, FileSpreadsheet, Users, Package, CheckCircle2, Loader2,
  RefreshCw, AlertTriangle, Database, Sparkles
} from 'lucide-react';
import { PageHeader, Button, Card } from '@/shared/ui';
import { parseSalesExcel } from '../parsers/salesExcelParser';
import { bulkSeedMasterData } from '../services/masterDataService';
import type { ParsedMasterData } from '../parsers/salesExcelParser';

type Step = 'upload' | 'preview' | 'seeding' | 'done';
type PreviewTab = 'parties' | 'products';

export function MasterDataPage() {
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedMasterData | null>(null);
  const [activeTab, setActiveTab] = useState<PreviewTab>('parties');
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' });
  const [seedResult, setSeedResult] = useState<{
    partiesCreated: number; partiesSkipped: number;
    productsCreated: number; productsSkipped: number;
    errors: string[];
  } | null>(null);

  // Search/filter state
  const [partySearch, setPartySearch] = useState('');
  const [productSearch, setProductSearch] = useState('');

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setParsedData(null);
    setSeedResult(null);
    setStep('upload');

    try {
      toast.info('Parsing Excel file…');
      const buffer = await selectedFile.arrayBuffer();
      const data = parseSalesExcel(buffer);
      setParsedData(data);
      setStep('preview');

      if (data.warnings.length > 0) {
        data.warnings.forEach(w => toast.warning(w));
      }

      toast.success(`Found ${data.parties.length} parties and ${data.products.length} products from ${data.totalRows} rows.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Parsing failed: ${msg}`);
      setStep('upload');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls'))) {
      handleFileSelect(droppedFile);
    } else {
      toast.error('Please drop an Excel file (.xlsx or .xls)');
    }
  }, [handleFileSelect]);

  const handleSeed = async () => {
    if (!parsedData) return;
    setStep('seeding');
    setProgress({ current: 0, total: parsedData.parties.length + parsedData.products.length, label: 'Starting…' });

    try {
      const result = await bulkSeedMasterData(
        parsedData.parties,
        parsedData.products,
        (current, total, label) => setProgress({ current, total, label })
      );

      setSeedResult(result);
      setStep('done');

      // Invalidate relevant queries
      qc.invalidateQueries({ queryKey: ['parties'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });

      if (result.errors.length > 0) {
        toast.warning(`Seeded with ${result.errors.length} warnings. Check results.`);
      } else {
        toast.success(`Successfully seeded ${result.partiesCreated} parties and ${result.productsCreated} products!`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Seeding failed: ${msg}`);
      setStep('preview');
    }
  };

  const handleReset = () => {
    setFile(null);
    setParsedData(null);
    setSeedResult(null);
    setStep('upload');
    setProgress({ current: 0, total: 0, label: '' });
    setPartySearch('');
    setProductSearch('');
  };

  const filteredParties = parsedData?.parties.filter(p =>
    !partySearch || p.name.toLowerCase().includes(partySearch.toLowerCase()) || p.code.toLowerCase().includes(partySearch.toLowerCase())
  ) ?? [];

  const filteredProducts = parsedData?.products.filter(p =>
    !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase())
  ) ?? [];

  const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Master Data Upload"
        description="Seed your Supabase database with parties & products from a Sales Excel file"
        actions={
          step !== 'upload' && step !== 'seeding' ? (
            <Button variant="outline" size="sm" onClick={handleReset} icon={<RefreshCw className="h-4 w-4" />}>
              Start Over
            </Button>
          ) : undefined
        }
      />

      {/* ── Step 1: Upload ──────────────────────────────────────── */}
      {step === 'upload' && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className={`
            border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300
            ${file
              ? 'border-primary-400 bg-primary-50/30 dark:bg-primary-950/20'
              : 'border-surface-300 dark:border-surface-700 hover:border-primary-400 dark:hover:border-primary-500 hover:bg-surface-50 dark:hover:bg-surface-800/50'
            }
          `}
        >
          <div className="flex flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-500/20">
              <FileSpreadsheet className="h-8 w-8 text-white" />
            </div>

            <div>
              <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">
                Upload Sales Excel File
              </h3>
              <p className="text-sm text-surface-500 dark:text-surface-400 mt-1 max-w-md mx-auto">
                Drop your SAP Sales Export Excel file here, or click to browse.
                The file should contain columns like <strong>Cust Code</strong>, <strong>Cust Name</strong>, <strong>SKU Code</strong>, and <strong>Description</strong>.
              </p>
            </div>

            <label className="cursor-pointer">
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />
              <span className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-xl transition-colors text-sm shadow-md shadow-primary-600/20">
                <Upload className="h-4 w-4" />
                Select Excel File
              </span>
            </label>

            <p className="text-xs text-surface-400 dark:text-surface-500">
              Supports .xlsx and .xls formats
            </p>
          </div>
        </div>
      )}

      {/* ── Step 2: Preview ─────────────────────────────────────── */}
      {step === 'preview' && parsedData && (
        <div className="space-y-5">
          {/* File info bar */}
          <Card className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <FileSpreadsheet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{file?.name}</p>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  {parsedData.totalRows} data rows parsed • {file ? `${(file.size / 1024).toFixed(1)} KB` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Parsed Successfully</span>
            </div>
          </Card>

          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div
              className={`cursor-pointer transition-all border-2 rounded-xl ${
                activeTab === 'parties'
                  ? 'border-primary-500 dark:border-primary-400 shadow-md shadow-primary-500/10'
                  : 'border-transparent hover:border-surface-300 dark:hover:border-surface-600'
              }`}
              onClick={() => setActiveTab('parties')}
            >
              <Card className="p-5">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-surface-900 dark:text-surface-100">{parsedData.parties.length}</div>
                    <div className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide">Unique Parties</div>
                  </div>
                </div>
              </Card>
            </div>

            <div
              className={`cursor-pointer transition-all border-2 rounded-xl ${
                activeTab === 'products'
                  ? 'border-primary-500 dark:border-primary-400 shadow-md shadow-primary-500/10'
                  : 'border-transparent hover:border-surface-300 dark:hover:border-surface-600'
              }`}
              onClick={() => setActiveTab('products')}
            >
              <Card className="p-5">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                    <Package className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-surface-900 dark:text-surface-100">{parsedData.products.length}</div>
                    <div className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide">Unique Products</div>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {/* Warnings */}
          {parsedData.warnings.length > 0 && (
            <Card className="p-4 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                  {parsedData.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* Parties Preview Tab */}
          {activeTab === 'parties' && (
            <Card className="overflow-hidden">
              <div className="p-3 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-500" />
                  Parties Preview
                  <span className="text-xs font-normal bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 px-2 py-0.5 rounded-full">
                    {filteredParties.length}
                  </span>
                </h3>
                <input
                  type="text"
                  placeholder="Search parties…"
                  value={partySearch}
                  onChange={(e) => setPartySearch(e.target.value)}
                  className="text-xs px-3 py-1.5 border border-surface-200 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 w-48 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                />
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="dt-table">
                  <thead>
                    <tr>
                      <th className="w-8">#</th>
                      <th>Code</th>
                      <th>Party Name</th>
                      <th>Region / City</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredParties.map((p, i) => (
                      <tr key={p.code}>
                        <td className="text-xs text-surface-400">{i + 1}</td>
                        <td>
                          <span className="font-mono text-xs bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300 px-1.5 py-0.5 rounded">
                            {p.code}
                          </span>
                        </td>
                        <td className="font-medium text-surface-900 dark:text-surface-100">{p.name}</td>
                        <td className="text-surface-500 dark:text-surface-400">{p.city || '—'}</td>
                      </tr>
                    ))}
                    {filteredParties.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center py-6 text-sm text-surface-400">
                          {partySearch ? 'No parties match your search.' : 'No parties found.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Products Preview Tab */}
          {activeTab === 'products' && (
            <Card className="overflow-hidden">
              <div className="p-3 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                  <Package className="h-4 w-4 text-amber-500" />
                  Products Preview
                  <span className="text-xs font-normal bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 px-2 py-0.5 rounded-full">
                    {filteredProducts.length}
                  </span>
                </h3>
                <input
                  type="text"
                  placeholder="Search products…"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="text-xs px-3 py-1.5 border border-surface-200 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 w-48 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                />
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="dt-table">
                  <thead>
                    <tr>
                      <th className="w-8">#</th>
                      <th>SKU Code</th>
                      <th>Product Name</th>
                      <th>Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((p, i) => (
                      <tr key={p.sku}>
                        <td className="text-xs text-surface-400">{i + 1}</td>
                        <td>
                          <span className="font-mono text-xs bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300 px-1.5 py-0.5 rounded">
                            {p.sku}
                          </span>
                        </td>
                        <td className="font-medium text-surface-900 dark:text-surface-100">{p.name}</td>
                        <td>
                          {p.category ? (
                            <span className="text-xs bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 px-2 py-0.5 rounded-full font-medium">
                              {p.category}
                            </span>
                          ) : (
                            <span className="text-surface-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredProducts.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center py-6 text-sm text-surface-400">
                          {productSearch ? 'No products match your search.' : 'No products found.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Confirm Button */}
          <Card className="p-4 flex items-center justify-between bg-surface-50 dark:bg-surface-800/50">
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-primary-500" />
              <div>
                <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                  Ready to seed {parsedData.parties.length} parties and {parsedData.products.length} products
                </p>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  Existing records will be skipped (no duplicates). New records will be created.
                </p>
              </div>
            </div>
            <Button onClick={handleSeed} icon={<Sparkles className="h-4 w-4" />}>
              Seed to Supabase
            </Button>
          </Card>
        </div>
      )}

      {/* ── Step 3: Seeding Progress ───────────────────────────── */}
      {step === 'seeding' && (
        <Card className="p-8">
          <div className="flex flex-col items-center gap-6">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-500/20 animate-pulse">
              <Loader2 className="h-8 w-8 text-white animate-spin" />
            </div>

            <div className="text-center">
              <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">
                Seeding Master Data…
              </h3>
              <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                {progress.label}
              </p>
            </div>

            {/* Progress bar */}
            <div className="w-full max-w-md">
              <div className="flex items-center justify-between text-xs text-surface-500 dark:text-surface-400 mb-1.5">
                <span>{progress.current} / {progress.total}</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-2.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary-500 to-primary-600 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── Step 4: Done ───────────────────────────────────────── */}
      {step === 'done' && seedResult && (
        <div className="space-y-5">
          {/* Success header */}
          <Card className="p-8 text-center border-emerald-200 dark:border-emerald-800">
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <CheckCircle2 className="h-8 w-8 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-surface-900 dark:text-surface-100">
                  Master Data Seeded Successfully!
                </h3>
                <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                  Your Supabase database has been populated with parties and products.
                </p>
              </div>
            </div>
          </Card>

          {/* Result cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{seedResult.partiesCreated}</div>
              <div className="text-xs text-surface-500 dark:text-surface-400 mt-1 font-medium uppercase tracking-wide">Parties Created</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold text-surface-400">{seedResult.partiesSkipped}</div>
              <div className="text-xs text-surface-500 dark:text-surface-400 mt-1 font-medium uppercase tracking-wide">Parties Skipped</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{seedResult.productsCreated}</div>
              <div className="text-xs text-surface-500 dark:text-surface-400 mt-1 font-medium uppercase tracking-wide">Products Created</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold text-surface-400">{seedResult.productsSkipped}</div>
              <div className="text-xs text-surface-500 dark:text-surface-400 mt-1 font-medium uppercase tracking-wide">Products Skipped</div>
            </Card>
          </div>

          {/* Errors */}
          {seedResult.errors.length > 0 && (
            <Card className="p-4 border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20">
              <h4 className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4" />
                {seedResult.errors.length} Error(s)
              </h4>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {seedResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400 font-mono">{e}</p>
                ))}
              </div>
            </Card>
          )}

          {/* Actions */}
          <Card className="p-4 flex items-center justify-between">
            <Button variant="outline" onClick={handleReset} icon={<RefreshCw className="h-4 w-4" />}>
              Upload Another File
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => window.location.href = '/admin/parties'} icon={<Users className="h-4 w-4" />}>
                View Parties
              </Button>
              <Button variant="ghost" onClick={() => window.location.href = '/admin/products'} icon={<Package className="h-4 w-4" />}>
                View Products
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
