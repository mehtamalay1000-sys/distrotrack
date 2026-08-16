import { supabase } from '@/lib/supabase';
import { getPicklists } from '@/features/picklists/services/picklistService';
import { getDeliveries } from '@/features/deliveries/services/deliveryService';
import { getPayments } from '@/features/payments/services/paymentService';
import { getExpenses } from '@/features/expenses/services/expenseService';
import { getParties } from '@/features/parties/services/partyService';
import { getWorkers } from '@/features/workers/services/workerService';

export interface DashboardStats {
  todaySales: number;
  todayCollections: number;
  totalOutstanding: number;
  pendingDeliveriesCount: number;
  completedDeliveriesCount: number;
  totalExpensesToday: number;
  activeWorkersCount: number;
  // Monthly stats
  monthlySales: number;
  monthlyCollections: number;
  monthlyUdhari: number;
  monthlyCash: number;
  monthlyCheque: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  /** Check if a date string falls in the current month */
  function isCurrentMonth(dateStr: string | null | undefined): boolean {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  }

  try {
    const [picklists, deliveries, payments, expenses, parties, workers] = await Promise.all([
      getPicklists().catch(() => []),
      getDeliveries().catch(() => []),
      getPayments().catch(() => []),
      getExpenses().catch(() => []),
      getParties().catch(() => []),
      getWorkers().catch(() => []),
    ]);

    // ── Daily Stats (use today's date) ─────────────────────────────────

    const todaySales = picklists
      .filter((p) => p.date === todayStr || p.created_at?.startsWith(todayStr))
      .reduce((sum, p) => sum + Number(p.total_amount || 0), 0);

    const todayCollections = payments
      .filter((p) => (p.payment_mode === 'cash' || p.payment_mode === 'cheque' || p.payment_mode === 'upi') && (p.payment_date === todayStr || p.created_at?.startsWith(todayStr)))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    // Total outstanding Udhari: Derived from active pending deliveries.
    // If there are no active deliveries or picklists, totalOutstanding must be 0!
    let totalOutstanding = 0;
    if (deliveries.length > 0) {
      totalOutstanding = deliveries
        .filter((d) => d.status === 'pending' || d.status === 'out_for_delivery' || d.status === 'partial')
        .reduce((sum, d) => sum + Math.max(0, Number(d.total_amount || 0) - Number(d.collected_amount || 0)), 0);
    } else if (picklists.length === 0) {
      totalOutstanding = 0;
    } else {
      totalOutstanding = parties.reduce((sum, p) => sum + Number(p.outstanding_amount || 0), 0);
    }

    const pendingDeliveriesCount = deliveries.filter((d) => d.status === 'pending' || d.status === 'out_for_delivery').length;
    const completedDeliveriesCount = deliveries.filter((d) => d.status === 'delivered' || d.status === 'partial').length;

    const totalExpensesToday = expenses
      .filter((e) => e.date === todayStr || e.created_at?.startsWith(todayStr))
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
      .filter((p) => isCurrentMonth(p.date) || isCurrentMonth(p.created_at))
      .reduce((sum, p) => sum + Number(p.total_amount || 0), 0);

    const monthlyPayments = payments.filter(
      (p) => isCurrentMonth(p.payment_date) || isCurrentMonth(p.created_at)
    );

    const monthlyCollections = monthlyPayments
      .filter((p) => p.payment_mode !== 'credit')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const monthlyUdhari = monthlyPayments
      .filter((p) => p.payment_mode === 'credit')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

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
