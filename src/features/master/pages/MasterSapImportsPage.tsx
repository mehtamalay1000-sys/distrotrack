import { useQuery } from '@tanstack/react-query';
import { RefreshCw, FileSpreadsheet, Package, AlertTriangle, Calendar, CheckCircle2 } from 'lucide-react';
import { getMasterSapImportsOverview } from '../services/masterService';
import { QK } from '@/lib/queryKeys';

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return s; }
}

export function MasterSapImportsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: QK.masterSapImports,
    queryFn: getMasterSapImportsOverview,
    refetchInterval: 60000,
  });

  const purchaseImports = data?.purchaseImports ?? [];
  const salesImports = data?.salesImports ?? [];
  const unmappedSkuCount = data?.unmappedSkuCount ?? 0;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">SAP / Import Oversight</h1>
          <p className="text-sm text-slate-500 mt-0.5">All SAP purchases, sales imports, and unmapped SKUs</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2">
            <Package className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">{purchaseImports.length}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Purchase Imports</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-2">
            <FileSpreadsheet className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">{salesImports.length}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Sales Imports</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="h-8 w-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center mb-2">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">{unmappedSkuCount}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Unmapped SKUs</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2">
            <Calendar className="h-4 w-4" />
          </div>
          <div className="text-xs font-semibold text-slate-700 tabular-nums truncate">
            {data?.lastSalesImportDate ? fmtDate(data.lastSalesImportDate).split(',')[0] : '—'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Last Sales Import</div>
        </div>
      </div>

      {/* SAP Sales Imports */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-blue-500" />
          <h2 className="font-semibold text-slate-800 text-sm">SAP Sales Imports</h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Loading...</div>
        ) : salesImports.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No SAP sales imports found</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {salesImports.map((imp) => (
              <div key={imp.id} className="px-4 py-3 flex items-start gap-3">
                <div className="mt-0.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-sm truncate">{imp.fileName}</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    <span className="text-xs text-slate-500">{imp.totalRows.toLocaleString()} rows</span>
                    {imp.cutoffDate && (
                      <span className="text-xs text-slate-500">Cutoff: {imp.cutoffDate}</span>
                    )}
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 font-medium">{imp.status}</span>
                  </div>
                </div>
                <div className="text-xs text-slate-400 flex-shrink-0">
                  {fmtDate(imp.importedAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SAP Purchase Imports */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <Package className="h-4 w-4 text-indigo-500" />
          <h2 className="font-semibold text-slate-800 text-sm">SAP Purchase Imports (Inward Stock)</h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Loading...</div>
        ) : purchaseImports.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No SAP purchase imports found</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {purchaseImports.map((imp) => (
              <div key={imp.id} className="px-4 py-3 flex items-start gap-3">
                <div className="mt-0.5">
                  <CheckCircle2 className="h-4 w-4 text-indigo-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-sm truncate">{imp.fileName}</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    <span className="text-xs text-slate-500">{imp.totalRows.toLocaleString()} rows</span>
                    <span className="text-xs text-slate-500">{imp.uniqueSkus} SKUs</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-medium">{imp.status}</span>
                  </div>
                </div>
                <div className="text-xs text-slate-400 flex-shrink-0">
                  {fmtDate(imp.importedAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
