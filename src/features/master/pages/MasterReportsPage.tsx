import { useState, useEffect } from 'react';
import { RefreshCw, BarChart3 } from 'lucide-react';
import { getMasterKPIs, monthRange } from '@/features/master/services/masterService';
import type { MasterKPIs } from '@/features/master/services/masterService';

const fmt = (n: number) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function MasterReportsPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [kpis, setKpis] = useState<MasterKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  useEffect(() => {
    setLoading(true);
    getMasterKPIs(monthRange(year, month)).then(d => {
      setKpis(d);
      setLoading(false);
    });
  }, [year, month]);

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Monthly Report</h1>
          <p className="text-sm text-slate-500 mt-0.5">Detailed single-month breakdown</p>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 font-medium">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 font-medium">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading…
        </div>
      )}

      {!loading && kpis && (
        <div className="space-y-4">
          {/* Sales & Collections */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-semibold text-slate-800">
                {MONTHS[month - 1]} {year} — Full Report
              </span>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {[
                  { label: 'Total Sales (Picklist Value)', value: fmt(kpis.totalSales), bold: true },
                  { label: 'Cash Collected', value: fmt(kpis.totalCash) },
                  { label: 'Cheque Collected', value: fmt(kpis.totalCheque) },
                  { label: 'Credit Extended (Udhari)', value: fmt(kpis.totalCredit) },
                  { label: 'Total Collections (excl. credit)', value: fmt(kpis.totalCollections), bold: true },
                  { label: 'Outstanding Amount', value: fmt(kpis.outstandingAmount) },
                  { label: 'Total Expenses', value: fmt(kpis.totalExpenses) },
                  { label: 'Net (Collections − Expenses)', value: fmt(kpis.totalCollections - kpis.totalExpenses), bold: true },
                  { label: '— Deliveries —', value: '' },
                  { label: 'Total Deliveries', value: String(kpis.totalDeliveries) },
                  { label: 'Completed', value: String(kpis.completedDeliveries) },
                  { label: 'Pending', value: String(kpis.pendingDeliveries) },
                  { label: 'Completion Rate', value: kpis.totalDeliveries > 0 ? `${Math.round((kpis.completedDeliveries / kpis.totalDeliveries) * 100)}%` : '—' },
                  { label: '— Infrastructure —', value: '' },
                  { label: 'Active Workers', value: String(kpis.activeWorkers) },
                  { label: 'Active Routes', value: String(kpis.activeRoutes) },
                  { label: 'Total Parties', value: String(kpis.totalParties) },
                  { label: 'Total Products', value: String(kpis.totalProducts) },
                  { label: 'Picklists Processed', value: String(kpis.totalPicklists) },
                ].map(row => (
                  row.value === '' ? (
                    <tr key={row.label} className="bg-slate-50">
                      <td colSpan={2} className="px-4 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-widest">{row.label}</td>
                    </tr>
                  ) : (
                    <tr key={row.label} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 text-slate-700">{row.label}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${row.bold ? 'font-bold text-slate-900' : 'text-slate-700'}`}>{row.value}</td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
