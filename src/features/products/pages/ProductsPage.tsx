import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Search, Edit2, Trash2, Package, Trophy, Calendar, MapPin,
  TrendingUp, BarChart3, Tag, Layers, RefreshCw, FileSpreadsheet, Scale,
  PackagePlus, History, AlertTriangle, ArrowDownToLine, Truck, RotateCcw,
  AlertCircle, ShieldAlert, Boxes, CheckCircle2, Loader2, UploadCloud, TrendingDown
} from 'lucide-react';
import { PageHeader, Button, Input, Modal, EmptyState, LoadingState, ErrorState, StatusBadge } from '@/shared/ui';
import { HistoricalSalesImportModal } from '../components/HistoricalSalesImportModal';
import {
  parseHistoricalSalesWorkbook,
  type ParsedHistoricalSalesResult
} from '../services/historicalSalesService';
import {
  getProducts, createProduct, updateProduct, deleteProduct,
  getProductMonthlyAnalytics, getRouteSalesHistory, clearAllOperationalProducts,
  clearAllSalesAnalyticsData,
} from '../services/productService';
import {
  getOperationalInventoryData,
  getProductMovementHistory,
  type ProductInventoryItem,
  type StockStatusType,
} from '@/features/inventory/services/inventoryService';
import { formatCurrency, getLocalDateString } from '@/shared/utils/format';
import type { Product } from '@/lib/database.types';
import { useAuth } from '@/app/AuthProvider';
import { AdminClearInventoryModal } from '@/features/inventory/components/AdminClearInventoryModal';

interface ProductsPageProps {
  defaultTab?: 'catalog' | 'inventory';
}

export function ProductsPage({ defaultTab }: ProductsPageProps) {
  const qc = useQueryClient();
  const { profile, role } = useAuth();
  const isAuthorized =
    role === 'owner' ||
    role === 'master' ||
    (role as any) === 'admin' ||
    profile?.role === 'owner' ||
    profile?.role === 'master' ||
    (profile?.role as any) === 'admin';

  const [clearInventoryModalOpen, setClearInventoryModalOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // URL tab coordination
  const paramTab = searchParams.get('tab') as 'catalog' | 'inventory' | 'monthly' | 'route_history' | null;
  const [activeTab, setActiveTab] = useState<'catalog' | 'inventory' | 'monthly' | 'route_history'>(
    paramTab || defaultTab || 'catalog'
  );

  useEffect(() => {
    if (paramTab && paramTab !== activeTab) {
      setActiveTab(paramTab);
    }
  }, [paramTab]);

  const handleTabChange = (tab: 'catalog' | 'inventory' | 'monthly' | 'route_history') => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // ── Tab 1: Product Catalog State ────────────────────────────────
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({
    sku: '', name: '', category: '', mrp: 0, rate: 0, unit: 'pcs'
  });

  // ── Tab 2: Inventory Operational View State ────────────────────
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState<
    'all' | 'in_stock' | 'zero_stock' | 'negative_stock' | 'low_stock' | 'unmapped' | 'incomplete'
  >('all');
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState('All');

  // Movement details modal state
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedInventoryProduct, setSelectedInventoryProduct] = useState<ProductInventoryItem | null>(null);

  // ── Tab 3: Monthly Analytics Filters ───────────────────────────
  const [selectedMonth, setSelectedMonth] = useState('2026-09');

  // ── Tab 4: Route Sales History Filters ─────────────────────────
  const [selectedDate, setSelectedDate] = useState(getLocalDateString());
  const [selectedRoute, setSelectedRoute] = useState('SANGAMNER_6');

  // ── Historical Sales Product Discovery State ──────────────────
  const [uploadingSales, setUploadingSales] = useState(false);
  const [historicalModalOpen, setHistoricalModalOpen] = useState(false);
  const [historicalParsed, setHistoricalParsed] = useState<ParsedHistoricalSalesResult | null>(null);

  const handleHistoricalFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadingSales(true);
    try {
      const buffer = await f.arrayBuffer();
      const parsed = parseHistoricalSalesWorkbook(buffer, f.name);
      setHistoricalParsed(parsed);
      setHistoricalModalOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Error reading historical sales file: ${msg}`);
    } finally {
      setUploadingSales(false);
      e.target.value = '';
    }
  };

  const handleHistoricalSuccess = () => {
    qc.invalidateQueries({ queryKey: ['products'] });
    toast.success('Historical discovery index updated successfully!');
  };

  // ── Queries ───────────────────────────────────────────────────
  const { data: products = [], isLoading: loadingProducts, error: errorProducts, refetch: refetchProducts } = useQuery({
    queryKey: ['products'],
    queryFn: () => getProducts(),
  });

  const {
    data: inventoryData,
    isLoading: loadingInventory,
    error: errorInventory,
    refetch: refetchInventory,
  } = useQuery({
    queryKey: ['inventory_stock'],
    queryFn: () => getOperationalInventoryData(),
  });

  const { data: movementHistory = [], isLoading: loadingHistory } = useQuery({
    queryKey: ['inventory_movement_history', selectedInventoryProduct?.sku],
    queryFn: () =>
      selectedInventoryProduct ? getProductMovementHistory(selectedInventoryProduct.sku) : Promise.resolve([]),
    enabled: Boolean(historyModalOpen && selectedInventoryProduct?.sku),
  });

  const { data: monthlyAnalytics, isLoading: loadingMonthly } = useQuery({
    queryKey: ['product_monthly_analytics', selectedMonth],
    queryFn: () => getProductMonthlyAnalytics(selectedMonth),
    enabled: activeTab === 'monthly',
  });

  const { data: routeHistory, isLoading: loadingRouteHistory } = useQuery({
    queryKey: ['route_sales_history', selectedRoute, selectedDate],
    queryFn: () => getRouteSalesHistory(selectedRoute, selectedDate),
    enabled: activeTab === 'route_history',
  });

  // ── Mutations ──────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: createProduct,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory_stock'] });
      toast.success('Product added to Product Master');
      closeModal();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Product> }) => updateProduct(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory_stock'] });
      toast.success('Product updated in Product Master');
      closeModal();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory_stock'] });
      toast.success('Product deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cleanCatalogMut = useMutation({
    mutationFn: () => clearAllOperationalProducts(true),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory_stock'] });
      toast.success(`Product Master cleaned (${res.count} products removed). Ready for operational SAP imports.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearSalesMut = useMutation({
    mutationFn: clearAllSalesAnalyticsData,
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success('Sales analytics data cleared');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    // If any legacy manual seed items are present in catalog, automatically trigger clean
    if (products.some((p) => p.sku === '12000-130908-0' || p.sku === 'Cibaca' || (p as any).source === 'manual_master')) {
      cleanCatalogMut.mutate();
    }
  }, [products]);

  // Unique categories for catalog filter pills
  const catalogCategories = ['All', ...Array.from(new Set(products.map((p) => p.category || 'General')))];
  const inventoryCategories = ['All', ...Array.from(new Set((inventoryData?.items || []).map((i) => i.category || 'General')))];

  // Filtered products for Catalog View
  const filteredCatalog = products.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      (p.category ?? '').toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === 'All' || (p.category || 'General') === categoryFilter;
    return matchSearch && matchCat;
  });

  // Filtered inventory items for Inventory View
  const filteredInventoryItems = (inventoryData?.items || []).filter((item) => {
    const q = inventorySearch.toLowerCase().trim();
    const matchSearch =
      !q ||
      item.sku.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      (item.brand || '').toLowerCase().includes(q) ||
      (item.category || '').toLowerCase().includes(q);

    const matchCat =
      inventoryCategoryFilter === 'All' || (item.category || 'General') === inventoryCategoryFilter;

    let matchStatus = true;
    switch (inventoryStatusFilter) {
      case 'in_stock':
        matchStatus = item.stockStatus === 'IN_STOCK';
        break;
      case 'zero_stock':
        matchStatus = item.stockStatus === 'ZERO_STOCK';
        break;
      case 'negative_stock':
        matchStatus = item.stockStatus === 'NEGATIVE_STOCK';
        break;
      case 'low_stock':
        matchStatus = item.stockStatus === 'LOW_STOCK';
        break;
      case 'unmapped':
        matchStatus = item.stockStatus === 'UNMAPPED';
        break;
      case 'incomplete':
        matchStatus = item.stockStatus === 'INCOMPLETE';
        break;
      default:
        matchStatus = true;
    }

    return matchSearch && matchCat && matchStatus;
  });

  function openCreate() {
    setEditing(null);
    setForm({ sku: '', name: '', category: '', mrp: 0, rate: 0, unit: 'pcs' });
    setModalOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      sku: p.sku,
      name: p.name,
      category: p.category ?? '',
      mrp: p.mrp,
      rate: p.rate,
      unit: p.unit ?? 'pcs',
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      updateMut.mutate({ id: editing.id, data: form });
    } else {
      createMut.mutate(form);
    }
  }

  function openHistoryModal(item: ProductInventoryItem) {
    setSelectedInventoryProduct(item);
    setHistoryModalOpen(true);
  }

  function closeHistoryModal() {
    setHistoryModalOpen(false);
    setSelectedInventoryProduct(null);
  }

  if (loadingProducts && activeTab === 'catalog') return <LoadingState />;
  if (errorProducts) return <ErrorState message={(errorProducts as Error).message} />;

  const summary = inventoryData?.summary || {
    totalSkus: products.length,
    totalInbound: 0,
    totalDelivered: 0,
    totalReturned: 0,
    negativeStockCount: 0,
    lowStockCount: 0,
    zeroStockCount: 0,
    unmappedCount: 0,
    incompleteCount: 0,
  };

  const highestSeller = monthlyAnalytics?.highestSellingProduct;

  const renderStockBadge = (status: StockStatusType, currentStock: number, uom: string) => {
    switch (status) {
      case 'NEGATIVE_STOCK':
        return (
          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 animate-pulse">
            <ShieldAlert className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
            NEGATIVE STOCK ({currentStock} {uom})
          </div>
        );
      case 'IN_STOCK':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            In Stock ({currentStock} {uom})
          </span>
        );
      case 'LOW_STOCK':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
            Low Stock ({currentStock} {uom})
          </span>
        );
      case 'ZERO_STOCK':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-700">
            Zero Stock
          </span>
        );
      case 'UNMAPPED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-orange-100 dark:bg-orange-950 text-orange-800 dark:text-orange-300 border border-orange-300 dark:border-orange-800">
            <AlertCircle className="h-3 w-3" />
            Unmapped SKU
          </span>
        );
      case 'INCOMPLETE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
            <AlertCircle className="h-3 w-3" />
            INCOMPLETE DATA
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products & Inventory"
        description="FMCG Product Master Catalog and Real-Time Authoritative Inventory Ledger"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/admin/inventory/import-stock">
              <Button variant="primary" icon={<PackagePlus className="h-4 w-4" />}>
                Import New Stock
              </Button>
            </Link>
            <Link to="/admin/inventory/import-sales">
              <Button variant="outline" icon={<TrendingDown className="h-4 w-4 text-indigo-600" />}>
                Import SAP Sales
              </Button>
            </Link>
            <Link to="/admin/inventory/register">
              <Button variant="outline" icon={<FileSpreadsheet className="h-4 w-4 text-primary-600" />}>
                Quantity Register
              </Button>
            </Link>
            <Link to="/admin/inventory/reconciliation">
              <Button variant="outline" icon={<Scale className="h-4 w-4 text-amber-600" />}>
                SAP Reconciliation
              </Button>
            </Link>

            <label className="cursor-pointer">
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={uploadingSales}
                onChange={handleHistoricalFileChange}
              />
              <span className="inline-flex items-center justify-center font-medium rounded-xl transition-colors h-9 px-3 text-xs gap-1.5 border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700">
                {uploadingSales ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-blue-500" />}
                Import Historical Sales
              </span>
            </label>

            {activeTab === 'catalog' && (
              <>
                <Button
                  variant="outline"
                  icon={<Trash2 className="h-4 w-4 text-rose-500" />}
                  onClick={() => {
                    if (confirm('Clear all imported sales analytics data and picklists?')) {
                      clearSalesMut.mutate();
                    }
                  }}
                  loading={clearSalesMut.isPending}
                >
                  Clear Sales Data
                </Button>
                <Button
                  id="btn-clean-product-master"
                  variant="outline"
                  icon={<Trash2 className="h-4 w-4 text-amber-600" />}
                  onClick={() => {
                    cleanCatalogMut.mutate();
                  }}
                  loading={cleanCatalogMut.isPending}
                >
                  Clean Product Master
                </Button>
                <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                  Add Product
                </Button>
              </>
            )}

            {isAuthorized && (
              <Button
                id="btn-reset-test-inventory"
                variant="outline"
                className="border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 gap-1.5 text-xs font-semibold"
                icon={<AlertTriangle className="h-4 w-4 text-rose-600" />}
                onClick={() => setClearInventoryModalOpen(true)}
              >
                Reset Test Inventory
              </Button>
            )}

            {activeTab === 'inventory' && (
              <Button
                variant="outline"
                icon={<RefreshCw className={`h-4 w-4 ${loadingInventory ? 'animate-spin' : ''}`} />}
                onClick={() => refetchInventory()}
                loading={loadingInventory}
              >
                Refresh Stock
              </Button>
            )}
          </div>
        }
      />

      {/* Main Feature Tabs */}
      <div className="flex items-center gap-2 border-b border-surface-200 dark:border-surface-700 pb-2 overflow-x-auto">
        <button
          onClick={() => handleTabChange('catalog')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'catalog'
              ? 'bg-primary-600 text-white shadow-sm'
              : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800'
          }`}
        >
          <Package className="h-4 w-4" />
          Product Catalog ({products.length})
        </button>

        <button
          onClick={() => handleTabChange('inventory')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'inventory'
              ? 'bg-primary-600 text-white shadow-sm'
              : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800'
          }`}
        >
          <Boxes className="h-4 w-4" />
          Inventory ({inventoryData?.items.length || products.length})
          {summary.negativeStockCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-500 text-white">
              {summary.negativeStockCount} neg
            </span>
          )}
        </button>

        {/* Temporary Debug Inspection Element */}
        <pre id="debug-store-dump" className="hidden">
          {JSON.stringify({
            productsCount: products.length,
            products: products.map((p) => ({
              id: p.id,
              sku: p.sku,
              name: p.name,
              category: p.category,
              mrp: p.mrp,
              rate: p.rate,
              unit: p.unit,
              status: p.status,
              source: p.source,
              is_sap_master: p.is_sap_master,
            })),
            inventoryCount: inventoryData?.items.length || 0,
            inventorySummary: summary,
            inventoryItems: (inventoryData?.items || []).map((i) => ({
              sku: i.sku,
              name: i.name,
              uom: i.uom,
              warehouseStock: i.warehouseStock,
              vehicleStock: i.vehicleStock,
              currentStock: i.currentStock,
              inboundQty: i.inboundQty,
              deliveredQty: i.deliveredQty,
              stockStatus: i.stockStatus,
              isUnmapped: i.isUnmapped,
              movementCount: i.movementCount,
            })),
          })}
        </pre>

        <button
          onClick={() => handleTabChange('monthly')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'monthly'
              ? 'bg-primary-600 text-white shadow-sm'
              : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800'
          }`}
        >
          <BarChart3 className="h-4 w-4" />
          Monthly Sales & Top Product
        </button>

        <button
          onClick={() => handleTabChange('route_history')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'route_history'
              ? 'bg-primary-600 text-white shadow-sm'
              : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800'
          }`}
        >
          <MapPin className="h-4 w-4" />
          Route & Date Sales History
        </button>
      </div>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* TAB 1: PRODUCT CATALOG MASTER */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          {/* Controls: Search & Category Filter */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
              <input
                type="text"
                placeholder="Search SKU, name, category…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-3 text-sm border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              />
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
              {catalogCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1 text-xs rounded-full font-medium transition-all whitespace-nowrap ${
                    categoryFilter === cat
                      ? 'bg-primary-100 dark:bg-primary-950/80 text-primary-700 dark:text-primary-300 border border-primary-300 dark:border-primary-700'
                      : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {filteredCatalog.length === 0 ? (
            <EmptyState
              icon={<Package className="h-10 w-10" />}
              title={search ? "No products match search" : "Product Master Ready (0 Active Products)"}
              description={
                search
                  ? 'Try adjusting your search query or category filter'
                  : 'The Product Master has been cleanly reset. Upload your weekly SAP Purchase / GR spreadsheet to populate operational products and inventory.'
              }
              action={
                !search ? (
                  <div className="flex items-center gap-2">
                    <Link to="/admin/inventory/import-stock">
                      <Button size="sm" icon={<PackagePlus className="h-4 w-4" />}>
                        Import Stock from SAP
                      </Button>
                    </Link>
                    <Button size="sm" variant="outline" onClick={openCreate}>
                      Add Product Manually
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ) : (
            <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-sm text-left text-surface-700 dark:text-surface-300">
                <thead className="bg-surface-50 dark:bg-surface-900/60 text-xs uppercase text-surface-500 border-b border-surface-200 dark:border-surface-700 font-semibold">
                  <tr>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Product Description</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3 text-right">MRP</th>
                    <th className="px-4 py-3 text-right">Rate</th>
                    <th className="px-4 py-3 text-center">Unit</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100 dark:divide-surface-700/60">
                  {filteredCatalog.map((p) => (
                    <tr key={p.id} className="hover:bg-surface-50/50 dark:hover:bg-surface-700/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-primary-700 dark:text-primary-400">
                        {p.sku}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-surface-900 dark:text-surface-100">{p.name}</span>
                          {p.source === 'SAP_PURCHASE_IMPORT' || (p as any).source === 'sap_purchase_import' ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                              SAP Purchase Inward
                            </span>
                          ) : p.is_sap_master ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              SAP Master
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              Manual Master
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300 px-2 py-0.5 rounded font-medium">
                          {p.category || 'General'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-surface-900 dark:text-surface-100">
                        {formatCurrency(p.mrp)}
                      </td>
                      <td className="px-4 py-3 text-right text-surface-700 dark:text-surface-300">
                        {formatCurrency(p.rate)}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-surface-500 uppercase">
                        {p.unit || p.uom || 'pcs'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={p.status === 'active' ? 'active' : 'inactive'} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(p)}
                            className="p-1.5 text-surface-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-surface-100 dark:hover:bg-surface-700 rounded transition-colors"
                            title="Edit Product"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Delete product ${p.name}?`)) deleteMut.mutate(p.id);
                            }}
                            className="p-1.5 text-surface-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-surface-100 dark:hover:bg-surface-700 rounded transition-colors"
                            title="Delete Product"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* TAB 2: INVENTORY OPERATIONAL VIEW */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {activeTab === 'inventory' && (
        <div className="space-y-6">
          {/* Summary Cards Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Card 1: Total SKUs */}
            <div className="bg-white dark:bg-surface-800 p-3.5 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">
                  Total SKUs
                </span>
                <Boxes className="h-4 w-4 text-primary-600 dark:text-primary-400" />
              </div>
              <div className="text-xl font-bold text-surface-900 dark:text-surface-100">
                {summary.totalSkus.toLocaleString()}
              </div>
              <p className="text-[10px] text-surface-500 mt-0.5">Tracked products</p>
            </div>

            {/* Card 2: Total Inbound */}
            <div className="bg-white dark:bg-surface-800 p-3.5 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">
                  Total Inbound
                </span>
                <ArrowDownToLine className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                +{summary.totalInbound.toLocaleString()}
              </div>
              <p className="text-[10px] text-surface-500 mt-0.5">Purchased / Received</p>
            </div>

            {/* Card 3: Total Delivered */}
            <div className="bg-white dark:bg-surface-800 p-3.5 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">
                  Total Delivered
                </span>
                <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="text-xl font-bold text-surface-900 dark:text-surface-100">
                {summary.totalDelivered.toLocaleString()}
              </div>
              <p className="text-[10px] text-surface-500 mt-0.5">Sold & fulfilled</p>
            </div>

            {/* Card 4: Total Returned */}
            <div className="bg-white dark:bg-surface-800 p-3.5 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">
                  Total Returned
                </span>
                <RotateCcw className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                +{summary.totalReturned.toLocaleString()}
              </div>
              <p className="text-[10px] text-surface-500 mt-0.5">Route return stock</p>
            </div>

            {/* Card 5: Low / Negative Stock */}
            <div
              className={`p-3.5 border rounded-xl shadow-sm transition-colors ${
                summary.negativeStockCount > 0
                  ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800/60'
                  : 'bg-white dark:bg-surface-800 border-surface-200 dark:border-surface-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">
                  Low / Negative
                </span>
                <AlertTriangle
                  className={`h-4 w-4 ${
                    summary.negativeStockCount > 0 ? 'text-rose-600' : 'text-amber-500'
                  }`}
                />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={`text-xl font-bold ${
                    summary.negativeStockCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {summary.negativeStockCount > 0 ? `${summary.negativeStockCount} neg` : `${summary.lowStockCount} low`}
                </span>
                {summary.negativeStockCount > 0 && summary.lowStockCount > 0 && (
                  <span className="text-xs text-surface-500">({summary.lowStockCount} low)</span>
                )}
              </div>
              <p className="text-[10px] text-surface-500 mt-0.5">Non-blocking exceptions</p>
            </div>

            {/* Card 6: Unmapped / Incomplete */}
            <div className="bg-white dark:bg-surface-800 p-3.5 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">
                  Unmapped / Inc.
                </span>
                <AlertCircle className="h-4 w-4 text-orange-500" />
              </div>
              <div className="text-xl font-bold text-orange-600 dark:text-orange-400">
                {summary.unmappedCount + summary.incompleteCount}
              </div>
              <p className="text-[10px] text-surface-500 mt-0.5">
                {summary.unmappedCount} unmapped, {summary.incompleteCount} inc.
              </p>
            </div>
          </div>

          {/* Controls: Search, Filters, Category, and Action Buttons */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
                <input
                  type="text"
                  placeholder="Search SKU or product name…"
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 text-sm border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                />
              </div>

              {/* Status Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                {[
                  { key: 'all', label: `All (${summary.totalSkus})` },
                  {
                    key: 'in_stock',
                    label: `In Stock (${summary.totalSkus - summary.zeroStockCount - summary.negativeStockCount})`,
                  },
                  { key: 'zero_stock', label: `Zero Stock (${summary.zeroStockCount})` },
                  { key: 'negative_stock', label: `Negative Stock (${summary.negativeStockCount})` },
                  { key: 'low_stock', label: `Low Stock (${summary.lowStockCount})` },
                  { key: 'unmapped', label: `Unmapped (${summary.unmappedCount})` },
                  { key: 'incomplete', label: `Incomplete (${summary.incompleteCount})` },
                ].map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setInventoryStatusFilter(f.key as any)}
                    className={`px-3 py-1 text-xs rounded-full font-medium transition-all whitespace-nowrap ${
                      inventoryStatusFilter === f.key
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Category Filter Dropdown */}
              <select
                value={inventoryCategoryFilter}
                onChange={(e) => setInventoryCategoryFilter(e.target.value)}
                className="h-8 px-2.5 text-xs font-semibold border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              >
                {inventoryCategories.map((c) => (
                  <option key={c} value={c}>
                    {c === 'All' ? 'All Categories' : c}
                  </option>
                ))}
              </select>
            </div>

            {/* Quick Action: Import Stock button */}
            <div className="flex items-center gap-2 w-full md:w-auto justify-end">
              <Link to="/admin/inventory/import-sales">
                <Button size="sm" variant="outline" icon={<UploadCloud className="h-4 w-4 text-purple-600" />}>
                  Import SAP Sales
                </Button>
              </Link>
              <Link to="/admin/inventory/import-stock">
                <Button size="sm" variant="outline" icon={<PackagePlus className="h-4 w-4 text-primary-600" />}>
                  Import New Stock
                </Button>
              </Link>
            </div>
          </div>

          {/* Operational Inventory Table */}
          {loadingInventory ? (
            <LoadingState />
          ) : errorInventory ? (
            <ErrorState message={(errorInventory as Error).message} />
          ) : filteredInventoryItems.length === 0 ? (
            <EmptyState
              icon={<Boxes className="h-10 w-10" />}
              title="No inventory records found"
              description={
                inventorySearch
                  ? 'Try clearing search filters or changing the status filter'
                  : 'Import weekly SAP purchase receipts to load inbound stock'
              }
              action={
                <div className="flex items-center gap-2">
                  <Link to="/admin/inventory/import-sales">
                    <Button size="sm" variant="outline" icon={<UploadCloud className="h-4 w-4" />}>
                      Import SAP Sales Baseline
                    </Button>
                  </Link>
                  <Link to="/admin/inventory/import-stock">
                    <Button size="sm" icon={<PackagePlus className="h-4 w-4" />}>
                      Import SAP Purchase/GR Stock
                    </Button>
                  </Link>
                </div>
              }
            />
          ) : (
            <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-surface-700 dark:text-surface-300">
                  <thead className="bg-surface-50 dark:bg-surface-900/60 text-xs uppercase text-surface-500 border-b border-surface-200 dark:border-surface-700 font-semibold">
                    <tr>
                      <th className="px-4 py-3">SKU / Material</th>
                      <th className="px-4 py-3">Product Description</th>
                      <th className="px-2.5 py-3 text-center">UOM</th>
                      <th className="px-3 py-3 text-right">Inbound</th>
                      <th className="px-3 py-3 text-right">Delivered</th>
                      <th className="px-3 py-3 text-right">Returned</th>
                      <th className="px-3 py-3 text-right text-amber-700 dark:text-amber-400 font-semibold">Warehouse</th>
                      <th className="px-3 py-3 text-right text-blue-700 dark:text-blue-400 font-semibold">Vehicle</th>
                      <th className="px-4 py-3 text-right font-bold text-emerald-700 dark:text-emerald-400">Total Stock</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-3 py-3 text-center">Movements</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100 dark:divide-surface-700/60">
                    {filteredInventoryItems.map((item) => (
                      <tr
                        key={item.sku}
                        onClick={() => openHistoryModal(item)}
                        className={`hover:bg-surface-50/70 dark:hover:bg-surface-700/40 transition-colors cursor-pointer ${
                          item.stockStatus === 'NEGATIVE_STOCK' ? 'bg-rose-500/5 dark:bg-rose-500/10' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-mono text-xs font-bold text-primary-700 dark:text-primary-400">
                          {item.sku}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-surface-900 dark:text-surface-100">{item.name}</div>
                          <div className="flex items-center gap-1.5 text-[11px] text-surface-500 mt-0.5">
                            <span>{item.category || 'General'}</span>
                            {item.brand && (
                              <>
                                <span>•</span>
                                <span>{item.brand}</span>
                              </>
                            )}
                            {item.mrp && item.mrp > 0 && (
                              <>
                                <span>•</span>
                                <span className="font-medium text-surface-600 dark:text-surface-400">
                                  MRP {formatCurrency(item.mrp)}
                                </span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-2.5 py-3 text-center font-mono text-xs text-surface-500 uppercase">
                          {item.uom}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {item.inboundQty > 0 ? (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              +{item.inboundQty.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-surface-400">0</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {item.deliveredQty > 0 ? (
                            <span className="font-medium text-surface-700 dark:text-surface-300">
                              {item.deliveredQty.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-surface-400">0</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {item.returnedQty > 0 ? (
                            <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                              +{item.returnedQty.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-surface-400">0</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-bold text-surface-800 dark:text-surface-200">
                          {item.warehouseStock.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-bold text-blue-600 dark:text-blue-400">
                          {item.vehicleStock.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`text-sm font-bold px-2 py-0.5 rounded ${
                              item.currentStock < 0
                                ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300'
                                : item.currentStock === 0
                                ? 'text-surface-600 dark:text-surface-400'
                                : 'text-emerald-700 dark:text-emerald-400 font-extrabold'
                            }`}
                          >
                            {item.currentStock.toLocaleString()} {item.uom}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          {renderStockBadge(item.stockStatus, item.currentStock, item.uom)}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openHistoryModal(item);
                            }}
                            className="p-1 text-surface-400 hover:text-primary-600 dark:hover:text-primary-400 rounded hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                            title="View Stock Movement History"
                          >
                            <History className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* TAB 3: MONTHLY SALES ANALYTICS & HIGHEST SELLING PRODUCT */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {activeTab === 'monthly' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4 bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-primary-600 dark:text-primary-400" />
              <div>
                <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                  Select Analytics Month
                </h3>
                <p className="text-xs text-surface-500">
                  View total products sold and highest selling SKU of the month
                </p>
              </div>
            </div>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-9 px-3 text-sm font-semibold border border-surface-300 dark:border-surface-600 rounded-lg bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            >
              <option value="2026-09">September 2026</option>
              <option value="2026-08">August 2026</option>
              <option value="2026-07">July 2026</option>
              <option value="2026-06">June 2026</option>
            </select>
          </div>

          {/* Monthly Sales Source Breakdown */}
          <div className="bg-gradient-to-r from-purple-500/5 via-primary-500/5 to-blue-500/5 border border-surface-200 dark:border-surface-700 rounded-xl p-4 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-surface-200/70 dark:border-surface-700/70 pb-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-purple-600"></span>
                <h4 className="text-xs font-bold uppercase tracking-wider text-surface-900 dark:text-surface-100">
                  Monthly Sales Source Breakdown ({selectedMonth})
                </h4>
              </div>
              <div className="flex items-center gap-3 text-xs text-surface-500 flex-wrap">
                <span>Transactions: <strong className="text-surface-900 dark:text-surface-100">{monthlyAnalytics?.totalTransactions || 0}</strong></span>
                <span>•</span>
                <span>Customers: <strong className="text-surface-900 dark:text-surface-100">{monthlyAnalytics?.uniqueCustomers || 0}</strong></span>
                <span>•</span>
                <span>Active SKUs: <strong className="text-surface-900 dark:text-surface-100">{monthlyAnalytics?.uniqueSkus || 0}</strong></span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* SAP Baseline Sales */}
              <div className="bg-white dark:bg-surface-800/90 border border-purple-200 dark:border-purple-900/50 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wider">
                    SAP Baseline Sales
                  </span>
                  <span className="text-[10px] bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded font-bold">
                    Pre-Go-Live
                  </span>
                </div>
                <div className="text-xl font-bold text-surface-900 dark:text-surface-100 mt-1 tabular-nums">
                  {formatCurrency(monthlyAnalytics?.sapBaselineRevenue || 0)}
                </div>
                <div className="text-xs text-surface-500 mt-0.5">
                  {(monthlyAnalytics?.sapBaselineUnits || 0).toLocaleString()} pcs sold
                </div>
              </div>

              {/* DistroTrack Operational Sales */}
              <div className="bg-white dark:bg-surface-800/90 border border-blue-200 dark:border-blue-900/50 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider">
                    DistroTrack Deliveries
                  </span>
                  <span className="text-[10px] bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded font-bold">
                    Post-Cutoff
                  </span>
                </div>
                <div className="text-xl font-bold text-surface-900 dark:text-surface-100 mt-1 tabular-nums">
                  {formatCurrency(monthlyAnalytics?.distrotrackRevenue || 0)}
                </div>
                <div className="text-xs text-surface-500 mt-0.5">
                  {(monthlyAnalytics?.distrotrackUnits || 0).toLocaleString()} pcs delivered
                </div>
              </div>

              {/* Total Authoritative Month Sales */}
              <div className="bg-white dark:bg-surface-800/90 border border-emerald-200 dark:border-emerald-900/50 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
                    Total Month Sales
                  </span>
                  <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded font-bold">
                    Authoritative
                  </span>
                </div>
                <div className="text-xl font-extrabold text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">
                  {formatCurrency(monthlyAnalytics?.totalRevenue || 0)}
                </div>
                <div className="text-xs text-surface-500 mt-0.5">
                  {(monthlyAnalytics?.totalUnitsSold || 0).toLocaleString()} pcs total (X + Y)
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">
                  Monthly Paid Units
                </span>
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-surface-900 dark:text-surface-100">
                {monthlyAnalytics?.totalUnitsSold.toLocaleString() || 0}{' '}
                <span className="text-xs font-normal text-surface-500">pcs</span>
              </div>
              <p className="text-xs text-surface-500 mt-1">Paid product units delivered</p>
            </div>

            <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">
                  Free Scheme Units
                </span>
                <Tag className="h-4 w-4 text-amber-600" />
              </div>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                +{monthlyAnalytics?.totalFreeUnits.toLocaleString() || 0}{' '}
                <span className="text-xs font-normal text-surface-500">pcs free</span>
              </div>
              <p className="text-xs text-surface-500 mt-1">Scheme free products given</p>
            </div>

            <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">
                  Total Product Sales
                </span>
                <Layers className="h-4 w-4 text-primary-600" />
              </div>
              <div className="text-2xl font-bold text-primary-700 dark:text-primary-400">
                {formatCurrency(monthlyAnalytics?.totalRevenue || 0)}
              </div>
              <p className="text-xs text-surface-500 mt-1">Gross month sales revenue</p>
            </div>

            <div className="bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border-2 border-amber-400/40 dark:border-amber-500/30 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1">
                  <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Top Product Of Month
                </span>
              </div>
              {highestSeller ? (
                <div>
                  <div
                    className="font-bold text-surface-900 dark:text-surface-100 text-sm truncate"
                    title={highestSeller.name}
                  >
                    {highestSeller.name}
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-amber-300/40 dark:border-amber-700/40 text-xs">
                    <span className="font-mono text-surface-600 dark:text-surface-400">{highestSeller.sku}</span>
                    <span className="font-bold text-amber-700 dark:text-amber-300">
                      {highestSeller.totalUnitsSold} pcs sold
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-surface-500 italic mt-2">No sales recorded for this month</div>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
              <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-sm">
                Monthly Product Sales Breakdown
              </h3>
              <span className="text-xs text-surface-500">Sorted by Units Sold Descending</span>
            </div>
            {loadingMonthly ? (
              <LoadingState />
            ) : (
              <table className="w-full text-sm text-left text-surface-700 dark:text-surface-300">
                <thead className="bg-surface-50 dark:bg-surface-900/60 text-xs uppercase text-surface-500 border-b border-surface-200 dark:border-surface-700 font-semibold">
                  <tr>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Product Description</th>
                    <th className="px-3 py-3 text-right">SAP Sold</th>
                    <th className="px-3 py-3 text-right">DistroTrack</th>
                    <th className="px-4 py-3 text-right">Total Units</th>
                    <th className="px-4 py-3 text-right">Free Qty</th>
                    <th className="px-4 py-3 text-right">Unit Rate</th>
                    <th className="px-4 py-3 text-right">Total Revenue</th>
                    <th className="px-4 py-3 text-right">% Revenue Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100 dark:divide-surface-700/60">
                  {monthlyAnalytics?.productStats.map((st, idx) => (
                    <tr
                      key={st.sku}
                      className={`hover:bg-surface-50/50 dark:hover:bg-surface-700/30 transition-colors ${
                        idx === 0 && st.totalUnitsSold > 0 ? 'bg-amber-500/5 dark:bg-amber-500/10' : ''
                      }`}
                    >
                      <td className="px-4 py-3 font-semibold text-xs text-surface-400">
                        {idx === 0 && st.totalUnitsSold > 0 ? '🥇 #1' : `#${idx + 1}`}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-primary-700 dark:text-primary-400">
                        {st.sku}
                      </td>
                      <td className="px-4 py-3 font-medium text-surface-900 dark:text-surface-100">{st.name}</td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-purple-700 dark:text-purple-400">
                        {st.sapUnits ? st.sapUnits.toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-blue-700 dark:text-blue-400">
                        {st.distrotrackUnits ? st.distrotrackUnits.toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-surface-900 dark:text-surface-100">
                        {st.totalUnitsSold}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {st.totalFreeUnits > 0 ? (
                          <span className="text-xs bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded font-semibold border border-emerald-200 dark:border-emerald-800">
                            +{st.totalFreeUnits} free
                          </span>
                        ) : (
                          <span className="text-surface-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-surface-700 dark:text-surface-300">
                        {formatCurrency(st.rate)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-primary-700 dark:text-primary-400">
                        {formatCurrency(st.totalRevenue)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs font-semibold">{st.percentageShare}%</span>
                          <div className="w-16 h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary-600 rounded-full"
                              style={{ width: `${Math.min(100, st.percentageShare * 2)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* TAB 4: ROUTE & DATE SALES HISTORY */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {activeTab === 'route_history' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-primary-600 dark:text-primary-400" />
              <div>
                <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                  Route & Date Sales History Filter
                </h3>
                <p className="text-xs text-surface-500">
                  Filter sold products history by specific distribution route and date
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-surface-600 dark:text-surface-400">Date:</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="h-9 px-3 text-sm font-semibold border border-surface-300 dark:border-surface-600 rounded-lg bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-surface-600 dark:text-surface-400">Route:</span>
                <select
                  value={selectedRoute}
                  onChange={(e) => setSelectedRoute(e.target.value)}
                  className="h-9 px-3 text-sm font-semibold border border-surface-300 dark:border-surface-600 rounded-lg bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                >
                  <option value="SANGAMNER_6">SANGAMNER 6</option>
                  <option value="SANGAMNER_3">SANGAMNER 3</option>
                  <option value="R-CENTRAL">Central City Route</option>
                  <option value="all">All Routes</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Delivered Units</span>
              <div className="text-2xl font-bold text-surface-900 dark:text-surface-100 mt-1">
                {routeHistory?.totalDeliveredUnits.toLocaleString() || 0}{' '}
                <span className="text-xs font-normal text-surface-500">pcs</span>
              </div>
            </div>

            <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Scheme Free Units</span>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                +{routeHistory?.totalFreeUnits.toLocaleString() || 0}{' '}
                <span className="text-xs font-normal text-surface-500">pcs free</span>
              </div>
            </div>

            <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Route Sales Value</span>
              <div className="text-2xl font-bold text-primary-700 dark:text-primary-400 mt-1">
                {formatCurrency(routeHistory?.totalSalesValue || 0)}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
              <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-sm">
                Products Sold History for {selectedDate} ({selectedRoute.replace('_', ' ')})
              </h3>
              <span className="text-xs font-medium text-surface-500">
                {routeHistory?.items.length || 0} product transactions
              </span>
            </div>

            {loadingRouteHistory ? (
              <LoadingState />
            ) : !routeHistory || routeHistory.items.length === 0 ? (
              <EmptyState
                icon={<MapPin className="h-10 w-10" />}
                title="No sales history for this route and date"
                description={`No SAP import or delivery records found for route ${selectedRoute} on ${selectedDate}. Try selecting date 2026-08-12 or uploading a SAP picklist.`}
              />
            ) : (
              <table className="w-full text-sm text-left text-surface-700 dark:text-surface-300">
                <thead className="bg-surface-50 dark:bg-surface-900/60 text-xs uppercase text-surface-500 border-b border-surface-200 dark:border-surface-700 font-semibold">
                  <tr>
                    <th className="px-4 py-3">Customer Party</th>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Product Description</th>
                    <th className="px-4 py-3 text-right">Delivered Qty</th>
                    <th className="px-4 py-3 text-right">Free Qty</th>
                    <th className="px-4 py-3 text-right">Unit Rate</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100 dark:divide-surface-700/60">
                  {routeHistory.items.map((it) => (
                    <tr key={it.id} className="hover:bg-surface-50/50 dark:hover:bg-surface-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-surface-900 dark:text-surface-100">{it.partyName}</div>
                        <div className="font-mono text-xs text-surface-400">{it.partyCode}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-primary-700 dark:text-primary-400">
                        {it.sku}
                      </td>
                      <td className="px-4 py-3 font-medium text-surface-900 dark:text-surface-100">{it.productName}</td>
                      <td className="px-4 py-3 text-right font-bold text-surface-900 dark:text-surface-100">
                        {it.deliveredQty}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {it.freeQuantity > 0 ? (
                          <span className="text-xs bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded font-semibold border border-emerald-200 dark:border-emerald-800">
                            +{it.freeQuantity} free
                          </span>
                        ) : (
                          <span className="text-surface-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-surface-700 dark:text-surface-300">
                        {formatCurrency(it.rate)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-surface-900 dark:text-surface-100">
                        {formatCurrency(it.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* STOCK MOVEMENT HISTORY MODAL */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <Modal
        open={historyModalOpen}
        onClose={closeHistoryModal}
        title={selectedInventoryProduct ? `Stock Ledger History — ${selectedInventoryProduct.sku}` : 'Stock Ledger History'}
      >
        {selectedInventoryProduct && (
          <div className="space-y-4">
            {/* Header info card */}
            <div className="bg-surface-50 dark:bg-surface-800/80 p-4 rounded-xl border border-surface-200 dark:border-surface-700">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="font-bold text-surface-900 dark:text-surface-100 text-base">
                    {selectedInventoryProduct.name}
                  </h4>
                  <div className="flex items-center gap-2 text-xs text-surface-500 mt-0.5">
                    <span className="font-mono font-semibold text-primary-600 dark:text-primary-400">
                      SKU: {selectedInventoryProduct.sku}
                    </span>
                    <span>•</span>
                    <span>UOM: {selectedInventoryProduct.uom}</span>
                    {selectedInventoryProduct.mrp && selectedInventoryProduct.mrp > 0 && (
                      <>
                        <span>•</span>
                        <span>Current Master MRP: {formatCurrency(selectedInventoryProduct.mrp)}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="text-right sm:text-right flex items-center justify-end gap-3 flex-wrap">
                  <div className="bg-white dark:bg-surface-900 px-2.5 py-1 rounded-lg border border-surface-200 dark:border-surface-700">
                    <span className="text-[10px] text-surface-500 uppercase tracking-wider font-semibold block">
                      Warehouse Stock
                    </span>
                    <span className="text-sm font-bold text-surface-800 dark:text-surface-200">
                      {selectedInventoryProduct.warehouseStock.toLocaleString()} {selectedInventoryProduct.uom}
                    </span>
                  </div>
                  <div className="bg-white dark:bg-surface-900 px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-900/50">
                    <span className="text-[10px] text-blue-600 dark:text-blue-400 uppercase tracking-wider font-semibold block">
                      Vehicle Stock
                    </span>
                    <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
                      {selectedInventoryProduct.vehicleStock.toLocaleString()} {selectedInventoryProduct.uom}
                    </span>
                  </div>
                  <div className="bg-white dark:bg-surface-900 px-3 py-1 rounded-lg border border-surface-200 dark:border-surface-700">
                    <span className="text-[10px] text-surface-500 uppercase tracking-wider font-semibold block">
                      Total Operational
                    </span>
                    <span
                      className={`text-lg font-extrabold ${
                        selectedInventoryProduct.currentStock < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : selectedInventoryProduct.currentStock === 0
                          ? 'text-surface-500'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {selectedInventoryProduct.currentStock.toLocaleString()} {selectedInventoryProduct.uom}
                    </span>
                  </div>
                </div>
              </div>

              {/* Movement Quantities Breakdown Pills */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mt-3 pt-3 border-t border-surface-200 dark:border-surface-700 text-xs">
                <div>
                  <span className="text-surface-500 block">Opening Stock</span>
                  <span className="font-semibold text-surface-800 dark:text-surface-200">
                    {selectedInventoryProduct.openingStock.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-surface-500 block">Inbound (Purchased)</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    +{selectedInventoryProduct.inboundQty.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-surface-500 block">Route Loaded (Transfer)</span>
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    {selectedInventoryProduct.routeLoadedQty.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-surface-500 block">Delivered (Sold)</span>
                  <span className="font-semibold text-surface-800 dark:text-surface-200">
                    -{selectedInventoryProduct.deliveredQty.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-surface-500 block">Returned</span>
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                    +{selectedInventoryProduct.returnedQty.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-surface-500 block">Damaged / Adj.</span>
                  <span className="font-semibold text-surface-800 dark:text-surface-200">
                    {selectedInventoryProduct.adjustmentQty - selectedInventoryProduct.damagedQty}
                  </span>
                </div>
              </div>
            </div>

            {/* Movement table from authoritative ledger */}
            <div className="border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden shadow-sm max-h-[420px] overflow-y-auto">
              <div className="p-3 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-surface-600 dark:text-surface-400">
                  Authoritative Ledger Movements ({movementHistory.length})
                </span>
                <span className="text-[11px] text-surface-400">Chronological append-only stock history</span>
              </div>

              {loadingHistory ? (
                <div className="p-8 text-center text-sm text-surface-500">Loading ledger movements…</div>
              ) : movementHistory.length === 0 ? (
                <div className="p-8 text-center">
                  <Boxes className="h-8 w-8 text-surface-300 mx-auto mb-2" />
                  <p className="text-sm font-medium text-surface-600 dark:text-surface-300">
                    No discrete movements recorded
                  </p>
                  <p className="text-xs text-surface-400 mt-1">
                    Current stock balance is 0 {selectedInventoryProduct.uom}. Stock movements will record here when
                    weekly SAP purchase files or delivery routes are confirmed.
                  </p>
                </div>
              ) : (
                <table className="w-full text-xs text-left text-surface-700 dark:text-surface-300">
                  <thead className="bg-surface-50 dark:bg-surface-900/60 uppercase text-[10px] text-surface-500 border-b border-surface-200 dark:border-surface-700 font-semibold sticky top-0">
                    <tr>
                      <th className="px-3 py-2">Date / Time</th>
                      <th className="px-3 py-2">Movement Type</th>
                      <th className="px-2 py-2 text-right">Qty</th>
                      <th className="px-2 py-2 text-center">Net Total Effect</th>
                      <th className="px-2 py-2 text-right font-semibold text-surface-600 dark:text-surface-300">Warehouse Bal</th>
                      <th className="px-2 py-2 text-right font-semibold text-blue-600 dark:text-blue-400">Vehicle Bal</th>
                      <th className="px-3 py-2 text-right font-bold text-emerald-700 dark:text-emerald-400">Total Stock</th>
                      <th className="px-3 py-2">Locations</th>
                      <th className="px-3 py-2">Reference / Document</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100 dark:divide-surface-700/60">
                    {movementHistory.map((m) => (
                      <tr key={m.id} className="hover:bg-surface-50/50 dark:hover:bg-surface-700/20">
                        <td className="px-3 py-2 whitespace-nowrap text-surface-500 font-mono">
                          {m.occurredAt ? m.occurredAt.split('T')[0] : '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded font-medium ${
                              m.movementType === 'purchase_inward'
                                ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                                : m.movementType === 'delivery_fulfilled'
                                ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300'
                                : m.movementType === 'route_load'
                                ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                                : m.movementType === 'route_return'
                                ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300'
                                : m.movementType === 'opening_balance'
                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                                : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300'
                            }`}
                          >
                            {m.movementTypeLabel}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono font-bold whitespace-nowrap">
                          {m.movementType === 'route_load' || m.movementType === 'route_return' ? (
                            <span className="text-amber-600 dark:text-amber-400">{m.quantity}</span>
                          ) : m.direction === 'in' ? (
                            <span className="text-emerald-600 dark:text-emerald-400">+{m.quantity}</span>
                          ) : (
                            <span className="text-rose-600 dark:text-rose-400">-{m.quantity}</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center whitespace-nowrap">
                          {m.netTotalImpact === 0 ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                              0 (Transfer)
                            </span>
                          ) : m.netTotalImpact > 0 ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              +{m.netTotalImpact} Inward
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                              {m.netTotalImpact} Outbound
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right font-mono font-medium text-surface-800 dark:text-surface-200 whitespace-nowrap">
                          {m.warehouseBalance}
                        </td>
                        <td className="px-2 py-2 text-right font-mono font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">
                          {m.vehicleBalance}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold whitespace-nowrap">
                          <span
                            className={
                              m.runningBalance < 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-emerald-700 dark:text-emerald-400 font-extrabold'
                            }
                          >
                            {m.runningBalance} {selectedInventoryProduct.uom}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-surface-500 font-mono text-[11px]">
                          {m.fromLocation} → {m.toLocation}
                        </td>
                        <td className="px-3 py-2 text-surface-600 dark:text-surface-400 max-w-xs truncate" title={m.notes || ''}>
                          {m.referenceNumber && (
                            <span className="font-mono font-medium text-surface-800 dark:text-surface-200 mr-1.5">
                              Doc: {m.referenceNumber}
                            </span>
                          )}
                          {m.notes}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-between items-center pt-2">
              <Link to="/admin/inventory/import-stock">
                <Button size="sm" variant="outline" icon={<PackagePlus className="h-4 w-4" />}>
                  Inward Stock Import
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={closeHistoryModal}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ADD / EDIT PRODUCT MODAL (Product Master) */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit Product Master SKU' : 'Add New Product Master SKU'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="SKU / Material Code"
            required
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
            placeholder="e.g. 61061321"
            disabled={!!editing}
          />
          <Input
            label="Product Name / Material Description"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Colgate Sensitive 80g"
          />
          <Input
            label="Category"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="e.g. Toothpaste, Toothbrush"
          />

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="MRP (₹)"
              type="number"
              step="0.01"
              value={form.mrp}
              onChange={(e) => setForm({ ...form, mrp: parseFloat(e.target.value) || 0 })}
            />
            <Input
              label="Rate (₹)"
              type="number"
              step="0.01"
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: parseFloat(e.target.value) || 0 })}
            />
            <Input
              label="Unit / UOM"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              placeholder="pcs, doz, cs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" loading={createMut.isPending || updateMut.isPending}>
              {editing ? 'Update' : 'Add to Master'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Historical Sales Product Discovery Modal */}
      <HistoricalSalesImportModal
        open={historicalModalOpen}
        onClose={() => setHistoricalModalOpen(false)}
        parsed={historicalParsed}
        onSuccess={handleHistoricalSuccess}
      />

      {/* Admin Clear Inventory Modal */}
      <AdminClearInventoryModal
        open={clearInventoryModalOpen}
        onClose={() => setClearInventoryModalOpen(false)}
        onSuccess={() => {
          refetchProducts();
          refetchInventory();
        }}
      />
    </div>
  );
}
