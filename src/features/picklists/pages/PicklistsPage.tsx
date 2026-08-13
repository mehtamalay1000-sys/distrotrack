import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardList, Search, FileUp, Eye, Trash2, CheckCircle2 } from 'lucide-react';
import { PageHeader, Button, StatusBadge, EmptyState, LoadingState, ErrorState, Select } from '@/shared/ui';
import { getPicklists, deletePicklist, updatePicklistStatus, assignPicklistWorker } from '../services/picklistService';
import { getWorkers } from '@/features/workers/services/workerService';
import { formatCurrency, formatDate } from '@/shared/utils/format';
import type { Picklist } from '@/lib/database.types';

export function PicklistsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: picklists = [], isLoading, error } = useQuery({
    queryKey: ['picklists'],
    queryFn: getPicklists,
  });

  const { data: workers = [] } = useQuery({ queryKey: ['workers'], queryFn: getWorkers });

  const deleteMut = useMutation({
    mutationFn: deletePicklist,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      toast.success('Picklist and all associated deliveries deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Picklist['status'] }) => updatePicklistStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('Status updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignMut = useMutation({
    mutationFn: ({ id, workerId }: { id: string; workerId: string | null }) => assignPicklistWorker(id, workerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      toast.success('Worker assigned to picklist');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = picklists.filter((pl) => {
    const matchSearch = pl.picklist_number.toLowerCase().includes(search.toLowerCase()) ||
      (pl.route?.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (pl.worker?.name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || pl.status === statusFilter;
    return matchSearch && matchStatus;
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;


  return (
    <div>
      <PageHeader
        title="Picklists"
        description="View and manage SAP picklists, assigned workload, and items"
        actions={
          <Button icon={<FileUp className="h-4 w-4" />} onClick={() => navigate('/admin/import')}>
            Import SAP Picklist
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
          <input
            type="text"
            placeholder="Search picklist # or route…"
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
              { value: 'draft', label: 'Draft' },
              { value: 'confirmed', label: 'Confirmed' },
              { value: 'in_progress', label: 'In Progress' },
              { value: 'completed', label: 'Completed' },
            ]}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-10 w-10" />}
          title="No picklists found"
          description={search ? 'Try a different search term' : 'Import an SAP Picklist PDF to generate structured picklist records'}
          action={!search ? <Button size="sm" onClick={() => navigate('/admin/import')}>Import SAP PDF</Button> : undefined}
        />
      ) : (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden">
          <table className="dt-table">
            <thead>
              <tr>
                <th>Picklist #</th>
                <th>Date</th>
                <th>Route</th>
                <th>Assigned Worker</th>
                <th>Items Count</th>
                <th>Total Value</th>
                <th>Status</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((pl) => (
                <tr key={pl.id}>
                  <td>
                    <span className="font-mono text-xs bg-surface-100 dark:bg-surface-700 text-surface-900 dark:text-surface-100 px-2 py-0.5 rounded font-bold">
                      {pl.picklist_number}
                    </span>
                  </td>
                  <td className="text-xs text-surface-600 dark:text-surface-400">{formatDate(pl.date)}</td>
                  <td>
                    {pl.route ? (
                      <span className="text-xs font-medium text-surface-700 dark:text-surface-300">{pl.route.name} ({pl.route.code})</span>
                    ) : (
                      <span className="text-xs text-surface-400">Main Route</span>
                    )}
                  </td>
                  <td>
                    <select
                      value={pl.worker_id || ''}
                      onChange={(e) => assignMut.mutate({ id: pl.id, workerId: e.target.value || null })}
                      className="text-xs bg-surface-50 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 text-surface-900 dark:text-surface-100 rounded px-2 py-1 outline-none font-medium cursor-pointer"
                    >
                      <option value="">-- Unassigned --</option>
                      {workers.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="text-xs font-medium text-surface-800 dark:text-surface-200">{pl.total_items} SKUs</td>
                  <td className="font-semibold text-primary-700 dark:text-primary-400">{formatCurrency(pl.total_amount)}</td>
                  <td><StatusBadge status={pl.status} /></td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => navigate(`/admin/picklists/${pl.id}`)}
                        className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-100"
                        title="View Details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {pl.status !== 'completed' && (
                        <button
                          onClick={() => statusMut.mutate({ id: pl.id, status: 'completed' })}
                          className="p-1 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-surface-400 hover:text-emerald-600 dark:hover:text-emerald-400"
                          title="Mark Complete"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => deleteMut.mutate(pl.id)}
                        className="p-1 rounded hover:bg-danger-50 dark:hover:bg-danger-950/40 text-surface-400 hover:text-danger-600 dark:hover:text-danger-500"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
