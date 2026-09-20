import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import { getDeliveries } from '@/features/deliveries/services/deliveryService';
import { getWorkers } from '@/features/workers/services/workerService';
import { getLocalDateString, parseEffectiveDateString } from '@/shared/utils/format';
import type { Delivery, Worker, FinancialSummary } from '@/lib/database.types';

export interface DashboardStats {
  todaySales: number;
  todayCollections: number;
  totalOutstanding: number;
  customerAdvance: number;
  pendingDeliveriesCount: number;
  completedDeliveriesCount: number;
  totalExpensesToday: number;
  cashExpensesToday: number;
  contributionBeforeCogsToday: number;
  activeWorkersCount: number;
  monthlySales: number;
  monthlyCollections: number;
  currentMonthSalesCollected: number;
  priorPeriodUdhariCollected: number;
  currentMonthCreditSales: number;
  monthlyUdhari: number;         // authoritative open unpaid receivables (strictly >= 0)
  pendingCreditAmount: number;  // same as totalOutstanding (strictly >= 0)
  monthlyCash: number;
  monthlyCheque: number;
  // Source-Aware Authoritative Monthly Sales Breakdown
  sapBaselineSales: number;
  distrotrackMonthlySales: number;
  totalMonthlySales: number;
  hasSapSales: boolean;
  goLiveCutoffDate?: string | null;
  sapSalesCount?: number;
  sapUniqueSkus?: number;
  sapUniqueCustomers?: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const now = new Date();
  const todayStr = getLocalDateString(now);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  const monthStartStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
  const monthEndStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  try {
    // P1/P3: Type RPC responses as FinancialSummary | null to enforce correct key access
    let todaySummaryRes: FinancialSummary | null = null;
    let monthSummaryRes: FinancialSummary | null = null;

    try {
      const { data } = await supabase.rpc('get_financial_summary', {
        p_start_date: todayStr,
        p_end_date: todayStr,
      });
      todaySummaryRes = data as FinancialSummary | null;
    } catch {
      todaySummaryRes = null;
    }

    try {
      const { data } = await supabase.rpc('get_financial_summary', {
        p_start_date: monthStartStr,
        p_end_date: monthEndStr,
      });
      monthSummaryRes = data as FinancialSummary | null;
    } catch {
      monthSummaryRes = null;
    }

    const [deliveries, workers] = await Promise.all([
      getDeliveries().catch(() => [] as Delivery[]),
      getWorkers().catch(() => [] as Worker[]),
    ]);

    // ── Helper: Effective Date matching ──────────────────────────────
    const getEffectiveDate = (dateStr: string | null | undefined, createdAtStr: string | null | undefined): string => {
      return parseEffectiveDateString(dateStr || createdAtStr);
    };

    // Deliveries scheduled for today
    const todayDeliveries = deliveries.filter(
      (d: Delivery) => getEffectiveDate(d.delivery_date, d.created_at) === todayStr
    );

    const pendingDeliveriesCount = todayDeliveries.filter(
      (d: Delivery) => d.status === 'pending' || d.status === 'out_for_delivery'
    ).length;

    const completedDeliveriesCount = todayDeliveries.filter(
      (d: Delivery) => d.status === 'delivered' || d.status === 'partial'
    ).length;

    let activeWorkersCount = workers.filter((w: Worker) => w.status === 'active').length;
    try {
      const { count } = await supabase
        .from('workers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active');
      if (count !== null && count !== undefined && count > 0) {
        activeWorkersCount = count;
      }
    } catch {
      // fallback
    }

    // ── Delivery amounts calculation (scheduled vs realized) ──────────
    const todayDeliveredSales = todayDeliveries
      .filter((d: Delivery) => d.status === 'delivered' || d.status === 'partial')
      .reduce((sum: number, d: Delivery) => sum + Number(d.delivered_amount || d.total_amount || 0), 0);

    const todayScheduledSales = todayDeliveries.reduce(
      (sum: number, d: Delivery) => sum + Number(d.delivered_amount || d.total_amount || 0),
      0
    );

    const monthDeliveries = deliveries.filter((d: Delivery) => {
      const dt = getEffectiveDate(d.delivery_date, d.created_at);
      return dt >= monthStartStr && dt <= monthEndStr;
    });

    const monthDeliveredSales = monthDeliveries
      .filter((d: Delivery) => d.status === 'delivered' || d.status === 'partial')
      .reduce((sum: number, d: Delivery) => sum + Number(d.delivered_amount || d.total_amount || 0), 0);

    const monthScheduledSales = monthDeliveries.reduce(
      (sum: number, d: Delivery) => sum + Number(d.delivered_amount || d.total_amount || 0),
      0
    );

    // ── SAP Baseline Sales Integration (Pre-Go-Live Authoritative Data) ──
    let sapSalesItems: any[] = [];
    let sapImports: any[] = [];
    let isSapFetchSuccess = false;
    try {
      const [sapItemsRes, sapImpRes] = await Promise.all([
        supabase.from('sap_sales_import_items').select('*'),
        supabase.from('sap_sales_imports').select('*'),
      ]);
      if (!sapItemsRes.error && !sapImpRes.error) {
        isSapFetchSuccess = true;
        sapSalesItems = sapItemsRes.data || [];
        sapImports = sapImpRes.data || [];
      }
    } catch {
      // ignore
    }

    if (!isSapFetchSuccess) {
      sapSalesItems = mockStore.getSapSalesImportItems();
      sapImports = mockStore.getSapSalesImports();
    }

    const currentMonthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    let goLiveCutoffDate: string | null = null;
    for (const imp of sapImports) {
      if (imp.cutoff_date && imp.cutoff_date.startsWith(currentMonthKey)) {
        if (!goLiveCutoffDate || imp.cutoff_date > goLiveCutoffDate) {
          goLiveCutoffDate = imp.cutoff_date;
        }
      }
    }

    const currentMonthSapItems = sapSalesItems.filter((s: any) => {
      const invDate = s.invoice_date || (s.created_at ? s.created_at.split('T')[0] : '');
      return invDate.startsWith(currentMonthKey);
    });

    let sapBaselineSales = 0;
    const sapSkus = new Set<string>();
    const sapCustomers = new Set<string>();

    for (const s of currentMonthSapItems) {
      const isCancel = Boolean(s.is_cancellation);
      const qty = Number(s.quantity || 0);
      const rate = Number(s.rate || 0);
      const netVal = Number(
        s.net_val !== null && s.net_val !== undefined
          ? s.net_val
          : (isCancel ? -qty : qty) * rate
      );
      sapBaselineSales += netVal;
      if (s.sku) sapSkus.add(s.sku.trim().toUpperCase());
      if (s.cust_code || s.cust_name) sapCustomers.add(s.cust_code || s.cust_name);
    }

    // DistroTrack deliveries for current month (post-cutoff to strictly avoid double-counting)
    const postCutoffDeliveries = monthDeliveries.filter((d: Delivery) => {
      if (!goLiveCutoffDate) return true;
      const dt = getEffectiveDate(d.delivery_date, d.created_at);
      return dt > goLiveCutoffDate;
    });

    const distrotrackMonthlySales = postCutoffDeliveries
      .filter((d: Delivery) => d.status === 'delivered' || d.status === 'partial')
      .reduce((sum: number, d: Delivery) => sum + Number(d.delivered_amount || d.total_amount || 0), 0);

    const hasSapSales = currentMonthSapItems.length > 0;
    const rpcMonthSales = Number(monthSummaryRes?.total_revenue ?? monthSummaryRes?.sales ?? 0);
    const operationalMonthSales = monthDeliveredSales > 0 ? monthDeliveredSales : (rpcMonthSales > 0 ? rpcMonthSales : monthScheduledSales);
    const totalMonthlySales = Number((hasSapSales
      ? sapBaselineSales + distrotrackMonthlySales
      : operationalMonthSales).toFixed(2));

    const monthlySales = totalMonthlySales;

    // ── Extract and map stats accurately from RPC & calculated workload ──
    const rpcTodaySales = Number(todaySummaryRes?.total_revenue ?? todaySummaryRes?.sales ?? 0);
    let todaySales = todayDeliveredSales > 0 ? todayDeliveredSales : (rpcTodaySales > 0 ? rpcTodaySales : todayScheduledSales);

    // If operational sales today is 0 and today matches SAP baseline transactions
    if (todaySales === 0 && hasSapSales) {
      const todaySapSales = currentMonthSapItems
        .filter((s: any) => (s.invoice_date || '').startsWith(todayStr))
        .reduce((sum: number, s: any) => {
          const isCancel = Boolean(s.is_cancellation);
          const qty = Number(s.quantity || 0);
          const rate = Number(s.rate || 0);
          const netVal = Number(
            s.net_val !== null && s.net_val !== undefined
              ? s.net_val
              : (isCancel ? -qty : qty) * rate
          );
          return sum + netVal;
        }, 0);
      if (todaySapSales > 0) {
        todaySales = todaySapSales;
      }
    }

    const rpcTodayCollections = Number(todaySummaryRes?.total_collected ?? 0);
    let todayCollections = rpcTodayCollections;
    if (!todaySummaryRes && todayCollections === 0) {
      const todayPayments = mockStore.getPayments().filter(p => (p.payment_date || '').startsWith(todayStr));
      todayCollections = todayPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    }

    let partyOutstanding = 0;
    try {
      const { data: pData } = await supabase.from('parties').select('outstanding_amount');
      partyOutstanding = Math.max(0, (pData || []).reduce((sum, p) => sum + Number(p.outstanding_amount || 0), 0));
    } catch {
      // ignore
    }
    const rpcOutstanding = Number(monthSummaryRes?.total_outstanding ?? todaySummaryRes?.total_outstanding ?? 0);
    const totalOutstanding = Math.max(0, rpcOutstanding > 0 ? rpcOutstanding : partyOutstanding);
    const customerAdvance = Number(monthSummaryRes?.customer_advance ?? todaySummaryRes?.customer_advance ?? 0);

    const rpcExpensesToday = Number(todaySummaryRes?.total_expenses ?? todaySummaryRes?.expenses ?? 0);
    let totalExpensesToday = rpcExpensesToday;
    if (!todaySummaryRes && totalExpensesToday === 0) {
      const todayExpenses = mockStore.getExpenses().filter(e => (e.date || '').startsWith(todayStr));
      totalExpensesToday = todayExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    }
    const cashExpensesToday = Number(todaySummaryRes?.cash_expenses ?? 0);
    const contributionBeforeCogsToday = Number(
      todaySummaryRes?.net_cash_deposit ??
      todaySummaryRes?.contribution_before_cogs ??
      (todaySales - totalExpensesToday)
    );

    const monthlyCollections = Number(monthSummaryRes?.total_collected ?? 0);
    const currentMonthSalesCollected = Number(monthSummaryRes?.current_period_collected ?? 0);
    const priorPeriodUdhariCollected = Number(monthSummaryRes?.prior_period_collected ?? 0);
    const currentMonthCreditSales = Number(monthSummaryRes?.credit_sales_created ?? monthSummaryRes?.total_credit ?? 0);
    const monthlyUdhari = totalOutstanding;
    const pendingCreditAmount = totalOutstanding;
    const monthlyCash = Number(monthSummaryRes?.cash_collected ?? monthSummaryRes?.cash ?? 0);
    const monthlyCheque = Number(
      (monthSummaryRes?.cheque_collected ?? 0) +
      (monthSummaryRes?.pending_cheques ?? monthSummaryRes?.cheque_pending ?? 0)
    );

    return {
      todaySales,
      todayCollections,
      totalOutstanding,
      customerAdvance,
      pendingDeliveriesCount,
      completedDeliveriesCount,
      totalExpensesToday,
      cashExpensesToday,
      contributionBeforeCogsToday,
      activeWorkersCount,
      monthlySales,
      monthlyCollections,
      currentMonthSalesCollected,
      priorPeriodUdhariCollected,
      currentMonthCreditSales,
      monthlyUdhari,
      pendingCreditAmount,
      monthlyCash,
      monthlyCheque,
      sapBaselineSales,
      distrotrackMonthlySales,
      totalMonthlySales,
      hasSapSales,
      goLiveCutoffDate,
      sapSalesCount: currentMonthSapItems.length,
      sapUniqueSkus: sapSkus.size,
      sapUniqueCustomers: sapCustomers.size,
    };
  } catch (err) {
    console.error('Error computing dashboard stats:', err);
    return {
      todaySales: 0,
      todayCollections: 0,
      totalOutstanding: 0,
      customerAdvance: 0,
      pendingDeliveriesCount: 0,
      completedDeliveriesCount: 0,
      totalExpensesToday: 0,
      cashExpensesToday: 0,
      contributionBeforeCogsToday: 0,
      activeWorkersCount: 0,
      monthlySales: 0,
      monthlyCollections: 0,
      currentMonthSalesCollected: 0,
      priorPeriodUdhariCollected: 0,
      currentMonthCreditSales: 0,
      monthlyUdhari: 0,
      pendingCreditAmount: 0,
      monthlyCash: 0,
      monthlyCheque: 0,
      sapBaselineSales: 0,
      distrotrackMonthlySales: 0,
      totalMonthlySales: 0,
      hasSapSales: false,
      goLiveCutoffDate: null,
      sapSalesCount: 0,
      sapUniqueSkus: 0,
      sapUniqueCustomers: 0,
    };
  }
}
