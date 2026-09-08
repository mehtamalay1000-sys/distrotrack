import { supabase } from '@/lib/supabase';
import { getDeliveries } from '@/features/deliveries/services/deliveryService';
import { getWorkers } from '@/features/workers/services/workerService';
import { getLocalDateString, parseEffectiveDateString } from '@/shared/utils/format';
import type { Delivery, Worker, FinancialSummary } from '@/lib/database.types';

export interface DashboardStats {
  todaySales: number;
  todayCollections: number;
  totalOutstanding: number;
  pendingDeliveriesCount: number;
  completedDeliveriesCount: number;
  totalExpensesToday: number;
  cashExpensesToday: number;
  contributionBeforeCogsToday: number;
  activeWorkersCount: number;
  monthlySales: number;
  monthlyCollections: number;
  monthlyUdhari: number;
  monthlyCash: number;
  monthlyCheque: number;
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

    // ── P1 FIX: Extract using ACTUAL get_financial_summary response keys ──
    // RPC returns: sales, total_collected, cash, upi, cheque_cleared, cheque_pending,
    //              credit_extended, expenses, cash_expenses, net_cash, total_outstanding,
    //              contribution_before_cogs
    const todaySales = Number(todaySummaryRes?.sales ?? 0);
    const todayCollections = Number(todaySummaryRes?.total_collected ?? 0);
    const totalOutstanding = Number(todaySummaryRes?.total_outstanding ?? 0);
    const totalExpensesToday = Number(todaySummaryRes?.expenses ?? 0);
    const cashExpensesToday = Number(todaySummaryRes?.cash_expenses ?? 0);
    const contributionBeforeCogsToday = Number(todaySummaryRes?.contribution_before_cogs ?? 0);

    const monthlySales = Number(monthSummaryRes?.sales ?? 0);
    const monthlyCollections = Number(monthSummaryRes?.total_collected ?? 0);
    const monthlyUdhari = Number(monthSummaryRes?.credit_extended ?? 0);
    const monthlyCash = Number(monthSummaryRes?.cash ?? 0);
    // Cheque: cleared + pending (both cleared and pending cheques are in scope)
    const monthlyCheque = Number((monthSummaryRes?.cheque_cleared ?? 0) + (monthSummaryRes?.cheque_pending ?? 0));

    return {
      todaySales,
      todayCollections,
      totalOutstanding,
      pendingDeliveriesCount,
      completedDeliveriesCount,
      totalExpensesToday,
      cashExpensesToday,
      contributionBeforeCogsToday,
      activeWorkersCount,
      monthlySales,
      monthlyCollections,
      monthlyUdhari,
      monthlyCash,
      monthlyCheque,
    };
  } catch (err) {
    console.error('Error computing dashboard stats:', err);
    return {
      todaySales: 0,
      todayCollections: 0,
      totalOutstanding: 0,
      pendingDeliveriesCount: 0,
      completedDeliveriesCount: 0,
      totalExpensesToday: 0,
      cashExpensesToday: 0,
      contributionBeforeCogsToday: 0,
      activeWorkersCount: 0,
      monthlySales: 0,
      monthlyCollections: 0,
      monthlyUdhari: 0,
      monthlyCash: 0,
      monthlyCheque: 0,
    };
  }
}
