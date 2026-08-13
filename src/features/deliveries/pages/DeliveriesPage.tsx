import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, CheckCircle2, Truck, DollarSign, Trash2 } from 'lucide-react';
import { PageHeader, Button, Select, StatusBadge, EmptyState, LoadingState, ErrorState } from '@/shared/ui';
import { getDeliveries, updateDeliveryStatus, assignDeliveryWorker, deleteDelivery } from '../services/deliveryService';
import { getWorkers } from '@/features/workers/services/workerService';
import { formatCurrency, formatDate } from '@/shared/utils/format';
import type { Delivery } from '@/lib/database.types';

export function DeliveriesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data: deliveries = [], isLoading, error } = useQuery({ queryKey: ['deliveries'], queryFn: getDeliveries });
  const { data: workers = [] } = useQuery({ queryKey: ['workers'], queryFn: getWorkers });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Delivery['status'] }) => updateDeliveryStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('Delivery status updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const workerMut = useMutation({
    mutationFn: ({ id, workerId }: { id: string; workerId: string | null }) => assignDeliveryWorker(id, workerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      toast.success('Worker assigned');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteDelivery,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      toast.success('Delivery order deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = deliveries.filter((d) => {
    const matchesSearch =
      (d.party?.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (d.invoice?.invoice_number ?? '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;

  return (
    <div>
      <PageHeader
        title="Deliveries"
        description="Track daily delivery workload generated from imported SAP picklists"
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
          <input
            type="text"
            placeholder="Search party or invoice #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-sm border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:ring-offset-1 dark:focus:ring-offset-surface-900"
          />
        </div>
        <div className="w-48">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'pending', label: 'Pending' },
              { value: 'out_for_delivery', label: 'Out for Delivery' },
              { value: 'delivered', label: 'Delivered' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-10 w-10" />}
          title="No deliveries found"
          description={search ? 'Try adjusting your filters' : 'Import an SAP Picklist to populate delivery tasks'}
        />
      ) : (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden">
          <table className="dt-table">
            <thead>
              <tr>
                <th>Customer / Party</th>
                <th>Invoice / Picklist Ref</th>
                <th>Assigned Worker</th>
                <th>Delivery Date</th>
                <th>Amount</th>
                <th>Payment Mode</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const totalPaid = (d.payments || []).reduce((acc, p) => acc + Number(p.amount), 0);
                const delAmount = Number(
                  d.delivered_amount ||
                  d.total_amount ||
                  d.invoice?.net_amount ||
                  d.collected_amount ||
                  totalPaid ||
                  0
                );
                const isPaid = totalPaid >= delAmount && delAmount > 0;
                const effectiveMode = d.payment_mode || (d.payments && d.payments[0] ? d.payments[0].payment_mode : null);
                const chequeNo = d.payments && d.payments[0] ? d.payments[0].cheque_number : null;

                return (
                  <tr key={d.id}>
                    <td>
                      <div className="font-medium text-surface-900 dark:text-surface-100">{d.party ? d.party.name : 'Unknown Party'}</div>
                      <div className="font-mono text-xs text-surface-400">{d.party?.code}</div>
                    </td>
                    <td>
                      {d.invoice?.invoice_number ? (
                        <span className="font-mono text-xs font-bold text-surface-900 dark:text-surface-100">{d.invoice.invoice_number}</span>
                      ) : d.picklist?.picklist_number ? (
                        <span className="font-mono text-xs text-blue-600 dark:text-blue-400 font-semibold">{d.picklist.picklist_number}</span>
                      ) : (
                        <span className="font-mono text-xs text-surface-500">INV-{d.id.slice(0, 8).toUpperCase()}</span>
                      )}
                    </td>
                    <td>
                      <select
                        value={d.worker_id || ''}
                        onChange={(e) => workerMut.mutate({ id: d.id, workerId: e.target.value || null })}
                        className="text-xs border border-surface-200 dark:border-surface-600 rounded px-2 py-1 bg-surface-50 dark:bg-surface-700 text-surface-800 dark:text-surface-200 focus:outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer"
                      >
                        <option value="">Unassigned</option>
                        {workers.filter(w => w.status === 'active').map(w => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="text-xs text-surface-600 dark:text-surface-400">{formatDate(d.delivery_date || d.created_at)}</td>
                    <td className="font-semibold text-surface-900 dark:text-surface-100">{formatCurrency(delAmount)}</td>
                    <td>
                      {effectiveMode === 'cash' ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                          Cash Collected
                        </span>
                      ) : effectiveMode === 'cheque' ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
                          Cheque {chequeNo ? `#${chequeNo}` : ''}
                        </span>
                      ) : effectiveMode === 'credit' ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                          Credit / Udhari
                        </span>
                      ) : (
                        <span className="text-xs text-surface-400">Pending</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={d.status} />
                        {isPaid && (
                          <span className="text-[10px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-semibold px-1.5 py-0.5 rounded w-fit">
                            Paid ({formatCurrency(totalPaid)})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {d.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="outline"
                            icon={<Truck className="h-3.5 w-3.5" />}
                            onClick={() => statusMut.mutate({ id: d.id, status: 'out_for_delivery' })}
                          >
                            Dispatch
                          </Button>
                        )}
                        {d.status === 'out_for_delivery' && (
                          <Button
                            size="sm"
                            variant="primary"
                            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                            onClick={() => statusMut.mutate({ id: d.id, status: 'delivered' })}
                          >
                            Mark Delivered
                          </Button>
                        )}
                        {d.status === 'delivered' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<DollarSign className="h-3.5 w-3.5 text-emerald-600" />}
                            onClick={() => navigate(`/admin/payments?delivery_id=${d.id}&party_id=${d.party_id}&amount=${delAmount}`)}
                          >
                            {effectiveMode ? 'View Payment' : 'Record Payment'}
                          </Button>
                        )}
                        <button
                          onClick={() => {
                            if (window.confirm('Delete this delivery order?')) deleteMut.mutate(d.id);
                          }}
                          className="p-1 rounded text-surface-400 hover:text-red-500 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors ml-1"
                          title="Delete Delivery"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
