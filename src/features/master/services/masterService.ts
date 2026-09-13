import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import { SAP_PRODUCT_MASTER } from '@/features/products/data/productMaster';
import { getExpenses, getRouteProfitability } from '@/features/expenses/services/expenseService';
import { getLocalDateString } from '@/shared/utils/format';
import type { MasterAuditLog, FinancialSummary, RouteProfitabilityResponse, RouteStockException, UnmappedSkuException } from '@/lib/database.types';

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
  totalParties: number;
  totalProducts: number;
  totalPicklists: number;
  outstandingAmount: number;
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
      supabase.from('parties').select('id', { count: 'exact', head: true }),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    ]);

    const picklists = picklistsRes.data ?? [];
    const deliveries = deliveriesRes.data ?? [];

    // P2 FIX: Use ACTUAL RPC response key names
    const totalSales = Number(finSummaryRes?.sales ?? 0);
    const totalCollections = Number(finSummaryRes?.total_collected ?? 0);
    const totalCash = Number(finSummaryRes?.cash ?? 0);
    const totalUpi = Number(finSummaryRes?.upi ?? 0);
    const chequeCleared = Number(finSummaryRes?.cheque_cleared ?? 0);
    const chequePending = Number(finSummaryRes?.cheque_pending ?? 0);
    const totalCheque = chequeCleared + chequePending;
    const totalCredit = Number(finSummaryRes?.credit_extended ?? 0);
    const totalExpenses = Number(finSummaryRes?.expenses ?? 0);
    const totalCashExpenses = Number(finSummaryRes?.cash_expenses ?? 0);
    const expectedPhysicalCash = Number(finSummaryRes?.net_cash ?? (totalCash - totalCashExpenses));
    const contributionBeforeCogs = Number(finSummaryRes?.contribution_before_cogs ?? (totalSales - totalExpenses));
    const outstandingAmount = Number(finSummaryRes?.total_outstanding ?? 0);

    const completedDeliveries = deliveries.filter(
      (d: any) => d.status === 'delivered' || d.status === 'partial'
    ).length;
    const pendingDeliveries = deliveries.filter(
      (d: any) => d.status === 'pending' || d.status === 'out_for_delivery'
    ).length;

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
      totalParties: partiesRes.count ?? 0,
      totalProducts: productsRes.count ?? 0,
      totalPicklists: picklists.length,
      outstandingAmount,
    };
  } catch {
    return {
      totalSales: 0,
      totalCollections: 0,
      totalCash: 0,
      totalUpi: 0,
      totalCheque: 0,
      chequeCleared: 0,
      chequePending: 0,
      totalCredit: 0,
      totalExpenses: 0,
      totalCashExpenses: 0,
      expectedPhysicalCash: 0,
      contributionBeforeCogs: 0,
      totalDeliveries: 0,
      completedDeliveries: 0,
      pendingDeliveries: 0,
      activeWorkers: 0,
      activeRoutes: 0,
      totalParties: 0,
      totalProducts: 0,
      totalPicklists: 0,
      outstandingAmount: 0,
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
    const { data: worker } = await supabase
      .from('workers')
      .select('id, name, phone, status')
      .eq('id', workerId)
      .single();

    if (!worker) return null;

    // Active picklist
    const { data: activePL } = await supabase
      .from('picklists')
      .select('id, picklist_number, date, status, started_at, completed_at, total_amount, total_parties, completed_parties, route:routes(name)')
      .eq('worker_id', workerId)
      .in('status', ['assigned', 'in_progress', 'confirmed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Deliveries for today (or active picklist)
    const todayStr = getLocalDateString();
    const { data: deliveriesRaw } = await supabase
      .from('deliveries')
      .select('id, status, sequence_order, total_amount, delivered_amount, collected_amount, payment_mode, delivered_at, notes, party:parties(name), items:delivery_items(id)')
      .eq('worker_id', workerId)
      .gte('delivery_date', todayStr)
      .lte('delivery_date', todayStr)
      .order('sequence_order');

    const deliveries = (deliveriesRaw ?? []).map(d => ({
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

    // Payments today
    const { data: paymentsRaw } = await supabase
      .from('payments')
      .select('id, amount, payment_mode, payment_date, notes, party:parties(name)')
      .eq('worker_id', workerId)
      .eq('payment_date', todayStr)
      .order('created_at', { ascending: false });

    const payments = (paymentsRaw ?? []).map(p => ({
      id: p.id,
      amount: Number(p.amount ?? 0),
      payment_mode: p.payment_mode,
      payment_date: p.payment_date,
      party_name: (p.party as unknown as { name: string } | null)?.name ?? null,
      notes: p.notes,
    }));

    // Route history & authoritative delivered sales
    const [{ data: historyRaw }, workerProfitability] = await Promise.all([
      supabase
        .from('picklists')
        .select('id, picklist_number, date, status, total_amount, total_collected, total_parties, completed_parties, started_at, completed_at')
        .eq('worker_id', workerId)
        .gte('date', historyRange.from)
        .lte('date', historyRange.to)
        .order('date', { ascending: false }),
      getRouteProfitability({ worker_id: workerId, start_date: historyRange.from, end_date: historyRange.to }).catch(() => null),
    ]);

    const routeProfMap = new Map<string, number>();
    if (workerProfitability?.routes) {
      for (const r of workerProfitability.routes) {
        if (r.picklist_number) {
          routeProfMap.set(r.picklist_number, Number(r.sales ?? 0));
        }
      }
    }

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
      deliveries,
      payments,
      routeHistory: (historyRaw ?? []).map(h => ({
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
      })),
    };
  } catch {
    return null;
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
    return data ?? [];
  } catch {
    return [];
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
  const { data } = await supabase
    .from('payments')
    .select('*, party:parties(name, code), worker:workers!payments_worker_id_fkey(name)')
    .gte('payment_date', range.from)
    .lte('payment_date', range.to)
    .order('payment_date', { ascending: false });
  return data ?? [];
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bouncedItems = (paymentsRes.data ?? []).map((p: any) => ({
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pendingExpenses = (expensesRes.data ?? []).map((e: any) => ({
      id: e.id,
      category: e.category,
      amount: Number(e.amount ?? 0),
      paymentMethod: e.payment_method ?? 'cash',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workerName: (e.worker as any)?.name ?? '—',
      date: e.date || (e.created_at || '').split('T')[0],
      description: e.description,
    }));

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
    return {
      cashDiscrepancies: { count: 0, totalAmount: 0, routes: [] },
      bouncedCheques: { count: 0, totalAmount: 0, items: [] },
      pendingExpenses: { count: 0, totalAmount: 0, items: [] },
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
    const [productsRes, movementsRes, activePicklistsRes] = await Promise.all([
      supabase
        .from('products')
        .select('id, sku, name, category, current_stock, unit, mrp, rate')
        .eq('status', 'active')
        .order('current_stock', { ascending: true }),
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      products: (productsRes.data ?? []).map((p: any) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        currentStock: Number(p.current_stock ?? 0),
        unit: p.unit || 'pcs',
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
  const totalSapProducts = SAP_PRODUCT_MASTER.length;

  // 1. Fetch products count
  let products = mockStore.getProducts();
  try {
    const { data } = await supabase.from('products').select('*');
    if (data && data.length > 0) {
      products = data as any[];
    }
  } catch {
    // fallback
  }

  const productsTracked = products.length;
  const activeProducts = products.filter(p => p.status === 'active').length;
  const mappedProducts = products.filter(p => p.is_sap_master !== false && p.sku !== 'UNMAPPED SKU').length;

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

  const deliveryItems = mockStore.getDeliveryItems();
  for (const it of deliveryItems) {
    totalDeliveredQty += Number(it.delivered_qty || 0);
    totalReturnedQty += Number(it.damaged_qty || 0);
    if (it.sku) activeSkusMoved.add(it.sku);
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
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recData) {
        stockVarianceCases = (recData as any).variance_count || 0;
        incompleteReconciliations = (recData as any).incomplete_count || 0;
      }
    }
  } catch {
    // fallback
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

