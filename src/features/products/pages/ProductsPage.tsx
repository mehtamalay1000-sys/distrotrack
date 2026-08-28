import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Search, Edit2, Trash2, Package, Trophy, Calendar, MapPin,
  TrendingUp, BarChart3, Tag, Layers, RefreshCw
} from 'lucide-react';
import { PageHeader, Button, Input, Modal, EmptyState, LoadingState, ErrorState, StatusBadge } from '@/shared/ui';
import {
  getProducts, createProduct, updateProduct, deleteProduct,
  getProductMonthlyAnalytics, getRouteSalesHistory, seedProductMaster,
  clearAllSalesAnalyticsData,
} from '../services/productService';
import { formatCurrency, getLocalDateString } from '@/shared/utils/format';
import type { Product } from '@/lib/database.types';

export function ProductsPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'catalog' | 'monthly' | 'route_history'>('catalog');

  // Catalog filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({
    sku: '', name: '', category: '', mrp: 0, rate: 0, unit: 'pcs'
  });

  // Monthly analytics filters
  const [selectedMonth, setSelectedMonth] = useState('2026-08');

  // Route & Date history filters
  const [selectedDate, setSelectedDate] = useState(getLocalDateString());
  const [selectedRoute, setSelectedRoute] = useState('SANGAMNER_6');

  // React Query hooks
  const { data: products = [], isLoading: loadingProducts, error: errorProducts } = useQuery({
    queryKey: ['products'],
    queryFn: getProducts,
  });

  const { data: monthlyAnalytics, isLoading: loadingMonthly } = useQuery({
    queryKey: ['product_monthly_analytics', selectedMonth],
    queryFn: () => getProductMonthlyAnalytics(selectedMonth),
    enabled: activeTab === 'monthly' || activeTab === 'catalog',
  });

  const { data: routeHistory, isLoading: loadingRouteHistory } = useQuery({
    queryKey: ['route_sales_history', selectedRoute, selectedDate],
    queryFn: () => getRouteSalesHistory(selectedRoute, selectedDate),
    enabled: activeTab === 'route_history',
  });

  // Mutations
  const createMut = useMutation({
    mutationFn: createProduct,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); toast.success('Product added'); closeModal(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Product> }) => updateProduct(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); toast.success('Product updated'); closeModal(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); toast.success('Product deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const seedMut = useMutation({
    mutationFn: seedProductMaster,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success(`Seeded ${res.created} products (${res.skipped} existing)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Unique categories for filter pills
  const categories = ['All', ...Array.from(new Set(products.map(p => p.category || 'General')))];

  // Filtered products for Catalog View
  const filteredCatalog = products.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      (p.category ?? '').toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === 'All' || (p.category || 'General') === categoryFilter;
    return matchSearch && matchCat;
  });

  function openCreate() {
    setEditing(null);
    setForm({ sku: '', name: '', category: '', mrp: 0, rate: 0, unit: 'pcs' });
    setModalOpen(true);
  }
  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      sku: p.sku, name: p.name, category: p.category ?? '',
      mrp: p.mrp, rate: p.rate, unit: p.unit ?? 'pcs'
    });
    setModalOpen(true);
  }
  function closeModal() { setModalOpen(false); setEditing(null); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      updateMut.mutate({ id: editing.id, data: form });
    } else {
      createMut.mutate(form);
    }
  }

  const clearSalesMut = useMutation({
    mutationFn: clearAllSalesAnalyticsData,
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success('Sales analytics data cleared');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loadingProducts) return <LoadingState />;
  if (errorProducts) return <ErrorState message={(errorProducts as Error).message} />;

  const highestSeller = monthlyAnalytics?.highestSellingProduct;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products & Sales Analytics"
        description="FMCG Product Master, Monthly Top Sellers, and Route/Date Sales History"
        actions={
          <div className="flex items-center gap-2">
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
            <Button variant="outline" icon={<RefreshCw className="h-4 w-4" />} onClick={() => seedMut.mutate()} loading={seedMut.isPending}>
              Reset SAP Seed
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              Add Product
            </Button>
          </div>
        }
      />

      {/* Main Feature Tabs */}
      <div className="flex items-center gap-2 border-b border-surface-200 dark:border-surface-700 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('catalog')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'catalog'
              ? 'bg-primary-600 text-white shadow-sm'
              : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800'
          }`}
        >
          <Package className="h-4 w-4" />
          Product Catalog ({products.length})
        </button>

        <button
          onClick={() => setActiveTab('monthly')}
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
          onClick={() => setActiveTab('route_history')}
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

      {/* TAB 1: PRODUCT CATALOG MASTER */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          {/* Controls: Search & Category Filter */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="relative w-full sm:w-72">
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
              {categories.map((cat) => (
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
              title="No products found"
              description={search ? 'Try adjusting your search query or category filter' : 'Add your first FMCG product SKU'}
              action={!search ? <Button size="sm" onClick={openCreate}>Add Product</Button> : undefined}
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
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-primary-700 dark:text-primary-400">{p.sku}</td>
                      <td className="px-4 py-3 font-medium text-surface-900 dark:text-surface-100">{p.name}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300 px-2 py-0.5 rounded font-medium">
                          {p.category || 'General'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-surface-900 dark:text-surface-100">{formatCurrency(p.mrp)}</td>
                      <td className="px-4 py-3 text-right text-surface-700 dark:text-surface-300">{formatCurrency(p.rate)}</td>
                      <td className="px-4 py-3 text-center text-xs text-surface-500 uppercase">{p.unit || 'pcs'}</td>
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

      {/* TAB 2: MONTHLY SALES ANALYTICS & HIGHEST SELLING PRODUCT */}
      {activeTab === 'monthly' && (
        <div className="space-y-6">
          {/* Controls: Month Selector */}
          <div className="flex items-center justify-between gap-4 bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-primary-600 dark:text-primary-400" />
              <div>
                <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Select Analytics Month</h3>
                <p className="text-xs text-surface-500">View total products sold and highest selling SKU of the month</p>
              </div>
            </div>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-9 px-3 text-sm font-semibold border border-surface-300 dark:border-surface-600 rounded-lg bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            >
              <option value="2026-08">August 2026</option>
              <option value="2026-07">July 2026</option>
              <option value="2026-06">June 2026</option>
            </select>
          </div>

          {/* KPI Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Card 1: Total Units Sold */}
            <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Monthly Paid Units</span>
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-surface-900 dark:text-surface-100">
                {monthlyAnalytics?.totalUnitsSold.toLocaleString() || 0} <span className="text-xs font-normal text-surface-500">pcs</span>
              </div>
              <p className="text-xs text-surface-500 mt-1">Paid product units delivered</p>
            </div>

            {/* Card 2: Free Scheme Units */}
            <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Free Scheme Units</span>
                <Tag className="h-4 w-4 text-amber-600" />
              </div>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                +{monthlyAnalytics?.totalFreeUnits.toLocaleString() || 0} <span className="text-xs font-normal text-surface-500">pcs free</span>
              </div>
              <p className="text-xs text-surface-500 mt-1">Scheme free products given</p>
            </div>

            {/* Card 3: Total Sales Revenue */}
            <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Total Product Sales</span>
                <Layers className="h-4 w-4 text-primary-600" />
              </div>
              <div className="text-2xl font-bold text-primary-700 dark:text-primary-400">
                {formatCurrency(monthlyAnalytics?.totalRevenue || 0)}
              </div>
              <p className="text-xs text-surface-500 mt-1">Gross month sales revenue</p>
            </div>

            {/* Card 4: 🏆 HIGHEST SELLING PRODUCT OF MONTH */}
            <div className="bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border-2 border-amber-400/40 dark:border-amber-500/30 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1">
                  <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Top Product Of Month
                </span>
              </div>
              {highestSeller ? (
                <div>
                  <div className="font-bold text-surface-900 dark:text-surface-100 text-sm truncate" title={highestSeller.name}>
                    {highestSeller.name}
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-amber-300/40 dark:border-amber-700/40 text-xs">
                    <span className="font-mono text-surface-600 dark:text-surface-400">{highestSeller.sku}</span>
                    <span className="font-bold text-amber-700 dark:text-amber-300">{highestSeller.totalUnitsSold} pcs sold</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-surface-500 italic mt-2">No sales recorded for this month</div>
              )}
            </div>
          </div>

          {/* Monthly Product Breakdown Table */}
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
              <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-sm">Monthly Product Sales Breakdown</h3>
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
                    <th className="px-4 py-3 text-right">Units Sold</th>
                    <th className="px-4 py-3 text-right">Free Qty</th>
                    <th className="px-4 py-3 text-right">Unit Rate</th>
                    <th className="px-4 py-3 text-right">Total Revenue</th>
                    <th className="px-4 py-3 text-right">% Revenue Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100 dark:divide-surface-700/60">
                  {monthlyAnalytics?.productStats.map((st, idx) => (
                    <tr key={st.sku} className={`hover:bg-surface-50/50 dark:hover:bg-surface-700/30 transition-colors ${idx === 0 && st.totalUnitsSold > 0 ? 'bg-amber-500/5 dark:bg-amber-500/10' : ''}`}>
                      <td className="px-4 py-3 font-semibold text-xs text-surface-400">
                        {idx === 0 && st.totalUnitsSold > 0 ? '🥇 #1' : `#${idx + 1}`}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-primary-700 dark:text-primary-400">{st.sku}</td>
                      <td className="px-4 py-3 font-medium text-surface-900 dark:text-surface-100">{st.name}</td>
                      <td className="px-4 py-3 text-right font-bold text-surface-900 dark:text-surface-100">{st.totalUnitsSold}</td>
                      <td className="px-4 py-3 text-right">
                        {st.totalFreeUnits > 0 ? (
                          <span className="text-xs bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded font-semibold border border-emerald-200 dark:border-emerald-800">
                            +{st.totalFreeUnits} free
                          </span>
                        ) : (
                          <span className="text-surface-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-surface-700 dark:text-surface-300">{formatCurrency(st.rate)}</td>
                      <td className="px-4 py-3 text-right font-bold text-primary-700 dark:text-primary-400">{formatCurrency(st.totalRevenue)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs font-semibold">{st.percentageShare}%</span>
                          <div className="w-16 h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                            <div className="h-full bg-primary-600 rounded-full" style={{ width: `${Math.min(100, st.percentageShare * 2)}%` }} />
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

      {/* TAB 3: ROUTE & DATE SALES HISTORY */}
      {activeTab === 'route_history' && (
        <div className="space-y-6">
          {/* Controls: Route Dropdown & Date Picker */}
          <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-primary-600 dark:text-primary-400" />
              <div>
                <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Route & Date Sales History Filter</h3>
                <p className="text-xs text-surface-500">Filter sold products history by specific distribution route and date</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              {/* Date Input */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-surface-600 dark:text-surface-400">Date:</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="h-9 px-3 text-sm font-semibold border border-surface-300 dark:border-surface-600 rounded-lg bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                />
              </div>

              {/* Route Input / Selector */}
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

          {/* Route History Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Delivered Units</span>
              <div className="text-2xl font-bold text-surface-900 dark:text-surface-100 mt-1">
                {routeHistory?.totalDeliveredUnits.toLocaleString() || 0} <span className="text-xs font-normal text-surface-500">pcs</span>
              </div>
            </div>

            <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Scheme Free Units</span>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                +{routeHistory?.totalFreeUnits.toLocaleString() || 0} <span className="text-xs font-normal text-surface-500">pcs free</span>
              </div>
            </div>

            <div className="bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl shadow-sm">
              <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Route Sales Value</span>
              <div className="text-2xl font-bold text-primary-700 dark:text-primary-400 mt-1">
                {formatCurrency(routeHistory?.totalSalesValue || 0)}
              </div>
            </div>
          </div>

          {/* Route History Table */}
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
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-primary-700 dark:text-primary-400">{it.sku}</td>
                      <td className="px-4 py-3 font-medium text-surface-900 dark:text-surface-100">{it.productName}</td>
                      <td className="px-4 py-3 text-right font-bold text-surface-900 dark:text-surface-100">{it.deliveredQty}</td>
                      <td className="px-4 py-3 text-right">
                        {it.freeQuantity > 0 ? (
                          <span className="text-xs bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded font-semibold border border-emerald-200 dark:border-emerald-800">
                            +{it.freeQuantity} free
                          </span>
                        ) : (
                          <span className="text-surface-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-surface-700 dark:text-surface-300">{formatCurrency(it.rate)}</td>
                      <td className="px-4 py-3 text-right font-bold text-surface-900 dark:text-surface-100">{formatCurrency(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit Product SKU' : 'Add New Product SKU'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="SKU Code" required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. 61061321" disabled={!!editing} />
          <Input label="Product Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Colgate Sensitive 80g" />
          <Input label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Toothpaste, Toothbrush" />

          <div className="grid grid-cols-3 gap-3">
            <Input label="MRP (₹)" type="number" step="0.01" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: parseFloat(e.target.value) || 0 })} />
            <Input label="Rate (₹)" type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: parseFloat(e.target.value) || 0 })} />
            <Input label="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="pcs, doz" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={closeModal}>Cancel</Button>
            <Button type="submit" loading={createMut.isPending || updateMut.isPending}>{editing ? 'Update' : 'Add'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
