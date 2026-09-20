import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, DollarSign, Receipt, Download,
  Calendar, Building2, CreditCard, Banknote, RefreshCw,
  Truck, ArrowUpRight, Package, Users, FileSpreadsheet
} from 'lucide-react';
import { PageHeader, Card, StatCard, Button, LoadingState } from '@/shared/ui';
import { getPicklists } from '@/features/picklists/services/picklistService';
import { getPayments } from '@/features/payments/services/paymentService';
import { getParties } from '@/features/parties/services/partyService';
import { getExpenses, getRouteProfitability } from '@/features/expenses/services/expenseService';
import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import * as XLSX from 'xlsx';
import { formatCurrency, formatDate } from '@/shared/utils/format';

type PeriodPreset =
  | 'all'
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_year'
  | 'custom_month'
  | 'custom_range';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── SKU Aggregation Types ───────────────────────────────────────
interface SkuRow {
  sku: string;
  productName: string;
  orderedQty: number;
  deliveredQty: number;
  refusedQty: number;
  deliveredValue: number;
}

// ── Ledger-enriched party type ──────────────────────────────────
interface PartyLedgerInfo {
  party_id: string;
  oldest_debit_date: string | null;
  payment_count: number;
}

// ── Worker performance row ───────────────────────────────────────
interface WorkerPerfRow {
  worker_id: string;
  worker_name: string;
  picklist_count: number;
  sales: number;
  cash_collected: number;
  upi_collected: number;
  cheque_total: number;
  credit_sales: number;
  approved_expenses: number;
  contribution_before_cogs: number;
}

export function ReportsPage() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  // Filters state
  const [preset, setPreset] = useState<PeriodPreset>('this_month');
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  const [reportType, setReportType] = useState<
    'profitability' | 'sales' | 'collections' | 'monthly' | 'udhari' | 'expenses' | 'products' | 'workers'
  >('profitability');
  const [salesSourceFilter, setSalesSourceFilter] = useState<'all' | 'sap' | 'distrotrack'>('all');

  // ── 1. Calculate Date Filter Range ──────────────────────────────────
  const dateRange = useMemo<{
    start: Date | null;
    end: Date | null;
    startDateStr?: string;
    endDateStr?: string;
    label: string;
  }>(() => {
    const toYMD = (d: Date) => d.toISOString().split('T')[0];

    if (preset === 'all') {
      return { start: null, end: null, label: 'All Time Records' };
    }

    if (preset === 'this_month') {
      const start = new Date(currentYear, currentMonth, 1);
      const end = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
      return { start, end, startDateStr: toYMD(start), endDateStr: toYMD(end), label: `${MONTH_NAMES[currentMonth]} ${currentYear}` };
    }

    if (preset === 'last_month') {
      const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
      const start = new Date(prevYear, prevMonth, 1);
      const end = new Date(prevYear, prevMonth + 1, 0, 23, 59, 59, 999);
      return { start, end, startDateStr: toYMD(start), endDateStr: toYMD(end), label: `${MONTH_NAMES[prevMonth]} ${prevYear}` };
    }

    if (preset === 'last_3_months') {
      const start = new Date(currentYear, currentMonth - 2, 1);
      const end = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
      return { start, end, startDateStr: toYMD(start), endDateStr: toYMD(end), label: `Past 3 Months (${MONTH_NAMES[start.getMonth()]} - ${MONTH_NAMES[currentMonth]})` };
    }

    if (preset === 'last_6_months') {
      const start = new Date(currentYear, currentMonth - 5, 1);
      const end = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
      return { start, end, startDateStr: toYMD(start), endDateStr: toYMD(end), label: `Past 6 Months` };
    }

    if (preset === 'this_year') {
      const start = new Date(currentMonth >= 3 ? currentYear : currentYear - 1, 3, 1);
      const end = new Date(currentMonth >= 3 ? currentYear + 1 : currentYear, 2, 31, 23, 59, 59, 999);
      return { start, end, startDateStr: toYMD(start), endDateStr: toYMD(end), label: `FY ${start.getFullYear()}-${(start.getFullYear() + 1).toString().slice(-2)}` };
    }

    if (preset === 'custom_month') {
      const start = new Date(selectedYear, selectedMonth, 1);
      const end = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59, 999);
      return { start, end, startDateStr: toYMD(start), endDateStr: toYMD(end), label: `${MONTH_NAMES[selectedMonth]} ${selectedYear}` };
    }

    if (preset === 'custom_range') {
      const start = customStartDate ? new Date(`${customStartDate}T00:00:00`) : null;
      const end = customEndDate ? new Date(`${customEndDate}T23:59:59.999`) : null;
      return {
        start,
        end,
        startDateStr: customStartDate || undefined,
        endDateStr: customEndDate || undefined,
        label: `${customStartDate || 'Start'} to ${customEndDate || 'End'}`,
      };
    }

    return { start: null, end: null, label: 'All Records' };
  }, [preset, currentYear, currentMonth, selectedYear, selectedMonth, customStartDate, customEndDate]);

  const { data: routeProfitability, isLoading: rpLoading, refetch: refetchRp } = useQuery({
    queryKey: ['route-profitability', dateRange.startDateStr, dateRange.endDateStr],
    queryFn: () => getRouteProfitability({
      start_date: dateRange.startDateStr,
      end_date: dateRange.endDateStr,
    }),
  });

  const { data: picklists = [], isLoading: plLoading, refetch: refetchPl } = useQuery({
    queryKey: ['picklists'],
    queryFn: getPicklists,
  });
  const { data: payments = [], isLoading: payLoading, refetch: refetchPay } = useQuery({
    queryKey: ['payments'],
    queryFn: getPayments,
  });
  const { data: parties = [], isLoading: partLoading, refetch: refetchPart } = useQuery({
    queryKey: ['parties'],
    queryFn: getParties,
  });
  const { data: expenses = [], isLoading: expLoading, refetch: refetchExp } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => getExpenses(),
  });

  // P5: delivery_items for SKU analytics — only when that tab is active to avoid unnecessary load
  const { data: deliveryItemsRaw = [], isLoading: diLoading, refetch: refetchDi } = useQuery({
    queryKey: ['delivery-items-for-sku', dateRange.startDateStr, dateRange.endDateStr],
    queryFn: async () => {
      // Join delivery_items → deliveries → picklists to get the picklist date
      let q = supabase
        .from('delivery_items')
        .select(
          'id, sku, ordered_qty, delivered_qty, rate, delivery:deliveries!inner(id, status, picklist_id, picklist:picklists!inner(id, date))'
        );
      if (dateRange.startDateStr) {
        q = q.gte('delivery.picklist.date', dateRange.startDateStr);
      }
      if (dateRange.endDateStr) {
        q = q.lte('delivery.picklist.date', dateRange.endDateStr);
      }
      const { data, error } = await q;
      if (error) {
        console.warn('[ReportsPage] delivery_items query error:', error.message);
        return [];
      }
      return data ?? [];
    },
    enabled: reportType === 'products',
  });

  // P6: party_financial_ledger for oldest debit date + payment count
  const { data: partyLedgerStats = [], refetch: refetchLedger } = useQuery({
    queryKey: ['party-ledger-stats'],
    queryFn: async (): Promise<PartyLedgerInfo[]> => {
      const { data, error } = await supabase
        .from('party_financial_ledger')
        .select('party_id, entry_type, direction, created_at, status')
        .eq('status', 'valid');
      if (error) {
        console.warn('[ReportsPage] party_financial_ledger query error:', error.message);
        return [];
      }
      const rows = data ?? [];
      // Aggregate per party
      const statsMap: Record<string, { oldest_debit: string | null; payment_count: number }> = {};
      for (const row of rows) {
        if (!statsMap[row.party_id]) {
          statsMap[row.party_id] = { oldest_debit: null, payment_count: 0 };
        }
        if (row.direction === 'debit') {
          const d = row.created_at;
          if (!statsMap[row.party_id].oldest_debit || d < statsMap[row.party_id].oldest_debit!) {
            statsMap[row.party_id].oldest_debit = d;
          }
        }
        if (row.entry_type === 'payment') {
          statsMap[row.party_id].payment_count += 1;
        }
      }
      return Object.entries(statsMap).map(([party_id, s]) => ({
        party_id,
        oldest_debit_date: s.oldest_debit,
        payment_count: s.payment_count,
      }));
    },
    enabled: reportType === 'udhari',
  });

  // P7: Authoritative SAP baseline sales for period reports
  const { data: sapSalesItems = [], refetch: refetchSapSales } = useQuery({
    queryKey: ['sap-sales-items-reports'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('sap_sales_import_items').select('*');
        if (!error && data && data.length > 0) return data;
      } catch {}
      return mockStore.getSapSalesImportItems();
    },
  });

  const isDataLoading = rpLoading || plLoading || payLoading || partLoading || expLoading;

  const handleRefresh = () => {
    refetchRp();
    refetchPl();
    refetchPay();
    refetchPart();
    refetchExp();
    refetchDi();
    refetchLedger();
    refetchSapSales();
  };

  // ── Helper: Check if item date is within range ──────────────────────
  const isDateInRange = (itemDateStr?: string | null): boolean => {
    if (!dateRange.start && !dateRange.end) return true;
    if (!itemDateStr) return false;
    try {
      const itemDate = new Date(itemDateStr).getTime();
      if (dateRange.start && itemDate < dateRange.start.getTime()) return false;
      if (dateRange.end && itemDate > dateRange.end.getTime()) return false;
      return true;
    } catch {
      return false;
    }
  };

  // ── Filtered Datasets ───────────────────────────────────────────────
  const filteredSapSales = useMemo(() => {
    return sapSalesItems.filter((s: any) => {
      const d = s.invoice_date || (s.created_at ? s.created_at.split('T')[0] : null);
      return isDateInRange(d);
    });
  }, [sapSalesItems, dateRange]);

  const filteredPicklists = useMemo(() => {
    return picklists.filter((pl) => isDateInRange(pl.date || pl.created_at));
  }, [picklists, dateRange]);

  const filteredPayments = useMemo(() => {
    return payments.filter(
      (p) =>
        isDateInRange(p.payment_date || p.created_at) &&
        p.status !== 'reversed' &&
        p.status !== 'bounced'
    );
  }, [payments, dateRange]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => isDateInRange(e.date || e.created_at));
  }, [expenses, dateRange]);

  // Only approved expenses affect financial totals
  const approvedFilteredExpenses = useMemo(() => {
    return filteredExpenses.filter((e) => e.status === 'approved');
  }, [filteredExpenses]);

  // ── Authoritative Totals ────────────────────────────────────────────
  // Calculate SAP baseline sales for selected period
  const sapSalesPeriodValue = useMemo(() => {
    return filteredSapSales.reduce((sum: number, s: any) => {
      const isCancel = Boolean(s.is_cancellation);
      const qty = Number(s.quantity || 0);
      const rate = Number(s.rate || 0);
      const val = Number(
        s.net_val !== null && s.net_val !== undefined
          ? s.net_val
          : (isCancel ? -qty : qty) * rate
      );
      return sum + val;
    }, 0);
  }, [filteredSapSales]);

  // When available, prefer PostgreSQL authoritative totals from routeProfitability for operational sales
  const operationalSalesValue = routeProfitability?.totals?.sales ??
    filteredPicklists.reduce((sum, p) => sum + Number(p.total_amount || 0), 0);

  const totalSalesValue =
    salesSourceFilter === 'sap'
      ? sapSalesPeriodValue
      : salesSourceFilter === 'distrotrack'
      ? operationalSalesValue
      : operationalSalesValue + sapSalesPeriodValue;

  const totalCashCollected = routeProfitability?.totals?.cash_collected ??
    filteredPayments
      .filter((p) => p.payment_mode === 'cash')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const totalChequeCollected = (routeProfitability?.totals ? (Number(routeProfitability.totals.cheque_cleared || 0) + Number(routeProfitability.totals.cheque_pending || 0)) : null) ??
    filteredPayments
      .filter((p) => p.payment_mode === 'cheque')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const totalUpiCollected = routeProfitability?.totals?.upi_collected ??
    filteredPayments
      .filter((p) => p.payment_mode === 'upi')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const totalActualCollections = totalCashCollected + totalChequeCollected + totalUpiCollected;

  // Cumulative Outstanding Balance from parties
  const totalOutstandingBalance = parties.reduce((sum, p) => sum + Number(p.outstanding_amount || 0), 0);

  // Authoritative approved route operating expenses
  const totalApprovedExpenses = routeProfitability?.totals?.approved_expenses ??
    approvedFilteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  // Route Contribution Before COGS = Delivered Commercial Sales - Approved Operating Expenses
  const routeContributionBeforeCogs = routeProfitability?.totals?.contribution_before_cogs ??
    (totalSalesValue - totalApprovedExpenses);

  const totalApprovedCashExpenses = routeProfitability?.totals?.cash_expenses ??
    approvedFilteredExpenses
      .filter((e) => e.payment_method === 'cash')
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  // Expected cash = cash collected - approved cash expenses
  const totalExpectedCash = routeProfitability?.totals?.expected_cash ??
    (totalCashCollected - totalApprovedCashExpenses);

  // ── P4 FIX: Multi-Month Trend — Authoritative Sales from routeProfitability ──
  // Build a map of month-key → sales from route profitability data (authoritative)
  // For months without RP data, fall back to 0 (not planned picklist total).
  const monthlyBreakdown = useMemo(() => {
    const monthsMap: Record<
      string,
      {
        key: string;
        label: string;
        year: number;
        monthIndex: number;
        sales: number;      // Authoritative: from route profitability (delivered commercial)
        cash: number;       // Cash collections (payments table)
        upi: number;        // P4 FIX: UPI separate from cheque
        chequeCl: number;   // P4 FIX: Cheque cleared separate
        chequePe: number;   // P4 FIX: Cheque pending separate
        credit: number;     // Credit extended (non-collection)
        collected: number;  // Cash + UPI + Cheque cleared
        expenses: number;   // Approved expenses only
        picklistsCount: number;
      }
    > = {};

    for (let i = 0; i < 12; i++) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const key = `${y}-${String(m + 1).padStart(2, '0')}`;
      monthsMap[key] = {
        key,
        label: `${MONTH_NAMES[m].slice(0, 3)} ${y}`,
        year: y,
        monthIndex: m,
        sales: 0,
        cash: 0,
        upi: 0,
        chequeCl: 0,
        chequePe: 0,
        credit: 0,
        collected: 0,
        expenses: 0,
        picklistsCount: 0,
      };
    }

    // P4 FIX: Use route profitability data for delivered commercial sales per month.
    // Aggregate route profitability items (each is a picklist/trip) into monthly buckets.
    // Falls back to 0 if routeProfitability isn't available (authoritative RPC preferred).
    if (routeProfitability?.routes) {
      for (const rp of routeProfitability.routes) {
        const dStr = rp.date;
        if (!dStr) continue;
        const d = new Date(dStr);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (monthsMap[key]) {
          monthsMap[key].sales += Number(rp.sales || 0);
          monthsMap[key].picklistsCount += 1;
        }
      }
    } else {
      // Fallback: count picklists only (do NOT use pl.total_amount as sales)
      picklists.forEach((pl) => {
        const dStr = pl.date || pl.created_at;
        if (!dStr) return;
        const d = new Date(dStr);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (monthsMap[key]) {
          monthsMap[key].picklistsCount += 1;
          // Sales remain 0 — do not use planned total_amount
        }
      });
    }

    // P4 FIX: Separate UPI from Cheque in payment aggregation
    payments.forEach((p) => {
      if (p.status === 'reversed' || p.status === 'bounced') return;
      const dStr = p.payment_date || p.created_at;
      if (!dStr) return;
      const d = new Date(dStr);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (monthsMap[key]) {
        const amt = Number(p.amount || 0);
        if (p.payment_mode === 'cash') {
          monthsMap[key].cash += amt;
          monthsMap[key].collected += amt;
        } else if (p.payment_mode === 'upi') {
          // P4 FIX: UPI is separate from cheque
          monthsMap[key].upi += amt;
          monthsMap[key].collected += amt;
        } else if (p.payment_mode === 'cheque') {
          // P4 FIX: Cheque split into cleared vs pending
          if (p.status === 'cleared') {
            monthsMap[key].chequeCl += amt;
          } else {
            monthsMap[key].chequePe += amt;
          }
          // Only cleared cheques count as collected (matching RPC definition)
          if (p.status === 'cleared') {
            monthsMap[key].collected += amt;
          }
        } else if (p.payment_mode === 'credit') {
          monthsMap[key].credit += amt;
        }
      }
    });

    // Only count approved expenses
    expenses.forEach((e) => {
      if (e.status !== 'approved') return;
      const dStr = e.date || e.created_at;
      if (!dStr) return;
      const d = new Date(dStr);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (monthsMap[key]) {
        monthsMap[key].expenses += Number(e.amount || 0);
      }
    });

    // Add SAP baseline sales to monthly trend if source filter includes SAP
    if (salesSourceFilter !== 'distrotrack') {
      sapSalesItems.forEach((s: any) => {
        const dStr = s.invoice_date || (s.created_at ? s.created_at.split('T')[0] : '');
        if (!dStr) return;
        const d = new Date(dStr);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (monthsMap[key]) {
          const isCancel = Boolean(s.is_cancellation);
          const qty = Number(s.quantity || 0);
          const rate = Number(s.rate || 0);
          const val = Number(
            s.net_val !== null && s.net_val !== undefined
              ? s.net_val
              : (isCancel ? -qty : qty) * rate
          );
          if (salesSourceFilter === 'sap') {
            // SAP only: replace operational sales with SAP baseline
            if (!monthsMap[key].label.includes('(SAP)')) {
              monthsMap[key].sales = 0;
              monthsMap[key].label += ' ';
            }
          }
          monthsMap[key].sales += val;
        }
      });
    } else {
      // DistroTrack only: ensure no SAP sales are included
    }

    return Object.values(monthsMap);
  }, [routeProfitability, picklists, payments, expenses, sapSalesItems, salesSourceFilter, currentYear, currentMonth]);

  // ── P5: SKU Aggregation from delivery_items and SAP baseline sales ────
  const skuRows = useMemo((): SkuRow[] => {
    const skuMap: Record<string, SkuRow> = {};

    // 1. DistroTrack operational delivery items
    if (salesSourceFilter !== 'sap') {
      for (const item of deliveryItemsRaw) {
        const delivery = item.delivery as any;
        // Only include delivered/partial status deliveries for delivered qty/value
        const isDelivered = delivery?.status === 'delivered' || delivery?.status === 'partial';
        const sku = String(item.sku || 'UNKNOWN');
        if (!skuMap[sku]) {
          skuMap[sku] = {
            sku,
            productName: '—',
            orderedQty: 0,
            deliveredQty: 0,
            refusedQty: 0,
            deliveredValue: 0,
          };
        }
        const ordered = Number(item.ordered_qty || 0);
        const delivered = isDelivered ? Number(item.delivered_qty || 0) : 0;
        const rate = Number(item.rate || 0);
        skuMap[sku].orderedQty += ordered;
        skuMap[sku].deliveredQty += delivered;
        // Refused = ordered - delivered (for completed deliveries only; pending = 0 refused)
        if (isDelivered) {
          skuMap[sku].refusedQty += Math.max(0, ordered - delivered);
        }
        // Delivered commercial value = delivered qty × rate (refused qty contributes 0)
        skuMap[sku].deliveredValue += delivered * rate;
      }
    }

    // 2. SAP baseline sales items for the period
    if (salesSourceFilter !== 'distrotrack') {
      for (const sItem of filteredSapSales) {
        const sku = String(sItem.sku || 'UNKNOWN').trim().toUpperCase();
        if (!sku) continue;
        if (!skuMap[sku]) {
          skuMap[sku] = {
            sku,
            productName: sItem.product_name || '—',
            orderedQty: 0,
            deliveredQty: 0,
            refusedQty: 0,
            deliveredValue: 0,
          };
        }
        const isCancel = Boolean(sItem.is_cancellation);
        const qty = Number(sItem.quantity || 0);
        const rate = Number(sItem.rate || 0);
        const netQty = isCancel ? -qty : qty;
        const val = Number(
          sItem.net_val !== null && sItem.net_val !== undefined
            ? sItem.net_val
            : netQty * rate
        );
        skuMap[sku].orderedQty += netQty;
        skuMap[sku].deliveredQty += netQty;
        skuMap[sku].deliveredValue += val;
      }
    }

    return Object.values(skuMap).sort((a, b) => b.deliveredValue - a.deliveredValue);
  }, [deliveryItemsRaw, filteredSapSales, salesSourceFilter]);

  // ── P7: Worker Performance from routeProfitability ───────────────────
  const workerPerfRows = useMemo((): WorkerPerfRow[] => {
    if (!routeProfitability?.routes) return [];
    const workerMap: Record<string, WorkerPerfRow> = {};
    for (const rp of routeProfitability.routes) {
      if (!rp.worker_id) continue;
      const key = rp.worker_id;
      if (!workerMap[key]) {
        workerMap[key] = {
          worker_id: rp.worker_id,
          worker_name: rp.worker_name || 'Unknown',
          picklist_count: 0,
          sales: 0,
          cash_collected: 0,
          upi_collected: 0,
          cheque_total: 0,
          credit_sales: 0,
          approved_expenses: 0,
          contribution_before_cogs: 0,
        };
      }
      const w = workerMap[key];
      w.picklist_count += 1;
      w.sales += Number(rp.sales || 0);
      w.cash_collected += Number(rp.cash_collected || 0);
      w.upi_collected += Number(rp.upi_collected || 0);
      w.cheque_total += Number((rp.cheque_cleared || 0) + (rp.cheque_pending || 0));
      w.credit_sales += Number(rp.credit_sales || 0);
      w.approved_expenses += Number(rp.approved_expenses || 0);
      w.contribution_before_cogs += Number(rp.contribution_before_cogs || 0);
    }
    return Object.values(workerMap).sort((a, b) => b.sales - a.sales);
  }, [routeProfitability]);

  if (isDataLoading) {
    return <LoadingState message="Calculating authoritative route profitability & financial records…" />;
  }

  const tabClass = (active: boolean) =>
    `pb-2.5 px-1 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
      active
        ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300'
        : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
    }`;

  const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    const summaryData = [
      { Metric: 'Reporting Period', Value: dateRange.label },
      { Metric: 'Total Delivered Sales', Value: totalSalesValue },
      { Metric: 'Total Realized Collections', Value: totalActualCollections },
      { Metric: 'Cash Collections', Value: totalCashCollected },
      { Metric: 'UPI Collections', Value: totalUpiCollected },
      { Metric: 'Cheque Collections', Value: totalChequeCollected },
      { Metric: 'Total Approved Operating Expenses', Value: totalApprovedExpenses },
      { Metric: 'Total Outstanding Receivables (Udhari)', Value: totalOutstandingBalance },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Financial Summary');

    if (workerPerfRows.length > 0) {
      const wsWorkers = XLSX.utils.json_to_sheet(
        workerPerfRows.map((w) => ({
          'Worker Name': w.worker_name,
          'Picklists': w.picklist_count,
          'Commercial Sales': w.sales,
          'Cash Collected': w.cash_collected,
          'UPI Collected': w.upi_collected,
          'Cheque Total': w.cheque_total,
          'Credit Sales': w.credit_sales,
          'Approved Expenses': w.approved_expenses,
          'Contribution Before COGS': w.contribution_before_cogs,
        }))
      );
      XLSX.utils.book_append_sheet(wb, wsWorkers, 'Worker Performance');
    }

    const partyData = parties.map((p) => ({
      'Party Code': p.code,
      'Party Name': p.name,
      'Outstanding Udhari': Math.max(0, Number(p.outstanding_amount || 0)),
    }));
    const wsParties = XLSX.utils.json_to_sheet(partyData);
    XLSX.utils.book_append_sheet(wb, wsParties, 'Customer Receivables');

    XLSX.writeFile(wb, `DistroTrack_Financial_Report_${dateRange.startDateStr || 'all'}.xlsx`);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <PageHeader
        title="Reports & Route Analytics"
        description="Comprehensive intelligence on sales volume, route collections, monthly performance, and customer ledgers"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={handleRefresh}
            >
              Refresh
            </Button>
            <Button
              variant="outline"
              icon={<FileSpreadsheet className="h-4 w-4" />}
              onClick={handleExportExcel}
            >
              Export Excel
            </Button>
            <Button
              variant="primary"
              icon={<Download className="h-4 w-4" />}
              onClick={() => window.print()}
            >
              Print / PDF
            </Button>
          </div>
        }
      />

      {/* ── Period Selector Bar ──────────────────────────────────────── */}
      <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-100 dark:border-blue-800/40">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-surface-400">
                Reporting Period
              </div>
              <div className="text-sm font-black text-surface-900 dark:text-white">
                {dateRange.label}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as PeriodPreset)}
              className="h-9 px-3 text-xs font-bold border border-surface-200 dark:border-surface-600 rounded-xl bg-surface-50 dark:bg-surface-900 text-surface-800 dark:text-surface-100 outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="this_month">📅 This Month ({MONTH_NAMES[currentMonth].slice(0, 3)})</option>
              <option value="last_month">⏮️ Last Month</option>
              <option value="last_3_months">📊 Past 3 Months</option>
              <option value="last_6_months">📈 Past 6 Months</option>
              <option value="this_year">🏛️ Financial Year (FY)</option>
              <option value="custom_month">🗓️ Select Month & Year</option>
              <option value="custom_range">📐 Custom Date Range</option>
              <option value="all">♾️ All Time</option>
            </select>

            {/* Source Filter (Section 27) */}
            <select
              value={salesSourceFilter}
              onChange={(e) => setSalesSourceFilter(e.target.value as 'all' | 'sap' | 'distrotrack')}
              className="h-9 px-3 text-xs font-bold border border-surface-200 dark:border-surface-600 rounded-xl bg-surface-50 dark:bg-surface-900 text-surface-800 dark:text-surface-100 outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="all">📦 All Sources (Combined)</option>
              <option value="sap">🏛️ SAP Baseline Only</option>
              <option value="distrotrack">🚚 DistroTrack Only</option>
            </select>

            {preset === 'custom_month' && (
              <div className="flex items-center gap-1.5 animate-in fade-in duration-200">
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="h-9 px-2.5 text-xs font-bold border border-surface-200 dark:border-surface-600 rounded-xl bg-surface-50 dark:bg-surface-900 text-surface-800 dark:text-surface-100"
                >
                  {MONTH_NAMES.map((m, idx) => (
                    <option key={m} value={idx}>{m}</option>
                  ))}
                </select>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="h-9 px-2.5 text-xs font-bold border border-surface-200 dark:border-surface-600 rounded-xl bg-surface-50 dark:bg-surface-900 text-surface-800 dark:text-surface-100"
                >
                  {availableYears.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}

            {preset === 'custom_range' && (
              <div className="flex items-center gap-1.5 animate-in fade-in duration-200">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="h-9 px-2 text-xs font-semibold border border-surface-200 dark:border-surface-600 rounded-xl bg-surface-50 dark:bg-surface-900 text-surface-800 dark:text-surface-100"
                />
                <span className="text-xs text-surface-400 font-bold">to</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="h-9 px-2 text-xs font-semibold border border-surface-200 dark:border-surface-600 rounded-xl bg-surface-50 dark:bg-surface-900 text-surface-800 dark:text-surface-100"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── KPI Cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Delivered Commercial Sales"
          value={formatCurrency(totalSalesValue)}
          icon={<TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
        />

        <StatCard
          label="Realized Collections"
          value={formatCurrency(totalActualCollections)}
          icon={<DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
        />

        <StatCard
          label="Approved Operating Expenses"
          value={formatCurrency(totalApprovedExpenses)}
          icon={<Receipt className="h-5 w-5 text-rose-500 dark:text-rose-400" />}
        />

        <StatCard
          label="Contribution Before COGS"
          value={formatCurrency(routeContributionBeforeCogs)}
          icon={<ArrowUpRight className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
        />
      </div>

      {/* ── Secondary Financial Reconciliation Highlights ────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-3 shadow-xs">
        <div className="p-2 border-r border-surface-100 dark:border-surface-700 last:border-0">
          <div className="text-[10px] font-bold text-surface-400 uppercase flex items-center gap-1">
            <Banknote className="h-3 w-3 text-emerald-500" /> Cash Collections
          </div>
          <div className="text-sm font-black text-emerald-700 dark:text-emerald-400 mt-0.5">
            {formatCurrency(totalCashCollected)}
          </div>
        </div>

        <div className="p-2 border-r border-surface-100 dark:border-surface-700 last:border-0">
          <div className="text-[10px] font-bold text-surface-400 uppercase flex items-center gap-1">
            <CreditCard className="h-3 w-3 text-blue-500" /> UPI & Cheque
          </div>
          <div className="text-sm font-black text-blue-700 dark:text-blue-400 mt-0.5">
            {formatCurrency(totalUpiCollected + totalChequeCollected)}
          </div>
        </div>

        <div className="p-2 border-r border-surface-100 dark:border-surface-700 last:border-0">
          <div className="text-[10px] font-bold text-surface-400 uppercase flex items-center gap-1">
            <Banknote className="h-3 w-3 text-rose-500" /> Approved Cash Expenses
          </div>
          <div className="text-sm font-black text-rose-600 dark:text-rose-400 mt-0.5">
            {formatCurrency(totalApprovedCashExpenses)}
          </div>
        </div>

        <div className="p-2 last:border-0">
          <div className="text-[10px] font-bold text-surface-400 uppercase flex items-center gap-1">
            <Building2 className="h-3 w-3 text-indigo-500" /> Expected Cash Handover
          </div>
          <div className="text-sm font-black text-indigo-700 dark:text-indigo-400 mt-0.5">
            {formatCurrency(totalExpectedCash)}
          </div>
        </div>
      </div>

      {/* ── Report Switcher Tabs ──────────────────────────────────────── */}
      <div className="border-b border-surface-200 dark:border-surface-700 flex gap-4 overflow-x-auto">
        <button onClick={() => setReportType('profitability')} className={tabClass(reportType === 'profitability')}>
          📈 Route Contribution & Profitability ({routeProfitability?.routes?.length || 0})
        </button>
        <button onClick={() => setReportType('sales')} className={tabClass(reportType === 'sales')}>
          Sales Invoices ({filteredPicklists.length})
        </button>
        <button onClick={() => setReportType('collections')} className={tabClass(reportType === 'collections')}>
          Collections Log ({filteredPayments.length})
        </button>
        <button onClick={() => setReportType('monthly')} className={tabClass(reportType === 'monthly')}>
          📊 Past Monthly Performance (12 Mo)
        </button>
        <button onClick={() => setReportType('udhari')} className={tabClass(reportType === 'udhari')}>
          Outstanding Ledger ({parties.filter((p) => p.outstanding_amount > 0).length})
        </button>
        <button onClick={() => setReportType('expenses')} className={tabClass(reportType === 'expenses')}>
          Expenses Log ({filteredExpenses.length})
        </button>
        <button onClick={() => setReportType('products')} className={tabClass(reportType === 'products')}>
          <Package className="inline h-3 w-3 mr-1" />SKU Analytics
        </button>
        <button onClick={() => setReportType('workers')} className={tabClass(reportType === 'workers')}>
          <Users className="inline h-3 w-3 mr-1" />Worker Performance
        </button>
      </div>

      {/* ── Report Tables ─────────────────────────────────────────────── */}
      <Card className="p-0 overflow-hidden border-surface-200 dark:border-surface-700 shadow-xs">
        {/* ── 0. ROUTE PROFITABILITY & CONTRIBUTION REPORT ───────────── */}
        {reportType === 'profitability' && (
          <div className="overflow-x-auto">
            <div className="p-4 border-b border-surface-100 dark:border-surface-700 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-surface-900 dark:text-white flex items-center gap-2">
                  <Truck className="h-4 w-4 text-primary-500" /> Route Contribution & Financial Reconciliation (Authoritative)
                </h3>
                <p className="text-xs text-surface-500 mt-0.5">
                  Delivered commercial sales, collection mode breakdown, approved operating costs, and contribution before COGS
                </p>
              </div>
            </div>

            <table className="dt-table w-full text-xs">
              <thead>
                <tr>
                  <th>Route / Trip</th>
                  <th>Date</th>
                  <th>Worker</th>
                  <th className="text-right">Delivered Sales</th>
                  <th className="text-right">Cash</th>
                  <th className="text-right">UPI</th>
                  <th className="text-right">Cheque</th>
                  <th className="text-right">Credit</th>
                  <th className="text-right">Approved Expenses</th>
                  <th className="text-right">Cash Expenses</th>
                  <th className="text-right">Expected Cash</th>
                  <th className="text-right">Actual Cash</th>
                  <th className="text-right">Difference</th>
                  <th className="text-right font-black">Contribution Before COGS</th>
                  <th className="text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {(!routeProfitability?.routes || routeProfitability.routes.length === 0) && (
                  <tr>
                    <td colSpan={15} className="text-center py-12 text-xs text-surface-400">
                      No route financial runs found for {dateRange.label}.
                    </td>
                  </tr>
                )}
                {routeProfitability?.routes?.map((item, idx) => {
                  const hasDiscrepancy = Math.abs(item.cash_discrepancy) > 0.01;
                  return (
                    <tr key={item.picklist_id || idx} className="hover:bg-surface-50/70 dark:hover:bg-surface-700/50">
                      <td className="font-semibold text-surface-900 dark:text-white">
                        <div className="font-mono text-[10px] text-primary-600 dark:text-primary-400">{item.route_code}</div>
                        <div>{item.route_name}</div>
                      </td>
                      <td className="text-surface-600 dark:text-surface-400 whitespace-nowrap">
                        {formatDate(item.date)}
                      </td>
                      <td className="text-surface-700 dark:text-surface-300">
                        {item.worker_name || '—'}
                      </td>
                      <td className="text-right font-bold text-surface-900 dark:text-white">
                        {formatCurrency(item.sales)}
                      </td>
                      <td className="text-right font-medium text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(item.cash_collected)}
                      </td>
                      <td className="text-right font-medium text-blue-700 dark:text-blue-400">
                        {formatCurrency(item.upi_collected)}
                      </td>
                      <td className="text-right font-medium text-surface-700 dark:text-surface-300">
                        {formatCurrency(item.cheque_cleared + item.cheque_pending)}
                        {item.cheque_pending > 0 && (
                          <div className="text-[9px] text-amber-600 font-normal">
                            ({formatCurrency(item.cheque_pending)} pending)
                          </div>
                        )}
                      </td>
                      <td className="text-right font-medium text-amber-600 dark:text-amber-400">
                        {formatCurrency(item.credit_sales)}
                      </td>
                      <td className="text-right font-medium text-rose-600 dark:text-rose-400">
                        {formatCurrency(item.approved_expenses)}
                      </td>
                      <td className="text-right font-medium text-rose-500 dark:text-rose-400">
                        {formatCurrency(item.cash_expenses)}
                      </td>
                      <td className="text-right font-bold text-surface-900 dark:text-white">
                        {formatCurrency(item.expected_cash)}
                      </td>
                      <td className="text-right font-bold text-surface-900 dark:text-white">
                        {formatCurrency(item.actual_cash_returned)}
                      </td>
                      <td className={`text-right font-bold ${hasDiscrepancy ? 'text-rose-600 dark:text-rose-400' : 'text-surface-400'}`}>
                        {formatCurrency(item.cash_discrepancy)}
                      </td>
                      <td className="text-right font-black text-indigo-700 dark:text-indigo-300">
                        {formatCurrency(item.contribution_before_cogs)}
                      </td>
                      <td className="text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          item.financial_status === 'reconciled'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                        }`}>
                          {item.financial_status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {routeProfitability?.totals && routeProfitability.routes && routeProfitability.routes.length > 0 && (
                <tfoot>
                  <tr className="bg-surface-100/80 dark:bg-surface-750 font-black border-t-2 border-surface-300 dark:border-surface-600">
                    <td colSpan={3} className="text-surface-900 dark:text-white uppercase tracking-wider">
                      Authoritative Totals ({routeProfitability.routes.length} Routes)
                    </td>
                    <td className="text-right text-surface-900 dark:text-white">
                      {formatCurrency(routeProfitability.totals.sales)}
                    </td>
                    <td className="text-right text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(routeProfitability.totals.cash_collected)}
                    </td>
                    <td className="text-right text-blue-700 dark:text-blue-400">
                      {formatCurrency(routeProfitability.totals.upi_collected)}
                    </td>
                    <td className="text-right text-surface-700 dark:text-surface-300">
                      {formatCurrency(routeProfitability.totals.cheque_cleared + routeProfitability.totals.cheque_pending)}
                    </td>
                    <td className="text-right text-amber-600 dark:text-amber-400">
                      {formatCurrency(routeProfitability.totals.credit_sales)}
                    </td>
                    <td className="text-right text-rose-600 dark:text-rose-400">
                      {formatCurrency(routeProfitability.totals.approved_expenses)}
                    </td>
                    <td className="text-right text-rose-500 dark:text-rose-400">
                      {formatCurrency(routeProfitability.totals.cash_expenses)}
                    </td>
                    <td className="text-right text-surface-900 dark:text-white">
                      {formatCurrency(routeProfitability.totals.expected_cash)}
                    </td>
                    <td className="text-right text-surface-900 dark:text-white">
                      {formatCurrency(routeProfitability.totals.actual_cash_returned)}
                    </td>
                    <td className="text-right text-surface-900 dark:text-white">
                      {formatCurrency(routeProfitability.totals.cash_discrepancy)}
                    </td>
                    <td className="text-right text-indigo-700 dark:text-indigo-300">
                      {formatCurrency(routeProfitability.totals.contribution_before_cogs)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* ── 1. SALES REPORT ────────────────────────────────────────── */}
        {reportType === 'sales' && (() => {
          const sapSalesTotal = filteredSapSales.reduce(
            (sum, s: any) => sum + Number(s.net_val !== null && s.net_val !== undefined ? s.net_val : s.quantity * (s.rate || 0)),
            0
          );
          const dtSalesTotal = filteredPicklists.reduce((sum, pl) => sum + Number(pl.total_amount || 0), 0);
          const grandTotal =
            (salesSourceFilter === 'all' ? sapSalesTotal + dtSalesTotal : salesSourceFilter === 'sap' ? sapSalesTotal : dtSalesTotal);

          const handleExportSalesExcel = () => {
            const exportRows: any[] = [];
            if (salesSourceFilter === 'all' || salesSourceFilter === 'sap') {
              filteredSapSales.forEach((s: any) => {
                exportRows.push({
                  Source: 'SAP Baseline',
                  Date: s.invoice_date,
                  'Invoice / Doc No': s.invoice_no,
                  'Customer Code': s.cust_code || '',
                  'Customer Name': s.cust_name || '',
                  SKU: s.sku,
                  'Product Description': s.product_name || '',
                  Quantity: s.quantity,
                  UOM: s.uom || 'EA',
                  Rate: s.rate,
                  'Sales Amount': s.net_val !== null && s.net_val !== undefined ? s.net_val : s.quantity * (s.rate || 0),
                });
              });
            }
            if (salesSourceFilter === 'all' || salesSourceFilter === 'distrotrack') {
              filteredPicklists.forEach((pl: any) => {
                exportRows.push({
                  Source: 'DistroTrack Delivery',
                  Date: pl.date || pl.created_at,
                  'Invoice / Doc No': pl.picklist_number,
                  'Customer Code': '',
                  'Customer Name': pl.route?.name || 'Main Route',
                  SKU: 'Multiple',
                  'Product Description': `${pl.total_items || 0} SKUs`,
                  Quantity: pl.total_items || 0,
                  UOM: 'pcs',
                  Rate: 0,
                  'Sales Amount': pl.total_amount || 0,
                });
              });
            }
            const ws = XLSX.utils.json_to_sheet(exportRows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Sales Report');
            XLSX.writeFile(wb, `Sales_Report_${dateRange.label.replace(/\s+/g, '_')}.xlsx`);
          };

          return (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-surface-50 dark:bg-surface-850 border border-surface-200 dark:border-surface-700 rounded-xl">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold text-surface-500 mr-1">Source Filter:</span>
                  {([
                    { id: 'all', label: 'All Sources' },
                    { id: 'sap', label: `SAP Baseline (₹${Math.round(sapSalesTotal).toLocaleString()})` },
                    { id: 'distrotrack', label: `DistroTrack (₹${Math.round(dtSalesTotal).toLocaleString()})` },
                  ] as const).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSalesSourceFilter(s.id)}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                        salesSourceFilter === s.id
                          ? s.id === 'sap'
                            ? 'bg-purple-600 text-white shadow-xs'
                            : 'bg-primary-600 text-white shadow-xs'
                          : 'bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-300 border border-surface-200 dark:border-surface-700 hover:bg-surface-100'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  icon={<FileSpreadsheet className="h-4 w-4 text-emerald-600" />}
                  onClick={handleExportSalesExcel}
                >
                  Export Sales XLSX
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="dt-table w-full">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Picklist / Invoice #</th>
                      <th>Date</th>
                      <th>Route / Customer</th>
                      <th>Assigned Salesman / Code</th>
                      <th>Items / SKUs</th>
                      <th className="text-right">Total Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* SAP Baseline Sales Rows */}
                    {(salesSourceFilter === 'all' || salesSourceFilter === 'sap') &&
                      filteredSapSales.map((s: any, idx: number) => {
                        const val =
                          s.net_val !== null && s.net_val !== undefined
                            ? Number(s.net_val)
                            : Number(s.quantity || 0) * Number(s.rate || 0);
                        return (
                          <tr key={`sap_${s.id || idx}`} className="hover:bg-surface-50/60 dark:hover:bg-surface-750/50">
                            <td>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 uppercase">
                                SAP Baseline
                              </span>
                            </td>
                            <td className="font-mono text-xs font-bold text-purple-700 dark:text-purple-300">
                              {s.invoice_no}
                            </td>
                            <td className="text-xs text-surface-600 dark:text-surface-400">
                              {formatDate(s.invoice_date || s.created_at)}
                            </td>
                            <td className="text-xs font-medium text-surface-800 dark:text-surface-200 max-w-xs truncate">
                              {s.cust_name || 'SAP Customer'}
                            </td>
                            <td className="text-xs font-mono text-surface-500">
                              {s.cust_code || 'SAP'}
                            </td>
                            <td className="text-xs text-surface-700 dark:text-surface-300">
                              <span className="font-mono font-semibold">{s.sku}</span> ({s.quantity} {s.uom || 'pcs'})
                            </td>
                            <td className="text-right font-bold text-surface-900 dark:text-white tabular-nums">
                              {formatCurrency(val)}
                            </td>
                          </tr>
                        );
                      })}

                    {/* DistroTrack Operational Picklist Deliveries */}
                    {(salesSourceFilter === 'all' || salesSourceFilter === 'distrotrack') &&
                      filteredPicklists.map((pl) => (
                        <tr key={pl.id} className="hover:bg-surface-50/60 dark:hover:bg-surface-750/50">
                          <td>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 uppercase">
                              DistroTrack
                            </span>
                          </td>
                          <td className="font-mono text-xs font-extrabold text-blue-700 dark:text-blue-300">
                            {pl.picklist_number}
                          </td>
                          <td className="text-xs text-surface-600 dark:text-surface-400">
                            {formatDate(pl.date || pl.created_at)}
                          </td>
                          <td className="text-xs font-semibold text-surface-800 dark:text-surface-200">
                            {pl.route?.name || 'Main Route'}
                          </td>
                          <td className="text-xs text-surface-700 dark:text-surface-300">
                            {pl.worker?.name || '—'}
                          </td>
                          <td className="text-xs text-surface-700 dark:text-surface-300">
                            {pl.total_items || pl.completed_parties || 0} SKUs
                          </td>
                          <td className="text-right font-extrabold text-surface-900 dark:text-white tabular-nums">
                            {formatCurrency(pl.total_amount)}
                          </td>
                        </tr>
                      ))}

                    {filteredSapSales.length === 0 && filteredPicklists.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center py-10 text-xs text-surface-400">
                          No sales recorded for {dateRange.label}.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-100 dark:bg-surface-750 font-bold">
                      <td colSpan={6} className="text-right text-xs">
                        Authoritative Sales Total ({salesSourceFilter.toUpperCase()}):
                      </td>
                      <td className="text-right text-xs font-extrabold text-primary-700 dark:text-primary-300 tabular-nums">
                        {formatCurrency(grandTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );
        })()}

        {/* ── 2. COLLECTIONS REPORT ──────────────────────────────────── */}
        {reportType === 'collections' && (
          <div className="overflow-x-auto">
            <table className="dt-table w-full">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Party / Customer</th>
                  <th>Payment Mode</th>
                  <th>Reference / Notes</th>
                  <th>Worker / Salesman</th>
                  <th className="text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-xs text-surface-400">
                      No payments or collections found for {dateRange.label}.
                    </td>
                  </tr>
                )}
                {filteredPayments.map((p) => {
                  const isCredit = p.payment_mode === 'credit';
                  const party = p.party || parties.find((x) => x.id === p.party_id || x.code === p.party_id);
                  return (
                    <tr key={p.id}>
                      <td className="text-xs text-surface-600 dark:text-surface-400">
                        {formatDate(p.payment_date || p.created_at)}
                      </td>
                      <td className="font-bold text-surface-900 dark:text-white">
                        {party?.name || 'Customer'}
                      </td>
                      <td>
                        <span
                          className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                            isCredit
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                              : p.payment_mode === 'cash'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                          }`}
                        >
                          {p.payment_mode === 'credit' ? 'Credit / Udhar' : p.payment_mode}
                        </span>
                      </td>
                      <td className="text-xs text-surface-500 dark:text-surface-400">
                        {p.cheque_number ? `Cheque: ${p.cheque_number}` : p.notes || '—'}
                      </td>
                      <td className="text-xs text-surface-700 dark:text-surface-300">
                        {p.worker?.name || '—'}
                      </td>
                      <td
                        className={`text-right font-black ${
                          isCredit
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {formatCurrency(p.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── 3. MONTHLY ANALYSIS (12-Month Table) ── P4 FIXED ────────── */}
        {reportType === 'monthly' && (
          <div className="overflow-x-auto">
            <div className="p-4 border-b border-surface-100 dark:border-surface-700 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-surface-900 dark:text-white">
                  12-Month Performance Audit & Trend
                </h3>
                <p className="text-xs text-surface-500">
                  Authoritative monthly delivered sales, cash / UPI / cheque recovery, credit, and operating expenses
                </p>
              </div>
            </div>
            <table className="dt-table w-full">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="text-right">Delivered Sales</th>
                  <th className="text-right">Cash</th>
                  <th className="text-right">UPI</th>
                  <th className="text-right">Cheque (Cleared)</th>
                  <th className="text-right">Cheque (Pending)</th>
                  <th className="text-right">Realized Total</th>
                  <th className="text-right">New Credit</th>
                  <th className="text-right">Approved Expenses</th>
                  {/* P4 FIX: Renamed from "Net Margin" to correct accounting term */}
                  <th className="text-right">Contribution Before COGS</th>
                </tr>
              </thead>
              <tbody>
                {monthlyBreakdown.map((row) => {
                  // P4 FIX: Contribution Before COGS = Commercial Sales - Approved Expenses
                  const contribution = row.sales - row.expenses;
                  return (
                    <tr key={row.key} className="hover:bg-surface-50/70 dark:hover:bg-surface-700/50">
                      <td className="font-bold text-surface-900 dark:text-white">
                        {row.label}
                        {row.year === currentYear && row.monthIndex === currentMonth && (
                          <span className="ml-2 px-1.5 py-0.5 text-[9px] font-black uppercase bg-blue-100 text-blue-700 rounded">
                            Current
                          </span>
                        )}
                      </td>
                      <td className="text-right font-semibold text-blue-700 dark:text-blue-300">
                        {formatCurrency(row.sales)}
                      </td>
                      <td className="text-right font-medium text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(row.cash)}
                      </td>
                      {/* P4 FIX: UPI as separate column */}
                      <td className="text-right font-medium text-cyan-700 dark:text-cyan-400">
                        {formatCurrency(row.upi)}
                      </td>
                      {/* P4 FIX: Cheque cleared separate */}
                      <td className="text-right font-medium text-blue-600 dark:text-blue-400">
                        {formatCurrency(row.chequeCl)}
                      </td>
                      {/* P4 FIX: Cheque pending separate */}
                      <td className="text-right font-medium text-amber-600 dark:text-amber-400">
                        {formatCurrency(row.chequePe)}
                      </td>
                      <td className="text-right font-black text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(row.collected)}
                      </td>
                      <td className="text-right font-medium text-amber-600 dark:text-amber-400">
                        {formatCurrency(row.credit)}
                      </td>
                      <td className="text-right font-medium text-rose-600 dark:text-rose-400">
                        {formatCurrency(row.expenses)}
                      </td>
                      <td
                        className={`text-right font-black ${
                          contribution >= 0 ? 'text-indigo-700 dark:text-indigo-300' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatCurrency(contribution)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── 4. UDHARI / OUTSTANDING REPORT ── P6 ENHANCED ─────────── */}
        {reportType === 'udhari' && (
          <div className="overflow-x-auto">
            <div className="p-4 border-b border-surface-100 dark:border-surface-700 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-surface-900 dark:text-white">
                  Customer Outstanding Ledger
                </h3>
                <p className="text-xs text-surface-500">
                  Accounts with pending balances — sourced from authoritative party_financial_ledger
                </p>
              </div>
              <div className="text-right">
                <div className="text-xs text-surface-400 font-bold uppercase">Total Pending</div>
                <div className="text-sm font-black text-amber-600 dark:text-amber-400">
                  {formatCurrency(totalOutstandingBalance)}
                </div>
              </div>
            </div>
            <table className="dt-table w-full">
              <thead>
                <tr>
                  <th>Customer Code</th>
                  <th>Customer / Store Name</th>
                  <th>City / Locality</th>
                  <th>Delivery Route</th>
                  <th>Contact Phone</th>
                  {/* P6: Added ledger-sourced columns */}
                  <th className="text-center">Oldest Debit</th>
                  <th className="text-center">Payments Received</th>
                  <th className="text-right">Outstanding Balance (₹)</th>
                </tr>
              </thead>
              <tbody>
                {parties.filter((p) => p.outstanding_amount > 0).length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-xs text-surface-400">
                      🎉 No customers currently have outstanding balances.
                    </td>
                  </tr>
                )}
                {parties
                  .filter((p) => p.outstanding_amount > 0)
                  .sort((a, b) => b.outstanding_amount - a.outstanding_amount)
                  .map((p) => {
                    // P6: Look up ledger stats for this party
                    const ledgerInfo = partyLedgerStats.find((l) => l.party_id === p.id);
                    return (
                      <tr key={p.id}>
                        <td className="font-mono text-xs font-bold text-surface-900 dark:text-surface-100">
                          {p.code}
                        </td>
                        <td className="font-bold text-surface-900 dark:text-surface-100">
                          {p.name}
                        </td>
                        <td className="text-xs text-surface-600 dark:text-surface-400">
                          {p.city || 'Sangamner'}
                        </td>
                        <td className="text-xs text-surface-700 dark:text-surface-300 font-medium">
                          {p.route?.name || 'Assigned Route'}
                        </td>
                        <td className="text-xs font-mono text-surface-500 dark:text-surface-400">
                          {p.phone || '—'}
                        </td>
                        {/* P6: Oldest debit from party_financial_ledger */}
                        <td className="text-center text-xs text-surface-600 dark:text-surface-400">
                          {ledgerInfo?.oldest_debit_date
                            ? formatDate(ledgerInfo.oldest_debit_date)
                            : '—'}
                        </td>
                        {/* P6: Payment count from party_financial_ledger */}
                        <td className="text-center text-xs font-semibold text-surface-700 dark:text-surface-300">
                          {ledgerInfo?.payment_count ?? '—'}
                        </td>
                        <td className="text-right font-black text-amber-700 dark:text-amber-400">
                          {formatCurrency(p.outstanding_amount)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── 5. EXPENSES REPORT ─────────────────────────────────────── */}
        {reportType === 'expenses' && (
          <div className="overflow-x-auto">
            <table className="dt-table w-full">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description / Notes</th>
                  <th>Worker / Driver</th>
                  <th>Payment Method</th>
                  <th>Status</th>
                  <th className="text-right">Expense Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-xs text-surface-400">
                      No operational expenses recorded for {dateRange.label}.
                    </td>
                  </tr>
                )}
                {filteredExpenses.map((e) => (
                  <tr key={e.id}>
                    <td className="text-xs text-surface-600 dark:text-surface-400">
                      {formatDate(e.date || e.created_at)}
                    </td>
                    <td>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                        {e.category}
                      </span>
                    </td>
                    <td className="text-xs text-surface-600 dark:text-surface-400">
                      {e.description || '—'}
                    </td>
                    <td className="text-xs text-surface-700 dark:text-surface-300">
                      {e.worker?.name || '—'}
                    </td>
                    <td>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300">
                        {e.payment_method || 'cash'}
                      </span>
                    </td>
                    <td>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        e.status === 'approved'
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : e.status === 'rejected'
                          ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                          : e.status === 'reversed'
                          ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                      }`}>
                        {e.status || 'pending'}
                      </span>
                    </td>
                    <td className="text-right font-black text-rose-600 dark:text-rose-400">
                      {formatCurrency(e.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── 6. PRODUCT / SKU ANALYTICS ── P5 NEW ────────────────────── */}
        {reportType === 'products' && (
          <div className="overflow-x-auto">
            <div className="p-4 border-b border-surface-100 dark:border-surface-700 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-surface-900 dark:text-white flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary-500" /> Product / SKU Analytics
                </h3>
                <p className="text-xs text-surface-500 mt-0.5">
                  Delivered quantities and commercial values by canonical SAP SKU — refused quantities excluded from delivered value
                </p>
              </div>
              <div className="text-right">
                <div className="text-xs text-surface-400 font-bold uppercase">Total SKUs</div>
                <div className="text-sm font-black text-primary-600 dark:text-primary-400">
                  {skuRows.length}
                </div>
              </div>
            </div>
            {diLoading ? (
              <div className="p-10 text-center text-xs text-surface-400">Loading SKU data…</div>
            ) : (
              <table className="dt-table w-full text-xs">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th className="text-right">Ordered Qty</th>
                    <th className="text-right">Delivered Qty</th>
                    <th className="text-right">Refused Qty</th>
                    <th className="text-right">Delivered Value (₹)</th>
                    <th className="text-right">Fulfillment %</th>
                  </tr>
                </thead>
                <tbody>
                  {skuRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-xs text-surface-400">
                        No delivery item data found for {dateRange.label}.
                      </td>
                    </tr>
                  )}
                  {skuRows.map((row) => {
                    const fulfillPct = row.orderedQty > 0
                      ? Math.round((row.deliveredQty / row.orderedQty) * 100)
                      : 100;
                    return (
                      <tr key={row.sku} className="hover:bg-surface-50/70 dark:hover:bg-surface-700/50">
                        <td className="font-mono font-extrabold text-primary-700 dark:text-primary-300">
                          {row.sku}
                        </td>
                        <td className="text-right text-surface-700 dark:text-surface-300 tabular-nums">
                          {row.orderedQty.toLocaleString('en-IN')}
                        </td>
                        <td className="text-right font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {row.deliveredQty.toLocaleString('en-IN')}
                        </td>
                        <td className={`text-right tabular-nums ${row.refusedQty > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-surface-400'}`}>
                          {row.refusedQty > 0 ? row.refusedQty.toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="text-right font-black text-surface-900 dark:text-white tabular-nums">
                          {formatCurrency(row.deliveredValue)}
                        </td>
                        <td className="text-right tabular-nums">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            fulfillPct >= 95
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : fulfillPct >= 70
                              ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                              : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                          }`}>
                            {fulfillPct}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {skuRows.length > 0 && (
                  <tfoot>
                    <tr className="bg-surface-100/80 dark:bg-surface-750 font-black border-t-2 border-surface-300 dark:border-surface-600">
                      <td className="text-surface-900 dark:text-white uppercase">Totals ({skuRows.length} SKUs)</td>
                      <td className="text-right text-surface-900 dark:text-white tabular-nums">
                        {skuRows.reduce((s, r) => s + r.orderedQty, 0).toLocaleString('en-IN')}
                      </td>
                      <td className="text-right text-emerald-700 dark:text-emerald-400 tabular-nums">
                        {skuRows.reduce((s, r) => s + r.deliveredQty, 0).toLocaleString('en-IN')}
                      </td>
                      <td className="text-right text-rose-600 dark:text-rose-400 tabular-nums">
                        {skuRows.reduce((s, r) => s + r.refusedQty, 0).toLocaleString('en-IN')}
                      </td>
                      <td className="text-right text-indigo-700 dark:text-indigo-300 tabular-nums">
                        {formatCurrency(skuRows.reduce((s, r) => s + r.deliveredValue, 0))}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        )}

        {/* ── 7. WORKER PERFORMANCE ── P7 NEW ─────────────────────────── */}
        {reportType === 'workers' && (
          <div className="overflow-x-auto">
            <div className="p-4 border-b border-surface-100 dark:border-surface-700 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-surface-900 dark:text-white flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary-500" /> Worker Performance Report
                </h3>
                <p className="text-xs text-surface-500 mt-0.5">
                  Per-worker delivered commercial sales, cash collected, credit extended, and approved expenses — from authoritative route profitability
                </p>
              </div>
            </div>
            <table className="dt-table w-full text-xs">
              <thead>
                <tr>
                  <th>Worker / Salesman</th>
                  <th className="text-center">Trips</th>
                  <th className="text-right">Delivered Sales</th>
                  <th className="text-right">Cash Collected</th>
                  <th className="text-right">UPI</th>
                  <th className="text-right">Cheque</th>
                  <th className="text-right">Credit Extended</th>
                  <th className="text-right">Approved Expenses</th>
                  <th className="text-right font-black">Contribution Before COGS</th>
                </tr>
              </thead>
              <tbody>
                {workerPerfRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-10 text-xs text-surface-400">
                      No worker route data found for {dateRange.label}. Ensure routes have been processed.
                    </td>
                  </tr>
                )}
                {workerPerfRows.map((w) => (
                  <tr key={w.worker_id} className="hover:bg-surface-50/70 dark:hover:bg-surface-700/50">
                    <td className="font-semibold text-surface-900 dark:text-white">
                      {w.worker_name}
                    </td>
                    <td className="text-center text-surface-700 dark:text-surface-300">
                      {w.picklist_count}
                    </td>
                    <td className="text-right font-bold text-blue-700 dark:text-blue-300 tabular-nums">
                      {formatCurrency(w.sales)}
                    </td>
                    <td className="text-right text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {formatCurrency(w.cash_collected)}
                    </td>
                    <td className="text-right text-cyan-700 dark:text-cyan-400 tabular-nums">
                      {formatCurrency(w.upi_collected)}
                    </td>
                    <td className="text-right text-surface-700 dark:text-surface-300 tabular-nums">
                      {formatCurrency(w.cheque_total)}
                    </td>
                    <td className="text-right text-amber-600 dark:text-amber-400 tabular-nums">
                      {formatCurrency(w.credit_sales)}
                    </td>
                    <td className="text-right text-rose-600 dark:text-rose-400 tabular-nums">
                      {formatCurrency(w.approved_expenses)}
                    </td>
                    <td className={`text-right font-black tabular-nums ${
                      w.contribution_before_cogs >= 0
                        ? 'text-indigo-700 dark:text-indigo-300'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}>
                      {formatCurrency(w.contribution_before_cogs)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {workerPerfRows.length > 1 && (
                <tfoot>
                  <tr className="bg-surface-100/80 dark:bg-surface-750 font-black border-t-2 border-surface-300 dark:border-surface-600">
                    <td className="text-surface-900 dark:text-white uppercase">Totals ({workerPerfRows.length} Workers)</td>
                    <td className="text-center">{workerPerfRows.reduce((s, w) => s + w.picklist_count, 0)}</td>
                    <td className="text-right text-blue-700 dark:text-blue-300">{formatCurrency(workerPerfRows.reduce((s, w) => s + w.sales, 0))}</td>
                    <td className="text-right text-emerald-700">{formatCurrency(workerPerfRows.reduce((s, w) => s + w.cash_collected, 0))}</td>
                    <td className="text-right text-cyan-700">{formatCurrency(workerPerfRows.reduce((s, w) => s + w.upi_collected, 0))}</td>
                    <td className="text-right text-surface-700">{formatCurrency(workerPerfRows.reduce((s, w) => s + w.cheque_total, 0))}</td>
                    <td className="text-right text-amber-600">{formatCurrency(workerPerfRows.reduce((s, w) => s + w.credit_sales, 0))}</td>
                    <td className="text-right text-rose-600">{formatCurrency(workerPerfRows.reduce((s, w) => s + w.approved_expenses, 0))}</td>
                    <td className="text-right text-indigo-700 dark:text-indigo-300">{formatCurrency(workerPerfRows.reduce((s, w) => s + w.contribution_before_cogs, 0))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
