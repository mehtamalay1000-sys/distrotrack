import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Package, AlertTriangle, TrendingDown, Activity } from 'lucide-react';
import {
  getMasterInventoryHealth, getMasterInventoryExceptions, getMasterVehicleInventory,
} from '../services/masterService';
import { QK } from '@/lib/queryKeys';

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    high: 'bg-rose-100 text-rose-700 border-rose-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low: 'bg-slate-100 text-slate-500 border-slate-200',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border tracking-wide ${map[severity] ?? map.low}`}>
      {severity}
    </span>
  );
}

export function MasterInventoryPage() {
  const { data: health, isLoading: healthLoading, refetch, isFetching } = useQuery({
    queryKey: QK.masterInventory,
    queryFn: getMasterInventoryHealth,
    refetchInterval: 30000,
  });

  const { data: exceptions = [] } = useQuery({
    queryKey: ['master-inventory-exceptions'],
    queryFn: getMasterInventoryExceptions,
    refetchInterval: 60000,
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ['master-vehicle-inventory'],
    queryFn: getMasterVehicleInventory,
    refetchInterval: 30000,
  });

  const healthCards = [
    { label: 'SAP Products', value: health?.totalSapProducts ?? 0, icon: Package, color: 'bg-indigo-50 text-indigo-600' },
    { label: 'Products Tracked', value: health?.productsTracked ?? 0, icon: Package, color: 'bg-blue-50 text-blue-600' },
    { label: 'Active Products', value: health?.activeProducts ?? 0, icon: Package, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Unmapped SKUs', value: health?.unmappedSkus ?? 0, icon: AlertTriangle, color: 'bg-amber-50 text-amber-600' },
    { label: 'Stock Variances', value: health?.stockVarianceCases ?? 0, icon: TrendingDown, color: 'bg-rose-50 text-rose-600' },
    { label: 'Net Sold Qty (MTD)', value: health?.totalNetSoldQty ?? 0, icon: Activity, color: 'bg-violet-50 text-violet-600' },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Inventory Deep-Dive</h1>
          <p className="text-sm text-slate-500 mt-0.5">Authoritative stock & exception view from Supabase</p>
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

      {/* Health Cards */}
      {healthLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {healthCards.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className={`h-7 w-7 rounded-lg ${color} flex items-center justify-center mb-2`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="text-xl font-bold text-slate-900 tabular-nums">{value.toLocaleString('en-IN')}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Vehicle Balances */}
      {vehicles.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">Active Vehicle Balances</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {vehicles.map((v: any) => (
              <div key={v.picklist_id || v.worker_name} className="px-4 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-sm">{v.worker_name || '—'}</div>
                  <div className="text-xs text-slate-500">{v.route_name}</div>
                </div>
                <div className="text-right text-xs">
                  <div className="font-semibold text-slate-700">{v.total_items} SKUs</div>
                  <div className="text-slate-400">{v.total_units} units</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Exceptions */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <h2 className="font-semibold text-slate-800 text-sm">
            Inventory Exceptions
          </h2>
          {exceptions.length > 0 && (
            <span className="ml-auto bg-rose-100 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
              {exceptions.length}
            </span>
          )}
        </div>
        {exceptions.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Package className="h-8 w-8 text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No inventory exceptions found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {exceptions.map((ex) => (
              <div key={ex.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <SeverityBadge severity={ex.severity} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800 text-sm">{ex.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{ex.detail}</div>
                  </div>
                  {ex.timestamp && (
                    <div className="text-[11px] text-slate-400 flex-shrink-0">
                      {new Date(ex.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
