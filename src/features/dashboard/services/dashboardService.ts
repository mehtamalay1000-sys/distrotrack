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
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const todayStr = new Date().toISOString().split('T')[0];

  try {
    const [picklists, deliveries, payments, expenses, parties, workers] = await Promise.all([
      getPicklists().catch(() => []),
      getDeliveries().catch(() => []),
      getPayments().catch(() => []),
      getExpenses().catch(() => []),
      getParties().catch(() => []),
      getWorkers().catch(() => []),
    ]);

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

    return {
      todaySales,
      todayCollections,
      totalOutstanding,
      pendingDeliveriesCount,
      completedDeliveriesCount,
      totalExpensesToday,
      activeWorkersCount,
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
    };
  }
}
