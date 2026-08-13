import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, DollarSign, AlertCircle, Receipt, Download } from 'lucide-react';
import { PageHeader, Card, StatCard, Button, LoadingState } from '@/shared/ui';
import { getPicklists } from '@/features/picklists/services/picklistService';
import { getDeliveries } from '@/features/deliveries/services/deliveryService';
import { getPayments } from '@/features/payments/services/paymentService';
import { getParties } from '@/features/parties/services/partyService';
import { getExpenses } from '@/features/expenses/services/expenseService';
import { formatCurrency, formatDate } from '@/shared/utils/format';

export function ReportsPage() {
  const [reportType, setReportType] = useState<'sales' | 'collections' | 'udhari' | 'expenses'>('sales');

  const { data: picklists = [], isLoading: plLoading } = useQuery({ queryKey: ['picklists'], queryFn: getPicklists });
  const { data: deliveries = [], isLoading: delLoading } = useQuery({ queryKey: ['deliveries'], queryFn: getDeliveries });
  const { data: payments = [], isLoading: payLoading } = useQuery({ queryKey: ['payments'], queryFn: getPayments });
  const { data: parties = [], isLoading: partLoading } = useQuery({ queryKey: ['parties'], queryFn: getParties });
  const { data: expenses = [], isLoading: expLoading } = useQuery({ queryKey: ['expenses'], queryFn: getExpenses });

  if (plLoading || delLoading || payLoading || partLoading || expLoading) return <LoadingState message="Calculating report analytics…" />;

  const totalSales = picklists.reduce((sum, p) => sum + Number(p.total_amount), 0);
  const totalCollections = payments.reduce((sum, p) => sum + Number(p.amount), 0);

  const totalOutstanding = picklists.length === 0
    ? 0
    : deliveries.length > 0
    ? deliveries
        .filter((d) => d.status === 'pending' || d.status === 'out_for_delivery' || d.status === 'partial')
        .reduce((sum, d) => sum + Math.max(0, Number(d.total_amount || 0) - Number(d.collected_amount || 0)), 0)
    : parties.reduce((sum, p) => sum + Number(p.outstanding_amount || 0), 0);

  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  const tabClass = (active: boolean) =>
    `pb-2 text-sm font-medium border-b-2 transition-colors ${active
      ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300'
      : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'}`;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Reports & Analytics"
        description="Detailed business intelligence on wholesale sales, route collections, outstanding balances, and expenses"
        actions={
          <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => window.print()}>
            Export Report
          </Button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Sales Value" value={formatCurrency(totalSales)} icon={<TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />} />
        <StatCard label="Total Collections" value={formatCurrency(totalCollections)} icon={<DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />} />
        <StatCard label="Total Outstanding / Udhari" value={formatCurrency(totalOutstanding)} icon={<AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />} />
        <StatCard label="Total Operational Expenses" value={formatCurrency(totalExpenses)} icon={<Receipt className="h-5 w-5 text-red-500 dark:text-red-400" />} />
      </div>

      {/* Report Switcher Tabs */}
      <div className="border-b border-surface-200 dark:border-surface-700 flex gap-4">
        <button onClick={() => setReportType('sales')} className={tabClass(reportType === 'sales')}>
          Sales Report ({picklists.length})
        </button>
        <button onClick={() => setReportType('collections')} className={tabClass(reportType === 'collections')}>
          Collections Report ({payments.length})
        </button>
        <button onClick={() => setReportType('udhari')} className={tabClass(reportType === 'udhari')}>
          Outstanding Udhari Report
        </button>
        <button onClick={() => setReportType('expenses')} className={tabClass(reportType === 'expenses')}>
          Expenses Breakdown ({expenses.length})
        </button>
      </div>

      {/* Report Content */}
      <Card className="p-0 overflow-hidden border-surface-200 dark:border-surface-700">
        {reportType === 'sales' && (
          <table className="dt-table">
            <thead>
              <tr>
                <th>Picklist #</th>
                <th>Date</th>
                <th>Route</th>
                <th>Worker</th>
                <th>Items Count</th>
                <th>Total Value</th>
              </tr>
            </thead>
            <tbody>
              {picklists.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-xs text-surface-400">No picklist sales data available</td></tr>
              )}
              {picklists.map((pl) => (
                <tr key={pl.id}>
                  <td className="font-mono text-xs font-bold text-surface-900 dark:text-surface-100">{pl.picklist_number}</td>
                  <td className="text-xs text-surface-600 dark:text-surface-400">{formatDate(pl.date)}</td>
                  <td className="text-xs font-medium text-surface-800 dark:text-surface-200">{pl.route?.name || 'Main Route'}</td>
                  <td className="text-xs text-surface-700 dark:text-surface-300">{pl.worker?.name || '—'}</td>
                  <td className="text-xs text-surface-700 dark:text-surface-300">{pl.total_items} SKUs</td>
                  <td className="font-semibold text-primary-700 dark:text-primary-400">{formatCurrency(pl.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {reportType === 'collections' && (
          <table className="dt-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Party / Customer</th>
                <th>Payment Mode</th>
                <th>Reference / Cheque</th>
                <th>Worker</th>
                <th>Amount Collected</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-xs text-surface-400">No payment collections recorded</td></tr>
              )}
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="text-xs text-surface-600 dark:text-surface-400">{formatDate(p.payment_date)}</td>
                  <td className="font-medium text-surface-900 dark:text-surface-100">{p.party?.name || 'Customer'}</td>
                  <td className="text-xs uppercase font-semibold text-surface-700 dark:text-surface-300">{p.payment_mode}</td>
                  <td className="text-xs text-surface-500 dark:text-surface-400">{p.cheque_number ? `Cheque #${p.cheque_number}` : 'Cash'}</td>
                  <td className="text-xs text-surface-700 dark:text-surface-300">{p.worker?.name || '—'}</td>
                  <td className="font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {reportType === 'udhari' && (
          <table className="dt-table">
            <thead>
              <tr>
                <th>Customer Code</th>
                <th>Customer Name</th>
                <th>City</th>
                <th>Route</th>
                <th>Outstanding Balance (₹)</th>
              </tr>
            </thead>
            <tbody>
              {parties.filter((p) => p.outstanding_amount > 0).map((p) => (
                <tr key={p.id}>
                  <td className="font-mono text-xs font-bold text-surface-900 dark:text-surface-100">{p.code}</td>
                  <td className="font-medium text-surface-900 dark:text-surface-100">{p.name}</td>
                  <td className="text-xs text-surface-600 dark:text-surface-400">{p.city || '—'}</td>
                  <td className="text-xs text-surface-700 dark:text-surface-300">{p.route?.name || 'Unassigned'}</td>
                  <td className="font-bold text-amber-700 dark:text-amber-400">{formatCurrency(p.outstanding_amount)}</td>
                </tr>
              ))}
              {parties.filter((p) => p.outstanding_amount > 0).length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-6 text-xs text-surface-400">
                    No customers with outstanding balances
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {reportType === 'expenses' && (
          <table className="dt-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th>Worker</th>
                <th>Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {expenses.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-xs text-surface-400">No expenses recorded</td></tr>
              )}
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="text-xs text-surface-600 dark:text-surface-400">{formatDate(e.date)}</td>
                  <td className="text-xs font-semibold text-surface-800 dark:text-surface-200">{e.category}</td>
                  <td className="text-xs text-surface-600 dark:text-surface-400">{e.description || '—'}</td>
                  <td className="text-xs text-surface-700 dark:text-surface-300">{e.worker?.name || '—'}</td>
                  <td className="font-semibold text-red-600 dark:text-red-400">{formatCurrency(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
