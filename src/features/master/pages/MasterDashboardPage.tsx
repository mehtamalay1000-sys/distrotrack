import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  TrendingUp, Package, Truck, CreditCard, Users,
  CheckCircle2, Clock, ArrowUp, ArrowDown,
  RefreshCw, CalendarDays, Building2, ClipboardList,
  AlertTriangle, ShieldAlert, XCircle, Activity,
  Scale, FileSpreadsheet, ExternalLink, ChevronRight,
} from 'lucide-react';
import {
  getMasterKPIs, getMasterExceptions, getMasterAuditLog,
  getMasterInventoryHealth, getMasterInventoryExceptions,
  todayRange, monthRange,
  type DateRange, type MasterExceptions,
  type MasterInventoryHealth, type MasterInventoryExceptionItem,
} from '@/features/master/services/masterService';
import type { MasterAuditLog } from '@/lib/database.types';
import { useAuth } from '@/app/AuthProvider';
import { QK } from '@/lib/queryKeys';
import { PendingCollectionsPanel } from '@/features/dashboard/components/PendingCollectionsPanel';

// ── Helpers ──────────────────────────────────────────────────────

const fmt = (n: number) =>
  n >= 1_00_000
    ? `₹${(n / 1_00_000).toFixed(2)}L`
    : n >= 1_000
    ? `₹${(n / 1_00_000).toFixed(2)}L`
    : `₹${n.toLocaleString('en-IN')}`;

const fmtK = (n: number) =>
  n >= 1_00_000
    ? `₹${(n / 1_00_000).toFixed(2)}L`
    : n >= 1_000
    ? `₹${(n / 1_000).toFixed(1)}K`
    : `₹${n.toLocaleString('en-IN')}`;

const fmtFull = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Period Presets ────────────────────────────────────────────────

type Preset = 'today' | 'this_month' | 'custom';

function getPresetRange(preset: Preset, custom: { year: number; month: number }): DateRange {
  if (preset === 'today') return todayRange();
  if (preset === 'this_month') {
    const now = new Date();
    return monthRange(now.getFullYear(), now.getMonth() + 1);
  }
  return monthRange(custom.year, custom.month);
}

// ── KPI Card ──────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
  trend?: 'up' | 'down' | 'neutral';
}

function KpiCard({ label, value, sub, icon: Icon, color, trend }: KpiCardProps) {
  const colorMap: Record<string, { bg: string; icon: string; badge: string }> = {
    indigo: { bg: 'bg-indigo-50', icon: 'text-indigo-600', badge: 'bg-indigo-100 text-indigo-700' },
    emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' },
    amber: { bg: 'bg-amber-50', icon: 'text-amber-600', badge: 'bg-amber-100 text-amber-700' },
    rose: { bg: 'bg-rose-50', icon: 'text-rose-600', badge: 'bg-rose-100 text-rose-700' },
    sky: { bg: 'bg-sky-50', icon: 'text-sky-600', badge: 'bg-sky-100 text-sky-700' },
    violet: { bg: 'bg-violet-50', icon: 'text-violet-600', badge: 'bg-violet-100 text-violet-700' },
    slate: { bg: 'bg-slate-50', icon: 'text-slate-600', badge: 'bg-slate-100 text-slate-700' },
  };
  const c = colorMap[color] ?? colorMap.indigo;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`h-8 w-8 rounded-lg ${c.bg} flex items-center justify-center`}>
          <Icon className={`h-4 w-4 ${c.icon}`} />
        </div>
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-900 tabular-nums">{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      </div>
      {trend && (
        <div className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full w-fit
          ${trend === 'up' ? 'bg-emerald-50 text-emerald-700' : trend === 'down' ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-500'}`}>
          {trend === 'up' ? <ArrowUp className="h-3 w-3" /> : trend === 'down' ? <ArrowDown className="h-3 w-3" /> : null}
          {trend === 'up' ? 'Positive' : trend === 'down' ? 'Attention' : 'Stable'}
        </div>
      )}
    </div>
  );
}

// ── Payment Breakdown Bar ─────────────────────────────────────────

function PaymentBreakdown({
  cash,
  upi,
  chequeCleared,
  chequePending,
  credit,
}: {
  cash: number;
  upi: number;
  chequeCleared: number;
  chequePending: number;
  credit: number;
}) {
  const totalCheque = chequeCleared + chequePending;
  const total = cash + upi + totalCheque + credit || 1;
  const cashPct = (cash / total) * 100;
  const upiPct = (upi / total) * 100;
  const chequeClPct = (chequeCleared / total) * 100;
  const chequePePct = (chequePending / total) * 100;
  const creditPct = (credit / total) * 100;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment Breakdown (Authoritative)</span>
        <CreditCard className="h-4 w-4 text-slate-400" />
      </div>
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-3 bg-slate-100">
        {cashPct > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${cashPct}%` }} title={`Cash: ${cashPct.toFixed(1)}%`} />}
        {upiPct > 0 && <div className="bg-violet-500 transition-all" style={{ width: `${upiPct}%` }} title={`UPI: ${upiPct.toFixed(1)}%`} />}
        {chequeClPct > 0 && <div className="bg-sky-500 transition-all" style={{ width: `${chequeClPct}%` }} title={`Cheque Cleared: ${chequeClPct.toFixed(1)}%`} />}
        {chequePePct > 0 && <div className="bg-sky-300 transition-all" style={{ width: `${chequePePct}%` }} title={`Cheque Pending: ${chequePePct.toFixed(1)}%`} />}
        {creditPct > 0 && <div className="bg-amber-400 transition-all" style={{ width: `${creditPct}%` }} title={`Credit: ${creditPct.toFixed(1)}%`} />}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: 'Cash', value: cash, color: 'bg-emerald-500' },
          { label: 'UPI', value: upi, color: 'bg-violet-500' },
          { label: 'Cheque (Cleared)', value: chequeCleared, color: 'bg-sky-500' },
          { label: 'Cheque (Pending)', value: chequePending, color: 'bg-sky-300' },
          { label: 'Credit', value: credit, color: 'bg-amber-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="text-center p-1.5 rounded-lg bg-slate-50 border border-slate-100">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <span className={`h-2 w-2 rounded-full ${color} flex-shrink-0`} />
              <span className="text-[10px] font-medium text-slate-500 truncate">{label}</span>
            </div>
            <div className="text-xs font-bold text-slate-800">{fmtK(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Delivery Status Card ──────────────────────────────────────────

function DeliveryStatus({ total, completed, pending }: { total: number; completed: number; pending: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Delivery Execution</span>
        <Truck className="h-4 w-4 text-slate-400" />
      </div>
      <div className="flex items-end gap-3 mb-3">
        <div className="text-2xl font-bold text-slate-900">{pct}%</div>
        <div className="text-xs text-slate-400 mb-0.5">completion rate</div>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          {completed} completed
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3 text-amber-500" />
          {pending} pending
        </span>
        <span className="text-slate-400">{total} total</span>
      </div>
    </div>
  );
}

// ── Executive Exceptions Deck ─────────────────────────────────────

function ExceptionsDeck({ exceptions }: { exceptions: MasterExceptions }) {
  const hasExceptions =
    exceptions.cashDiscrepancies.count > 0 ||
    exceptions.bouncedCheques.count > 0 ||
    exceptions.pendingExpenses.count > 0 ||
    exceptions.reconciliationSummary.discrepantCount > 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className={`h-4 w-4 ${hasExceptions ? 'text-amber-600' : 'text-emerald-600'}`} />
          <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Executive Attention & Exceptions
          </h2>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
          hasExceptions ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
        }`}>
          {hasExceptions ? 'Action Required' : 'All Clear'}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {/* 1. Cash Discrepancies */}
        <div className={`p-3 rounded-lg border ${
          exceptions.cashDiscrepancies.count > 0
            ? 'bg-rose-50/50 border-rose-200'
            : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 mb-1">
            <span>Cash Discrepancies</span>
            <AlertTriangle className={`h-3.5 w-3.5 ${exceptions.cashDiscrepancies.count > 0 ? 'text-rose-600' : 'text-slate-400'}`} />
          </div>
          <div className="text-lg font-bold text-slate-900 tabular-nums">
            {exceptions.cashDiscrepancies.count} {exceptions.cashDiscrepancies.count === 1 ? 'Route' : 'Routes'}
          </div>
          <div className="text-xs text-rose-600 font-semibold mt-0.5">
            {exceptions.cashDiscrepancies.totalAmount !== 0 ? fmtFull(exceptions.cashDiscrepancies.totalAmount) : '₹0.00'} variance
          </div>
        </div>

        {/* 2. Bounced Cheques */}
        <div className={`p-3 rounded-lg border ${
          exceptions.bouncedCheques.count > 0
            ? 'bg-rose-50/50 border-rose-200'
            : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 mb-1">
            <span>Bounced Cheques</span>
            <XCircle className={`h-3.5 w-3.5 ${exceptions.bouncedCheques.count > 0 ? 'text-rose-600' : 'text-slate-400'}`} />
          </div>
          <div className="text-lg font-bold text-slate-900 tabular-nums">
            {exceptions.bouncedCheques.count} Cheques
          </div>
          <div className="text-xs text-rose-600 font-semibold mt-0.5">
            {fmtFull(exceptions.bouncedCheques.totalAmount)}
          </div>
        </div>

        {/* 3. Pending Expenses */}
        <div className={`p-3 rounded-lg border ${
          exceptions.pendingExpenses.count > 0
            ? 'bg-amber-50/50 border-amber-200'
            : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 mb-1">
            <span>Pending Expenses</span>
            <Clock className={`h-3.5 w-3.5 ${exceptions.pendingExpenses.count > 0 ? 'text-amber-600' : 'text-slate-400'}`} />
          </div>
          <div className="text-lg font-bold text-slate-900 tabular-nums">
            {exceptions.pendingExpenses.count} Unapproved
          </div>
          <div className="text-xs text-amber-700 font-semibold mt-0.5">
            {fmtFull(exceptions.pendingExpenses.totalAmount)} awaiting signoff
          </div>
        </div>

        {/* 4. Route Reconciliation Status */}
        <div className={`p-3 rounded-lg border ${
          exceptions.reconciliationSummary.discrepantCount > 0
            ? 'bg-rose-50/50 border-rose-200'
            : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 mb-1">
            <span>Route Reconciliation</span>
            <CheckCircle2 className="h-3.5 w-3.5 text-slate-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 tabular-nums">
            {exceptions.reconciliationSummary.reconciledCount} / {exceptions.reconciliationSummary.totalCompletedPicklists}
          </div>
          <div className="text-xs text-slate-500 font-medium mt-0.5">
            {exceptions.reconciliationSummary.discrepantCount > 0 ? (
              <span className="text-rose-600 font-semibold">{exceptions.reconciliationSummary.discrepantCount} discrepant</span>
            ) : exceptions.reconciliationSummary.pendingReconciliationCount > 0 ? (
              <span className="text-amber-600 font-semibold">{exceptions.reconciliationSummary.pendingReconciliationCount} pending</span>
            ) : (
              <span className="text-emerald-600 font-semibold">All closed reconciled</span>
            )}
          </div>
        </div>
      </div>

      {/* Exception details if active */}
      {exceptions.cashDiscrepancies.count > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            Active Cash Discrepancies Requiring Review:
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {exceptions.cashDiscrepancies.routes.map(r => (
              <div key={r.id} className="py-1.5 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-800">{r.picklistNumber}</span>
                  <span className="text-slate-400 mx-1">·</span>
                  <span className="text-slate-600">{r.routeName}</span>
                  <span className="text-slate-400 mx-1">({r.workerName})</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500">Exp: {fmtFull(r.expectedCash)}</span>
                  <span className="text-slate-500">Act: {fmtFull(r.actualCash)}</span>
                  <span className="font-bold text-rose-600">{fmtFull(r.discrepancy)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {exceptions.bouncedCheques.count > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            Bounced Cheques (Uncollected Debt):
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {exceptions.bouncedCheques.items.map(b => (
              <div key={b.id} className="py-1.5 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-800">{b.partyName}</span>
                  <span className="text-slate-400 mx-1">·</span>
                  <span className="text-slate-500">Cheque #{b.chequeNumber || '—'}</span>
                  {b.bounceReason && <span className="text-slate-400 mx-1">({b.bounceReason})</span>}
                </div>
                <div className="font-bold text-rose-600">{fmtFull(b.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {exceptions.pendingExpenses.count > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Pending Expenses Awaiting Signoff:
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {exceptions.pendingExpenses.items.slice(0, 4).map(e => (
              <div key={e.id} className="py-1.5 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-800">{e.category}</span>
                  <span className="text-slate-400 mx-1">·</span>
                  <span className="text-slate-600">{e.workerName}</span>
                  {e.description && <span className="text-slate-400 mx-1">({e.description})</span>}
                </div>
                <div className="font-bold text-amber-700">{fmtFull(e.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stock Exception Summary ───────────────────────────────────────

function StockExceptionSummary({ stock }: { stock: MasterExceptions['stockExceptions'] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-slate-500" />
          <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Stock Exceptions & Damage Overview
          </h2>
        </div>
        <span className="text-xs text-slate-400">Authoritative Movement Ledger</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
          <div className="text-xs text-slate-500 font-medium">Damaged in Transit</div>
          <div className="text-lg font-bold text-slate-900 mt-0.5">{stock.damagedTransitCount} movements</div>
        </div>
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
          <div className="text-xs text-slate-500 font-medium">Damaged in Warehouse</div>
          <div className="text-lg font-bold text-slate-900 mt-0.5">{stock.damagedWarehouseCount} movements</div>
        </div>
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
          <div className="text-xs text-slate-500 font-medium">Total Damaged Quantity</div>
          <div className={`text-lg font-bold mt-0.5 ${stock.totalDamagedQty > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
            {stock.totalDamagedQty} units
          </div>
        </div>
      </div>

      {stock.recentDamagedMovements.length > 0 && (
        <div className="divide-y divide-slate-100 text-xs">
          <div className="text-[11px] font-semibold text-slate-500 uppercase py-1">Recent Damage Records</div>
          {stock.recentDamagedMovements.slice(0, 4).map(m => (
            <div key={m.id} className="py-1.5 flex items-center justify-between text-slate-700">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900">{m.sku}</span>
                <span className="text-slate-400">·</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  m.movementType === 'damaged_transit' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                }`}>
                  {m.movementType === 'damaged_transit' ? 'Transit' : 'Warehouse'}
                </span>
                <span className="text-slate-400">by {m.workerName}</span>
              </div>
              <div className="font-bold text-rose-600">{m.quantity} units</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inventory & Product Master Health (Section 14-16) ─────────────

function InventoryProductMasterHealthSection({
  health,
  inventoryExceptions,
}: {
  health: MasterInventoryHealth;
  inventoryExceptions: MasterInventoryExceptionItem[];
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Package className="h-4 w-4 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Inventory & Product Master Health</h2>
            <p className="text-xs text-slate-500">
              Canonical SAP Product Master Oversight & Operational Stock Reconciliation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/admin/inventory/register"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-primary-600" />
            Quantity Register
          </Link>
          <Link
            to="/admin/inventory/reconciliation"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors"
          >
            <Scale className="h-3.5 w-3.5 text-amber-600" />
            Stock Reconciliation
          </Link>
        </div>
      </div>

      {/* 8 Primary Health Metrics Grid (Section 14) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 mb-4">
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
          <div className="text-[11px] font-semibold text-slate-500">Total SAP Master</div>
          <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">{health.totalSapProducts.toLocaleString()}</div>
          <div className="text-[10px] text-slate-400">Canonical SKUs</div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
          <div className="text-[11px] font-semibold text-slate-500">Active Products</div>
          <div className="text-base font-bold text-emerald-700 tabular-nums mt-0.5">{health.activeProducts.toLocaleString()}</div>
          <div className="text-[10px] text-slate-400">Available in ERP</div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
          <div className="text-[11px] font-semibold text-slate-500">Mapped Products</div>
          <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">{health.mappedProducts.toLocaleString()}</div>
          <div className="text-[10px] text-slate-400">Verified SAP identity</div>
        </div>

        <div className={`p-2.5 rounded-lg border ${health.unmappedSkus > 0 ? 'bg-amber-50/60 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-100'}`}>
          <div className="text-[11px] font-semibold">Unmapped SKUs</div>
          <div className={`text-base font-bold tabular-nums mt-0.5 ${health.unmappedSkus > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{health.unmappedSkus}</div>
          <div className="text-[10px] text-slate-400">Action required</div>
        </div>

        <div className={`p-2.5 rounded-lg border ${health.productMasterExceptions > 0 ? 'bg-rose-50/60 border-rose-200' : 'bg-slate-50 border-slate-100'}`}>
          <div className="text-[11px] font-semibold text-slate-500">PM Exceptions</div>
          <div className={`text-base font-bold tabular-nums mt-0.5 ${health.productMasterExceptions > 0 ? 'text-rose-600' : 'text-slate-900'}`}>{health.productMasterExceptions}</div>
          <div className="text-[10px] text-slate-400">Shortages & unmapped</div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
          <div className="text-[11px] font-semibold text-slate-500">Recent Movement</div>
          <div className="text-base font-bold text-indigo-700 tabular-nums mt-0.5">{health.productsWithRecentMovement}</div>
          <div className="text-[10px] text-slate-400">Moved in 30 days</div>
        </div>

        <div className={`p-2.5 rounded-lg border ${health.stockVarianceCases > 0 ? 'bg-rose-50/60 border-rose-200' : 'bg-slate-50 border-slate-100'}`}>
          <div className="text-[11px] font-semibold text-slate-500">Stock Variances</div>
          <div className={`text-base font-bold tabular-nums mt-0.5 ${health.stockVarianceCases > 0 ? 'text-rose-600' : 'text-slate-900'}`}>{health.stockVarianceCases}</div>
          <div className="text-[10px] text-slate-400">SAP vs DistroTrack</div>
        </div>

        <div className={`p-2.5 rounded-lg border ${health.incompleteReconciliations > 0 ? 'bg-amber-50/60 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
          <div className="text-[11px] font-semibold text-slate-500">Incomplete Recs</div>
          <div className={`text-base font-bold tabular-nums mt-0.5 ${health.incompleteReconciliations > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{health.incompleteReconciliations}</div>
          <div className="text-[10px] text-slate-400">Missing opening/inbound</div>
        </div>
      </div>

      {/* Compact Business-Wide Stock Overview (Section 16) */}
      <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Business-Wide Product Stock Overview</span>
          <span className="text-[11px] text-slate-500">Aggregated Operational Ledger</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-slate-500">Products Tracked:</span>
            <span className="ml-1.5 font-bold text-slate-900">{health.productsTracked.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-slate-500">Total Delivered Qty:</span>
            <span className="ml-1.5 font-bold text-emerald-700">{health.totalDeliveredQty.toLocaleString()} units</span>
          </div>
          <div>
            <span className="text-slate-500">Total Returned Qty:</span>
            <span className="ml-1.5 font-bold text-rose-600">{health.totalReturnedQty.toLocaleString()} units</span>
          </div>
          <div>
            <span className="text-slate-500">Total Net Sold Qty:</span>
            <span className="ml-1.5 font-bold text-indigo-700">{health.totalNetSoldQty.toLocaleString()} units</span>
          </div>
        </div>
      </div>

      {/* Exception-First Master Inventory Alerts (Section 15) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-rose-600" />
            Inventory & Product Exceptions ({inventoryExceptions.length})
          </div>
          {inventoryExceptions.length > 0 && (
            <Link
              to="/master/business?tab=stock"
              className="text-xs font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              Inspect all in Stock Oversight <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        {inventoryExceptions.length === 0 ? (
          <div className="py-3 px-4 rounded-lg bg-emerald-50/50 border border-emerald-100 flex items-center gap-2 text-xs text-emerald-800">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            <span>Zero critical inventory exceptions. All SKUs are mapped in SAP Master, routes are operating with recorded stock integrity, and reconciliations are clean.</span>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 text-xs border border-slate-100 rounded-lg overflow-hidden">
            {inventoryExceptions.slice(0, 5).map((ex) => (
              <div key={ex.id} className="p-2.5 hover:bg-slate-50 flex items-center justify-between gap-3 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                      ex.severity === 'high' ? 'bg-rose-100 text-rose-800' :
                      ex.severity === 'medium' ? 'bg-amber-100 text-amber-800' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {ex.type.replace('_', ' ')}
                    </span>
                    <span className="font-bold text-slate-900 truncate">{ex.title}</span>
                  </div>
                  <p className="text-slate-500 mt-0.5 truncate">{ex.detail}</p>
                </div>
                {ex.sku && (
                  <Link
                    to={`/admin/inventory/reconciliation?sku=${encodeURIComponent(ex.sku)}`}
                    className="flex-shrink-0 text-[11px] font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    Drill down <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Recent Activity / Audit Summary ───────────────────────────────

function RecentActivitySummary({ logs }: { logs: MasterAuditLog[] }) {
  if (logs.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="h-4 w-4 text-slate-500" />
          <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Recent System Activity</h2>
        </div>
        <div className="text-xs text-slate-400 py-3 text-center">No recent audit log events found for period</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-slate-500" />
          <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Recent System Activity (master_audit_log)</h2>
        </div>
        <span className="text-xs text-slate-400">{logs.length} logged events</span>
      </div>
      <div className="divide-y divide-slate-100 text-xs">
        {logs.slice(0, 6).map(log => (
          <div key={log.id} className="py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                log.status === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                log.status === 'failure' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                'bg-slate-100 text-slate-700'
              }`}>
                {log.status || 'info'}
              </span>
              <span className="font-semibold text-slate-800">{log.action}</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-500 uppercase text-[11px]">{log.module}</span>
              <span className="text-slate-400">({log.role || 'system'})</span>
            </div>
            <div className="text-slate-400 text-[11px] tabular-nums">
              {new Date(log.occurred_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export function MasterDashboardPage() {
  const { profile } = useAuth();
  const now = new Date();

  const [preset, setPreset] = useState<Preset>('this_month');
  const [customYear, setCustomYear] = useState(now.getFullYear());
  const [customMonth, setCustomMonth] = useState(now.getMonth() + 1);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(now);

  const range = getPresetRange(preset, { year: customYear, month: customMonth });

  const { data: kpis, isLoading: kpisLoading, refetch: refetchKpis, isFetching: kpisFetching } = useQuery({
    queryKey: QK.masterKpis(range.from, range.to),
    queryFn: () => getMasterKPIs(range),
    refetchInterval: 15_000,
  });

  const { data: exceptions, isLoading: excLoading, refetch: refetchExc } = useQuery({
    queryKey: QK.masterExceptions(range.from, range.to),
    queryFn: () => getMasterExceptions(range),
    refetchInterval: 30_000,
  });

  const { data: recentLogs = [], refetch: refetchLogs } = useQuery({
    queryKey: QK.masterAuditLog(range.from, range.to),
    queryFn: () => getMasterAuditLog({ range, limit: 10 }),
    refetchInterval: 30_000,
  });

  const { data: invHealth, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: QK.masterInventory,
    queryFn: getMasterInventoryHealth,
    refetchInterval: 30_000,
  });

  const { data: invExceptions = [], refetch: refetchInvExc } = useQuery({
    queryKey: ['master-inventory-exceptions'],
    queryFn: getMasterInventoryExceptions,
    refetchInterval: 30_000,
  });

  const loading = kpisLoading || excLoading || healthLoading;
  const isFetching = kpisFetching || loading;

  const handleRefresh = async () => {
    setLastRefreshed(new Date());
    await Promise.all([
      refetchKpis(),
      refetchExc(),
      refetchLogs(),
      refetchHealth(),
      refetchInvExc(),
    ]);
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Master Executive Oversight</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Sanghavi Traders · Business health, exception detection & audit layer · {profile?.full_name || 'Master'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Period presets */}
          <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden text-xs font-semibold">
            {(['today', 'this_month', 'custom'] as Preset[]).map(p => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`px-3 py-1.5 transition-colors cursor-pointer ${
                  preset === p
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {p === 'today' ? 'Today' : p === 'this_month' ? 'This Month' : 'Custom'}
              </button>
            ))}
          </div>

          {/* Custom period selectors */}
          {preset === 'custom' && (
            <div className="flex items-center gap-1.5">
              <select
                value={customMonth}
                onChange={e => setCustomMonth(Number(e.target.value))}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 font-medium"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
              <select
                value={customYear}
                onChange={e => setCustomYear(Number(e.target.value))}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 font-medium"
              >
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}

          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors disabled:opacity-40 cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Period label */}
      <div className="flex items-center gap-2 mb-4 text-xs text-slate-500">
        <CalendarDays className="h-3.5 w-3.5" />
        <span>
          Period: <strong className="text-slate-700">{range.from}</strong> to <strong className="text-slate-700">{range.to}</strong>
        </span>
        <span className="text-slate-300">·</span>
        <span>Last refreshed: {lastRefreshed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      {loading && !kpis && (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading authoritative oversight data…
        </div>
      )}

      {kpis && (
        <>
          {/* ── Executive Primary KPIs ─────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <KpiCard
              label="Delivered Commercial Sales"
              value={fmt(kpis.totalSales)}
              sub={`Delivered value (${fmtFull(kpis.totalSales)})`}
              icon={TrendingUp}
              color="indigo"
              trend="neutral"
            />
            <KpiCard
              label="Collections (Realized)"
              value={fmt(kpis.totalCollections)}
              sub="Cash + UPI + Cheque"
              icon={CreditCard}
              color="emerald"
              trend={kpis.totalCollections > 0 ? 'up' : 'neutral'}
            />
            <KpiCard
              label="Contribution Before COGS"
              value={fmt(kpis.contributionBeforeCogs)}
              sub={`Sales − Operating Expenses`}
              icon={Package}
              color="emerald"
              trend={kpis.contributionBeforeCogs > 0 ? 'up' : 'down'}
            />
            <KpiCard
              label="Expected Physical Cash Handover"
              value={fmt(kpis.expectedPhysicalCash)}
              sub={`Cash − Cash Expenses`}
              icon={Building2}
              color="sky"
              trend="neutral"
            />
          </div>

          {/* ── Secondary Oversight KPIs ───────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <KpiCard
              label="Pending Credit (Udhari)"
              value={fmt(kpis.totalCredit)}
              sub="Sales not yet collected"
              icon={Clock}
              color="amber"
              trend={kpis.totalCredit > 0 ? 'down' : 'up'}
            />
            <KpiCard
              label="Approved Expenses"
              value={fmt(kpis.totalExpenses)}
              sub={`Cash: ${fmtK(kpis.totalCashExpenses)}`}
              icon={CreditCard}
              color="rose"
            />
            <KpiCard label="Fleet Active" value={`${kpis.activeWorkers} Workers / ${kpis.activeRoutes} Routes`} icon={Users} color="slate" />
            <KpiCard label="Deliveries" value={`${kpis.completedDeliveries} / ${kpis.totalDeliveries} Done`} icon={ClipboardList} color="indigo" />
          </div>

          {/* ── Executive Exceptions Deck (P0) ─────────────────── */}
          {exceptions && <ExceptionsDeck exceptions={exceptions} />}

          {/* ── Stock Exceptions (P0) ──────────────────────────── */}
          {exceptions && <StockExceptionSummary stock={exceptions.stockExceptions} />}

          {/* ── Inventory & Product Master Health (Section 14-16) ── */}
          {invHealth && (
            <InventoryProductMasterHealthSection
              health={invHealth}
              inventoryExceptions={invExceptions}
            />
          )}

          {/* ── Detail Cards Row (Breakdowns) ──────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <PaymentBreakdown
              cash={kpis.totalCash}
              upi={kpis.totalUpi}
              chequeCleared={kpis.chequeCleared}
              chequePending={kpis.chequePending}
              credit={kpis.totalCredit}
            />
            <DeliveryStatus
              total={kpis.totalDeliveries}
              completed={kpis.completedDeliveries}
              pending={kpis.pendingDeliveries}
            />
          </div>

          {/* ── Pending Collections Queue (Credit Receivables) ── */}
          <div className="mb-6">
            <PendingCollectionsPanel maxRows={20} />
          </div>

          {/* ── Recent Activity / Audit Feed ───────────────────── */}
          <RecentActivitySummary logs={recentLogs} />

          {/* ── Authoritative Summary Table ────────────────────── */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Authoritative Financial & Operational Summary</h2>
              <span className="text-xs text-slate-400">get_financial_summary</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-2.5">Authoritative Metric</th>
                    <th className="text-right px-4 py-2.5">Amount / Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    { label: 'Delivered Commercial Sales (Sum of delivered qty × rate)', value: fmtFull(kpis.totalSales) },
                    { label: 'Cash Collections', value: fmtFull(kpis.totalCash) },
                    { label: 'UPI Collections', value: fmtFull(kpis.totalUpi) },
                    { label: 'Cheques Cleared', value: fmtFull(kpis.chequeCleared) },
                    { label: 'Cheques Pending Clearance', value: fmtFull(kpis.chequePending) },
                    { label: 'Total Cheque Collections (Cleared + Pending)', value: fmtFull(kpis.totalCheque) },
                    { label: 'Total Realized Collections (Cash + UPI + Cheque)', value: fmtFull(kpis.totalCollections) },
                    { label: 'Collections from Current-Period Sales', value: fmtFull(kpis.currentPeriodCollected) },
                    { label: 'Prior-Period Udhari / Advance Collected', value: fmtFull(kpis.priorPeriodCollected) },
                    { label: 'Total Outstanding Udhari (Authoritative Open Receivables)', value: fmtFull(kpis.outstandingAmount) },
                    { label: 'Customer Advances / Overpayments Held', value: fmtFull(kpis.customerAdvance) },
                    { label: 'Approved Route Operating Expenses', value: fmtFull(kpis.totalExpenses) },
                    { label: 'Approved Cash Route Expenses', value: fmtFull(kpis.totalCashExpenses) },
                    { label: 'Contribution Before COGS (Commercial Sales − Approved Expenses)', value: fmtFull(kpis.contributionBeforeCogs) },
                    { label: 'Expected Physical Cash Handover (Cash Collections − Cash Expenses)', value: fmtFull(kpis.expectedPhysicalCash) },
                    { label: 'Total Deliveries', value: String(kpis.totalDeliveries) },
                    { label: 'Completed Deliveries', value: String(kpis.completedDeliveries) },
                    { label: 'Pending Deliveries', value: String(kpis.pendingDeliveries) },
                    { label: 'Picklists Processed', value: String(kpis.totalPicklists) },
                  ].map(row => (
                    <tr key={row.label} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 text-slate-700">{row.label}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

