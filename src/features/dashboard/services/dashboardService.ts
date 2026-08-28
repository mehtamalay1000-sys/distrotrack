import { supabase } from '@/lib/supabase';
import { getPicklists } from '@/features/picklists/services/picklistService';
import { getDeliveries } from '@/features/deliveries/services/deliveryService';
import { getPayments } from '@/features/payments/services/paymentService';
import { getExpenses } from '@/features/expenses/services/expenseService';
import { getWorkers } from '@/features/workers/services/workerService';
import { getLocalDateString, parseEffectiveDateString } from '@/shared/utils/format';

export interface DashboardStats {
  todaySales: number;
  todayCollections: number;
  totalOutstanding: number;
  pendingDeliveriesCount: number;
  completedDeliveriesCount: number;
  totalExpensesToday: number;
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

  /** Check if a date string falls in the current month */
  function isCurrentMonth(dateStr: string | null | undefined): boolean {
    if (!dateStr) return false;
    const cleanStr = parseEffectiveDateString(dateStr);
    const d = new Date(cleanStr);
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  }

  try {
    const [picklists, deliveries, payments, expenses, workers] = await Promise.all([
      getPicklists().catch(() => []),
      getDeliveries().catch(() => []),
      getPayments().catch(() => []),
      getExpenses().catch(() => []),
      getWorkers().catch(() => []),
    ]);

    // ── Helper: Effective Date matching ──────────────────────────────
    const getEffectiveDate = (dateStr: string | null | undefined, createdAtStr: string | null | undefined): string => {
      return parseEffectiveDateString(dateStr || createdAtStr);
    };

    // ── Daily Stats (strictly for today's delivery/operations date) ─────

    // Today's Sales: only picklists scheduled for today
    const todaySales = picklists
      .filter((p) => getEffectiveDate(p.date, p.created_at) === todayStr)
      .reduce((sum, p) => sum + Number(p.total_amount || 0), 0);

    // Today's Collections: payments collected on today's date (cash, cheque, upi)
    const todayCollections = payments
      .filter((p) => {
        const isDirectMode = p.payment_mode === 'cash' || p.payment_mode === 'cheque' || p.payment_mode === 'upi';
        return isDirectMode && getEffectiveDate(p.payment_date, p.created_at) === todayStr;
      })
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    // Deliveries scheduled for today
    const todayDeliveries = deliveries.filter(
      (d) => getEffectiveDate(d.delivery_date, d.created_at) === todayStr
    );

    // Pending / Completed counts for today's deliveries
    const pendingDeliveriesCount = todayDeliveries.filter(
      (d) => d.status === 'pending' || d.status === 'out_for_delivery'
    ).length;

    const completedDeliveriesCount = todayDeliveries.filter(
      (d) => d.status === 'delivered' || d.status === 'partial'
    ).length;

    // Total outstanding Udhari for today's deliveries (credit deliveries + partials + pending)
    const creditPaymentsToday = payments
      .filter((p) => p.payment_mode === 'credit' && getEffectiveDate(p.payment_date, p.created_at) === todayStr)
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const deliveryUdhariToday = todayDeliveries
      .filter((d) => d.payment_mode === 'credit' || d.status === 'pending' || d.status === 'out_for_delivery' || d.status === 'partial')
      .reduce((sum, d) => sum + Math.max(0, Number(d.total_amount || 0) - Number(d.collected_amount || 0)), 0);

    const totalOutstanding = Math.max(creditPaymentsToday, deliveryUdhariToday);

    const totalExpensesToday = expenses
      .filter((e) => getEffectiveDate(e.date, e.created_at) === todayStr)
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);

    let activeWorkersCount = workers.filter((w) => w.status === 'active').length;
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

    // ── Monthly Stats ──────────────────────────────────────────────────

    const monthlySales = picklists
      .filter((p) => isCurrentMonth(p.date || p.created_at))
      .reduce((sum, p) => sum + Number(p.total_amount || 0), 0);

    const monthlyPayments = payments.filter(
      (p) => isCurrentMonth(p.payment_date || p.created_at)
    );

    const monthlyCollections = monthlyPayments
      .filter((p) => p.payment_mode !== 'credit')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const creditFromPayments = monthlyPayments
      .filter((p) => p.payment_mode === 'credit')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const creditFromDeliveries = deliveries
      .filter((d) => isCurrentMonth(d.delivery_date || d.created_at) && (d.payment_mode === 'credit' || d.status === 'pending' || d.status === 'out_for_delivery'))
      .reduce((sum, d) => sum + Math.max(0, Number(d.total_amount || 0) - Number(d.collected_amount || 0)), 0);

    const monthlyUdhari = Math.max(creditFromPayments, creditFromDeliveries);

    const monthlyCash = monthlyPayments
      .filter((p) => p.payment_mode === 'cash')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const monthlyCheque = monthlyPayments
      .filter((p) => p.payment_mode === 'cheque')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    return {
      todaySales,
      todayCollections,
      totalOutstanding,
      pendingDeliveriesCount,
      completedDeliveriesCount,
      totalExpensesToday,
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
      activeWorkersCount: 0,
      monthlySales: 0,
      monthlyCollections: 0,
      monthlyUdhari: 0,
      monthlyCash: 0,
      monthlyCheque: 0,
    };
  }
}
