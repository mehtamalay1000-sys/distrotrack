import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Layers, Download, FileSpreadsheet, Search,
  TrendingUp, Truck, RotateCcw, DollarSign, RefreshCw, CheckCircle2,
  UploadCloud
} from 'lucide-react';
import { PageHeader, Card, Button, LoadingState, EmptyState } from '@/shared/ui';
import {
  getProductQuantityRegister,
  aggregateQuantityRegister,
  exportQuantityRegisterToCSV,
  exportQuantityRegisterToXLSX,
  type AggregationMode,
} from '../services/quantityRegisterService';
import { formatCurrency, getLocalDateString } from '@/shared/utils/format';

export function ProductQuantityRegisterPage() {
  const navigate = useNavigate();
  const [datePreset, setDatePreset] = useState<'today' | 'week' | 'month' | 'custom'>('month');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [endDate, setEndDate] = useState(getLocalDateString());
  const [routeFilter, setRouteFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'sap' | 'distrotrack'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [aggregation, setAggregation] = useState<AggregationMode>('detailed');

  const handlePresetChange = (preset: 'today' | 'week' | 'month' | 'custom') => {
    setDatePreset(preset);
    const today = getLocalDateString();
    if (preset === 'today') {
      setStartDate(today);
      setEndDate(today);
    } else if (preset === 'week') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(today);
    } else if (preset === 'month') {
      const d = new Date();
      setStartDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
      setEndDate(today);
    }
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product_quantity_register', startDate, endDate, routeFilter, searchQuery, sourceFilter],
    queryFn: () => getProductQuantityRegister({
      startDate,
      endDate,
      routeCode: routeFilter,
      searchQuery,
      source: sourceFilter,
    }),
  });

  const rows = data?.rows || [];
  const summary = data?.summary || {
    totalPicklistQty: 0,
    totalDeliveredQty: 0,
    totalReturnedQty: 0,
    totalNetSoldQty: 0,
    totalSalesAmount: 0,
    rowCount: 0,
  };

  const aggregatedRows = aggregation !== 'detailed' ? aggregateQuantityRegister(rows, aggregation) : [];

  const handleExportCSV = () => {
    exportQuantityRegisterToCSV(rows, `Product_Quantity_Register_${startDate}_to_${endDate}.csv`);
  };

  const handleExportXLSX = () => {
    exportQuantityRegisterToXLSX(rows, `Product_Quantity_Register_${startDate}_to_${endDate}.xlsx`);
  };

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <PageHeader
        title="Product Quantity / Sales Register"
        description="Authoritative operational product movement and net sales derived from verified deliveries and returns."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<UploadCloud className="h-4 w-4" />}
              onClick={() => navigate('/admin/inventory/import-sales')}
            >
              Import SAP Sales
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<Download className="h-4 w-4" />}
              onClick={handleExportCSV}
              disabled={rows.length === 0}
            >
              Export CSV
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<FileSpreadsheet className="h-4 w-4" />}
              onClick={handleExportXLSX}
              disabled={rows.length === 0}
            >
              Export Excel (XLSX)
            </Button>
          </div>
        }
      />

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Picklist Qty</span>
            <div className="h-8 w-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-600">
              <Truck className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-surface-900 dark:text-surface-100 mt-2 tabular-nums">
            {summary.totalPicklistQty.toLocaleString()} <span className="text-xs font-normal text-surface-500">pcs</span>
          </div>
          <div className="text-xs text-surface-500 mt-0.5">Total dispatched</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Delivered Qty</span>
            <div className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-2 tabular-nums">
            {summary.totalDeliveredQty.toLocaleString()} <span className="text-xs font-normal text-emerald-600/70">pcs</span>
          </div>
          <div className="text-xs text-surface-500 mt-0.5">Accepted by parties</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Returned Qty</span>
            <div className="h-8 w-8 rounded-lg bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center text-rose-600">
              <RotateCcw className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-rose-700 dark:text-rose-400 mt-2 tabular-nums">
            {summary.totalReturnedQty.toLocaleString()} <span className="text-xs font-normal text-rose-600/70">pcs</span>
          </div>
          <div className="text-xs text-surface-500 mt-0.5">Returned to warehouse</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Net Sold Qty</span>
            <div className="h-8 w-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-indigo-700 dark:text-indigo-400 mt-2 tabular-nums">
            {summary.totalNetSoldQty.toLocaleString()} <span className="text-xs font-normal text-indigo-600/70">pcs</span>
          </div>
          <div className="text-xs text-surface-500 mt-0.5">Delivered − Returns</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Sales Amount</span>
            <div className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-surface-900 dark:text-surface-100 mt-2 tabular-nums">
            {formatCurrency(summary.totalSalesAmount)}
          </div>
          <div className="text-xs text-surface-500 mt-0.5">{summary.rowCount} registered line items</div>
        </Card>
      </div>

      {/* Filter & Aggregation Controls */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Period Presets */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-surface-500 mr-1">Period:</span>
            {(['today', 'week', 'month', 'custom'] as const).map((p) => (
              <button
                key={p}
                onClick={() => handlePresetChange(p)}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  datePreset === p
                    ? 'bg-primary-600 text-white shadow-xs'
                    : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200'
                }`}
              >
                {p === 'today' ? 'Daily (Today)' : p === 'week' ? 'Weekly (Last 7d)' : p === 'month' ? 'Monthly (MTD)' : 'Custom'}
              </button>
            ))}

            <div className="h-4 w-px bg-surface-300 dark:bg-surface-700 mx-1.5" />

            <span className="text-xs font-semibold text-surface-500 mr-1">Source:</span>
            {([
              { id: 'all', label: 'All Sources' },
              { id: 'sap', label: 'SAP Baseline' },
              { id: 'distrotrack', label: 'DistroTrack Delivery' },
            ] as const).map((s) => (
              <button
                key={s.id}
                onClick={() => setSourceFilter(s.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  sourceFilter === s.id
                    ? s.id === 'sap'
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'bg-primary-600 text-white shadow-xs'
                    : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Date range pickers (for custom) */}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="text-xs border border-surface-300 dark:border-surface-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 font-medium"
              />
              <span className="text-xs text-surface-400">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="text-xs border border-surface-300 dark:border-surface-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 font-medium"
              />
            </div>
          )}

          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-500 hover:text-primary-600 transition-colors ml-auto cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Search & Aggregation Selectors */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-2 flex-1 max-w-lg">
            <div className="relative flex-1">
              <Search className="h-4 w-4 text-surface-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by SKU, Product Name, Brand, Picklist, Invoice…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
              />
            </div>
            <select
              value={routeFilter}
              onChange={(e) => setRouteFilter(e.target.value)}
              className="text-xs border border-surface-300 dark:border-surface-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 font-medium"
            >
              <option value="all">All Routes</option>
              <option value="SANGAMNER_6">SANGAMNER 6</option>
              <option value="SANGAMNER_3">SANGAMNER 3</option>
              <option value="R-CENTRAL">Central Route</option>
            </select>
          </div>

          {/* Aggregation Mode Buttons */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            <span className="text-xs font-semibold text-surface-500 mr-1 flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" /> View:
            </span>
            {[
              { id: 'detailed', label: 'Detailed Rows' },
              { id: 'product', label: 'By Product' },
              { id: 'sku', label: 'By SKU' },
              { id: 'date', label: 'By Date' },
              { id: 'route', label: 'By Route' },
              { id: 'picklist', label: 'By Picklist' },
              { id: 'brand', label: 'By Brand' },
              { id: 'category', label: 'By Category' },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setAggregation(m.id as AggregationMode)}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
                  aggregation === m.id
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Data Table */}
      {isLoading ? (
        <LoadingState message="Deriving authoritative product quantities from delivery records and SAP sales…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-10 w-10 text-surface-400" />}
          title="No Product Quantity Records Found"
          description="No delivery, picklist, or SAP sales baseline movements match the selected period or filters."
        />
      ) : aggregation === 'detailed' ? (
        /* Detailed Line Items View */
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto max-h-[650px] overflow-y-auto">
            <table className="dt-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Date</th>
                  <th>Doc / Invoice</th>
                  <th>Route / Customer</th>
                  <th>SKU</th>
                  <th>Official Product Name</th>
                  <th>Brand</th>
                  <th>UOM</th>
                  <th className="text-right">Ordered / Qty</th>
                  <th className="text-right">Delivered</th>
                  <th className="text-right">Returned</th>
                  <th className="text-right">Net Sold Qty</th>
                  <th className="text-right">Rate</th>
                  <th className="text-right">Sales Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${r.source}_${r.picklistId}_${r.sku}_${idx}`} className="hover:bg-surface-50 dark:hover:bg-surface-700/50">
                    <td className="text-xs whitespace-nowrap">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                        r.source === 'SAP'
                          ? 'bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                          : 'bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                      }`}>
                        {r.source === 'SAP' ? 'SAP Baseline' : 'DistroTrack'}
                      </span>
                    </td>
                    <td className="text-xs whitespace-nowrap">{r.date}</td>
                    <td className="text-xs font-mono font-medium text-primary-700 dark:text-primary-400">{r.picklistNumber}</td>
                    <td className="text-xs whitespace-nowrap">{r.routeName}</td>
                    <td className="text-xs font-mono font-bold text-surface-900 dark:text-surface-100">{r.sku}</td>
                    <td className="text-xs font-medium text-surface-900 dark:text-white max-w-xs truncate" title={r.productName}>
                      {r.productName}
                    </td>
                    <td className="text-xs text-surface-500">{r.brand}</td>
                    <td className="text-xs font-mono text-surface-400">{r.uom}</td>
                    <td className="text-xs text-right font-medium">{r.picklistQty}</td>
                    <td className="text-xs text-right font-bold text-emerald-600 dark:text-emerald-400">{r.deliveredQty}</td>
                    <td className="text-xs text-right text-rose-600 dark:text-rose-400">{r.returnedQty > 0 ? r.returnedQty : '—'}</td>
                    <td className="text-xs text-right font-bold text-indigo-600 dark:text-indigo-400">{r.netSoldQty}</td>
                    <td className="text-xs text-right tabular-nums">₹{r.rate.toFixed(2)}</td>
                    <td className="text-xs text-right font-bold tabular-nums text-surface-900 dark:text-surface-100">
                      {formatCurrency(r.salesAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-100 dark:bg-surface-750 font-bold">
                  <td colSpan={8} className="text-right text-xs">Total:</td>
                  <td className="text-right text-xs font-bold">{summary.totalPicklistQty.toLocaleString()}</td>
                  <td className="text-right text-xs font-bold text-emerald-600">{summary.totalDeliveredQty.toLocaleString()}</td>
                  <td className="text-right text-xs font-bold text-rose-600">{summary.totalReturnedQty.toLocaleString()}</td>
                  <td className="text-right text-xs font-bold text-indigo-600">{summary.totalNetSoldQty.toLocaleString()}</td>
                  <td></td>
                  <td className="text-right text-xs font-bold">{formatCurrency(summary.totalSalesAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        /* Aggregated Summary View */
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto max-h-[650px] overflow-y-auto">
            <table className="dt-table">
              <thead>
                <tr>
                  <th>{aggregation.toUpperCase()} Dimension</th>
                  <th>Records Count</th>
                  <th>UOM</th>
                  <th className="text-right">Total Picklist Qty</th>
                  <th className="text-right">Total Delivered Qty</th>
                  <th className="text-right">Total Returned Qty</th>
                  <th className="text-right">Total Net Sold Qty</th>
                  <th className="text-right">Total Sales Amount</th>
                </tr>
              </thead>
              <tbody>
                {aggregatedRows.map((agg) => (
                  <tr key={agg.key} className="hover:bg-surface-50 dark:hover:bg-surface-700/50">
                    <td className="text-xs font-medium text-surface-900 dark:text-white">
                      <div>{agg.label}</div>
                      {agg.subLabel && <div className="text-[11px] text-surface-500 font-normal">{agg.subLabel}</div>}
                    </td>
                    <td className="text-xs text-surface-500 font-mono">{agg.recordsCount} items</td>
                    <td className="text-xs font-mono text-surface-400">{agg.uom}</td>
                    <td className="text-xs text-right font-medium">{agg.picklistQty.toLocaleString()}</td>
                    <td className="text-xs text-right font-bold text-emerald-600 dark:text-emerald-400">{agg.deliveredQty.toLocaleString()}</td>
                    <td className="text-xs text-right text-rose-600 dark:text-rose-400">{agg.returnedQty > 0 ? agg.returnedQty.toLocaleString() : '—'}</td>
                    <td className="text-xs text-right font-bold text-indigo-600 dark:text-indigo-400">{agg.netSoldQty.toLocaleString()}</td>
                    <td className="text-xs text-right font-bold tabular-nums text-surface-900 dark:text-surface-100">
                      {formatCurrency(agg.totalSalesAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-100 dark:bg-surface-750 font-bold">
                  <td colSpan={3} className="text-right text-xs">Total:</td>
                  <td className="text-right text-xs font-bold">{summary.totalPicklistQty.toLocaleString()}</td>
                  <td className="text-right text-xs font-bold text-emerald-600">{summary.totalDeliveredQty.toLocaleString()}</td>
                  <td className="text-right text-xs font-bold text-rose-600">{summary.totalReturnedQty.toLocaleString()}</td>
                  <td className="text-right text-xs font-bold text-indigo-600">{summary.totalNetSoldQty.toLocaleString()}</td>
                  <td className="text-right text-xs font-bold">{formatCurrency(summary.totalSalesAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
