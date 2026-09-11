import { useState } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  MapPin, ChevronRight, CheckCircle2, Package, Loader2,
  TrendingUp, Target, Award, Route, X, Calendar, DollarSign,
  Zap, ArrowRight, Sparkles,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Picklist } from '@/lib/database.types';
import { formatCurrency } from '@/shared/utils/format';
import { getWorkerTodayRoute, getWorkerPerformanceMetrics } from '../services/workerRouteService';

async function getWorkerRecentPicklists(workerId: string): Promise<Picklist[]> {
  try {
    const { data, error } = await supabase
      .from('picklists')
      .select('*, route:routes(*)')
      .eq('worker_id', workerId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(5);
    if (error || !data) return [];
    return data as Picklist[];
  } catch {
    return [];
  }
}

export function WorkerDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const workerId = profile?.id || '';
  const workerName = profile?.full_name || '';

  const [activeModal, setActiveModal] = useState<'products' | 'routes' | 'target' | null>(null);

  const { data: todayRoute, isLoading: isLoadingRoute } = useQuery({
    queryKey: ['worker-today-route', workerId, workerName],
    queryFn: () => getWorkerTodayRoute(workerId, workerName),
    // Only fetch after profile is fully resolved; workerId derived from profile.id
    enabled: !!workerId && !!profile,
  });

  const { data: metrics, isLoading: isLoadingMetrics } = useQuery({
    queryKey: ['worker-performance-metrics', workerId, workerName],
    queryFn: () => getWorkerPerformanceMetrics(workerId, workerName),
    // Only fetch after profile is fully resolved; workerId derived from profile.id
    enabled: !!workerId && !!profile,
  });

  const { data: recentRoutes = [] } = useQuery({
    queryKey: ['worker-recent-routes', workerId],
    queryFn: () => getWorkerRecentPicklists(workerId),
    // Only fetch after profile is fully resolved; workerId derived from profile.id
    enabled: !!workerId && !!profile,
  });

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  if (isLoadingRoute || isLoadingMetrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  const progressPercent = metrics?.progressPercent ?? 0;
  const progressColor =
    progressPercent >= 80
      ? 'from-emerald-500 to-emerald-400'
      : progressPercent >= 50
      ? 'from-blue-500 to-indigo-500'
      : 'from-amber-500 to-orange-400';

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto pb-24">

      {/* ── Greeting Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2 pb-1">
        <div>
          <h1 className="text-lg font-bold text-surface-900 dark:text-white">
            {greeting()}, {profile?.full_name?.split(' ')[0] || 'Salesman'} 👋
          </h1>
          <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-0.5">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0">
          {profile?.full_name?.charAt(0) || 'S'}
        </div>
      </div>

      {/* ── Monthly Target Card ──────────────────────────────────────── */}
      {metrics && (
        <div
          onClick={() => setActiveModal('target')}
          className="relative overflow-hidden bg-slate-900 dark:bg-slate-900 text-white rounded-2xl p-5 shadow-lg cursor-pointer active:scale-[0.99] transition-all group"
        >
          {/* Decorative Background Blob */}
          <div className="absolute -top-6 -right-6 h-28 w-28 bg-blue-600/30 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-4 -left-4 h-20 w-20 bg-indigo-500/20 rounded-full blur-xl pointer-events-none" />

          {/* Header */}
          <div className="relative flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/15">
                <Target className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Monthly Target</div>
                <div className="text-2xl font-black text-white tracking-tight leading-tight">
                  {formatCurrency(metrics.monthlyTarget)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold ${
                progressPercent >= 100
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : progressPercent >= 50
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}>
                <TrendingUp className="h-3 w-3" />
                {metrics.progressPercent}%
              </div>
              <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
            </div>
          </div>

          {/* Progress Bar */}
          <div className="relative space-y-2.5">
            <div className="h-2.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${progressColor} rounded-full transition-all duration-700`}
                style={{ width: `${metrics.progressPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-semibold">
              <span className="text-slate-400">
                Achieved: <span className="text-white font-bold">{formatCurrency(metrics.achievedSales)}</span>
              </span>
              <span className="text-slate-400">
                Remaining: <span className="text-amber-300 font-bold">{formatCurrency(metrics.remainingTarget)}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI Cards ───────────────────────────────────────────────── */}
      {metrics && (
        <div className="grid grid-cols-2 gap-3">
          {/* Total Sales */}
          <div
            onClick={() => setActiveModal('target')}
            className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs hover:shadow-sm transition-all cursor-pointer group active:scale-[0.98]"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="h-8 w-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-100 dark:border-emerald-800/40">
                <TrendingUp className="h-4 w-4" />
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-surface-300 group-hover:text-surface-500 group-hover:translate-x-0.5 transition-all" />
            </div>
            <div className="text-xl font-extrabold text-surface-900 dark:text-white tracking-tight">
              {formatCurrency(metrics.totalSales)}
            </div>
            <div className="text-[11px] text-surface-500 dark:text-surface-400 mt-0.5 font-medium">Total Sales</div>
          </div>

          {/* Total Routes */}
          <div
            onClick={() => setActiveModal('routes')}
            className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs hover:shadow-sm transition-all cursor-pointer group active:scale-[0.98]"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="h-8 w-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-100 dark:border-blue-800/40">
                <Route className="h-4 w-4" />
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-surface-300 group-hover:text-surface-500 group-hover:translate-x-0.5 transition-all" />
            </div>
            <div className="text-xl font-extrabold text-surface-900 dark:text-white tracking-tight">
              {metrics.totalRoutes}
            </div>
            <div className="text-[11px] text-surface-500 dark:text-surface-400 mt-0.5 font-medium">
              {metrics.totalRoutes === 1 ? 'Route' : 'Routes'} Completed
            </div>
          </div>
        </div>
      )}

      {/* ── Top Product Card ─────────────────────────────────────────── */}
      {metrics?.topProduct && (
        <div
          onClick={() => setActiveModal('products')}
          className="bg-white dark:bg-surface-800 border border-amber-200/60 dark:border-amber-800/40 rounded-2xl p-4 shadow-xs hover:shadow-sm transition-all cursor-pointer group active:scale-[0.99]"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
                <Award className="h-4 w-4" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Top Selling Product
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                🏆 Best
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>

          <div className="flex items-end justify-between">
            <div>
              <div className="text-sm font-bold text-surface-900 dark:text-white truncate max-w-[160px]">
                {metrics.topProduct.name}
              </div>
              <div className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                {metrics.topProduct.unitsSold} units sold
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-extrabold text-amber-600 dark:text-amber-400 tracking-tight">
                {formatCurrency(metrics.topProduct.revenue)}
              </div>
              <div className="text-[10px] text-surface-400">total revenue</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Today's Route Card ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wide">Today's Route</h3>
        </div>

        {todayRoute ? (
          <div
            onClick={() => navigate('/w/route')}
            className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs hover:shadow-sm transition-all cursor-pointer group active:scale-[0.99]"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
                  <MapPin className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-surface-900 dark:text-white">
                    {todayRoute.route?.name || 'Assigned Route'}
                  </h2>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        todayRoute.status === 'in_progress'
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                          : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      <Zap className="h-2.5 w-2.5" />
                      {todayRoute.status === 'in_progress' ? 'In Progress' : 'Assigned'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 group-hover:gap-2 transition-all">
                Open <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-3 rounded-xl bg-surface-50 dark:bg-surface-900/50 border border-surface-100 dark:border-surface-700/50">
                <div className="text-xl font-extrabold text-surface-900 dark:text-white">{todayRoute.total_parties || 0}</div>
                <div className="text-[10px] text-surface-500 dark:text-surface-400 uppercase font-semibold mt-0.5">Parties</div>
              </div>
              <div className="text-center p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-800/40">
                <div className="text-xl font-extrabold text-emerald-700 dark:text-emerald-400">{todayRoute.completed_parties || 0}</div>
                <div className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase font-semibold mt-0.5">Done</div>
              </div>
              <div className="text-center p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-800/40">
                <div className="text-sm font-extrabold text-blue-700 dark:text-blue-400 leading-tight">
                  {formatCurrency(todayRoute.total_amount)}
                </div>
                <div className="text-[10px] text-blue-600 dark:text-blue-400 uppercase font-semibold mt-0.5">Value</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-surface-800 border border-dashed border-surface-300 dark:border-surface-600 rounded-2xl p-8 text-center">
            <div className="h-12 w-12 rounded-xl bg-surface-100 dark:bg-surface-700 flex items-center justify-center mx-auto mb-3">
              <Package className="h-6 w-6 text-surface-400" />
            </div>
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">No Active Route Assigned</h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 max-w-[220px] mx-auto">
              Contact your administrator to assign a new route to your account.
            </p>
          </div>
        )}
      </div>

      {/* ── Recent Completed Routes ──────────────────────────────────── */}
      {recentRoutes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wide">Recent Routes</h3>
            <button
              onClick={() => setActiveModal('routes')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              View All
            </button>
          </div>
          <div className="space-y-2">
            {recentRoutes.map((r) => (
              <div
                key={r.id}
                onClick={() => setActiveModal('routes')}
                className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3 flex items-center gap-3 shadow-xs hover:shadow-sm transition-all cursor-pointer"
              >
                <div className="h-8 w-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-100 dark:border-emerald-800/40 flex-shrink-0">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-surface-900 dark:text-white truncate">
                    {r.route?.name || r.picklist_number}
                  </div>
                  <div className="text-[10px] text-surface-500 dark:text-surface-400 flex items-center gap-1.5 mt-0.5">
                    <span>{new Date(r.completed_at || r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                    <span>•</span>
                    <span>{r.completed_parties}/{r.total_parties} parties</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs font-bold text-surface-900 dark:text-white">{formatCurrency(r.total_collected)}</div>
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">collected</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          MODALS
      ════════════════════════════════════════════════════════════════ */}

      {/* ── Modal: Products Performance ─────────────────────────────── */}
      {activeModal === 'products' && metrics && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-t-3xl sm:rounded-2xl max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl">
            <div className="p-5 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-sm">
                  <Award className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-surface-900 dark:text-white">Product Performance</h3>
                  <p className="text-xs text-surface-500 dark:text-surface-400">All products sold by you</p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1.5 rounded-xl text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {metrics.allProductsList.map((p, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl bg-surface-50 dark:bg-surface-900/60 border border-surface-200/70 dark:border-surface-700/60 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-extrabold flex-shrink-0 ${
                        idx === 0
                          ? 'bg-amber-500 text-white shadow-sm'
                          : idx === 1
                          ? 'bg-slate-400 text-white'
                          : 'bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300'
                      }`}
                    >
                      #{idx + 1}
                    </span>
                    <div>
                      <div className="text-xs font-bold text-surface-900 dark:text-white">{p.name}</div>
                      <div className="text-[10px] text-surface-500 dark:text-surface-400">
                        {p.sku} • {p.unitsSold} units
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-extrabold text-amber-600 dark:text-amber-400">{formatCurrency(p.revenue)}</div>
                    <div className="text-[9px] text-surface-400">Revenue</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Route History ─────────────────────────────────────── */}
      {activeModal === 'routes' && metrics && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-t-3xl sm:rounded-2xl max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl">
            <div className="p-5 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
                  <Route className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-surface-900 dark:text-white">Route History</h3>
                  <p className="text-xs text-surface-500 dark:text-surface-400">All routes handled by you</p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1.5 rounded-xl text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {metrics.routesList.map((r) => (
                <div
                  key={r.id}
                  className="p-3.5 rounded-xl bg-surface-50 dark:bg-surface-900/60 border border-surface-200/70 dark:border-surface-700/60 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-xl bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-surface-900 dark:text-white">{r.name}</div>
                      <div className="text-[10px] text-surface-500 dark:text-surface-400">
                        {r.date} • {r.partiesCount} parties
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-extrabold text-surface-900 dark:text-white">{formatCurrency(r.amount)}</div>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                      {r.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Sales & Target Breakdown ─────────────────────────── */}
      {activeModal === 'target' && metrics && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-t-3xl sm:rounded-2xl max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-5 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-sm">
                  <DollarSign className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-surface-900 dark:text-white">Sales & Target Progress</h3>
                  <p className="text-xs text-surface-500 dark:text-surface-400">Monthly breakdown & metrics</p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1.5 rounded-xl text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4">

              {/* Target progress block */}
              <div className="relative overflow-hidden bg-slate-900 text-white rounded-2xl p-5 space-y-3">
                <div className="absolute -top-4 -right-4 h-20 w-20 bg-blue-600/30 rounded-full blur-xl pointer-events-none" />
                <div className="relative">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">Monthly Sales Target</div>
                  <div className="text-2xl font-black">{formatCurrency(metrics.monthlyTarget)}</div>
                </div>
                <div className="h-2.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${progressColor} rounded-full transition-all duration-700`}
                    style={{ width: `${metrics.progressPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-slate-400 font-semibold">
                  <span>Achieved: <span className="text-white font-bold">{formatCurrency(metrics.achievedSales)}</span></span>
                  <span>Progress: <span className={`font-bold ${progressPercent >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>{metrics.progressPercent}%</span></span>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-xl bg-surface-50 dark:bg-surface-900/60 border border-surface-200/70 dark:border-surface-700/60 text-center">
                  <div className="text-[10px] text-surface-500 dark:text-surface-400 font-semibold uppercase mb-1">Total Sales</div>
                  <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{formatCurrency(metrics.totalSales)}</div>
                </div>
                <div className="p-4 rounded-xl bg-surface-50 dark:bg-surface-900/60 border border-surface-200/70 dark:border-surface-700/60 text-center">
                  <div className="text-[10px] text-surface-500 dark:text-surface-400 font-semibold uppercase mb-1">Remaining</div>
                  <div className="text-lg font-extrabold text-amber-600 dark:text-amber-400">{formatCurrency(metrics.remainingTarget)}</div>
                </div>
                <div className="p-4 rounded-xl bg-surface-50 dark:bg-surface-900/60 border border-surface-200/70 dark:border-surface-700/60 text-center">
                  <div className="text-[10px] text-surface-500 dark:text-surface-400 font-semibold uppercase mb-1">Routes Done</div>
                  <div className="text-lg font-extrabold text-blue-600 dark:text-blue-400">{metrics.totalRoutes}</div>
                </div>
                <div className="p-4 rounded-xl bg-surface-50 dark:bg-surface-900/60 border border-surface-200/70 dark:border-surface-700/60 text-center">
                  <div className="text-[10px] text-surface-500 dark:text-surface-400 font-semibold uppercase mb-1">Completion</div>
                  <div className={`text-lg font-extrabold ${progressPercent >= 80 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {metrics.progressPercent}%
                  </div>
                </div>
              </div>

              {/* Motivation Banner */}
              {metrics.progressPercent < 100 && (
                <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-800/40 rounded-xl p-4 flex items-center gap-3">
                  <Sparkles className="h-5 w-5 text-amber-500 flex-shrink-0" />
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    You need{' '}
                    <strong>{formatCurrency(metrics.remainingTarget)}</strong> more to hit your target.{' '}
                    {metrics.progressPercent >= 70 ? "You're almost there! 🎯" : 'Keep pushing! 💪'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
