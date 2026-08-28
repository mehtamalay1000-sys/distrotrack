import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, DollarSign, AlertCircle, Receipt, Download,
  Calendar, Building2, CreditCard,
  Banknote, RefreshCw,
} from 'lucide-react';
import { PageHeader, Card, StatCard, Button, LoadingState } from '@/shared/ui';
import { getPicklists } from '@/features/picklists/services/picklistService';
import { getPayments } from '@/features/payments/services/paymentService';
import { getParties } from '@/features/parties/services/partyService';
import { getExpenses } from '@/features/expenses/services/expenseService';
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
    'sales' | 'collections' | 'monthly' | 'udhari' | 'expenses'
  >('sales');

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
    queryFn: getExpenses,
  });

  const isDataLoading = plLoading || payLoading || partLoading || expLoading;

  const handleRefresh = () => {
    refetchPl();
    refetchPay();
    refetchPart();
    refetchExp();
  };

  // ── 1. Calculate Date Filter Range ──────────────────────────────────
  const dateRange = useMemo<{ start: Date | null; end: Date | null; label: string }>(() => {
    if (preset === 'all') {
      return { start: null, end: null, label: 'All Time Records' };
    }

    if (preset === 'this_month') {
      const start = new Date(currentYear, currentMonth, 1);
      const end = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
      return { start, end, label: `${MONTH_NAMES[currentMonth]} ${currentYear}` };
    }

    if (preset === 'last_month') {
      const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
      const start = new Date(prevYear, prevMonth, 1);
      const end = new Date(prevYear, prevMonth + 1, 0, 23, 59, 59, 999);
      return { start, end, label: `${MONTH_NAMES[prevMonth]} ${prevYear}` };
    }

    if (preset === 'last_3_months') {
      const start = new Date(currentYear, currentMonth - 2, 1);
      const end = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
      return { start, end, label: `Past 3 Months (${MONTH_NAMES[start.getMonth()]} - ${MONTH_NAMES[currentMonth]})` };
    }

    if (preset === 'last_6_months') {
      const start = new Date(currentYear, currentMonth - 5, 1);
      const end = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
      return { start, end, label: `Past 6 Months` };
    }

    if (preset === 'this_year') {
      // Indian Financial Year: 1st April to 31st March
      const start = new Date(currentMonth >= 3 ? currentYear : currentYear - 1, 3, 1);
      const end = new Date(currentMonth >= 3 ? currentYear + 1 : currentYear, 2, 31, 23, 59, 59, 999);
      return { start, end, label: `FY ${start.getFullYear()}-${(start.getFullYear() + 1).toString().slice(-2)}` };
    }

    if (preset === 'custom_month') {
      const start = new Date(selectedYear, selectedMonth, 1);
      const end = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59, 999);
      return { start, end, label: `${MONTH_NAMES[selectedMonth]} ${selectedYear}` };
    }

    if (preset === 'custom_range') {
      const start = customStartDate ? new Date(`${customStartDate}T00:00:00`) : null;
      const end = customEndDate ? new Date(`${customEndDate}T23:59:59.999`) : null;
      return {
        start,
        end,
        label: `${customStartDate || 'Start'} to ${customEndDate || 'End'}`,
      };
    }

    return { start: null, end: null, label: 'All Records' };
  }, [preset, currentYear, currentMonth, selectedYear, selectedMonth, customStartDate, customEndDate]);

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

  // ── 2. Filtered Dataset ─────────────────────────────────────────────
  const filteredPicklists = useMemo(() => {
    return picklists.filter((pl) => isDateInRange(pl.date || pl.created_at));
  }, [picklists, dateRange]);

  const filteredPayments = useMemo(() => {
    return payments.filter((p) => isDateInRange(p.payment_date || p.created_at));
  }, [payments, dateRange]);


  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => isDateInRange(e.date || e.created_at));
  }, [expenses, dateRange]);

  // ── 3. Accurate Aggregated Metrics ──────────────────────────────────
  const totalSalesValue = filteredPicklists.reduce((sum, p) => sum + Number(p.total_amount || 0), 0);

  // Collections = only money collected (cash, cheque, upi) — EXCLUDING credit/udhari
  const totalCashCollected = filteredPayments
    .filter((p) => p.payment_mode === 'cash')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const totalChequeCollected = filteredPayments
    .filter((p) => p.payment_mode === 'cheque')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const totalUpiCollected = filteredPayments
    .filter((p) => p.payment_mode === 'upi')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const totalCreditExtended = filteredPayments
    .filter((p) => p.payment_mode === 'credit')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const totalActualCollections = totalCashCollected + totalChequeCollected + totalUpiCollected;

  // Cumulative Outstanding Balance across all parties
  const totalOutstandingBalance = parties.reduce((sum, p) => sum + Number(p.outstanding_amount || 0), 0);

  const totalOperationalExpenses = filteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const netRealization = totalActualCollections - totalOperationalExpenses;

  // ── 4. Multi-Month Trend Analysis ───────────────────────────────────
  const monthlyBreakdown = useMemo(() => {
    const monthsMap: Record<
      string,
      {
        key: string;
        label: string;
        year: number;
        monthIndex: number;
        sales: number;
        cash: number;
        cheque: number;
        credit: number;
        collected: number;
        expenses: number;
        picklistsCount: number;
      }
    > = {};

    // Populate past 12 months in reverse order
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
        cheque: 0,
        credit: 0,
        collected: 0,
        expenses: 0,
        picklistsCount: 0,
      };
    }

    // Aggregate picklists
    picklists.forEach((pl) => {
      const dStr = pl.date || pl.created_at;
      if (!dStr) return;
      const d = new Date(dStr);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (monthsMap[key]) {
        monthsMap[key].sales += Number(pl.total_amount || 0);
        monthsMap[key].picklistsCount += 1;
      }
    });

    // Aggregate payments
    payments.forEach((p) => {
      const dStr = p.payment_date || p.created_at;
      if (!dStr) return;
      const d = new Date(dStr);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (monthsMap[key]) {
        const amt = Number(p.amount || 0);
        if (p.payment_mode === 'cash') {
          monthsMap[key].cash += amt;
          monthsMap[key].collected += amt;
        } else if (p.payment_mode === 'cheque' || p.payment_mode === 'upi') {
          monthsMap[key].cheque += amt;
          monthsMap[key].collected += amt;
        } else if (p.payment_mode === 'credit') {
          monthsMap[key].credit += amt;
        }
      }
    });

    // Aggregate expenses
    expenses.forEach((e) => {
      const dStr = e.date || e.created_at;
      if (!dStr) return;
      const d = new Date(dStr);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (monthsMap[key]) {
        monthsMap[key].expenses += Number(e.amount || 0);
      }
    });

    return Object.values(monthsMap);
  }, [picklists, payments, expenses, currentYear, currentMonth]);

  if (isDataLoading) {
    return <LoadingState message="Calculating detailed business intelligence & audit records…" />;
  }

  const tabClass = (active: boolean) =>
    `pb-2.5 px-1 text-xs font-bold border-b-2 transition-all cursor-pointer ${
      active
        ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300'
        : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
    }`;

  const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <PageHeader
        title="Reports & Analytics"
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
              variant="primary"
              icon={<Download className="h-4 w-4" />}
              onClick={() => window.print()}
            >
              Export Report
            </Button>
          </div>
        }
      />

      {/* ── Period & Month Selector Bar ───────────────────────────────── */}
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

          {/* Presets and Dropdowns */}
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            {/* Quick Presets Dropdown */}
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

            {/* Custom Month + Year Pickers */}
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

            {/* Custom Date Range Inputs */}
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
        {/* Total Sales Value */}
        <StatCard
          label="Total Sales Value"
          value={formatCurrency(totalSalesValue)}
          icon={<TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
        />

        {/* Realized Cash/Cheque/UPI Collections */}
        <StatCard
          label="Total Realized Collections"
          value={formatCurrency(totalActualCollections)}
          icon={<DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
        />

        {/* Cumulative Outstanding / Udhari */}
        <StatCard
          label="Party Outstanding (Total)"
          value={formatCurrency(totalOutstandingBalance)}
          icon={<AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
        />

        {/* Operational Expenses */}
        <StatCard
          label="Operational Expenses"
          value={formatCurrency(totalOperationalExpenses)}
          icon={<Receipt className="h-5 w-5 text-red-500 dark:text-red-400" />}
        />
      </div>

      {/* ── Secondary Highlights Bar ──────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-3 shadow-xs">
        <div className="p-2 border-r border-surface-100 dark:border-surface-700 last:border-0">
          <div className="text-[10px] font-bold text-surface-400 uppercase flex items-center gap-1">
            <Banknote className="h-3 w-3 text-emerald-500" /> Cash Collected
          </div>
          <div className="text-sm font-black text-emerald-700 dark:text-emerald-400 mt-0.5">
            {formatCurrency(totalCashCollected)}
          </div>
        </div>

        <div className="p-2 border-r border-surface-100 dark:border-surface-700 last:border-0">
          <div className="text-[10px] font-bold text-surface-400 uppercase flex items-center gap-1">
            <CreditCard className="h-3 w-3 text-blue-500" /> Cheque & UPI
          </div>
          <div className="text-sm font-black text-blue-700 dark:text-blue-400 mt-0.5">
            {formatCurrency(totalChequeCollected + totalUpiCollected)}
          </div>
        </div>

        <div className="p-2 border-r border-surface-100 dark:border-surface-700 last:border-0">
          <div className="text-[10px] font-bold text-surface-400 uppercase flex items-center gap-1">
            <AlertCircle className="h-3 w-3 text-amber-500" /> New Credit Given
          </div>
          <div className="text-sm font-black text-amber-700 dark:text-amber-400 mt-0.5">
            {formatCurrency(totalCreditExtended)}
          </div>
        </div>

        <div className="p-2 last:border-0">
          <div className="text-[10px] font-bold text-surface-400 uppercase flex items-center gap-1">
            <Building2 className="h-3 w-3 text-indigo-500" /> Net Realization
          </div>
          <div className="text-sm font-black text-indigo-700 dark:text-indigo-400 mt-0.5">
            {formatCurrency(netRealization)}
          </div>
        </div>
      </div>

      {/* ── Report Switcher Tabs ──────────────────────────────────────── */}
      <div className="border-b border-surface-200 dark:border-surface-700 flex gap-4 overflow-x-auto">
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
      </div>

      {/* ── Report Tables ─────────────────────────────────────────────── */}
      <Card className="p-0 overflow-hidden border-surface-200 dark:border-surface-700 shadow-xs">
        {/* ── 1. SALES REPORT ────────────────────────────────────────── */}
        {reportType === 'sales' && (
          <div className="overflow-x-auto">
            <table className="dt-table w-full">
              <thead>
                <tr>
                  <th>Picklist / Invoice #</th>
                  <th>Date</th>
                  <th>Route</th>
                  <th>Assigned Salesman</th>
                  <th>Items / SKUs</th>
                  <th className="text-right">Total Invoice Value</th>
                </tr>
              </thead>
              <tbody>
                {filteredPicklists.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-xs text-surface-400">
                      No picklist sales recorded for {dateRange.label}.
                    </td>
                  </tr>
                )}
                {filteredPicklists.map((pl) => (
                  <tr key={pl.id}>
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
                    <td className="text-right font-extrabold text-surface-900 dark:text-white">
                      {formatCurrency(pl.total_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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

        {/* ── 3. MONTHLY ANALYSIS (12-Month Table) ───────────────────── */}
        {reportType === 'monthly' && (
          <div className="overflow-x-auto">
            <div className="p-4 border-b border-surface-100 dark:border-surface-700 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-surface-900 dark:text-white">
                  12-Month Performance Audit & Trend
                </h3>
                <p className="text-xs text-surface-500">
                  Month-by-month sales invoices, cash/cheque recovery, credit, and operational expenses
                </p>
              </div>
            </div>
            <table className="dt-table w-full">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="text-right">Picklist Sales</th>
                  <th className="text-right">Cash Received</th>
                  <th className="text-right">Cheque & UPI</th>
                  <th className="text-right">Total Realized</th>
                  <th className="text-right">New Credit (Udhar)</th>
                  <th className="text-right">Expenses</th>
                  <th className="text-right">Net Margin</th>
                </tr>
              </thead>
              <tbody>
                {monthlyBreakdown.map((row) => {
                  const net = row.collected - row.expenses;
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
                      <td className="text-right font-medium text-blue-600 dark:text-blue-400">
                        {formatCurrency(row.cheque)}
                      </td>
                      <td className="text-right font-black text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(row.collected)}
                      </td>
                      <td className="text-right font-medium text-amber-600 dark:text-amber-400">
                        {formatCurrency(row.credit)}
                      </td>
                      <td className="text-right font-medium text-red-600 dark:text-red-400">
                        {formatCurrency(row.expenses)}
                      </td>
                      <td
                        className={`text-right font-black ${
                          net >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {formatCurrency(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── 4. UDHARI / OUTSTANDING REPORT ─────────────────────────── */}
        {reportType === 'udhari' && (
          <div className="overflow-x-auto">
            <div className="p-4 border-b border-surface-100 dark:border-surface-700 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-surface-900 dark:text-white">
                  Customer Outstanding Ledger
                </h3>
                <p className="text-xs text-surface-500">
                  Accounts with pending balances requiring recovery
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
                  <th className="text-right">Outstanding Balance (₹)</th>
                </tr>
              </thead>
              <tbody>
                {parties.filter((p) => p.outstanding_amount > 0).length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-xs text-surface-400">
                      🎉 No customers currently have outstanding balances.
                    </td>
                  </tr>
                )}
                {parties
                  .filter((p) => p.outstanding_amount > 0)
                  .sort((a, b) => b.outstanding_amount - a.outstanding_amount)
                  .map((p) => (
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
                      <td className="text-right font-black text-amber-700 dark:text-amber-400">
                        {formatCurrency(p.outstanding_amount)}
                      </td>
                    </tr>
                  ))}
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
                  <th className="text-right">Expense Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-10 text-xs text-surface-400">
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
                    <td className="text-right font-black text-red-600 dark:text-red-400">
                      {formatCurrency(e.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
