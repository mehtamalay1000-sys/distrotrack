/**
 * DistroTrack v2 — Month-End Purchase-Basis Net Margin Service
 *
 * Dedicated service for calculating and presenting the Month-End Profitability Model:
 *   Month-End Net Margin = Monthly Sales - Confirmed Monthly SAP Purchases - Approved Monthly Expenses
 *
 * Distinguishes from Route Realized Profitability:
 *   Route Profit = Route Sales - Delivered Goods COGS - Approved Route Expenses
 */

import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { MonthEndPurchaseMarginSummary } from '@/lib/database.types';

/**
 * Returns true if the given date is in the last 7 calendar days of its month.
 * Suggested behavior per prompt:
 *   Days 1 to ~23: Normal dashboard, no prominent month-end margin card.
 *   Last 7 calendar days: Show Month-End Profitability section.
 */
export function isLastWeekOfMonth(date: Date = new Date()): boolean {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const year = d.getFullYear();
  const month = d.getMonth();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const currentDay = d.getDate();
  return (lastDayOfMonth - currentDay) < 7;
}

/**
 * Returns true if the selected year/month is in the past compared to referenceDate.
 * Past months are considered closed and their finalized month-end result is always viewable.
 */
export function isClosedMonth(year: number, month: number, referenceDate: Date = new Date()): boolean {
  const ref = referenceDate instanceof Date && !isNaN(referenceDate.getTime()) ? referenceDate : new Date();
  const currentYear = ref.getFullYear();
  const currentMonth = ref.getMonth() + 1; // 1-based
  if (year < currentYear) return true;
  if (year === currentYear && month < currentMonth) return true;
  return false;
}

/**
 * Fetches authoritative month-end purchase-basis net margin with full drilldowns.
 * Calls get_month_end_purchase_margin RPC with graceful fallback to mockStore.
 */
export async function getMonthEndPurchaseMargin(
  year: number,
  month: number
): Promise<MonthEndPurchaseMarginSummary> {
  try {
    const { data, error } = await supabase.rpc('get_month_end_purchase_margin' as any, {
      p_year: year,
      p_month: month,
    });

    if (!error && data && data.success) {
      return {
        success: true,
        year: Number(data.year),
        month: Number(data.month),
        start_date: data.start_date,
        end_date: data.end_date,
        sales_revenue: Number(data.sales_revenue || 0),
        purchase_spend: Number(data.purchase_spend || 0),
        approved_expenses: Number(data.approved_expenses || 0),
        month_end_net_margin: Number(data.month_end_net_margin || 0),
        net_margin_pct: data.net_margin_pct !== null && data.net_margin_pct !== undefined ? Number(data.net_margin_pct) : null,
        purchase_batches_count: Number(data.purchase_batches_count || 0),
        purchase_items_count: Number(data.purchase_items_count || 0),
        total_received_qty: Number(data.total_received_qty || 0),
        purchase_batches: data.purchase_batches || [],
        sales_by_route: data.sales_by_route || [],
        expenses_breakdown: data.expenses_breakdown || [],
        realized_cogs: Number(data.realized_cogs || 0),
        realized_gross_profit: Number(data.realized_gross_profit || 0),
        realized_net_profit: Number(data.realized_net_profit || 0),
        model_label: data.model_label || 'Month-End Net Margin (Purchase Basis)',
        model_explanation: data.model_explanation || 'Sales − Confirmed Monthly Purchases − Approved Expenses',
      };
    }
  } catch (err) {
    console.warn('[MONTH_END_MARGIN] RPC get_month_end_purchase_margin unavailable, using fallback:', err);
  }

  // Authoritative fallback: aggregate through mockStore
  return mockStore.getMonthEndPurchaseMargin(year, month);
}
