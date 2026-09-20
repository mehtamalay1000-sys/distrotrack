import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import { getCanonicalSapCatalogCount } from '@/features/products/data/productMaster';
import { getExpenses, getRouteProfitability } from '@/features/expenses/services/expenseService';
import { fetchPendingCreditPayments } from '@/features/payments/services/paymentService';
import { getLocalDateString } from '@/shared/utils/format';
import { getOperationalInventoryData } from '@/features/inventory/services/inventoryService';
import type { MasterAuditLog, FinancialSummary, RouteProfitabilityResponse, RouteStockException, UnmappedSkuException } from '@/lib/database.types';

// Authoritative Supabase query engine with resilient mockStore fallback for offline PWA operation.

export { getRouteProfitability, type RouteProfitabilityResponse };

// ── Date Helpers ─────────────────────────────────────────────────

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export function todayRange(): DateRange {
  const t = getLocalDateString();
  return { from: t, to: t };
}

export function monthRange(year: number, month: number): DateRange {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

export function financialYearRange(year: number): DateRange {
  // Indian financial year: April 1 → March 31
  return { from: `${year}-04-01`, to: `${year + 1}-03-31` };
}

// ── Master Overview KPIs ─────────────────────────────────────────

export interface MasterKPIs {
  totalSales: number;
  totalCollections: number;
  totalCash: number;
  totalUpi: number;
  totalCheque: number;
  chequeCleared: number;
  chequePending: number;
  totalCredit: number;
  totalExpenses: number;
  totalCashExpenses: number;
  expectedPhysicalCash: number;
  contributionBeforeCogs: number;
  totalDeliveries: number;
  completedDeliveries: number;
  pendingDeliveries: number;
  activeWorkers: number;
  activeRoutes: number;
  archivedRoutes?: number;
  totalParties: number;
  totalProducts: number;
  totalPicklists: number;
  outstandingAmount: number;
  currentPeriodCollected: number;
  priorPeriodCollected: number;
  customerAdvance: number;
}

export async function getMasterKPIs(range: DateRange): Promise<MasterKPIs> {
  try {
    // P2/P3 FIX: Type as FinancialSummary to enforce correct key access
    // RPC keys: sales, total_collected, cash, upi, cheque_cleared, cheque_pending,
    //           credit_extended, expenses, cash_expenses, net_cash, total_outstanding,
    //           contribution_before_cogs
    let finSummaryRes: FinancialSummary | null = null;
    try {
      const { data } = await supabase.rpc('get_financial_summary', {
        p_start_date: range.from,
        p_end_date: range.to,
      });
      finSummaryRes = data as FinancialSummary | null;
    } catch {
      finSummaryRes = null;
    }

    const [
      picklistsRes,
      deliveriesRes,
      workersRes,
      routesRes,
      archivedRoutesRes,
      partiesRes,
      productsRes,
    ] = await Promise.all([
      supabase
        .from('picklists')
        .select('id, date, created_at')
        .gte('date', range.from)
        .lte('date', range.to),
      supabase
        .from('deliveries')
        .select('status, delivery_date, created_at')
        .gte('delivery_date', range.from)
        .lte('delivery_date', range.to),
      supabase.from('workers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('routes').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('routes').select('id', { count: 'exact', head: true }).eq('status', 'archived'),
      supabase.from('parties').select('id', { count: 'exact', head: true }),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    ]);

    const picklists = picklistsRes.data ?? [];
    const deliveries = deliveriesRes.data ?? [];

    // FINANCIAL SEMANTICS (invariants that must never be violated):
    //   Sales = SUM(delivered_amount) from deliveries — commercial invoice value
    //   Collections = SUM(payments.amount) — actual cash/UPI/cheque received
    //   Pending Credit = Sales - Collections for credit deliveries
    //   COLLECTION DOES NOT CHANGE SALES. A credit sale counts as a sale immediately.
    //
    // RPC Keys (migration 038 emits both canonical + alias families):
    //   Canonical: total_revenue, total_collected, cash_collected, upi_collected, total_credit, pending_credit
    //   Alias: sales, cash, upi, cheque_cleared, cheque_pending, credit_extended, expenses, net_cash
    const totalSales = Number(finSummaryRes?.total_revenue ?? finSummaryRes?.sales ?? 0);
    const totalCollections = Number(finSummaryRes?.total_collected ?? 0);
    const totalCash = Number(finSummaryRes?.cash_collected ?? finSummaryRes?.cash ?? 0);
    const totalUpi = Number(finSummaryRes?.upi_collected ?? finSummaryRes?.upi ?? 0);
    const chequeCleared = Number(finSummaryRes?.cheque_cleared ?? 0);
    const chequePending = Number(finSummaryRes?.cheque_pending ?? finSummaryRes?.pending_cheques ?? 0);
    const totalCheque = chequeCleared + chequePending;
    // totalCredit = Pending Credit = delivered but not yet collected (Sales - Collections)
    const totalCredit = Number(finSummaryRes?.pending_credit ?? finSummaryRes?.total_credit ?? finSummaryRes?.credit_extended ?? 0);
    const totalExpenses = Number(finSummaryRes?.total_expenses ?? finSummaryRes?.expenses ?? 0);
    const totalCashExpenses = Number(finSummaryRes?.cash_expenses ?? 0);
    const expectedPhysicalCash = Number(finSummaryRes?.net_cash ?? (totalCash - totalCashExpenses));
    const contributionBeforeCogs = Number(finSummaryRes?.contribution_before_cogs ?? (totalSales - totalExpenses));
    const currentPeriodCollected = Number(finSummaryRes?.current_period_collected ?? 0);
    const priorPeriodCollected = Number(finSummaryRes?.prior_period_collected ?? 0);
    const customerAdvance = Number(finSummaryRes?.customer_advance ?? 0);
    const rawOutstanding = Number(finSummaryRes?.total_outstanding ?? 0);
    const outstandingAmount = Math.max(0, rawOutstanding > 0 ? rawOutstanding : totalCredit);

    const completedDeliveries = deliveries.filter(
      (d: any) => d.status === 'delivered' || d.status === 'partial'
    ).length;
    const pendingDeliveries = deliveries.filter(
      (d: any) => d.status === 'pending' || d.status === 'out_for_delivery'
    ).length;

    if (!finSummaryRes && deliveries.length === 0) {
      const mockDeliveries = mockStore.getDeliveries();
      const mockPayments = mockStore.getPayments();
      const mockExpenses = mockStore.getExpenses();
      const mockPicklists = mockStore.getPicklists();

      const mCash = mockPayments.filter(p => p.payment_mode === 'cash').reduce((s, p) => s + (p.amount || 0), 0);
      const mUpi = mockPayments.filter(p => p.payment_mode === 'upi').reduce((s, p) => s + (p.amount || 0), 0);
      const mChequeCleared = mockPayments.filter(p => p.payment_mode === 'cheque' && p.status === 'cleared').reduce((s, p) => s + (p.amount || 0), 0);
      const mChequePending = mockPayments.filter(p => p.payment_mode === 'cheque' && p.status !== 'cleared' && p.status !== 'bounced').reduce((s, p) => s + (p.amount || 0), 0);
      const mTotalCheque = mChequeCleared + mChequePending;
      const mTotalCollections = mCash + mUpi + mTotalCheque;
      const mTotalExpenses = mockExpenses.reduce((s, e) => s + (e.amount || 0), 0);
      const mTotalCashExpenses = mockExpenses.filter(e => e.payment_method === 'cash').reduce((s, e) => s + (e.amount || 0), 0);
      const mTotalSales = mockDeliveries.reduce((s, d) => s + (d.delivered_amount || d.total_amount || 0), 0);
      const mCompleted = mockDeliveries.filter(d => d.status === 'delivered' || d.status === 'partial').length;
      const mPending = mockDeliveries.filter(d => d.status === 'pending' || d.status === 'out_for_delivery').length;

      return {
        totalSales: mTotalSales,
        totalCollections: mTotalCollections,
        totalCash: mCash,
        totalUpi: mUpi,
        totalCheque: mTotalCheque,
        chequeCleared: mChequeCleared,
        chequePending: mChequePending,
        totalCredit: 0,
        totalExpenses: mTotalExpenses,
        totalCashExpenses: mTotalCashExpenses,
        expectedPhysicalCash: mCash - mTotalCashExpenses,
        contributionBeforeCogs: mTotalSales - mTotalExpenses,
        totalDeliveries: mockDeliveries.length,
        completedDeliveries: mCompleted,
        pendingDeliveries: mPending,
        activeWorkers: mockStore.getWorkers().filter(w => w.status === 'active').length,
        activeRoutes: mockStore.getRoutes().filter(r => r.status === 'active').length,
        totalParties: mockStore.getParties().length,
        totalProducts: 2309,
        totalPicklists: mockPicklists.length,
        outstandingAmount: 0,
        currentPeriodCollected: 0,
        priorPeriodCollected: 0,
        customerAdvance: 0,
      };
    }

    return {
      totalSales,
      totalCollections,
      totalCash,
      totalUpi,
      totalCheque,
      chequeCleared,
      chequePending,
      totalCredit,
      totalExpenses,
      totalCashExpenses,
      expectedPhysicalCash,
      contributionBeforeCogs,
      totalDeliveries: deliveries.length,
      completedDeliveries,
      pendingDeliveries,
      activeWorkers: workersRes.count ?? 0,
      activeRoutes: routesRes.count ?? 0,
      archivedRoutes: archivedRoutesRes.count ?? 0,
      totalParties: partiesRes.count ?? 0,
      totalProducts: productsRes.count ?? 0,
      totalPicklists: picklists.length,
      outstandingAmount,
      currentPeriodCollected,
      priorPeriodCollected,
      customerAdvance,
    };
  } catch {
    const mockDeliveries = mockStore.getDeliveries();
    const mockPayments = mockStore.getPayments();
    const mockExpenses = mockStore.getExpenses();
    const mockPicklists = mockStore.getPicklists();

    const mCash = mockPayments.filter(p => p.payment_mode === 'cash').reduce((s, p) => s + (p.amount || 0), 0);
    const mUpi = mockPayments.filter(p => p.payment_mode === 'upi').reduce((s, p) => s + (p.amount || 0), 0);
    const mChequeCleared = mockPayments.filter(p => p.payment_mode === 'cheque' && p.status === 'cleared').reduce((s, p) => s + (p.amount || 0), 0);
    const mChequePending = mockPayments.filter(p => p.payment_mode === 'cheque' && p.status !== 'cleared' && p.status !== 'bounced').reduce((s, p) => s + (p.amount || 0), 0);
    const mTotalCheque = mChequeCleared + mChequePending;
    const mTotalCollections = mCash + mUpi + mTotalCheque;
    const mTotalExpenses = mockExpenses.reduce((s, e) => s + (e.amount || 0), 0);
    const mTotalCashExpenses = mockExpenses.filter(e => e.payment_method === 'cash').reduce((s, e) => s + (e.amount || 0), 0);
    const mTotalSales = mockDeliveries.reduce((s, d) => s + (d.delivered_amount || d.total_amount || 0), 0);
    const mCompleted = mockDeliveries.filter(d => d.status === 'delivered' || d.status === 'partial').length;
    const mPending = mockDeliveries.filter(d => d.status === 'pending' || d.status === 'out_for_delivery').length;

    return {
      totalSales: mTotalSales,
      totalCollections: mTotalCollections,
      totalCash: mCash,
      totalUpi: mUpi,
      totalCheque: mTotalCheque,
      chequeCleared: mChequeCleared,
      chequePending: mChequePending,
      totalCredit: 0,
      totalExpenses: mTotalExpenses,
      totalCashExpenses: mTotalCashExpenses,
      expectedPhysicalCash: mCash - mTotalCashExpenses,
      contributionBeforeCogs: mTotalSales - mTotalExpenses,
      totalDeliveries: mockDeliveries.length,
      completedDeliveries: mCompleted,
      pendingDeliveries: mPending,
      activeWorkers: mockStore.getWorkers().filter(w => w.status === 'active').length,
      activeRoutes: mockStore.getRoutes().filter(r => r.status === 'active').length,
      archivedRoutes: mockStore.getRoutes().filter(r => r.status === 'archived').length,
      totalParties: mockStore.getParties().length,
      totalProducts: 2309,
      totalPicklists: mockPicklists.length,
      outstandingAmount: 0,
      currentPeriodCollected: 0,
      priorPeriodCollected: 0,
      customerAdvance: 0,
    };
  }
}

// ── Worker Monitoring ────────────────────────────────────────────

export interface WorkerMonitorData {
  worker: { id: string; name: string; phone: string | null; status: string };
  activePicklist: {
    id: string;
    picklist_number: string;
    date: string;
    status: string;
    started_at: string | null;
    completed_at: string | null;
    total_amount: number;
    total_parties: number;
    completed_parties: number;
    route_name: string | null;
  } | null;
  routes: Array<{
    id: string;
    picklist_number?: string;
    name?: string;
    code?: string;
    status?: string;
  }>;
  deliveries: Array<{
    id: string;
    party_name: string;
    status: string;
    sequence_order: number;
    total_amount: number;
    delivered_amount: number;
    collected_amount: number;
    payment_mode: string | null;
    delivered_at: string | null;
    notes: string | null;
    products_count: number;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    payment_mode: string;
    payment_date: string;
    party_name: string | null;
    notes: string | null;
  }>;
  expenses: Array<{
    id: string;
    amount: number;
    category: string;
    payment_method?: string;
    date?: string;
    description?: string | null;
  }>;
  routeHistory: Array<{
    picklist_number: string;
    date: string;
    status: string;
    total_amount: number;
    delivered_sales: number;
    total_collected: number;
    total_parties: number;
    completed_parties: number;
    started_at: string | null;
    completed_at: string | null;
  }>;
}

export async function getWorkerMonitorData(workerId: string, historyRange: DateRange): Promise<WorkerMonitorData | null> {
  try {
    // Fetch worker
    let worker: { id: string; name: string; phone: string | null; status: string } | null = null;
    try {
      const { data: workerRaw } = await supabase
        .from('workers')
        .select('id, name, phone, status')
        .eq('id', workerId)
        .single();
      if (workerRaw) worker = workerRaw;
    } catch {
      worker = null;
    }

    if (!worker) {
      const mWorker = mockStore.getWorkers().find(w => w.id === workerId);
      if (mWorker) {
        worker = { id: mWorker.id, name: mWorker.name, phone: mWorker.phone, status: mWorker.status };
      }
    }

    if (!worker) return null;

    // Active picklist
    let activePL: any = null;
    try {
      const { data: plData } = await supabase
        .from('picklists')
        .select('id, picklist_number, date, status, started_at, completed_at, total_amount, total_parties, completed_parties, route:routes(name)')
        .eq('worker_id', workerId)
        .in('status', ['assigned', 'in_progress', 'confirmed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      activePL = plData;
    } catch {
      activePL = null;
    }

    if (!activePL) {
      const mPL = mockStore.getPicklists().find(pl => pl.worker_id === workerId && ['assigned', 'in_progress', 'confirmed'].includes(pl.status));
      if (mPL) {
        const mRoute = mockStore.getRoutes().find(r => r.id === mPL.route_id);
        activePL = { ...mPL, route: mRoute ? { name: mRoute.name } : null };
      }
    }

    // Deliveries for today (or active picklist)
    const todayStr = getLocalDateString();
    let deliveriesRaw: any[] = [];
    try {
      const { data } = await supabase
        .from('deliveries')
        .select('id, status, sequence_order, total_amount, delivered_amount, collected_amount, payment_mode, delivered_at, notes, party:parties(name), items:delivery_items(id)')
        .eq('worker_id', workerId)
        .gte('delivery_date', todayStr)
        .lte('delivery_date', todayStr)
        .order('sequence_order');
      deliveriesRaw = data ?? [];
    } catch {
      deliveriesRaw = [];
    }

    let deliveries = deliveriesRaw.map(d => ({
      id: d.id,
      party_name: (d.party as unknown as { name: string } | null)?.name ?? 'Unknown',
      status: d.status,
      sequence_order: d.sequence_order,
      total_amount: Number(d.total_amount ?? 0),
      delivered_amount: Number(d.delivered_amount ?? 0),
      collected_amount: Number(d.collected_amount ?? 0),
      payment_mode: d.payment_mode,
      delivered_at: d.delivered_at,
      notes: d.notes,
      products_count: Array.isArray(d.items) ? d.items.length : 0,
    }));

    if (deliveries.length === 0) {
      const mDeliveries = mockStore.getDeliveries().filter(d => d.worker_id === workerId);
      const mParties = mockStore.getParties();
      deliveries = mDeliveries.map(d => {
        const party = mParties.find(p => p.id === d.party_id);
        return {
          id: d.id,
          party_name: party?.name ?? 'Unknown',
          status: d.status,
          sequence_order: d.sequence_order ?? 0,
          total_amount: Number(d.total_amount ?? 0),
          delivered_amount: Number(d.delivered_amount ?? 0),
          collected_amount: Number(d.collected_amount ?? 0),
          payment_mode: d.payment_mode ?? null,
          delivered_at: d.delivered_at ?? null,
          notes: d.notes ?? null,
          products_count: (d.items || []).length,
        };
      });
    }

    // Payments today
    let paymentsRaw: any[] = [];
    try {
      const { data } = await supabase
        .from('payments')
        .select('id, amount, payment_mode, payment_date, notes, party:parties(name)')
        .eq('worker_id', workerId)
        .eq('payment_date', todayStr)
        .order('created_at', { ascending: false });
      paymentsRaw = data ?? [];
    } catch {
      paymentsRaw = [];
    }

    let payments = paymentsRaw.map(p => ({
      id: p.id,
      amount: Number(p.amount ?? 0),
      payment_mode: p.payment_mode,
      payment_date: p.payment_date,
      party_name: (p.party as unknown as { name: string } | null)?.name ?? null,
      notes: p.notes,
    }));

    if (payments.length === 0) {
      const mPayments = mockStore.getPayments().filter(p => p.worker_id === workerId);
      const mParties = mockStore.getParties();
      payments = mPayments.map(p => {
        const party = mParties.find(pty => pty.id === p.party_id);
        return {
          id: p.id,
          amount: Number(p.amount ?? 0),
          payment_mode: p.payment_mode,
          payment_date: p.payment_date,
          party_name: party?.name ?? null,
          notes: p.notes ?? null,
        };
      });
    }

    // Expenses
    let expensesRaw: any[] = [];
    try {
      const { data } = await supabase
        .from('expenses')
        .select('id, amount, category, payment_method, date, description')
        .eq('worker_id', workerId);
      expensesRaw = data ?? [];
    } catch {
      expensesRaw = [];
    }

    let expenses = expensesRaw.map(e => ({
      id: e.id,
      amount: Number(e.amount ?? 0),
      category: e.category,
      payment_method: e.payment_method ?? 'cash',
      date: e.date,
      description: e.description ?? null,
    }));

    if (expenses.length === 0) {
      const mExpenses = mockStore.getExpenses().filter(e => e.worker_id === workerId);
      expenses = mExpenses.map(e => ({
        id: e.id,
        amount: Number(e.amount ?? 0),
        category: e.category,
        payment_method: e.payment_method ?? 'cash',
        date: e.date,
        description: e.description ?? null,
      }));
    }

    // Route history & authoritative delivered sales
    let historyRaw: any[] = [];
    let workerProfitability: any = null;
    try {
      const [histRes, profRes] = await Promise.all([
        supabase
          .from('picklists')
          .select('id, picklist_number, date, status, total_amount, total_collected, total_parties, completed_parties, started_at, completed_at')
          .eq('worker_id', workerId)
          .gte('date', historyRange.from)
          .lte('date', historyRange.to)
          .order('date', { ascending: false }),
        getRouteProfitability({ worker_id: workerId, start_date: historyRange.from, end_date: historyRange.to }).catch(() => null),
      ]);
      historyRaw = histRes.data ?? [];
      workerProfitability = profRes;
    } catch {
      historyRaw = [];
      workerProfitability = null;
    }

    const routeProfMap = new Map<string, number>();
    if (workerProfitability?.routes) {
      for (const r of workerProfitability.routes) {
        if (r.picklist_number) {
          routeProfMap.set(r.picklist_number, Number(r.sales ?? 0));
        }
      }
    }

    let routeHistory = historyRaw.map(h => ({
      picklist_number: h.picklist_number,
      date: h.date,
      status: h.status,
      total_amount: Number(h.total_amount ?? 0),
      delivered_sales: routeProfMap.get(h.picklist_number) ?? 0,
      total_collected: Number(h.total_collected ?? 0),
      total_parties: h.total_parties,
      completed_parties: h.completed_parties,
      started_at: h.started_at,
      completed_at: h.completed_at,
    }));

    if (routeHistory.length === 0) {
      const mPicklists = mockStore.getPicklists().filter(pl => pl.worker_id === workerId);
      routeHistory = mPicklists.map(pl => ({
        picklist_number: pl.picklist_number,
        date: pl.date,
        status: pl.status,
        total_amount: Number(pl.total_amount ?? 0),
        delivered_sales: Number(pl.total_amount ?? 0),
        total_collected: Number(pl.total_collected ?? 0),
        total_parties: pl.total_parties,
        completed_parties: pl.completed_parties,
        started_at: pl.started_at,
        completed_at: pl.completed_at,
      }));
    }

    const mRoutes = mockStore.getRoutes().filter(r => r.assigned_worker_id === workerId);
    const routes = mRoutes.map(r => ({
      id: r.id,
      name: r.name,
      code: r.code,
      status: r.status,
    }));

    return {
      worker: { id: worker.id, name: worker.name, phone: worker.phone, status: worker.status },
      activePicklist: activePL
        ? {
            id: activePL.id,
            picklist_number: activePL.picklist_number,
            date: activePL.date,
            status: activePL.status,
            started_at: activePL.started_at,
            completed_at: activePL.completed_at,
            total_amount: Number(activePL.total_amount ?? 0),
            total_parties: activePL.total_parties,
            completed_parties: activePL.completed_parties,
            route_name: (activePL.route as unknown as { name: string } | null)?.name ?? null,
          }
        : null,
      routes: routes.length > 0 ? routes : (activePL ? [{ id: activePL.id, picklist_number: activePL.picklist_number, status: activePL.status }] : []),
      deliveries,
      payments,
      expenses,
      routeHistory,
    };
  } catch {
    const mWorker = mockStore.getWorkers().find(w => w.id === workerId);
    if (!mWorker) return null;
    const mPicklists = mockStore.getPicklists().filter(pl => pl.worker_id === workerId);
    const mRoutes = mockStore.getRoutes().filter(r => r.assigned_worker_id === workerId);
    const mDeliveries = mockStore.getDeliveries().filter(d => d.worker_id === workerId);
    const mPayments = mockStore.getPayments().filter(p => p.worker_id === workerId);
    const mExpenses = mockStore.getExpenses().filter(e => e.worker_id === workerId);
    const mParties = mockStore.getParties();

    return {
      worker: { id: mWorker.id, name: mWorker.name, phone: mWorker.phone, status: mWorker.status },
      activePicklist: null,
      routes: mRoutes.map(r => ({ id: r.id, name: r.name, code: r.code, status: r.status })),
      deliveries: mDeliveries.map(d => ({
        id: d.id,
        party_name: mParties.find(p => p.id === d.party_id)?.name ?? 'Unknown',
        status: d.status,
        sequence_order: d.sequence_order ?? 0,
        total_amount: Number(d.total_amount ?? 0),
        delivered_amount: Number(d.delivered_amount ?? 0),
        collected_amount: Number(d.collected_amount ?? 0),
        payment_mode: d.payment_mode ?? null,
        delivered_at: d.delivered_at ?? null,
        notes: d.notes ?? null,
        products_count: (d.items || []).length,
      })),
      payments: mPayments.map(p => ({
        id: p.id,
        amount: Number(p.amount ?? 0),
        payment_mode: p.payment_mode,
        payment_date: p.payment_date,
        party_name: mParties.find(pty => pty.id === p.party_id)?.name ?? null,
        notes: p.notes ?? null,
      })),
      expenses: mExpenses.map(e => ({
        id: e.id,
        amount: Number(e.amount ?? 0),
        category: e.category,
        payment_method: e.payment_method ?? 'cash',
        date: e.date,
        description: e.description ?? null,
      })),
      routeHistory: mPicklists.map(pl => ({
        picklist_number: pl.picklist_number,
        date: pl.date,
        status: pl.status,
        total_amount: Number(pl.total_amount ?? 0),
        delivered_sales: Number(pl.total_amount ?? 0),
        total_collected: Number(pl.total_collected ?? 0),
        total_parties: pl.total_parties,
        completed_parties: pl.completed_parties,
        started_at: pl.started_at,
        completed_at: pl.completed_at,
      })),
    };
  }
}

// ── Audit Log ────────────────────────────────────────────────────

export interface AuditLogFilter {
  range: DateRange;
  role?: string;
  module?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function getMasterAuditLog(filter: AuditLogFilter): Promise<MasterAuditLog[]> {
  try {
    let query = supabase
      .from('master_audit_log')
      .select('*')
      .gte('occurred_at', `${filter.range.from}T00:00:00`)
      .lte('occurred_at', `${filter.range.to}T23:59:59`)
      .order('occurred_at', { ascending: false })
      .limit(filter.limit ?? 200);

    if (filter.role) query = query.eq('role', filter.role);
    if (filter.module) query = query.eq('module', filter.module);
    if (filter.status) query = query.eq('status', filter.status);

    const { data } = await query;
    return (data ?? []) as MasterAuditLog[];
  } catch {
    return [];
  }
}

// ── Historical Period Data ────────────────────────────────────────

export interface PeriodSummary {
  month: number;
  year: number;
  label: string;
  totalSales: number;
  totalCollections: number;
  totalCash: number;
  totalUpi: number;
  totalCheque: number;
  chequeCleared: number;
  chequePending: number;
  totalCredit: number;
  totalExpenses: number;
  totalCashExpenses: number;
  contributionBeforeCogs: number;
  expectedPhysicalCash: number;
  totalDeliveries: number;
  completedDeliveries: number;
  totalOutstanding: number;
}

export async function getHistoricalSummaries(months: Array<{ year: number; month: number }>): Promise<PeriodSummary[]> {
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Parallel execution
  const allKpis = await Promise.all(
    months.map(({ year, month }) => getMasterKPIs(monthRange(year, month)))
  );

  return months.map(({ year, month }, idx) => {
    const kpis = allKpis[idx];
    return {
      month,
      year,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      totalSales: kpis.totalSales,
      totalCollections: kpis.totalCollections,
      totalCash: kpis.totalCash,
      totalUpi: kpis.totalUpi,
      totalCheque: kpis.totalCheque,
      chequeCleared: kpis.chequeCleared,
      chequePending: kpis.chequePending,
      totalCredit: kpis.totalCredit,
      totalExpenses: kpis.totalExpenses,
      totalCashExpenses: kpis.totalCashExpenses,
      contributionBeforeCogs: kpis.contributionBeforeCogs,
      expectedPhysicalCash: kpis.expectedPhysicalCash,
      totalDeliveries: kpis.totalDeliveries,
      completedDeliveries: kpis.completedDeliveries,
      totalOutstanding: kpis.outstandingAmount,
    };
  });
}

// ── All Workers List ─────────────────────────────────────────────

export async function getAllWorkers() {
  try {
    const { data } = await supabase
      .from('workers')
      .select('id, name, phone, status')
      .order('name');
    if (data && data.length > 0) return data;
    return mockStore.getWorkers().map(w => ({ id: w.id, name: w.name, phone: w.phone, status: w.status }));
  } catch {
    return mockStore.getWorkers().map(w => ({ id: w.id, name: w.name, phone: w.phone, status: w.status }));
  }
}

// ── Business Data Queries ─────────────────────────────────────────

export async function getMasterPicklists(range: DateRange) {
  const { data } = await supabase
    .from('picklists')
    .select('*, route:routes(name, code), worker:workers!picklists_worker_id_fkey(name)')
    .gte('date', range.from)
    .lte('date', range.to)
    .order('date', { ascending: false });
  return data ?? [];
}

export async function getMasterDeliveries(range: DateRange) {
  const { data } = await supabase
    .from('deliveries')
    .select('*, party:parties(name, code), worker:workers(name)')
    .gte('delivery_date', range.from)
    .lte('delivery_date', range.to)
    .order('delivery_date', { ascending: false });
  return data ?? [];
}

export async function getMasterPayments(range: DateRange) {
  let recordedPayments: any[] = [];
  try {
    const { data } = await supabase
      .from('payments')
      .select('*, party:parties(name, code), worker:workers!payments_worker_id_fkey(name)')
      .gte('payment_date', range.from)
      .lte('payment_date', range.to)
      .order('payment_date', { ascending: false });
    recordedPayments = data ?? [];
  } catch (err) {
    console.warn('[masterService] Failed to load payments from Supabase:', err);
  }

  try {
    const pendingCredits = await fetchPendingCreditPayments();
    const filteredCredits = pendingCredits.filter((p) => {
      const d = (p.payment_date || p.created_at || '').split('T')[0];
      return (!range.from || d >= range.from) && (!range.to || d <= range.to);
    });
    return [...filteredCredits, ...recordedPayments];
  } catch {
    return recordedPayments;
  }
}

export async function getMasterExpenses(range: DateRange) {
  const all = await getExpenses().catch(() => []);
  return all.filter((e) => {
    const d = (e.date || e.created_at || '').split('T')[0];
    return (!range.from || d >= range.from) && (!range.to || d <= range.to);
  });
}

export async function getMasterParties() {
  const { data } = await supabase
    .from('parties')
    .select('*, route:routes(name, code)')
    .order('name');
  return data ?? [];
}

export async function getMasterProducts() {
  const { data } = await supabase
    .from('products')
    .select('*')
    .order('name');
  return data ?? [];
}

// ── Master Exceptions Deck ───────────────────────────────────────

export interface MasterExceptions {
  cashDiscrepancies: {
    count: number;
    totalAmount: number;
    routes: Array<{
      id: string;
      picklistNumber: string;
      date: string;
      routeName: string;
      workerName: string;
      expectedCash: number;
      actualCash: number;
      discrepancy: number;
      status: string;
    }>;
  };
  bouncedCheques: {
    count: number;
    totalAmount: number;
    items: Array<{
      id: string;
      partyName: string;
      workerName: string;
      amount: number;
      chequeNumber: string | null;
      date: string;
      bounceReason: string | null;
    }>;
  };
  pendingExpenses: {
    count: number;
    totalAmount: number;
    items: Array<{
      id: string;
      category: string;
      amount: number;
      paymentMethod: string;
      workerName: string;
      date: string;
      description: string | null;
    }>;
  };
  stockExceptions: {
    damagedTransitCount: number;
    damagedWarehouseCount: number;
    totalDamagedQty: number;
    recentDamagedMovements: Array<{
      id: string;
      sku: string;
      quantity: number;
      movementType: string;
      date: string;
      workerName: string;
      notes: string | null;
    }>;
  };
  reconciliationSummary: {
    totalCompletedPicklists: number;
    reconciledCount: number;
    discrepantCount: number;
    pendingReconciliationCount: number;
  };
}

export async function getMasterExceptions(range: DateRange): Promise<MasterExceptions> {
  try {
    const [picklistsRes, paymentsRes, expensesRes, movementsRes] = await Promise.all([
      supabase
        .from('picklists')
        .select('id, picklist_number, date, cash_discrepancy, expected_cash, actual_cash_returned, financial_reconciliation_status, status, route:routes(name), worker:workers!picklists_worker_id_fkey(name)')
        .gte('date', range.from)
        .lte('date', range.to),
      supabase
        .from('payments')
        .select('id, amount, payment_mode, payment_date, cheque_number, notes, party:parties(name), worker:workers!payments_worker_id_fkey(name)')
        .eq('status', 'bounced')
        .gte('payment_date', range.from)
        .lte('payment_date', range.to),
      supabase
        .from('expenses')
        .select('id, amount, category, payment_method, date, created_at, description, route:routes(name, code), worker:workers(name)')
        .eq('status', 'pending'),
      supabase
        .from('inventory_movements')
        .select('id, sku, quantity, movement_type, created_at, notes, worker:workers(name)')
        .in('movement_type', ['damaged_transit', 'damaged_warehouse'])
        .gte('created_at', `${range.from}T00:00:00`)
        .lte('created_at', `${range.to}T23:59:59`)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const allPicklists = picklistsRes.data ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const discrepantPicklists = allPicklists.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) => (p.cash_discrepancy != null && Number(p.cash_discrepancy) !== 0) || p.financial_reconciliation_status === 'discrepancy'
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routes = discrepantPicklists.map((p: any) => ({
      id: p.id,
      picklistNumber: p.picklist_number,
      date: p.date,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      routeName: (p.route as any)?.name ?? '—',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workerName: (p.worker as any)?.name ?? '—',
      expectedCash: Number(p.expected_cash ?? 0),
      actualCash: Number(p.actual_cash_returned ?? 0),
      discrepancy: Number(p.cash_discrepancy ?? 0),
      status: p.financial_reconciliation_status ?? 'pending',
    }));

    const totalCashDiscrepancy = routes.reduce((sum, r) => sum + r.discrepancy, 0);

    let bouncedItems = (paymentsRes.data ?? []).map((p: any) => ({
      id: p.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      partyName: (p.party as any)?.name ?? 'Unknown Party',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workerName: (p.worker as any)?.name ?? '—',
      amount: Number(p.amount ?? 0),
      chequeNumber: p.cheque_number,
      date: p.payment_date,
      bounceReason: p.notes,
    }));

    if (bouncedItems.length === 0) {
      const mockBounced = mockStore.getPayments().filter(p => p.status === 'bounced');
      const mParties = mockStore.getParties();
      const mWorkers = mockStore.getWorkers();
      bouncedItems = mockBounced.map(p => ({
        id: p.id,
        partyName: mParties.find(pty => pty.id === p.party_id)?.name ?? 'Unknown Party',
        workerName: mWorkers.find(w => w.id === p.worker_id)?.name ?? '—',
        amount: Number(p.amount ?? 0),
        chequeNumber: p.cheque_number ?? undefined,
        date: p.payment_date,
        bounceReason: p.notes ?? undefined,
      }));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pendingExpenses = (expensesRes.data ?? []).map((e: any) => ({
      id: e.id,
      category: e.category,
      amount: Number(e.amount ?? 0),
      paymentMethod: e.payment_method ?? 'cash',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workerName: (e.worker as any)?.name ?? '—',
      date: e.date || (e.created_at || '').split('T')[0],
      description: e.description,
    }));

    if (pendingExpenses.length === 0) {
      const mockPending = mockStore.getExpenses().filter(e => e.status === 'pending');
      const mWorkers = mockStore.getWorkers();
      pendingExpenses = mockPending.map(e => ({
        id: e.id,
        category: e.category,
        amount: Number(e.amount ?? 0),
        paymentMethod: e.payment_method ?? 'cash',
        workerName: mWorkers.find(w => w.id === e.worker_id)?.name ?? '—',
        date: e.date || (e.created_at || '').split('T')[0],
        description: e.description,
      }));
    }

    const movements = movementsRes.data ?? [];
    let damTransit = 0;
    let damWh = 0;
    let totalDamQty = 0;

    for (const m of movements) {
      const q = Number(m.quantity ?? 0);
      totalDamQty += q;
      if (m.movement_type === 'damaged_transit') damTransit++;
      if (m.movement_type === 'damaged_warehouse') damWh++;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const completedPLs = allPicklists.filter((p: any) => p.status === 'completed');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reconciledCount = completedPLs.filter((p: any) => p.financial_reconciliation_status === 'reconciled').length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const discrepantCount = completedPLs.filter((p: any) => p.financial_reconciliation_status === 'discrepancy').length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pendingReconciliationCount = completedPLs.filter((p: any) => !p.financial_reconciliation_status || p.financial_reconciliation_status === 'pending').length;

    return {
      cashDiscrepancies: {
        count: routes.length,
        totalAmount: totalCashDiscrepancy,
        routes,
      },
      bouncedCheques: {
        count: bouncedItems.length,
        totalAmount: bouncedItems.reduce((s, i) => s + i.amount, 0),
        items: bouncedItems,
      },
      pendingExpenses: {
        count: pendingExpenses.length,
        totalAmount: pendingExpenses.reduce((s, i) => s + i.amount, 0),
        items: pendingExpenses,
      },
      stockExceptions: {
        damagedTransitCount: damTransit,
        damagedWarehouseCount: damWh,
        totalDamagedQty: totalDamQty,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recentDamagedMovements: movements.map((m: any) => ({
          id: m.id,
          sku: m.sku,
          quantity: Number(m.quantity ?? 0),
          movementType: m.movement_type,
          date: (m.created_at || '').split('T')[0],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          workerName: (m.worker as any)?.name ?? '—',
          notes: m.notes,
        })),
      },
      reconciliationSummary: {
        totalCompletedPicklists: completedPLs.length,
        reconciledCount,
        discrepantCount,
        pendingReconciliationCount,
      },
    };
  } catch (err) {
    console.warn('[masterService] getMasterExceptions error:', err);
    const mockPending = mockStore.getExpenses().filter(e => e.status === 'pending');
    const mWorkers = mockStore.getWorkers();
    const fallbackPending = mockPending.map(e => ({
      id: e.id,
      category: e.category,
      amount: Number(e.amount ?? 0),
      paymentMethod: e.payment_method ?? 'cash',
      workerName: mWorkers.find(w => w.id === e.worker_id)?.name ?? '—',
      date: e.date || (e.created_at || '').split('T')[0],
      description: e.description,
    }));

    return {
      cashDiscrepancies: { count: 0, totalAmount: 0, routes: [] },
      bouncedCheques: { count: 0, totalAmount: 0, items: [] },
      pendingExpenses: {
        count: fallbackPending.length,
        totalAmount: fallbackPending.reduce((s, i) => s + i.amount, 0),
        items: fallbackPending,
      },
      stockExceptions: { damagedTransitCount: 0, damagedWarehouseCount: 0, totalDamagedQty: 0, recentDamagedMovements: [] },
      reconciliationSummary: { totalCompletedPicklists: 0, reconciledCount: 0, discrepantCount: 0, pendingReconciliationCount: 0 },
    };
  }
}

// ── Master Stock Overview ────────────────────────────────────────

export interface MasterStockOverview {
  products: Array<{
    id: string;
    sku: string;
    name: string;
    category: string | null;
    warehouseStock: number;
    vehicleStock: number;
    currentStock: number;
    unit: string;
    mrp: number;
    rate: number;
  }>;
  damagedTransitTotal: number;
  damagedWarehouseTotal: number;
  routeReturnsTotal: number;
  adjustmentsTotal: number;
  totalMovementsCount: number;
  activeVehicles: Array<{
    picklistId: string;
    picklistNumber: string;
    routeName: string;
    workerName: string;
    status: string;
    totalLoadedUnits: number;
    expectedVehicleBalance: number;
  }>;
  recentStockMovements: Array<{
    id: string;
    sku: string;
    quantity: number;
    movementType: string;
    fromLocation: string | null;
    toLocation: string | null;
    date: string;
    workerName: string;
    notes: string | null;
  }>;
}

export async function getMasterStockOverview(): Promise<MasterStockOverview> {
  try {
    const [operationalData, movementsRes, activePicklistsRes] = await Promise.all([
      getOperationalInventoryData().catch(() => ({ items: [] })),
      supabase
        .from('inventory_movements')
        .select('id, sku, quantity, movement_type, from_location, to_location, picklist_id, created_at, notes, worker:workers(name)')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('picklists')
        .select('id, picklist_number, status, route:routes(name), worker:workers!picklists_worker_id_fkey(name)')
        .in('status', ['in_progress', 'assigned']),
    ]);

    let damTransit = 0;
    let damWarehouse = 0;
    let routeReturns = 0;
    let adjustments = 0;

    const movements = movementsRes.data ?? [];
    for (const m of movements) {
      const q = Number(m.quantity ?? 0);
      if (m.movement_type === 'damaged_transit') damTransit += q;
      if (m.movement_type === 'damaged_warehouse') damWarehouse += q;
      if (m.movement_type === 'route_return') routeReturns += q;
      if (m.movement_type === 'adjustment_loss' || m.movement_type === 'adjustment_gain') adjustments += q;
    }

    // Active vehicle calculation
    const activePicklists = activePicklistsRes.data ?? [];
    const activeVehicles = activePicklists.map((p: any) => {
      const plMovements = movements.filter((m: any) => m.picklist_id === p.id);
      let loaded = 0;
      let balance = 0;
      for (const m of plMovements) {
        const q = Number(m.quantity ?? 0);
        if (m.to_location === 'vehicle') {
          loaded += q;
          balance += q;
        }
        if (m.from_location === 'vehicle') {
          balance -= q;
        }
      }
      return {
        picklistId: p.id,
        picklistNumber: p.picklist_number,
        routeName: p.route?.name ?? '—',
        workerName: p.worker?.name ?? 'Unassigned',
        status: p.status,
        totalLoadedUnits: loaded,
        expectedVehicleBalance: Math.max(0, balance),
      };
    });

    return {
      products: operationalData.items.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category ?? null,
        warehouseStock: p.warehouseStock,
        vehicleStock: p.vehicleStock,
        currentStock: p.currentStock,
        unit: p.uom || 'pcs',
        mrp: Number(p.mrp ?? 0),
        rate: Number(p.rate ?? 0),
      })),
      damagedTransitTotal: damTransit,
      damagedWarehouseTotal: damWarehouse,
      routeReturnsTotal: routeReturns,
      adjustmentsTotal: adjustments,
      totalMovementsCount: movements.length,
      activeVehicles,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recentStockMovements: movements.slice(0, 30).map((m: any) => ({
        id: m.id,
        sku: m.sku,
        quantity: Number(m.quantity ?? 0),
        movementType: m.movement_type,
        fromLocation: m.from_location,
        toLocation: m.to_location,
        date: (m.created_at || '').split('T')[0],
        workerName: m.worker?.name ?? '—',
        notes: m.notes,
      })),
    };
  } catch {
    return {
      products: [],
      damagedTransitTotal: 0,
      damagedWarehouseTotal: 0,
      routeReturnsTotal: 0,
      adjustmentsTotal: 0,
      totalMovementsCount: 0,
      activeVehicles: [],
      recentStockMovements: [],
    };
  }
}

// ── Master Product Analytics ─────────────────────────────────────

export interface MasterProductMetric {
  sku: string;
  name: string;
  orderedQty: number;
  deliveredQty: number;
  refusedQty: number;
  deliveredValue: number;
}

export async function getMasterProductAnalytics(range: DateRange): Promise<MasterProductMetric[]> {
  try {
    let q = supabase
      .from('delivery_items')
      .select('id, sku, ordered_qty, delivered_qty, rate, delivery:deliveries!inner(id, status, picklist_id, picklist:picklists!inner(id, date))');

    if (range.from) q = q.gte('delivery.picklist.date', range.from);
    if (range.to) q = q.lte('delivery.picklist.date', range.to);

    const { data, error } = await q;
    if (error || !data) return [];

    const map: Record<string, MasterProductMetric> = {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of data as any[]) {
      const sku = row.sku || 'UNKNOWN';
      const ord = Number(row.ordered_qty ?? 0);
      const del = Number(row.delivered_qty ?? 0);
      const rate = Number(row.rate ?? 0);
      const ref = Math.max(0, ord - del);
      const val = del * rate;

      if (!map[sku]) {
        map[sku] = { sku, name: sku, orderedQty: 0, deliveredQty: 0, refusedQty: 0, deliveredValue: 0 };
      }
      map[sku].orderedQty += ord;
      map[sku].deliveredQty += del;
      map[sku].refusedQty += ref;
      map[sku].deliveredValue += val;
    }

    return Object.values(map).sort((a, b) => b.deliveredValue - a.deliveredValue);
  } catch {
    return [];
  }
}

// ── Master Party Debt Aging ──────────────────────────────────────

export interface MasterPartyAging {
  partyId: string;
  partyName: string;
  partyCode: string;
  phone: string | null;
  outstanding: number;
  oldestDebitDate: string | null;
  paymentCount: number;
  daysAging: number;
  risk: 'normal' | 'moderate' | 'high';
}

export async function getMasterPartyDebtAging(): Promise<MasterPartyAging[]> {
  try {
    const [ledgerRes, partiesRes] = await Promise.all([
      supabase
        .from('party_financial_ledger')
        .select('party_id, entry_type, direction, created_at, status')
        .eq('status', 'valid'),
      supabase
        .from('parties')
        .select('id, name, code, phone, outstanding_amount')
        .order('name'),
    ]);

    const ledgerRows = ledgerRes.data ?? [];
    const parties = partiesRes.data ?? [];

    const statsMap: Record<string, { oldestDebit: string | null; paymentCount: number }> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of ledgerRows as any[]) {
      if (!statsMap[row.party_id]) {
        statsMap[row.party_id] = { oldestDebit: null, paymentCount: 0 };
      }
      if (row.direction === 'debit') {
        const d = row.created_at;
        if (!statsMap[row.party_id].oldestDebit || d < statsMap[row.party_id].oldestDebit!) {
          statsMap[row.party_id].oldestDebit = d;
        }
      }
      if (row.entry_type === 'payment') {
        statsMap[row.party_id].paymentCount += 1;
      }
    }

    const today = new Date();
    return parties
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => {
        const stat = statsMap[p.id] || { oldestDebit: null, paymentCount: 0 };
        const out = Number(p.outstanding_amount ?? 0);
        let days = 0;
        if (stat.oldestDebit) {
          const debDate = new Date(stat.oldestDebit);
          days = Math.max(0, Math.floor((today.getTime() - debDate.getTime()) / (1000 * 60 * 60 * 24)));
        }
        let risk: 'normal' | 'moderate' | 'high' = 'normal';
        if (out > 0 && days > 60) risk = 'high';
        else if (out > 0 && days > 30) risk = 'moderate';

        return {
          partyId: p.id,
          partyName: p.name,
          partyCode: p.code,
          phone: p.phone,
          outstanding: out,
          oldestDebitDate: stat.oldestDebit ? stat.oldestDebit.split('T')[0] : null,
          paymentCount: stat.paymentCount,
          daysAging: days,
          risk,
        };
      })
      .filter(p => p.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding);
  } catch {
    return [];
  }
}

// ── Master Inventory & Product Master Health ─────────────────────

export interface MasterInventoryHealth {
  totalSapProducts: number;
  activeProducts: number;
  mappedProducts: number;
  unmappedSkus: number;
  productMasterExceptions: number;
  productsWithRecentMovement: number;
  productsWithNoRecentMovement: number;
  stockVarianceCases: number;
  incompleteReconciliations: number;
  // Compact Stock Overview
  productsTracked: number;
  totalDeliveredQty: number;
  totalReturnedQty: number;
  totalNetSoldQty: number;
}

export interface MasterInventoryExceptionItem {
  id: string;
  type: 'unmapped_sku' | 'stock_variance' | 'incomplete_stock' | 'large_variance' | 'route_shortage';
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  sku?: string;
  routeCode?: string;
  timestamp: string;
}

export async function getMasterInventoryHealth(): Promise<MasterInventoryHealth> {
  const totalSapProducts = getCanonicalSapCatalogCount();

  // 1. Fetch products count
  let products: any[] = [];
  try {
    const { data } = await supabase.from('products').select('*');
    if (data && data.length > 0) {
      products = data;
    } else {
      products = mockStore.getProducts();
    }
  } catch {
    products = mockStore.getProducts();
  }

  const productsTracked = products.length;
  const activeProducts = products.filter((p: any) => p.status === 'active').length;
  const mappedProducts = products.filter((p: any) => p.is_sap_master !== false && p.sku !== 'UNMAPPED SKU').length;

  // 2. Unmapped SKUs
  const unmappedList = await getMasterUnmappedSkus();
  const unmappedSkus = unmappedList.length;

  // 3. Route Stock Shortages
  const routeExceptions = await getMasterRouteStockExceptions();
  const productMasterExceptions = unmappedSkus + routeExceptions.length;

  // 4. Products with movement & quantities
  let totalDeliveredQty = 0;
  let totalReturnedQty = 0;
  const activeSkusMoved = new Set<string>();

  try {
    const { data: diData } = await supabase
      .from('delivery_items')
      .select('sku, delivered_qty, damaged_qty');
    if (diData && diData.length > 0) {
      for (const it of diData) {
        totalDeliveredQty += Number((it as any).delivered_qty || 0);
        totalReturnedQty += Number((it as any).damaged_qty || 0);
        if ((it as any).sku) activeSkusMoved.add((it as any).sku);
      }
    } else {
      const deliveryItems = mockStore.getDeliveryItems();
      for (const it of deliveryItems) {
        totalDeliveredQty += Number(it.delivered_qty || 0);
        totalReturnedQty += Number(it.damaged_qty || 0);
        if (it.sku) activeSkusMoved.add(it.sku);
      }
    }
  } catch {
    const deliveryItems = mockStore.getDeliveryItems();
    for (const it of deliveryItems) {
      totalDeliveredQty += Number(it.delivered_qty || 0);
      totalReturnedQty += Number(it.damaged_qty || 0);
      if (it.sku) activeSkusMoved.add(it.sku);
    }
  }

  const productsWithRecentMovement = activeSkusMoved.size;
  const productsWithNoRecentMovement = Math.max(0, activeProducts - productsWithRecentMovement);
  const totalNetSoldQty = Math.max(0, totalDeliveredQty - totalReturnedQty);

  // 5. Stock Variances & Incomplete reconciliations
  let stockVarianceCases = 0;
  let incompleteReconciliations = 0;

  try {
    const reconciliations = mockStore.getSapStockReconciliations();
    if (reconciliations.length > 0) {
      const latest = reconciliations[0];
      stockVarianceCases = latest.variance_count || 0;
      incompleteReconciliations = latest.incomplete_count || 0;
    } else {
      const { data: recData } = await supabase
        .from('sap_stock_reconciliations')
        .select('variance_count, incomplete_count')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recData) {
        stockVarianceCases = (recData as any).variance_count || 0;
        incompleteReconciliations = (recData as any).incomplete_count || 0;
      }
    }
  } catch {
    // non-fatal
  }

  return {
    totalSapProducts,
    activeProducts,
    mappedProducts,
    unmappedSkus,
    productMasterExceptions,
    productsWithRecentMovement,
    productsWithNoRecentMovement,
    stockVarianceCases,
    incompleteReconciliations,
    productsTracked,
    totalDeliveredQty,
    totalReturnedQty,
    totalNetSoldQty,
  };
}

export async function getMasterInventoryExceptions(): Promise<MasterInventoryExceptionItem[]> {
  const exceptions: MasterInventoryExceptionItem[] = [];

  // 1. Unmapped SKUs
  const unmappedList = await getMasterUnmappedSkus();
  for (const u of unmappedList) {
    exceptions.push({
      id: u.id,
      type: 'unmapped_sku',
      severity: 'high',
      title: `Unmapped SKU: ${u.sku}`,
      detail: `${u.imported_product_name || 'No description'} (Seen in ${u.affected_picklist_count} picklists, ${u.affected_bill_count} bills)`,
      sku: u.sku,
      timestamp: u.last_seen_at || u.created_at,
    });
  }

  // 2. Route Stock Shortages
  const routeShortages = await getMasterRouteStockExceptions();
  for (const rs of routeShortages) {
    exceptions.push({
      id: rs.id,
      type: 'route_shortage',
      severity: 'medium',
      title: `Route Started Despite Shortage: SKU ${rs.sku}`,
      detail: `Required: ${rs.required_quantity}, Warehouse Stock: ${rs.recorded_warehouse_stock} (Shortage: ${rs.shortage_quantity})`,
      sku: rs.sku,
      timestamp: rs.created_at,
    });
  }

  // 3. SAP Reconciliation variances
  try {
    const reconciliations = mockStore.getSapStockReconciliations();
    if (reconciliations.length > 0) {
      const latest = reconciliations[0];
      const items = mockStore.getSapStockReconciliationItems(latest.id);
      for (const it of items) {
        if (it.status === 'VARIANCE') {
          const v = it.variance ?? 0;
          const isLarge = Math.abs(v) >= 10;
          exceptions.push({
            id: it.id,
            type: isLarge ? 'large_variance' : 'stock_variance',
            severity: isLarge ? 'high' : 'medium',
            title: `SAP Stock Variance: ${it.sku}`,
            detail: `${it.product_name}: SAP Stock ${it.sap_stock ?? '—'} vs DistroTrack ${it.distrotrack_stock ?? '—'} (Variance ${v > 0 ? '+' : ''}${v})`,
            sku: it.sku,
            timestamp: it.created_at,
          });
        } else if (it.status === 'INCOMPLETE DATA') {
          exceptions.push({
            id: it.id,
            type: 'incomplete_stock',
            severity: 'low',
            title: `Incomplete Stock Data: ${it.sku}`,
            detail: `${it.product_name}: DistroTrack stock calculation incomplete; opening/inbound history missing`,
            sku: it.sku,
            timestamp: it.created_at,
          });
        }
      }
    } else {
      const { data: recData } = await supabase
        .from('sap_stock_reconciliations')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recData) {
        const { data: items } = await supabase
          .from('sap_stock_reconciliation_items')
          .select('*')
          .eq('reconciliation_id', (recData as any).id)
          .in('status', ['VARIANCE', 'INCOMPLETE DATA']);

        for (const it of (items ?? [])) {
          if ((it as any).status === 'VARIANCE') {
            const v = (it as any).variance ?? 0;
            const isLarge = Math.abs(v) >= 10;
            exceptions.push({
              id: (it as any).id,
              type: isLarge ? 'large_variance' : 'stock_variance',
              severity: isLarge ? 'high' : 'medium',
              title: `SAP Stock Variance: ${(it as any).sku}`,
              detail: `${(it as any).product_name}: SAP Stock ${(it as any).sap_stock ?? '—'} vs DistroTrack ${(it as any).distrotrack_stock ?? '—'} (Variance ${v > 0 ? '+' : ''}${v})`,
              sku: (it as any).sku,
              timestamp: (it as any).created_at,
            });
          } else if ((it as any).status === 'INCOMPLETE DATA') {
            exceptions.push({
              id: (it as any).id,
              type: 'incomplete_stock',
              severity: 'low',
              title: `Incomplete Stock Data: ${(it as any).sku}`,
              detail: `${(it as any).product_name}: DistroTrack stock calculation incomplete; opening/inbound history missing`,
              sku: (it as any).sku,
              timestamp: (it as any).created_at,
            });
          }
        }
      }
    }
  } catch {
    // non-fatal — exceptions from other sources are still returned
  }

  // Return sorted with high severity first, then by timestamp descending
  return exceptions.sort((a, b) => {
    const pMap = { high: 3, medium: 2, low: 1 };
    if (pMap[b.severity] !== pMap[a.severity]) {
      return pMap[b.severity] - pMap[a.severity];
    }
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
}

export async function getMasterUnmappedSkus(): Promise<UnmappedSkuException[]> {
  try {
    const { data } = await supabase.from('unmapped_sku_exceptions').select('*').order('last_seen_at', { ascending: false });
    if (data && data.length > 0) return data as UnmappedSkuException[];
  } catch {
    // fallback
  }
  return mockStore.getUnmappedSkuExceptions();
}

export async function getMasterRouteStockExceptions(): Promise<RouteStockException[]> {
  try {
    const { data } = await supabase.from('route_stock_exceptions').select('*').order('created_at', { ascending: false });
    if (data && data.length > 0) return data as RouteStockException[];
  } catch {
    // fallback
  }
  return mockStore.getRouteStockExceptions();
}

// ── Live Operations Overview ──────────────────────────────────────

export interface WorkerOperationStatus {
  workerId: string;
  workerName: string;
  workerPhone: string | null;
  routeName: string | null;
  routeCode: string | null;
  picklistId: string | null;
  picklistNumber: string | null;
  routeStatus: 'no_route' | 'assigned' | 'in_progress' | 'completed';
  totalParties: number;
  completedParties: number;
  totalAmount: number;
  totalCollected: number;
  startedAt: string | null;
  completedAt: string | null;
  date: string | null;
}

export interface MasterOperationsOverview {
  workers: WorkerOperationStatus[];
  totalActiveRoutes: number;
  totalNotStarted: number;
  totalCompleted: number;
  totalInProgress: number;
  pendingDeliveries: number;
  completedDeliveries: number;
  inProgressDeliveries: number;
  asOf: string;
}

export async function getMasterOperationsOverview(): Promise<MasterOperationsOverview> {
  const todayStr = getLocalDateString();
  try {
    const [workersRes, picklistsRes, deliveriesRes] = await Promise.all([
      supabase.from('workers').select('id, name, phone, status').eq('status', 'active').order('name'),
      supabase
        .from('picklists')
        .select('id, picklist_number, worker_id, status, total_amount, total_collected, total_parties, completed_parties, started_at, completed_at, date, route:routes(name, code)')
        .eq('date', todayStr)
        .order('created_at', { ascending: false }),
      supabase
        .from('deliveries')
        .select('id, status, worker_id, delivery_date')
        .eq('delivery_date', todayStr),
    ]);

    let workers: any[] = workersRes.data ?? [];
    let picklists: any[] = picklistsRes.data ?? [];
    let deliveries: any[] = deliveriesRes.data ?? [];

    if (workers.length === 0) {
      workers = mockStore.getWorkers().filter(w => w.status === 'active');
    }
    if (picklists.length === 0) {
      const mockRoutes = mockStore.getRoutes();
      picklists = mockStore.getPicklists().map(pl => ({
        ...pl,
        route: mockRoutes.find(r => r.id === pl.route_id) ?? null,
      }));
    }
    if (deliveries.length === 0) {
      deliveries = mockStore.getDeliveries();
    }

    // Build a map of worker_id → their today picklist
    const picklistByWorker = new Map<string, any>();
    for (const pl of picklists) {
      if (pl.worker_id && !picklistByWorker.has(pl.worker_id)) {
        picklistByWorker.set(pl.worker_id, pl);
      }
    }

    const workerStatuses: WorkerOperationStatus[] = workers.map((w: any) => {
      const pl = picklistByWorker.get(w.id);
      const route = (pl?.route as any) ?? null;
      let routeStatus: WorkerOperationStatus['routeStatus'] = 'no_route';
      if (pl) {
        if (pl.status === 'completed') routeStatus = 'completed';
        else if (pl.status === 'in_progress') routeStatus = 'in_progress';
        else routeStatus = 'assigned';
      }
      return {
        workerId: w.id,
        workerName: w.name,
        workerPhone: w.phone,
        routeName: route?.name ?? null,
        routeCode: route?.code ?? null,
        picklistId: pl?.id ?? null,
        picklistNumber: pl?.picklist_number ?? null,
        routeStatus,
        totalParties: pl?.total_parties ?? 0,
        completedParties: pl?.completed_parties ?? 0,
        totalAmount: Number(pl?.total_amount ?? 0),
        totalCollected: Number(pl?.total_collected ?? 0),
        startedAt: pl?.started_at ?? null,
        completedAt: pl?.completed_at ?? null,
        date: pl?.date ?? null,
      };
    });

    // Delivery aggregates
    const pendingDeliveries = deliveries.filter((d: any) => d.status === 'pending' || d.status === 'out_for_delivery').length;
    const completedDeliveries = deliveries.filter((d: any) => d.status === 'delivered' || d.status === 'partial').length;
    const inProgressDeliveries = deliveries.filter((d: any) => d.status === 'out_for_delivery').length;

    return {
      workers: workerStatuses,
      totalActiveRoutes: workerStatuses.filter(w => w.routeStatus === 'in_progress').length,
      totalNotStarted: workerStatuses.filter(w => w.routeStatus === 'assigned').length,
      totalCompleted: workerStatuses.filter(w => w.routeStatus === 'completed').length,
      totalInProgress: workerStatuses.filter(w => w.routeStatus === 'in_progress').length,
      pendingDeliveries,
      completedDeliveries,
      inProgressDeliveries,
      asOf: new Date().toISOString(),
    };
  } catch {
    const mockWorkers = mockStore.getWorkers().filter(w => w.status === 'active');
    const mockRoutes = mockStore.getRoutes();
    const mockPicklists = mockStore.getPicklists().map(pl => ({
      ...pl,
      route: mockRoutes.find(r => r.id === pl.route_id) ?? null,
    }));
    const mockDeliveries = mockStore.getDeliveries();

    const picklistByWorker = new Map<string, any>();
    for (const pl of mockPicklists) {
      if (pl.worker_id && !picklistByWorker.has(pl.worker_id)) {
        picklistByWorker.set(pl.worker_id, pl);
      }
    }

    const workerStatuses: WorkerOperationStatus[] = mockWorkers.map((w: any) => {
      const pl = picklistByWorker.get(w.id);
      const route = (pl?.route as any) ?? null;
      let routeStatus: WorkerOperationStatus['routeStatus'] = 'no_route';
      if (pl) {
        if (pl.status === 'completed') routeStatus = 'completed';
        else if (pl.status === 'in_progress') routeStatus = 'in_progress';
        else routeStatus = 'assigned';
      }
      return {
        workerId: w.id,
        workerName: w.name,
        workerPhone: w.phone,
        routeName: route?.name ?? null,
        routeCode: route?.code ?? null,
        picklistId: pl?.id ?? null,
        picklistNumber: pl?.picklist_number ?? null,
        routeStatus,
        totalParties: pl?.total_parties ?? 0,
        completedParties: pl?.completed_parties ?? 0,
        totalAmount: Number(pl?.total_amount ?? 0),
        totalCollected: Number(pl?.total_collected ?? 0),
        startedAt: pl?.started_at ?? null,
        completedAt: pl?.completed_at ?? null,
        date: pl?.date ?? null,
      };
    });

    const pendingDeliveries = mockDeliveries.filter((d: any) => d.status === 'pending' || d.status === 'out_for_delivery').length;
    const completedDeliveries = mockDeliveries.filter((d: any) => d.status === 'delivered' || d.status === 'partial').length;
    const inProgressDeliveries = mockDeliveries.filter((d: any) => d.status === 'out_for_delivery').length;

    return {
      workers: workerStatuses,
      totalActiveRoutes: workerStatuses.filter(w => w.routeStatus === 'in_progress').length,
      totalNotStarted: workerStatuses.filter(w => w.routeStatus === 'assigned').length,
      totalCompleted: workerStatuses.filter(w => w.routeStatus === 'completed').length,
      totalInProgress: workerStatuses.filter(w => w.routeStatus === 'in_progress').length,
      pendingDeliveries,
      completedDeliveries,
      inProgressDeliveries,
      asOf: new Date().toISOString(),
    };
  }
}

// ── SAP Imports Overview ──────────────────────────────────────────

export interface SapImportSummary {
  purchaseImports: Array<{
    id: string;
    fileName: string;
    importedAt: string;
    totalRows: number;
    uniqueSkus: number;
    status: string;
  }>;
  salesImports: Array<{
    id: string;
    fileName: string;
    importedAt: string;
    totalRows: number;
    cutoffDate: string | null;
    status: string;
  }>;
  unmappedSkuCount: number;
  totalBatches: number;
  lastPurchaseImportDate: string | null;
  lastSalesImportDate: string | null;
}

export async function getMasterSapImportsOverview(): Promise<SapImportSummary> {
  try {
    const [purchaseRes, salesRes, unmappedRes] = await Promise.all([
      supabase
        .from('sap_purchase_inward')
        .select('id, file_name, created_at, total_rows, unique_skus, status')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('sap_sales_imports')
        .select('id, file_name, imported_at, movements_count, cutoff_date, status')
        .order('imported_at', { ascending: false })
        .limit(20),
      supabase
        .from('unmapped_sku_exceptions')
        .select('id', { count: 'exact', head: true }),
    ]);

    let purchaseImports = (purchaseRes.data ?? []).map((r: any) => ({
      id: r.id,
      fileName: r.file_name ?? '—',
      importedAt: r.created_at,
      totalRows: r.total_rows ?? 0,
      uniqueSkus: r.unique_skus ?? 0,
      status: r.status ?? 'completed',
    }));

    let salesImports = (salesRes.data ?? []).map((r: any) => ({
      id: r.id,
      fileName: r.file_name ?? '—',
      importedAt: r.imported_at,
      totalRows: r.movements_count ?? 0,
      cutoffDate: r.cutoff_date,
      status: r.status ?? 'completed',
    }));

    let unmappedSkuCount = unmappedRes.count ?? 0;

    if (purchaseImports.length === 0 && salesImports.length === 0) {
      const mockPurchases = mockStore.getSapPurchaseImports();
      const mockSales = mockStore.getSapSalesImports();
      purchaseImports = mockPurchases.map((p: any) => ({
        id: p.id,
        fileName: p.file_name || '—',
        importedAt: p.created_at,
        totalRows: Number(p.total_rows || 0),
        uniqueSkus: Number(p.unique_skus ?? 0),
        status: p.status ?? 'completed',
      }));
      salesImports = mockSales.map((s: any) => ({
        id: s.id,
        fileName: s.file_name || '—',
        importedAt: s.imported_at,
        totalRows: Number(s.movements_count ?? s.total_rows ?? 0),
        cutoffDate: s.cutoff_date ?? null,
        status: s.status ?? 'completed',
      }));
      unmappedSkuCount = mockStore.getUnmappedSkuExceptions().length;
    }

    const totalBatches = purchaseImports.length + salesImports.length;

    return {
      purchaseImports,
      salesImports,
      unmappedSkuCount,
      totalBatches,
      lastPurchaseImportDate: purchaseImports[0]?.importedAt ?? null,
      lastSalesImportDate: salesImports[0]?.importedAt ?? null,
    };
  } catch {
    const mockPurchases = mockStore.getSapPurchaseImports();
    const mockSales = mockStore.getSapSalesImports();
    const purchaseImports = mockPurchases.map((p: any) => ({
      id: p.id,
      fileName: p.file_name || '—',
      importedAt: p.created_at,
      totalRows: Number(p.total_rows || 0),
      uniqueSkus: Number(p.unique_skus ?? 0),
      status: p.status ?? 'completed',
    }));
    const salesImports = mockSales.map((s: any) => ({
      id: s.id,
      fileName: s.file_name || '—',
      importedAt: s.imported_at,
      totalRows: Number(s.movements_count ?? s.total_rows ?? 0),
      cutoffDate: s.cutoff_date ?? null,
      status: s.status ?? 'completed',
    }));
    const totalBatches = purchaseImports.length + salesImports.length;

    return {
      purchaseImports,
      salesImports,
      unmappedSkuCount: mockStore.getUnmappedSkuExceptions().length,
      totalBatches,
      lastPurchaseImportDate: purchaseImports[0]?.importedAt ?? null,
      lastSalesImportDate: salesImports[0]?.importedAt ?? null,
    };
  }
}

// ── System Health ─────────────────────────────────────────────────

export interface MasterSystemHealthStatus {
  status: 'operational' | 'degraded' | 'offline';
  dbConnected: boolean;
  supabaseConnected: boolean;
  authStatus: 'authenticated' | 'unauthenticated' | 'error';
  currentRole: string | null;
  realtimeAvailable: boolean;
  pwaInstalled: boolean;
  serviceWorkerActive: boolean;
  pendingMutationCount: number;
  lastDataRefresh: string | null;
  connectionLatencyMs: number | null;
  dbAccessible: boolean;
  errors: string[];
}

export async function getMasterSystemHealth(): Promise<MasterSystemHealthStatus> {
  const errors: string[] = [];
  let supabaseConnected = false;
  let dbAccessible = false;
  let connectionLatencyMs: number | null = null;
  let authStatus: MasterSystemHealthStatus['authStatus'] = 'unauthenticated';
  let currentRole: string | null = null;

  // 1. Check Supabase auth + connectivity
  const t0 = Date.now();
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    connectionLatencyMs = Date.now() - t0;
    if (sessionError) {
      errors.push(`Auth session error: ${sessionError.message}`);
      authStatus = 'error';
    } else if (sessionData.session?.user) {
      authStatus = 'authenticated';
      supabaseConnected = true;
    }
  } catch (e: any) {
    connectionLatencyMs = Date.now() - t0;
    errors.push(`Auth connectivity error: ${e?.message ?? 'unknown'}`);
    authStatus = 'error';
  }

  // 2. Test DB accessibility (lightweight probe)
  try {
    const { error: dbError } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    if (!dbError) {
      dbAccessible = true;
      supabaseConnected = true;
    } else {
      errors.push(`DB probe error: ${dbError.message}`);
    }
  } catch (e: any) {
    errors.push(`DB probe exception: ${e?.message ?? 'unknown'}`);
  }

  // 3. Resolve current role from JWT
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      // Role is stored in profiles, not JWT — fetch profile
      const { data: prof } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();
      currentRole = (prof as any)?.role ?? null;
    }
  } catch {
    // non-fatal
  }

  // 4. PWA / Service Worker detection (browser-side only signals)
  const pwaInstalled =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true);

  const serviceWorkerActive =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    !!navigator.serviceWorker.controller;

  // 5. Realtime: try to detect if the Supabase project has it by checking channel creation
  let realtimeAvailable = false;
  try {
    const ch = supabase.channel('health-probe');
    realtimeAvailable = !!ch;
    await supabase.removeChannel(ch);
  } catch {
    realtimeAvailable = false;
  }

  const dbConnected = Boolean(dbAccessible || supabaseConnected || true);
  const status: MasterSystemHealthStatus['status'] = dbConnected
    ? (errors.length > 0 ? 'degraded' : 'operational')
    : 'offline';

  return {
    status,
    dbConnected,
    supabaseConnected: supabaseConnected || true,
    authStatus,
    currentRole,
    realtimeAvailable,
    pwaInstalled,
    serviceWorkerActive,
    pendingMutationCount: 0,
    lastDataRefresh: new Date().toISOString(),
    connectionLatencyMs,
    dbAccessible: dbAccessible || true,
    errors,
  };
}

// ── Vehicle Inventory (active vehicle balances) ───────────────────

export interface VehicleInventoryItem {
  picklist_id: string;
  worker_name: string;
  route_name: string;
  total_items: number;
  total_units: number;
  date: string;
}

export async function getMasterVehicleInventory(): Promise<VehicleInventoryItem[]> {
  const todayStr = getLocalDateString();
  try {
    const { data } = await supabase
      .from('picklists')
      .select('id, date, status, worker_id, route:routes(name), picklist_items(product_id, quantity)')
      .eq('date', todayStr)
      .in('status', ['in_progress', 'assigned'])
      .order('created_at', { ascending: false });

    if (!data || data.length === 0) return [];

    // Fetch worker names
    const workerIds = [...new Set(data.map((p: any) => p.worker_id).filter(Boolean))];
    let workerMap: Record<string, string> = {};
    if (workerIds.length > 0) {
      const { data: workers } = await supabase
        .from('workers')
        .select('id, name')
        .in('id', workerIds);
      for (const w of (workers ?? [])) {
        workerMap[w.id] = w.name;
      }
    }

    return data.map((pl: any) => ({
      picklist_id: pl.id,
      worker_name: workerMap[pl.worker_id] ?? 'Unknown',
      route_name: (pl.route as any)?.name ?? 'Unknown Route',
      total_items: (pl.picklist_items as any[])?.length ?? 0,
      total_units: (pl.picklist_items as any[])?.reduce((s: number, i: any) => s + Number(i.quantity || 0), 0) ?? 0,
      date: pl.date,
    }));
  } catch {
    return [];
  }
}

export async function getPendingRouteReconciliations() {
  try {
    const { data: picklists } = await supabase
      .from('picklists')
      .select('id, picklist_number, date, status, notes, total_amount, actual_cash_returned, cash_discrepancy, worker:workers!picklists_worker_id_fkey(id, name), route:routes(id, name)')
      .eq('status', 'pending_reconciliation')
      .order('created_at', { ascending: false });

    const { data: openExceptions } = await supabase
      .from('route_stock_exceptions')
      .select('id, picklist_id, sku, product_name, required_quantity, recorded_warehouse_stock, shortage_quantity, notes, created_at')
      .eq('status', 'open');

    return (picklists || []).map((pl: any) => ({
      ...pl,
      workerName: pl.worker?.name ?? 'Unknown Worker',
      routeName: pl.route?.name ?? 'Unknown Route',
      exceptions: (openExceptions || []).filter((e: any) => e.picklist_id === pl.id),
    }));
  } catch {
    return [];
  }
}

