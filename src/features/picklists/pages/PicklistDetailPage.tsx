import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Truck, CheckCircle2 } from 'lucide-react';
import { PageHeader, Button, StatusBadge, Card, LoadingState, ErrorState } from '@/shared/ui';
import { getPicklist, updatePicklistStatus, assignPicklistWorker } from '../services/picklistService';
import { getWorkers } from '@/features/workers/services/workerService';
import { formatCurrency, formatDate } from '@/shared/utils/format';

export function PicklistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: picklist, isLoading, error } = useQuery({
    queryKey: ['picklist', id],
    queryFn: () => getPicklist(id!),
    enabled: !!id,
  });

  const { data: workers = [] } = useQuery({ queryKey: ['workers'], queryFn: getWorkers });

  const statusMut = useMutation({
    mutationFn: (status: 'assigned' | 'in_progress' | 'completed') => updatePicklistStatus(id!, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picklist', id] });
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('Picklist status updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignMut = useMutation({
    mutationFn: (workerId: string | null) => assignPicklistWorker(id!, workerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picklist', id] });
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      toast.success('Worker assigned to picklist');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <LoadingState />;
  if (error || !picklist) return <ErrorState message={error ? (error as Error).message : 'Picklist not found'} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/admin/picklists')}>
          Back to Picklists
        </Button>
      </div>

      <PageHeader
        title={`Picklist #${picklist.picklist_number}`}
        description={`Imported SAP Picklist created on ${formatDate(picklist.date)}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={picklist.status} />
            {picklist.status === 'confirmed' && (
              <Button size="sm" icon={<Truck className="h-4 w-4" />} onClick={() => statusMut.mutate('in_progress')}>
                Start Delivery
              </Button>
            )}
            {picklist.status === 'in_progress' && (
              <Button size="sm" variant="secondary" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => statusMut.mutate('completed')}>
                Mark Complete
              </Button>
            )}
          </div>
        }
      />

      {/* Header Info */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase">Route</div>
          <div className="text-sm font-semibold text-surface-900 dark:text-surface-100 mt-1">{picklist.route ? picklist.route.name : 'Main Route'}</div>
          {picklist.route && <div className="font-mono text-xs text-surface-400 mt-0.5">{picklist.route.code}</div>}
        </Card>
        <Card className="p-4">
          <div className="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase">Assigned Worker</div>
          <select
            value={picklist.worker_id || ''}
            onChange={(e) => assignMut.mutate(e.target.value || null)}
            className="mt-1 text-sm font-semibold bg-surface-50 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 text-surface-900 dark:text-surface-100 rounded px-2 py-1 outline-none w-full cursor-pointer"
          >
            <option value="">-- Unassigned --</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase">Total Line Items</div>
          <div className="text-sm font-semibold text-surface-900 dark:text-surface-100 mt-1">{picklist.total_items || picklist.items?.length || 0} SKUs</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase">Total Value</div>
          <div className="text-base font-bold text-primary-700 dark:text-primary-400 mt-1">{formatCurrency(picklist.total_amount)}</div>
        </Card>
      </div>

      {/* Items Table */}
      <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-surface-200 dark:border-surface-700 font-semibold text-sm text-surface-900 dark:text-surface-100">
          Picklist Product Items
          {picklist.notes && <span className="ml-2 text-xs font-normal text-surface-400">— {picklist.notes}</span>}
        </div>
        {(picklist.items || []).length === 0 ? (
          <div className="p-8 text-center text-xs text-surface-400">
            No item lines found for this picklist. Items appear here when imported with PDF parsing.
          </div>
        ) : (
          <table className="dt-table">
            <thead>
              <tr>
                <th>Customer / Party</th>
                <th>SKU</th>
                <th>Product Name</th>
                <th className="text-right">Quantity</th>
                <th className="text-right">Rate</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(picklist.items || []).map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="font-medium text-surface-900 dark:text-surface-100">{item.party ? item.party.name : 'General Customer'}</span>
                    {item.party?.code && <div className="font-mono text-xs text-surface-400">{item.party.code}</div>}
                  </td>
                  <td><span className="font-mono text-xs bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-200 px-1.5 py-0.5 rounded font-medium">{item.sku}</span></td>
                  <td className="font-medium text-surface-900 dark:text-surface-100">{item.product_name}</td>
                  <td className="text-right font-medium text-surface-900 dark:text-surface-100">{item.quantity}</td>
                  <td className="text-right text-surface-700 dark:text-surface-300">{formatCurrency(item.rate)}</td>
                  <td className="text-right font-semibold text-surface-900 dark:text-surface-100">{formatCurrency(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
