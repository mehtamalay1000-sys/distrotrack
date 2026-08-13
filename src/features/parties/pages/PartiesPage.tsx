import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, MoreHorizontal, Edit2, Trash2, Building2, Phone, MapPin } from 'lucide-react';
import { PageHeader, Button, Input, Select, Modal, EmptyState, LoadingState, ErrorState, StatusBadge } from '@/shared/ui';
import { getParties, createParty, updateParty, deleteParty } from '../services/partyService';
import { getRoutes } from '@/features/routes/services/routeService';
import { formatCurrency } from '@/shared/utils/format';
import type { Party } from '@/lib/database.types';

export function PartiesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: '', name: '', contact_person: '', phone: '', email: '', address: '', city: '', route_id: ''
  });

  const { data: parties = [], isLoading, error } = useQuery({ queryKey: ['parties'], queryFn: getParties });
  const { data: routes = [] } = useQuery({ queryKey: ['routes'], queryFn: getRoutes });

  const createMut = useMutation({
    mutationFn: createParty,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['parties'] }); toast.success('Party added'); closeModal(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Party> }) => updateParty(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['parties'] }); toast.success('Party updated'); closeModal(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: deleteParty,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['parties'] }); toast.success('Party deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = parties.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.code.toLowerCase().includes(search.toLowerCase()) ||
    (p.city ?? '').toLowerCase().includes(search.toLowerCase())
  );

  function openCreate() {
    setEditing(null);
    setForm({ code: '', name: '', contact_person: '', phone: '', email: '', address: '', city: '', route_id: '' });
    setModalOpen(true);
  }
  function openEdit(p: Party) {
    setEditing(p);
    setForm({
      code: p.code, name: p.name, contact_person: p.contact_person ?? '',
      phone: p.phone ?? '', email: p.email ?? '', address: p.address ?? '',
      city: p.city ?? '', route_id: p.route_id ?? ''
    });
    setModalOpen(true);
    setMenuOpen(null);
  }
  function closeModal() { setModalOpen(false); setEditing(null); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      updateMut.mutate({ id: editing.id, data: { ...form, route_id: form.route_id || null } });
    } else {
      createMut.mutate({ ...form, route_id: form.route_id || undefined });
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;

  return (
    <div>
      <PageHeader title="Parties (Customers)" description="Manage wholesale customers, routes, and outstanding balances" actions={<Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Add Party</Button>} />
      <div className="mb-4 max-w-xs">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
          <input type="text" placeholder="Search party code, name, city…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full h-9 pl-9 pr-3 text-sm border border-surface-300 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:ring-offset-1 dark:focus:ring-offset-surface-900" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<Building2 className="h-10 w-10" />} title="No parties found" description={search ? 'Try a different search' : 'Add your first customer party'} action={!search ? <Button size="sm" onClick={openCreate}>Add Party</Button> : undefined} />
      ) : (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden">
          <table className="dt-table">
            <thead>
              <tr>
                <th>Code & Name</th>
                <th>Contact / City</th>
                <th>Route</th>
                <th>Outstanding</th>
                <th>Status</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-200 px-1.5 py-0.5 rounded font-medium">{p.code}</span>
                      <span className="font-medium text-surface-900 dark:text-surface-100">{p.name}</span>
                    </div>
                  </td>
                  <td>
                    <div className="text-xs text-surface-600 dark:text-surface-400 space-y-0.5">
                      {p.contact_person && <div>{p.contact_person}</div>}
                      {p.phone && <div className="flex items-center gap-1"><Phone className="h-3 w-3" /> {p.phone}</div>}
                      {p.city && <div className="flex items-center gap-1 text-surface-400 dark:text-surface-500"><MapPin className="h-3 w-3" /> {p.city}</div>}
                      {!p.contact_person && !p.phone && !p.city && <span className="text-surface-400">—</span>}
                    </div>
                  </td>
                  <td>{p.route ? <span className="text-sm font-medium text-surface-700 dark:text-surface-300">{p.route.name} ({p.route.code})</span> : <span className="text-xs text-surface-400">Unassigned</span>}</td>
                  <td>
                    <span className={`font-medium ${p.outstanding_amount > 0 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-surface-600 dark:text-surface-400'}`}>
                      {formatCurrency(p.outstanding_amount)}
                    </span>
                  </td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>
                    <div className="relative">
                      <button onClick={() => setMenuOpen(menuOpen === p.id ? null : p.id)} className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-400"><MoreHorizontal className="h-4 w-4" /></button>
                      {menuOpen === p.id && (
                        <div className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg py-1 z-10">
                          <button onClick={() => openEdit(p)} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700"><Edit2 className="h-3.5 w-3.5" /> Edit</button>
                          <button onClick={() => { deleteMut.mutate(p.id); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-danger-600 dark:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-950/40"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit Party' : 'Add Party'} footer={<><Button variant="secondary" onClick={closeModal}>Cancel</Button><Button loading={createMut.isPending || updateMut.isPending} onClick={() => (document.getElementById('party-form') as HTMLFormElement)?.requestSubmit()}>{editing ? 'Save' : 'Add Party'}</Button></>}>
        <form id="party-form" onSubmit={handleSubmit} className="space-y-3">
          <Input label="Customer Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. CUST001" required />
          <Input label="Customer Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label="Contact Person" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
          <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Input label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Select label="Route" value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value })} placeholder="Select route (optional)" options={routes.filter(r => r.status === 'active').map(r => ({ value: r.id, label: `${r.name} (${r.code})` }))} />
        </form>
      </Modal>
    </div>
  );
}
