import { supabase } from '@/lib/supabase';
import type { MasterAuditLog } from '@/lib/database.types';

// ── Date Helpers ─────────────────────────────────────────────────

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export function todayRange(): DateRange {
  const t = new Date().toISOString().split('T')[0];
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
  totalCheque: number;
  totalCredit: number;
  totalExpenses: number;
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
    const [
      picklistsRes,
      paymentsRes,
      deliveriesRes,
      expensesRes,
      workersRes,
      routesRes,
      partiesRes,
      productsRes,
    ] = await Promise.all([
      supabase
        .from('picklists')
        .select('total_amount, date, created_at')
        .gte('date', range.from)
        .lte('date', range.to),
      supabase
        .from('payments')
        .select('amount, payment_mode, payment_date, created_at')
        .gte('payment_date', range.from)
        .lte('payment_date', range.to),
      supabase
        .from('deliveries')
        .select('status, total_amount, collected_amount, delivery_date, created_at')
        .gte('delivery_date', range.from)
        .lte('delivery_date', range.to),
      supabase
        .from('expenses')
        .select('amount, date')
        .gte('date', range.from)
        .lte('date', range.to),
      supabase.from('workers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('routes').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('parties').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    ]);

    const picklists = picklistsRes.data ?? [];
    const payments = paymentsRes.data ?? [];
    const deliveries = deliveriesRes.data ?? [];
    const expenses = expensesRes.data ?? [];

    const totalSales = picklists.reduce((s, p) => s + Number(p.total_amount ?? 0), 0);
    const totalCollections = payments.filter(p => p.payment_mode !== 'credit').reduce((s, p) => s + Number(p.amount ?? 0), 0);
    const totalCash = payments.filter(p => p.payment_mode === 'cash').reduce((s, p) => s + Number(p.amount ?? 0), 0);
    const totalCheque = payments.filter(p => p.payment_mode === 'cheque').reduce((s, p) => s + Number(p.amount ?? 0), 0);
    const totalCredit = payments.filter(p => p.payment_mode === 'credit').reduce((s, p) => s + Number(p.amount ?? 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
    const completedDeliveries = deliveries.filter(d => d.status === 'delivered' || d.status === 'partial').length;
    const pendingDeliveries = deliveries.filter(d => d.status === 'pending' || d.status === 'out_for_delivery').length;
    const outstandingAmount = deliveries
      .filter(d => d.status === 'pending' || d.status === 'out_for_delivery' || d.status === 'partial')
      .reduce((s, d) => s + Math.max(0, Number(d.total_amount ?? 0) - Number(d.collected_amount ?? 0)), 0);

    return {
      totalSales,
      totalCollections,
      totalCash,
      totalCheque,
      totalCredit,
      totalExpenses,
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
      totalSales: 0, totalCollections: 0, totalCash: 0, totalCheque: 0,
      totalCredit: 0, totalExpenses: 0, totalDeliveries: 0,
      completedDeliveries: 0, pendingDeliveries: 0, activeWorkers: 0,
      activeRoutes: 0, totalParties: 0, totalProducts: 0,
      totalPicklists: 0, outstandingAmount: 0,
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
    const todayStr = new Date().toISOString().split('T')[0];
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

    // Route history
    const { data: historyRaw } = await supabase
      .from('picklists')
      .select('picklist_number, date, status, total_amount, total_collected, total_parties, completed_parties, started_at, completed_at')
      .eq('worker_id', workerId)
      .gte('date', historyRange.from)
      .lte('date', historyRange.to)
      .order('date', { ascending: false });

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
  totalCheque: number;
  totalCredit: number;
  totalExpenses: number;
  totalDeliveries: number;
  completedDeliveries: number;
}

export async function getHistoricalSummaries(months: Array<{ year: number; month: number }>): Promise<PeriodSummary[]> {
  const results: PeriodSummary[] = [];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  for (const { year, month } of months) {
    const range = monthRange(year, month);
    const kpis = await getMasterKPIs(range);
    results.push({
      month,
      year,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      totalSales: kpis.totalSales,
      totalCollections: kpis.totalCollections,
      totalCash: kpis.totalCash,
      totalCheque: kpis.totalCheque,
      totalCredit: kpis.totalCredit,
      totalExpenses: kpis.totalExpenses,
      totalDeliveries: kpis.totalDeliveries,
      completedDeliveries: kpis.completedDeliveries,
    });
  }

  return results;
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
    .select('*, route:routes(name, code), worker:workers(name)')
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
    .select('*, party:parties(name, code), worker:workers(name)')
    .gte('payment_date', range.from)
    .lte('payment_date', range.to)
    .order('payment_date', { ascending: false });
  return data ?? [];
}

export async function getMasterExpenses(range: DateRange) {
  const { data } = await supabase
    .from('expenses')
    .select('*, worker:workers(name)')
    .gte('date', range.from)
    .lte('date', range.to)
    .order('date', { ascending: false });
  return data ?? [];
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
