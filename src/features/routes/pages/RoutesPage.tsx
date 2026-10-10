import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QK } from '@/lib/queryKeys';
import { toast } from 'sonner';
import { Plus, Search, MoreHorizontal, Edit2, Trash2, ChevronDown, ChevronUp, CheckCircle2, MapPin, Building2, Package, Settings2, RefreshCw, RotateCcw, Archive, AlertCircle } from 'lucide-react';
import { PageHeader, Button, Input, Select, Modal, EmptyState, LoadingState, ErrorState, StatusBadge, Card } from '@/shared/ui';
import { getRoutes, createRoute, updateRoute, deleteRoute, archiveRoute, unarchiveRoute, seedOfficialRoutes, getRouteDeletePreview } from '../services/routeService';
import { getWorkers } from '@/features/workers/services/workerService';
import { getParties } from '@/features/parties/services/partyService';
import { getDeliveries } from '@/features/deliveries/services/deliveryService';
import { getPicklists } from '@/features/picklists/services/picklistService';
import { getPayments, createPayment } from '@/features/payments/services/paymentService';
import { getRouteProfitability } from '@/features/expenses/services/expenseService';
import { supabase, isMockMode } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import { formatCurrency } from '@/shared/utils/format';
import type { Route, PaymentMode, RouteProfitabilityItem } from '@/lib/database.types';
import { AdminRouteEditorModal } from '../components/AdminRouteEditorModal';

export function RoutesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Route | null>(null);
  const [editingRouteForItems, setEditingRouteForItems] = useState<Route | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [deletingRoute, setDeletingRoute] = useState<Route | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'active' | 'completed' | 'archived' | 'all'>('active');
  const [form, setForm] = useState({ name: '', code: '', description: '', assigned_worker_id: '' });

  const { data: routes = [], isLoading: rLoading, error } = useQuery({ queryKey: ['routes'], queryFn: getRoutes });
  const { data: workers = [] } = useQuery({ queryKey: ['workers'], queryFn: getWorkers });
  const { data: parties = [] } = useQuery({ queryKey: ['parties'], queryFn: getParties });
  const { data: deliveries = [] } = useQuery({ queryKey: ['deliveries'], queryFn: getDeliveries });
  const { data: picklists = [] } = useQuery({ queryKey: ['picklists'], queryFn: getPicklists });
  const { data: payments = [] } = useQuery({ queryKey: ['payments'], queryFn: getPayments });
  const { data: routeProfitability } = useQuery({
    queryKey: ['route-profitability'],
    queryFn: () => getRouteProfitability(),
  });
  const { data: deletePreview, isLoading: previewLoading } = useQuery({
    queryKey: ['route-delete-preview', deletingRoute?.id],
    queryFn: () => (deletingRoute ? getRouteDeletePreview(deletingRoute.id) : null),
    enabled: !!deletingRoute,
  });

  const createMut = useMutation({
    mutationFn: createRoute,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routes'] });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterAllWorkers });
      toast.success('Route added');
      closeModal();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Route> }) => updateRoute(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routes'] });
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      // Master Command Center
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterAllWorkers });
      toast.success('Route updated');
      closeModal();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const archiveMut = useMutation({
    mutationFn: archiveRoute,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routes'] });
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterAllWorkers });
      qc.invalidateQueries({ queryKey: QK.dashboardStats });
      toast.success('Route archived. Historical records and inventory ledger preserved.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const unarchiveMut = useMutation({
    mutationFn: unarchiveRoute,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routes'] });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterAllWorkers });
      toast.success('Route unarchived and restored to active status.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteRoute(id, true, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routes'] });
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['parties'] });
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      qc.invalidateQueries({ queryKey: ['worker-history'] });
      qc.invalidateQueries({ queryKey: ['worker-route-deliveries'] });
      qc.invalidateQueries({ queryKey: ['inventory-movements'] });
      qc.invalidateQueries({ queryKey: ['route-profitability'] });
      // Master Command Center & Dashboard
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterAllWorkers });
      qc.invalidateQueries({ queryKey: QK.dashboardStats });
      qc.invalidateQueries({ queryKey: QK.deliveries });
      qc.invalidateQueries({ queryKey: QK.payments });
      qc.invalidateQueries({ queryKey: QK.inventory });
      toast.success('Route and all route-owned operational data permanently deleted.');
      setDeletingRoute(null);
      setDeleteConfirmText('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Mark entire route as complete
  const markRouteCompleteMut = useMutation({
    mutationFn: async (route: Route) => {
      // Find all deliveries for parties on this route or picklists on this route
      const routeParties = parties.filter(p => p.route_id === route.id || p.route?.code === route.code);
      const partyIds = new Set(routeParties.map(p => p.id));

      const routeDeliveries = deliveries.filter(d => partyIds.has(d.party_id) || d.picklist?.route_id === route.id);
      const routePicklists = picklists.filter(pl => pl.route_id === route.id || pl.route?.code === route.code);

      let routeTotalCash = 0;
      let routeTotalUpi = 0;
      let routeTotalCheque = 0;
      let routeTotalCredit = 0;

      for (const del of routeDeliveries) {
        const party = parties.find(p => p.id === del.party_id);
        const isCredit = (party && Number(party.outstanding_amount || 0) > 0) || del.payment_mode === 'credit';
        const billAmt = Number(del.delivered_amount || del.total_amount || 0);

        const mode: PaymentMode = isCredit
          ? 'credit'
          : (del.payment_mode === 'cheque' || del.payment_mode === 'upi' ? del.payment_mode : 'cash');
        const collectedAmt = isCredit ? 0 : billAmt;

        if (mode === 'cash') routeTotalCash += billAmt;
        else if (mode === 'upi') routeTotalUpi += billAmt;
        else if (mode === 'cheque') routeTotalCheque += billAmt;
        else if (mode === 'credit') routeTotalCredit += billAmt;

        const deliveredAt = del.delivered_at || new Date().toISOString();

        // Update delivery in Supabase & mockStore
        try {
          await supabase.from('deliveries').update({
            status: 'delivered',
            delivered_amount: billAmt,
            collected_amount: collectedAmt,
            payment_mode: mode,
            delivered_at: deliveredAt,
          }).eq('id', del.id);
        } catch {
          // fallback
        }

        if (isMockMode()) {
          mockStore.saveDelivery({
            id: del.id,
            status: 'delivered',
            delivered_amount: billAmt,
            collected_amount: collectedAmt,
            payment_mode: mode,
            delivered_at: deliveredAt,
          });
        }

        // Record payment
        if (billAmt > 0 && mode !== 'credit') {
          await createPayment({
            delivery_id: del.id,
            party_id: del.party_id,
            worker_id: del.worker_id || route.assigned_worker_id || undefined,
            amount: billAmt,
            payment_mode: mode,
          });
        }
      }

      // Update route picklists
      const totalCollected = routeTotalCash + routeTotalUpi + routeTotalCheque;
      for (const pl of routePicklists) {
        try {
          await supabase.from('picklists').update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            completed_parties: routeDeliveries.length,
            total_collected: totalCollected,
            total_cash: routeTotalCash,
            total_upi: routeTotalUpi,
            total_cheque: routeTotalCheque,
            total_credit: routeTotalCredit,
          }).eq('id', pl.id);
        } catch {
          // fallback
        }

        if (isMockMode()) {
          mockStore.savePicklist({
            id: pl.id,
            status: 'completed',
            completed_at: new Date().toISOString(),
            completed_parties: routeDeliveries.length,
            total_collected: totalCollected,
            total_cash: routeTotalCash,
            total_cheque: routeTotalCheque,
            total_credit: routeTotalCredit,
          });
        }
      }

      await updateRoute(route.id, { status: 'completed' as any });
      return { totalCash: routeTotalCash, totalCredit: routeTotalCredit };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['routes'] });
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      qc.invalidateQueries({ queryKey: ['worker-history'] });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterAllWorkers });
      qc.invalidateQueries({ queryKey: QK.dashboardStats });
      toast.success(`Route completed! Recorded ${formatCurrency(result?.totalCash || 0)} Cash collected.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Reactivate a completed route
  const reactivateRouteMut = useMutation({
    mutationFn: async (routeId: string) => {
      await updateRoute(routeId, { status: 'active' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routes'] });
      qc.invalidateQueries({ queryKey: QK.masterOperations });
      qc.invalidateQueries({ queryKey: QK.masterAllWorkers });
      toast.success('Route reactivated!');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = routes.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.code.toLowerCase().includes(search.toLowerCase())
  );

  const activeRoutes = filtered.filter((r) => r.status === 'active' || (!['completed', 'archived'].includes(r.status)));
  const completedRoutes = filtered.filter((r) => r.status === 'completed');
  const archivedRoutes = filtered.filter((r) => r.status === 'archived');

  function openCreate() {
    setEditing(null);
    setForm({ name: '', code: '', description: '', assigned_worker_id: '' });
    setModalOpen(true);
  }
  function openEdit(r: Route) {
    setEditing(r);
    setForm({ name: r.name, code: r.code, description: r.description ?? '', assigned_worker_id: r.assigned_worker_id ?? '' });
    setModalOpen(true);
    setMenuOpen(null);
  }
  function closeModal() { setModalOpen(false); setEditing(null); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      updateMut.mutate({ id: editing.id, data: { ...form, assigned_worker_id: form.assigned_worker_id || null } });
    } else {
      createMut.mutate({ ...form, assigned_worker_id: form.assigned_worker_id || undefined });
    }
  }

  const seedRoutesMut = useMutation({
    mutationFn: seedOfficialRoutes,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routes'] });
      toast.success('Synced 20 official routes & assigned workers!');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (rLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Route Management"
        description="View imported SAP routes, party orders, product breakdowns, payment modes, and complete deliveries"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => seedRoutesMut.mutate()}
              loading={seedRoutesMut.isPending}
            >
              Sync 20 Official Routes
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              Add Route
            </Button>
          </div>
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="max-w-xs w-full">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
            <input
              type="text"
              placeholder="Search route code or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 text-sm border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:ring-offset-1 dark:focus:ring-offset-surface-900"
            />
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 bg-surface-100 dark:bg-surface-800 p-1 rounded-lg self-start sm:self-auto text-xs font-medium border border-surface-200 dark:border-surface-700">
          <button
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1.5 rounded-md transition-all ${statusFilter === 'active' ? 'bg-white dark:bg-surface-700 text-primary-600 dark:text-primary-400 shadow-xs font-bold' : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200'}`}
          >
            Active ({activeRoutes.length})
          </button>
          <button
            onClick={() => setStatusFilter('completed')}
            className={`px-3 py-1.5 rounded-md transition-all ${statusFilter === 'completed' ? 'bg-white dark:bg-surface-700 text-emerald-600 dark:text-emerald-400 shadow-xs font-bold' : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200'}`}
          >
            Completed ({completedRoutes.length})
          </button>
          <button
            onClick={() => setStatusFilter('archived')}
            className={`px-3 py-1.5 rounded-md transition-all ${statusFilter === 'archived' ? 'bg-white dark:bg-surface-700 text-amber-600 dark:text-amber-400 shadow-xs font-bold' : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200'}`}
          >
            Archived ({archivedRoutes.length})
          </button>
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-md transition-all ${statusFilter === 'all' ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-xs font-bold' : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200'}`}
          >
            All ({filtered.length})
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No routes found" description={search ? 'Try a different search' : 'Add your first route or import an SAP picklist'} action={!search ? <Button size="sm" onClick={openCreate}>Add Route</Button> : undefined} />
      ) : (
        <div className="space-y-6">
        {/* Active Routes Section */}
        {(statusFilter === 'active' || statusFilter === 'all') && activeRoutes.length > 0 && (
        <div className="space-y-4">
          {activeRoutes.map((route) => {
            const isExpanded = expandedRouteId === route.id;
            // Get parties assigned to this route
            const routeParties = parties.filter(p => p.route_id === route.id || p.route?.code === route.code);
            const partyIds = new Set(routeParties.map(p => p.id));

            // Get picklists for this route
            const routePicklists = picklists.filter((pl) => pl.route_id === route.id || pl.route?.code === route.code);
            const rProfit = routeProfitability?.routes?.find((it: RouteProfitabilityItem) => it.route_id === route.id || it.route_code === route.code);

            const routeSales = rProfit ? rProfit.sales : (routePicklists.reduce((sum, pl) => sum + Number(pl.total_amount || 0), 0) ||
              routeParties.reduce((sum, p) => sum + Number(p.outstanding_amount || 0), 0));

            // Get deliveries on this route
            const routeDeliveries = deliveries.filter(d => partyIds.has(d.party_id) || d.picklist?.route_id === route.id);
            const completedCount = routeDeliveries.filter(d => d.status === 'delivered').length;
            const isAllDelivered = routeDeliveries.length > 0 && completedCount === routeDeliveries.length;

            const routeCashCollected = rProfit ? rProfit.cash_collected : (routePicklists.reduce((s, pl) => s + Number(pl.total_cash || 0), 0));
            const routeCreditAmount = rProfit ? rProfit.credit_sales : (routePicklists.reduce((s, pl) => s + Number(pl.total_credit || 0), 0));
            const routeApprovedExpenses = rProfit ? rProfit.approved_expenses : 0;
            const routeCogs = rProfit?.cogs ?? 0;
            const routeGrossProfit = rProfit?.gross_profit ?? (routeSales - routeCogs);
            const routeNetProfit = rProfit?.net_profit ?? (routeGrossProfit - routeApprovedExpenses);
            const routeCogsStatus = rProfit?.cogs_status || 'complete';

            return (
              <Card key={route.id} className="p-0 overflow-hidden border border-surface-200 dark:border-surface-700">
                {/* Route Main Header */}
                <div className="p-4 bg-white dark:bg-surface-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-surface-200 dark:border-surface-700">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setExpandedRouteId(isExpanded ? null : route.id)}
                      className="p-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"
                    >
                      {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs bg-primary-100 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 px-2 py-0.5 rounded font-bold">{route.code}</span>
                        <h3 className="font-semibold text-base text-surface-900 dark:text-white">{route.name}</h3>
                      </div>
                      {route.description && <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{route.description}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-wrap">
                    {/* Worker */}
                    <div className="text-xs">
                      <span className="text-surface-400 block uppercase font-medium text-[10px]">Assigned Worker</span>
                      <select
                        value={route.assigned_worker_id || routePicklists[0]?.worker_id || ''}
                        onChange={(e) => updateMut.mutate({ id: route.id, data: { assigned_worker_id: e.target.value || null } })}
                        className="text-xs border border-surface-200 dark:border-surface-600 rounded px-2 py-0.5 bg-surface-50 dark:bg-surface-700 text-surface-800 dark:text-surface-200 font-semibold focus:outline-none cursor-pointer"
                      >
                        <option value="">-- Unassigned --</option>
                        {workers.filter(w => w.status === 'active').map(w => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Delivered Sales */}
                    <div className="text-xs">
                      <span className="text-surface-400 block uppercase font-medium text-[10px]">Delivered Sales</span>
                      <span className="font-bold text-primary-700 dark:text-primary-400 text-sm">{formatCurrency(routeSales)}</span>
                    </div>

                    {/* COGS */}
                    <div className="text-xs">
                      <span className="text-amber-600 dark:text-amber-400 block uppercase font-medium text-[10px] flex items-center gap-1">
                        COGS
                        {routeCogsStatus === 'incomplete' && (
                          <span className="px-1 py-0.2 rounded text-[8px] bg-amber-100 text-amber-800 font-bold">Inc</span>
                        )}
                      </span>
                      <span className="font-bold text-amber-700 dark:text-amber-400 text-sm">{formatCurrency(routeCogs)}</span>
                    </div>

                    {/* Gross Profit */}
                    <div className="text-xs">
                      <span className="text-emerald-600 dark:text-emerald-400 block uppercase font-medium text-[10px]">Gross Profit</span>
                      <span className="font-black text-emerald-700 dark:text-emerald-400 text-sm">{formatCurrency(routeGrossProfit)}</span>
                    </div>

                    {/* Approved Expenses */}
                    {routeApprovedExpenses > 0 && (
                      <div className="text-xs">
                        <span className="text-surface-400 block uppercase font-medium text-[10px]">Approved Costs</span>
                        <span className="font-black text-rose-600 dark:text-rose-400 text-sm">{formatCurrency(routeApprovedExpenses)}</span>
                      </div>
                    )}

                    {/* Net Profit */}
                    <div className="text-xs">
                      <span className="text-surface-400 block uppercase font-medium text-[10px]">Net Profit</span>
                      <span className={`font-black text-sm ${routeNetProfit >= 0 ? 'text-indigo-700 dark:text-indigo-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {formatCurrency(routeNetProfit)}
                      </span>
                    </div>

                    {/* Cash Collected */}
                    <div className="text-xs">
                      <span className="text-surface-400 block uppercase font-medium text-[10px]">Cash Collected</span>
                      <span className="font-black text-emerald-700 dark:text-emerald-400 text-sm">{formatCurrency(routeCashCollected)}</span>
                    </div>

                    {/* Credit / Udhar */}
                    {routeCreditAmount > 0 && (
                      <div className="text-xs">
                        <span className="text-surface-400 block uppercase font-medium text-[10px]">Credit / Udhar</span>
                        <span className="font-black text-amber-700 dark:text-amber-400 text-sm">{formatCurrency(routeCreditAmount)}</span>
                      </div>
                    )}

                    {/* Completion Status */}
                    <div className="text-xs">
                      <span className="text-surface-400 block uppercase font-medium text-[10px]">Deliveries</span>
                      <span className={`font-semibold ${isAllDelivered ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {completedCount} / {routeDeliveries.length} Completed
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Settings2 className="h-4 w-4" />}
                        onClick={() => setEditingRouteForItems(route)}
                      >
                        Edit Route & Bills
                      </Button>

                      <Button
                        size="sm"
                        variant={isAllDelivered ? 'secondary' : 'primary'}
                        icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                        loading={markRouteCompleteMut.isPending}
                        onClick={() => markRouteCompleteMut.mutate(route)}
                      >
                        {isAllDelivered ? 'Route Complete ✓' : 'Mark Route Complete'}
                      </Button>

                      <div className="relative">
                        <button onClick={() => setMenuOpen(menuOpen === route.id ? null : route.id)} className="p-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-400">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {menuOpen === route.id && (
                          <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg py-1 z-10">
                            <button onClick={() => openEdit(route)} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700">
                              <Edit2 className="h-3.5 w-3.5" /> Edit
                            </button>
                            <button
                              onClick={() => { archiveMut.mutate(route.id); setMenuOpen(null); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                              title="Archive this route to preserve historical reports."
                            >
                              <Archive className="h-3.5 w-3.5" /> Archive Route
                            </button>
                            <button
                              onClick={() => { setDeletingRoute(route); setDeleteConfirmText(''); setMenuOpen(null); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-danger-600 dark:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-950/40"
                              title="Delete route definition."
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete Route
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Party & Product Breakdown */}
                {isExpanded && (
                  <div className="p-4 bg-surface-50/50 dark:bg-surface-850/50 space-y-4 border-t border-surface-100 dark:border-surface-800">
                    <h4 className="text-xs font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wide flex items-center gap-1.5">
                      <Building2 className="h-4 w-4" /> Parties & Products on {route.name}
                    </h4>

                    {routeParties.length === 0 ? (
                      <div className="text-center py-6 text-xs text-surface-400">
                        No customer parties assigned to this route yet. Import an SAP picklist to assign parties.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3">
                        {routeParties.map((party) => {
                          // Find delivery for this party on this route
                          const partyDelivery = routeDeliveries.find(d => d.party_id === party.id);
                          const partyPayments = payments.filter(p => p.party_id === party.id);

                          // Determine payment mode (cash, cheque, upi, credit)
                          const latestPayment = partyPayments[0];
                          const paymentMode = latestPayment?.payment_mode || (party.outstanding_amount > 0 ? 'credit' : 'cash');

                          // Get picklist items for this party
                          const partyPicklistItems = routePicklists.flatMap(pl => (pl.items || []).filter(it => it.party_id === party.id || it.party?.code === party.code));

                          return (
                            <div key={party.id} className="bg-white dark:bg-surface-800 p-3.5 rounded-xl border border-surface-200 dark:border-surface-700 shadow-xs">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 pb-2 border-b border-surface-100 dark:border-surface-700">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs bg-surface-100 dark:bg-surface-700 px-1.5 py-0.5 rounded font-medium text-surface-800 dark:text-surface-200">{party.code}</span>
                                    <span className="font-semibold text-sm text-surface-900 dark:text-surface-100">{party.name}</span>
                                  </div>
                                  <div className="text-xs text-surface-500 dark:text-surface-400 flex items-center gap-3 mt-0.5">
                                    {party.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {party.city}</span>}
                                    {party.contact_person && <span>Contact: {party.contact_person}</span>}
                                  </div>
                                </div>

                                <div className="flex items-center gap-3">
                                  {/* Payment Mode Badge */}
                                  <div className="text-xs">
                                    <span className="text-surface-400 block text-[10px] uppercase font-medium">Payment Mode</span>
                                    <StatusBadge status={paymentMode} />
                                  </div>

                                  {/* Delivery Status Badge */}
                                  <div className="text-xs">
                                    <span className="text-surface-400 block text-[10px] uppercase font-medium">Delivery Status</span>
                                    <StatusBadge status={partyDelivery?.status || 'pending'} />
                                  </div>

                                  {/* Bill / Delivered Value */}
                                  <div className="text-xs text-right">
                                    <span className="text-surface-400 block text-[10px] uppercase font-medium">Bill Amount</span>
                                    <span className="font-bold text-surface-900 dark:text-surface-100">
                                      {formatCurrency(partyDelivery?.delivered_amount || partyDelivery?.total_amount || 0)}
                                    </span>
                                  </div>

                                  {/* Outstanding / Payment Status */}
                                  <div className="text-xs text-right">
                                    <span className="text-surface-400 block text-[10px] uppercase font-medium">
                                      {paymentMode === 'credit' ? 'Credit Balance' : 'Cash Paid'}
                                    </span>
                                    <span className={`font-black ${paymentMode === 'credit' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                                      {paymentMode === 'credit'
                                        ? formatCurrency(party.outstanding_amount || partyDelivery?.total_amount || 0)
                                        : formatCurrency(partyDelivery?.collected_amount || partyDelivery?.total_amount || 0)}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Products List */}
                              <div className="mt-2">
                                <div className="text-[11px] font-semibold text-surface-500 dark:text-surface-400 mb-1.5 flex items-center gap-1">
                                  <Package className="h-3.5 w-3.5" /> Products Sold:
                                </div>
                                {partyPicklistItems.length === 0 ? (
                                  <div className="text-xs text-surface-400 italic">Standard catalog items assigned on delivery.</div>
                                ) : (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs text-surface-700 dark:text-surface-300">
                                      <thead>
                                        <tr className="text-left text-surface-400 border-b border-surface-100 dark:border-surface-700/60">
                                          <th className="pb-1">SKU</th>
                                          <th className="pb-1">Product</th>
                                          <th className="pb-1 text-right">Qty</th>
                                          <th className="pb-1 text-right">Rate</th>
                                          <th className="pb-1 text-right">Amount</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {partyPicklistItems.map((item, idx) => (
                                          <tr key={idx} className="border-b border-surface-50 dark:border-surface-800">
                                            <td className="py-1 font-mono text-surface-500">{item.sku}</td>
                                            <td className="py-1 font-medium text-surface-900 dark:text-surface-100">{item.product_name}</td>
                                            <td className="py-1 text-right font-medium">{item.quantity}</td>
                                            <td className="py-1 text-right">{formatCurrency(item.rate)}</td>
                                            <td className="py-1 text-right font-semibold text-primary-700 dark:text-primary-400">{formatCurrency(item.amount)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
        )}

        {/* Completed Routes Section */}
        {completedRoutes.length > 0 && (
          <div className="space-y-3">
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              className="w-full flex items-center justify-between px-4 py-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
                  Completed Routes ({completedRoutes.length})
                </span>
              </div>
              {showCompleted ? <ChevronUp className="h-4 w-4 text-emerald-600" /> : <ChevronDown className="h-4 w-4 text-emerald-600" />}
            </button>

            {showCompleted && completedRoutes.map((route) => {
              const routeParties = parties.filter(p => p.route_id === route.id || p.route?.code === route.code);
              const routePicklists = picklists.filter(pl => pl.route_id === route.id || pl.route?.code === route.code);
              const routeTotalAmount = routePicklists.reduce((sum, pl) => sum + Number(pl.total_amount || 0), 0);

              return (
                <Card key={route.id} className="p-4 border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                        <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded font-bold">{route.code}</span>
                          <h3 className="font-semibold text-sm text-surface-900 dark:text-white">{route.name}</h3>
                          <StatusBadge status="completed" />
                        </div>
                        <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                          {routeParties.length} parties • {formatCurrency(routeTotalAmount)} total
                          {route.worker && <> • Worker: {route.worker.name}</>}
                        </p>
                      </div>
                    </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          icon={<RotateCcw className="h-3.5 w-3.5" />}
                          loading={reactivateRouteMut.isPending}
                          onClick={() => reactivateRouteMut.mutate(route.id)}
                        >
                          Reactivate
                        </Button>
                        <button
                          onClick={() => archiveMut.mutate(route.id)}
                          className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/40 text-surface-400 hover:text-amber-600 transition-colors"
                          title="Archive completed route (preserves all ledger & delivery records)"
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => { setDeletingRoute(route); setDeleteConfirmText(''); }}
                          className="p-1.5 rounded-lg hover:bg-danger-50 dark:hover:bg-danger-950/40 text-surface-400 hover:text-danger-600 transition-colors"
                          title="Delete route"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Archived Routes Section */}
        {(statusFilter === 'archived' || statusFilter === 'all') && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1 py-1">
              <div className="flex items-center gap-2">
                <Archive className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-bold text-surface-800 dark:text-surface-200">
                  Archived Routes ({archivedRoutes.length})
                </span>
              </div>
              <span className="text-xs text-surface-400">Ledger, delivery & payment history preserved</span>
            </div>

            {archivedRoutes.length === 0 ? (
              <div className="text-center py-6 text-xs text-surface-400 border border-dashed border-surface-200 dark:border-surface-700 rounded-xl">
                No archived routes found.
              </div>
            ) : (
              archivedRoutes.map((route) => {
                const routeParties = parties.filter(p => p.route_id === route.id || p.route?.code === route.code);
                const routePicklists = picklists.filter(pl => pl.route_id === route.id || pl.route?.code === route.code);
                const routeTotalAmount = routePicklists.reduce((sum, pl) => sum + Number(pl.total_amount || 0), 0);

                return (
                  <Card key={route.id} className="p-4 border border-amber-200 dark:border-amber-800/40 bg-amber-50/20 dark:bg-amber-950/10">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                          <Archive className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded font-bold">{route.code}</span>
                            <h3 className="font-semibold text-sm text-surface-900 dark:text-white">{route.name}</h3>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300">
                              Archived
                            </span>
                          </div>
                          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                            {routeParties.length} parties • {formatCurrency(routeTotalAmount)} historical volume
                            {route.worker && <> • Worker: {route.worker.name}</>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          icon={<RotateCcw className="h-3.5 w-3.5" />}
                          loading={unarchiveMut.isPending}
                          onClick={() => unarchiveMut.mutate(route.id)}
                        >
                          Unarchive / Restore
                        </Button>
                        <button
                          onClick={() => { setDeletingRoute(route); setDeleteConfirmText(''); }}
                          className="p-1.5 rounded-lg hover:bg-danger-50 dark:hover:bg-danger-950/40 text-surface-400 hover:text-danger-600 transition-colors"
                          title="Delete route"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
          </div>
        )}
        </div>
      )}

      {/* Add / Edit Route Modal */}
      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit Route' : 'Add Route'} footer={<><Button variant="secondary" onClick={closeModal}>Cancel</Button><Button loading={createMut.isPending || updateMut.isPending} onClick={() => (document.getElementById('route-form') as HTMLFormElement)?.requestSubmit()}>{editing ? 'Save' : 'Add Route'}</Button></>}>
        <form id="route-form" onSubmit={handleSubmit} className="space-y-3">
          <Input label="Route Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. R001" required />
          <Input label="Route Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Select label="Assigned Worker" value={form.assigned_worker_id} onChange={(e) => setForm({ ...form, assigned_worker_id: e.target.value })} placeholder="Select worker (optional)" options={workers.filter((w) => w.status === 'active').map((w) => ({ value: w.id, label: w.name }))} />
        </form>
      </Modal>

      {/* Admin Route & Invoice Products Editor Modal */}
      {editingRouteForItems && (
        <AdminRouteEditorModal
          route={editingRouteForItems}
          onClose={() => setEditingRouteForItems(null)}
        />
      )}

      {/* Delete Route Confirmation Modal */}
      <Modal
        open={!!deletingRoute}
        onClose={() => {
          setDeletingRoute(null);
          setDeleteConfirmText('');
        }}
        title="Delete Route — Permanent Operational Data Reset"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDeletingRoute(null);
                setDeleteConfirmText('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteMut.isPending}
              disabled={deleteConfirmText.trim().toUpperCase() !== 'DELETE ROUTE' || deleteMut.isPending || Boolean(deletePreview && !deletePreview.can_delete)}
              onClick={() => {
                if (deletingRoute && deleteConfirmText.trim().toUpperCase() === 'DELETE ROUTE') {
                  deleteMut.mutate(deletingRoute.id);
                }
              }}
            >
              Delete Route
            </Button>
          </>
        }
      >
        {deletingRoute && (
          <div className="space-y-4 text-xs">
            {/* Destructive Warning Alert */}
            <div className="p-3.5 rounded-xl bg-danger-50 dark:bg-danger-950/40 border border-danger-200 dark:border-danger-800 flex items-start gap-2.5">
              <AlertCircle className="h-5 w-5 text-danger-600 shrink-0 mt-0.5" />
              <div className="text-danger-900 dark:text-danger-200 space-y-1.5">
                <div className="font-bold text-sm">
                  Permanently Delete Route {deletingRoute.name} ({deletingRoute.code})?
                </div>
                <p className="text-[12px] leading-relaxed text-danger-800 dark:text-danger-300">
                  This permanently deletes the route and all operational data belonging exclusively to this route,
                  including deliveries, payments, expenses, returns, route stock activity, and route-specific records.
                </p>
                <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  ✓ Shared Product Master, Workers, and Customers are preserved.
                </p>
              </div>
            </div>

            {/* Offline block reason warning if applicable */}
            {deletePreview?.block_reason && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{deletePreview.block_reason}</span>
              </div>
            )}

            {/* Dynamic Live Delete Scope Breakdown */}
            <div className="border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden bg-surface-50 dark:bg-surface-900/50">
              <div className="px-3 py-2 bg-surface-100 dark:bg-surface-800/80 border-b border-surface-200 dark:border-surface-700 font-bold text-surface-800 dark:text-surface-200 text-xs">
                Operational Records To Be Removed:
              </div>
              {previewLoading ? (
                <div className="py-4 text-center text-surface-500">Calculating deletion scope...</div>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 p-3 text-[11px]">
                  <div className="flex justify-between border-b border-surface-100 dark:border-surface-800 pb-1">
                    <span className="text-surface-600 dark:text-surface-400">Route:</span>
                    <span className="font-bold text-surface-900 dark:text-surface-100">1</span>
                  </div>
                  <div className="flex justify-between border-b border-surface-100 dark:border-surface-800 pb-1">
                    <span className="text-surface-600 dark:text-surface-400">Assignments:</span>
                    <span className="font-bold text-surface-900 dark:text-surface-100">
                      {deletePreview?.assignments_count ?? (deletingRoute.assigned_worker_id ? 1 : 0)}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-surface-100 dark:border-surface-800 pb-1">
                    <span className="text-surface-600 dark:text-surface-400">Picklists/links:</span>
                    <span className="font-bold text-surface-900 dark:text-surface-100">
                      {deletePreview?.picklists_count ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-surface-100 dark:border-surface-800 pb-1">
                    <span className="text-surface-600 dark:text-surface-400">Deliveries:</span>
                    <span className="font-bold text-surface-900 dark:text-surface-100">
                      {deletePreview?.deliveries_count ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-surface-100 dark:border-surface-800 pb-1">
                    <span className="text-surface-600 dark:text-surface-400">Delivery Items:</span>
                    <span className="font-bold text-surface-900 dark:text-surface-100">
                      {deletePreview?.delivery_items_count ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-surface-100 dark:border-surface-800 pb-1">
                    <span className="text-surface-600 dark:text-surface-400">Payments:</span>
                    <span className="font-bold text-surface-900 dark:text-surface-100">
                      {deletePreview?.payments_count ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-surface-100 dark:border-surface-800 pb-1">
                    <span className="text-surface-600 dark:text-surface-400">Expenses:</span>
                    <span className="font-bold text-surface-900 dark:text-surface-100">
                      {deletePreview?.expenses_count ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-surface-100 dark:border-surface-800 pb-1">
                    <span className="text-surface-600 dark:text-surface-400">Returns:</span>
                    <span className="font-bold text-surface-900 dark:text-surface-100">
                      {deletePreview?.returns_count ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-surface-100 dark:border-surface-800 pb-1">
                    <span className="text-surface-600 dark:text-surface-400">Inventory Movements:</span>
                    <span className="font-bold text-surface-900 dark:text-surface-100">
                      {deletePreview?.inventory_movements_count ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-surface-100 dark:border-surface-800 pb-1">
                    <span className="text-surface-600 dark:text-surface-400">Financial Records:</span>
                    <span className="font-bold text-surface-900 dark:text-surface-100">
                      {deletePreview?.financial_records_count ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-surface-100 dark:border-surface-800 pb-1">
                    <span className="text-surface-600 dark:text-surface-400">Exceptions:</span>
                    <span className="font-bold text-surface-900 dark:text-surface-100">
                      {deletePreview?.exceptions_count ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-surface-100 dark:border-surface-800 pb-1">
                    <span className="text-surface-600 dark:text-surface-400">Unlinked Parties:</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      {deletePreview?.parties_unlinked_count ?? 0} (preserved)
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Confirmation input */}
            <div className="space-y-1.5 pt-1">
              <label className="block text-xs font-semibold text-surface-800 dark:text-surface-200">
                To confirm permanent deletion, type <span className="font-mono font-bold text-danger-600 dark:text-danger-400 select-all">DELETE ROUTE</span> below:
              </label>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE ROUTE"
                autoFocus
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
