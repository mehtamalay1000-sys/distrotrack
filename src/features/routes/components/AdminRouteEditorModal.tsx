import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Trash2, Plus, Edit2, User, ChevronDown, ChevronRight } from 'lucide-react';
import { getParties } from '@/features/parties/services/partyService';
import { getProducts } from '@/features/products/services/productService';
import { mockStore } from '@/lib/mockStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getLocalDateString } from '@/shared/utils/format';
import type { Route, DeliveryItem } from '@/lib/database.types';

interface AdminRouteEditorModalProps {
  route: Route;
  onClose: () => void;
}

export function AdminRouteEditorModal({ route, onClose }: AdminRouteEditorModalProps) {
  const qc = useQueryClient();
  const [expandedPartyId, setExpandedPartyId] = useState<string | null>(null);
  const [addingPartyId, setAddingPartyId] = useState('');
  const [addingProductIdMap, setAddingProductIdMap] = useState<Record<string, string>>({});

  const { data: allParties = [] } = useQuery({ queryKey: ['parties'], queryFn: getParties });
  const { data: allProducts = [] } = useQuery({ queryKey: ['products'], queryFn: () => getProducts() });

  // Get all deliveries associated with this route
  const deliveries = mockStore.getDeliveries().filter((d) => {
    const p = mockStore.getParties().find((party) => party.id === d.party_id);
    return d.picklist?.route_id === route.id || p?.route_id === route.id || p?.route?.code === route.code;
  });

  const deliveryItems = mockStore.getDeliveryItems();

  // Helper to get delivery items for a delivery
  const getItemsForDelivery = (deliveryId: string) => {
    return deliveryItems.filter((i) => i.delivery_id === deliveryId);
  };

  // Add a party to the route
  const handleAddPartyToRoute = async () => {
    if (!addingPartyId) return;
    try {
      // Find party
      const party = allParties.find((p) => p.id === addingPartyId);
      if (!party) return;

      // Create new delivery record
      mockStore.saveDelivery({
        party_id: party.id,
        worker_id: route.assigned_worker_id || null,
        status: 'pending',
        total_amount: 0,
        delivery_date: getLocalDateString(),
        notes: `Added to route ${route.name}`,
      });

      // Update party route_id
      await supabase.from('parties').update({ route_id: route.id }).eq('id', party.id);
      mockStore.saveParty({ ...party, route_id: route.id });

      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['routes'] });
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      toast.success(`Party ${party.name} added to route!`);
      setAddingPartyId('');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // Remove a party from the route
  const handleRemovePartyFromRoute = async (deliveryId: string, partyName: string) => {
    if (!confirm(`Are you sure you want to remove ${partyName} from this route?`)) return;
    try {
      mockStore.deleteDelivery(deliveryId);
      await supabase.from('deliveries').delete().eq('id', deliveryId);

      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['routes'] });
      qc.invalidateQueries({ queryKey: ['worker-today-route'] });
      toast.success(`Removed ${partyName} from route.`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // Update item ordered quantity
  const handleUpdateItemQty = (item: DeliveryItem, newQty: number) => {
    const qty = Math.max(0, newQty);
    const amount = qty * Number(item.rate || 0);

    mockStore.updateDeliveryItem(item.id, {
      ordered_qty: qty,
      delivered_qty: qty,
      amount,
    });

    // Update parent delivery total amount
    recalculateDeliveryTotal(item.delivery_id);

    qc.invalidateQueries({ queryKey: ['deliveries'] });
    qc.invalidateQueries({ queryKey: ['worker-today-route'] });
    toast.success(`Updated ${item.product_name} quantity to ${qty}`);
  };

  // Remove item from delivery
  const handleDeleteItem = (itemId: string, deliveryId: string) => {
    mockStore.deleteDeliveryItem(itemId);
    recalculateDeliveryTotal(deliveryId);

    qc.invalidateQueries({ queryKey: ['deliveries'] });
    qc.invalidateQueries({ queryKey: ['worker-today-route'] });
    toast.success('Item removed from bill');
  };

  // Add product to delivery bill
  const handleAddProductToDelivery = (deliveryId: string) => {
    const prodId = addingProductIdMap[deliveryId];
    if (!prodId) return;

    const prod = allProducts.find((p) => p.id === prodId);
    if (!prod) return;

    const rate = Number(prod.rate || prod.mrp || 100);
    const amount = rate * 1;

    mockStore.saveDeliveryItem({
      delivery_id: deliveryId,
      product_id: prod.id,
      sku: prod.sku,
      product_name: prod.name,
      ordered_qty: 1,
      delivered_qty: 1,
      rate,
      amount,
    });

    recalculateDeliveryTotal(deliveryId);

    qc.invalidateQueries({ queryKey: ['deliveries'] });
    qc.invalidateQueries({ queryKey: ['worker-today-route'] });
    toast.success(`Added ${prod.name} to bill`);

    setAddingProductIdMap((prev) => ({ ...prev, [deliveryId]: '' }));
  };

  // Recalculate parent delivery total amount
  const recalculateDeliveryTotal = (deliveryId: string) => {
    const items = mockStore.getDeliveryItems().filter((i) => i.delivery_id === deliveryId);
    const newTotal = items.reduce((sum, i) => sum + Number(i.amount || 0), 0);
    const del = mockStore.getDeliveries().find((d) => d.id === deliveryId);
    if (del) {
      del.total_amount = newTotal;
      mockStore.saveDelivery(del);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
        {/* Modal Header */}
        <div className="p-4 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between bg-surface-50 dark:bg-surface-900/50">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold">
              <Edit2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-surface-900 dark:text-white">
                Edit Route & Invoice Products — {route.name}
              </h2>
              <p className="text-xs text-surface-500 dark:text-surface-400">
                Modify party bills, adjust quantities, add/remove items or parties
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Add Party to Route */}
          <div className="p-3.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/80 dark:border-blue-800/40 space-y-2">
            <label className="block text-xs font-bold text-blue-900 dark:text-blue-200">
              Add New Party / Customer to Route
            </label>
            <div className="flex gap-2">
              <select
                value={addingPartyId}
                onChange={(e) => setAddingPartyId(e.target.value)}
                className="flex-1 h-9 px-3 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-xs font-medium text-surface-900 dark:text-white outline-none"
              >
                <option value="">-- Select Customer Party to Add --</option>
                {allParties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
              <button
                onClick={handleAddPartyToRoute}
                disabled={!addingPartyId}
                className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs transition-colors flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" /> Add Party
              </button>
            </div>
          </div>

          {/* Parties & Products List */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-surface-500 dark:text-surface-400">
              Parties & Invoice Line Items on Route ({deliveries.length})
            </h3>

            {deliveries.length === 0 ? (
              <div className="p-6 text-center text-xs text-surface-400 border border-dashed border-surface-300 dark:border-surface-700 rounded-xl">
                No parties currently on this route. Select a party above to add them.
              </div>
            ) : (
              deliveries.map((del) => {
                const party = allParties.find((p) => p.id === del.party_id) || del.party;
                const items = getItemsForDelivery(del.id);
                const isExpanded = expandedPartyId === del.id;
                const totalAmt = items.reduce((sum, i) => sum + Number(i.amount || 0), Number(del.total_amount || 0) === 0 ? 0 : Number(del.total_amount));

                return (
                  <div key={del.id} className="border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden bg-white dark:bg-surface-900 shadow-xs">
                    {/* Party Header Row */}
                    <div className="p-3 bg-surface-50 dark:bg-surface-800/60 flex items-center justify-between gap-3">
                      <button
                        onClick={() => setExpandedPartyId(isExpanded ? null : del.id)}
                        className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-surface-400" /> : <ChevronRight className="h-4 w-4 text-surface-400" />}
                        <User className="h-4 w-4 text-blue-500 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-surface-900 dark:text-white truncate">
                            {party?.name || 'Customer Party'}
                          </div>
                          <div className="text-[10px] text-surface-500 dark:text-surface-400">
                            {party?.code} • {items.length} product(s)
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-3">
                        <span className="text-xs font-extrabold text-surface-900 dark:text-white">
                          {formatCurrency(totalAmt)}
                        </span>
                        <button
                          onClick={() => handleRemovePartyFromRoute(del.id, party?.name || 'Party')}
                          className="p-1.5 rounded-lg text-surface-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                          title="Remove Party from Route"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Products Editor */}
                    {isExpanded && (
                      <div className="p-3 border-t border-surface-200 dark:border-surface-700 space-y-3 bg-white dark:bg-surface-900">
                        {/* Products Table */}
                        {items.length === 0 ? (
                          <div className="text-xs text-surface-400 p-2 text-center">No products on this bill. Add one below.</div>
                        ) : (
                          <div className="space-y-2">
                            {items.map((item) => (
                              <div key={item.id} className="p-2.5 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-surface-200/60 dark:border-surface-700/60 flex items-center justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-bold text-surface-900 dark:text-white truncate">{item.product_name}</div>
                                  <div className="text-[10px] text-surface-400 font-mono">{item.sku} • ₹{item.rate}/pc</div>
                                </div>

                                <div className="flex items-center gap-2">
                                  <div className="flex items-center border border-surface-300 dark:border-surface-600 rounded-md overflow-hidden bg-white dark:bg-surface-800">
                                    <button
                                      onClick={() => handleUpdateItemQty(item, Number(item.ordered_qty) - 1)}
                                      className="w-6 h-6 flex items-center justify-center text-xs font-bold text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700"
                                    >
                                      −
                                    </button>
                                    <span className="w-8 text-center text-xs font-bold text-surface-900 dark:text-white">
                                      {item.ordered_qty}
                                    </span>
                                    <button
                                      onClick={() => handleUpdateItemQty(item, Number(item.ordered_qty) + 1)}
                                      className="w-6 h-6 flex items-center justify-center text-xs font-bold text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700"
                                    >
                                      +
                                    </button>
                                  </div>

                                  <div className="text-xs font-bold text-surface-900 dark:text-white w-16 text-right">
                                    {formatCurrency(item.amount)}
                                  </div>

                                  <button
                                    onClick={() => handleDeleteItem(item.id, del.id)}
                                    className="p-1 text-surface-400 hover:text-red-600"
                                    title="Delete product"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Add Product to this Party */}
                        <div className="flex gap-2 pt-1">
                          <select
                            value={addingProductIdMap[del.id] || ''}
                            onChange={(e) => setAddingProductIdMap({ ...addingProductIdMap, [del.id]: e.target.value })}
                            className="flex-1 h-8 px-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-xs text-surface-900 dark:text-white outline-none"
                          >
                            <option value="">-- Add Product to Bill --</option>
                            {allProducts.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} (₹{p.rate || p.mrp})
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleAddProductToDelivery(del.id)}
                            disabled={!addingProductIdMap[del.id]}
                            className="px-2.5 py-1 rounded-lg bg-surface-200 dark:bg-surface-700 hover:bg-surface-300 text-surface-900 dark:text-white font-semibold text-xs disabled:opacity-50"
                          >
                            + Add Item
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-surface-200 dark:border-surface-700 flex justify-end bg-surface-50 dark:bg-surface-900/50">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm"
          >
            Done Editing Route
          </button>
        </div>
      </div>
    </div>
  );
}
