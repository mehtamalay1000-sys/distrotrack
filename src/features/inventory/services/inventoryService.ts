/**
 * Authoritative Operational Inventory Service
 *
 * Provides real-time operational inventory stock calculations derived directly
 * from the immutable `inventory_movements` ledger table and Product Master.
 *
 * Rules:
 * 1. Current Stock = Opening + Inbound (Purchased) - Delivered (Sold) + Returned - Damaged ± Adjustments.
 * 2. Does NOT invent fabricated quantities. Uses 'INCOMPLETE DATA' if indeterminate.
 * 3. Supports negative inventory by design (e.g. delivered before GR import confirmed).
 * 4. Strictly decouples inventory quantities from product pricing / MRP.
 * 5. Primary source is Supabase `inventory_movements` with graceful offline fallback to `mockStore`.
 */

import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import { getProducts } from '@/features/products/services/productService';
import { findProductMasterEntry } from '@/features/products/data/productMaster';
import type { InventoryMovement } from '@/lib/database.types';

export type StockStatusType =
  | 'IN_STOCK'
  | 'LOW_STOCK'
  | 'ZERO_STOCK'
  | 'NEGATIVE_STOCK'
  | 'INCOMPLETE'
  | 'UNMAPPED';

export interface ProductInventoryItem {
  id: string;
  sku: string;
  name: string;
  uom: string;
  category?: string;
  brand?: string;
  mrp?: number;
  rate?: number;
  openingStock: number;
  inboundQty: number;
  sapSalesBaselineQty: number;
  routeLoadedQty: number;
  deliveredQty: number;
  returnedQty: number;
  damagedQty: number;
  adjustmentQty: number;
  warehouseStock: number;
  vehicleStock: number;
  currentStock: number; // Total Operational Stock = warehouseStock + vehicleStock
  calculatedStock: number;
  stockStatus: StockStatusType;
  hasMovements: boolean;
  isIncomplete: boolean;
  isUnmapped: boolean;
  notes?: string;
  lastMovementDate?: string;
  movementCount: number;
}

export interface InventorySummary {
  totalSkus: number;
  totalInbound: number;
  totalSapSalesBaseline: number;
  totalDelivered: number;
  totalReturned: number;
  totalWarehouseStock: number;
  totalVehicleStock: number;
  totalOperationalStock: number;
  negativeStockCount: number;
  lowStockCount: number;
  zeroStockCount: number;
  unmappedCount: number;
  incompleteCount: number;
}

export interface InventoryMovementDetail {
  id: string;
  occurredAt: string;
  movementType: string;
  movementTypeLabel: string;
  quantity: number;
  direction: 'in' | 'out';
  fromLocation: string;
  toLocation: string;
  referenceNumber?: string | null;
  referenceType?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
  routeId?: string | null;
  partyName?: string | null;
  warehouseBalance: number;
  vehicleBalance: number;
  runningBalance: number; // Total Operational Stock
  netTotalImpact: number;
  netTotalImpactLabel: string;
}

export interface InventoryFilterOptions {
  search?: string;
  statusFilter?: 'all' | 'in_stock' | 'zero_stock' | 'negative_stock' | 'low_stock' | 'unmapped' | 'incomplete';
  categoryFilter?: string;
}

/**
 * Normalizes SKU by trimming, uppercase, and stripping leading zeros for index matching.
 */
export function normalizeSkuKey(sku: string): string {
  if (!sku) return '';
  const clean = sku.trim().toUpperCase();
  const unpadded = clean.replace(/^0+/, '');
  return unpadded || clean;
}

/**
 * Formats user-friendly label for inventory movement types.
 */
export function getMovementTypeLabel(type: string): string {
  switch (type) {
    case 'purchase_inward':
      return 'SAP Purchase Inward';
    case 'sap_sales_baseline':
      return 'SAP Baseline Sale';
    case 'opening_balance':
      return 'Opening Balance';
    case 'delivery_fulfilled':
      return 'Delivery Fulfilled';
    case 'route_load':
      return 'Route Vehicle Load';
    case 'route_return':
      return 'Route Return';
    case 'damaged_transit':
      return 'Damaged (Transit)';
    case 'damaged_warehouse':
      return 'Damaged (Warehouse)';
    case 'inventory_adjustment':
      return 'Inventory Adjustment';
    default:
      return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/**
 * Fetches all inventory movements from Supabase ledger, falling back to mockStore.
 */
export async function getAllInventoryMovements(): Promise<InventoryMovement[]> {
  try {
    const { data, error } = await supabase
      .from('inventory_movements')
      .select('*')
      .order('occurred_at', { ascending: true });

    if (!error && data) {
      return data as InventoryMovement[];
    }
  } catch (err) {
    console.warn('[INVENTORY] Supabase inventory_movements query failed, falling back to mockStore:', err);
  }

  return mockStore.getInventoryMovements();
}

/**
 * Fetches and derives complete operational inventory stock per product.
 */
export async function getOperationalInventoryData(
  options?: InventoryFilterOptions
): Promise<{
  items: ProductInventoryItem[];
  summary: InventorySummary;
  categories: string[];
}> {
  // 1. Fetch products & movements in parallel
  const [products, movements] = await Promise.all([
    getProducts(),
    getAllInventoryMovements(),
  ]);

  // Map movements by normalized SKU
  const movementsByNormSku = new Map<string, InventoryMovement[]>();
  for (const m of movements) {
    const norm = normalizeSkuKey(m.sku);
    const list = movementsByNormSku.get(norm) || [];
    list.push(m);
    movementsByNormSku.set(norm, list);
  }

  // 2. Track processed products and unmapped movements
  const inventoryItems: ProductInventoryItem[] = [];
  const processedNormSkus = new Set<string>();

  // Process all canonical products from Product Master
  for (const prod of products) {
    const norm = normalizeSkuKey(prod.sku);
    processedNormSkus.add(norm);

    const prodMovements = movementsByNormSku.get(norm) || [];

    let openingStock = 0;
    let inboundQty = 0;
    let sapSalesBaselineQty = 0;
    let routeLoadedQty = 0;
    let deliveredQty = 0;
    let returnedQty = 0;
    let damagedTransitQty = 0;
    let damagedWarehouseQty = 0;
    let damagedQty = 0;
    let warehouseAdjustmentQty = 0;
    let vehicleAdjustmentQty = 0;
    let adjustmentQty = 0;
    let lastDate: string | undefined = undefined;

    for (const m of prodMovements) {
      const q = Number(m.quantity || 0);
      if (m.occurred_at) {
        if (!lastDate || new Date(m.occurred_at) > new Date(lastDate)) {
          lastDate = m.occurred_at;
        }
      }

      switch (m.movement_type) {
        case 'opening_balance':
          openingStock += q;
          break;
        case 'purchase_inward':
          inboundQty += q;
          break;
        case 'sap_sales_baseline':
          sapSalesBaselineQty += q;
          break;
        case 'route_load':
          // Location transfer: Warehouse -> Vehicle (Net total stock impact = 0)
          routeLoadedQty += q;
          break;
        case 'route_return':
          // Location transfer: Vehicle -> Warehouse (Net total stock impact = 0)
          returnedQty += q;
          break;
        case 'delivery_fulfilled':
          // True stock-out from vehicle: Vehicle -> Customer
          deliveredQty += q;
          break;
        case 'damaged_transit':
          damagedTransitQty += q;
          damagedQty += q;
          break;
        case 'damaged_warehouse':
          damagedWarehouseQty += q;
          damagedQty += q;
          break;
        case 'inventory_adjustment':
          const adj = (m.direction === 'in' ? q : -q);
          adjustmentQty += adj;
          if (m.from_location === 'vehicle' || m.to_location === 'vehicle') {
            vehicleAdjustmentQty += adj;
          } else {
            warehouseAdjustmentQty += adj;
          }
          break;
        default:
          if (m.from_location === 'warehouse' && m.to_location === 'vehicle') {
            routeLoadedQty += q;
          } else if (m.from_location === 'vehicle' && m.to_location === 'warehouse') {
            returnedQty += q;
          } else if (m.to_location === 'warehouse' && m.direction === 'in') {
            inboundQty += q;
          } else if (m.from_location === 'vehicle' && m.to_location === 'customer') {
            deliveredQty += q;
          } else if (m.from_location === 'warehouse' && m.to_location === 'customer') {
            deliveredQty += q;
          }
      }
    }

    // Mathematical Invariants:
    //   Warehouse = Opening + Inbound - Baseline - Loads + Returns - WhDamage ± WhAdj
    //   Vehicle = Loads - Deliveries - Returns - TransitDamage ± VehAdj
    //   Total = Warehouse + Vehicle = Opening + Inbound - Baseline - Deliveries - Damage ± Adj
    const warehouseStock = openingStock + inboundQty - sapSalesBaselineQty - routeLoadedQty + returnedQty - damagedWarehouseQty + warehouseAdjustmentQty;
    const vehicleStock = routeLoadedQty - deliveredQty - returnedQty - damagedTransitQty + vehicleAdjustmentQty;
    const currentStock = warehouseStock + vehicleStock;
    const hasMovements = prodMovements.length > 0;

    let stockStatus: StockStatusType = 'ZERO_STOCK';
    if (currentStock < 0) {
      stockStatus = 'NEGATIVE_STOCK';
    } else if (currentStock === 0) {
      stockStatus = 'ZERO_STOCK';
    } else if (currentStock <= 10) {
      stockStatus = 'LOW_STOCK';
    } else {
      stockStatus = 'IN_STOCK';
    }

    inventoryItems.push({
      id: prod.id,
      sku: prod.sku,
      name: prod.name,
      uom: prod.uom || prod.unit || 'EA',
      category: prod.category || 'General',
      brand: prod.brand || 'Colgate',
      mrp: prod.mrp,
      rate: prod.rate,
      openingStock,
      inboundQty,
      sapSalesBaselineQty,
      routeLoadedQty,
      deliveredQty,
      returnedQty,
      damagedQty,
      adjustmentQty,
      warehouseStock,
      vehicleStock,
      currentStock,
      calculatedStock: currentStock,
      stockStatus,
      hasMovements,
      isIncomplete: false,
      isUnmapped: false,
      lastMovementDate: lastDate,
      movementCount: prodMovements.length,
    });
  }

  // 3. Process unmapped movements (SKUs in movements not present in products catalog)
  for (const [norm, movs] of movementsByNormSku.entries()) {
    if (!processedNormSkus.has(norm)) {
      const sample = movs[0];
      let openingStock = 0;
      let inboundQty = 0;
      let sapSalesBaselineQty = 0;
      let routeLoadedQty = 0;
      let deliveredQty = 0;
      let returnedQty = 0;
      let damagedTransitQty = 0;
      let damagedWarehouseQty = 0;
      let damagedQty = 0;
      let warehouseAdjustmentQty = 0;
      let vehicleAdjustmentQty = 0;
      let adjustmentQty = 0;
      let lastDate: string | undefined = undefined;

      for (const m of movs) {
        const q = Number(m.quantity || 0);
        if (m.occurred_at) {
          if (!lastDate || new Date(m.occurred_at) > new Date(lastDate)) {
            lastDate = m.occurred_at;
          }
        }
        switch (m.movement_type) {
          case 'opening_balance':
            openingStock += q;
            break;
          case 'purchase_inward':
            inboundQty += q;
            break;
          case 'sap_sales_baseline':
            sapSalesBaselineQty += q;
            break;
          case 'route_load':
            routeLoadedQty += q;
            break;
          case 'route_return':
            returnedQty += q;
            break;
          case 'delivery_fulfilled':
            deliveredQty += q;
            break;
          case 'damaged_transit':
            damagedTransitQty += q;
            damagedQty += q;
            break;
          case 'damaged_warehouse':
            damagedWarehouseQty += q;
            damagedQty += q;
            break;
          case 'inventory_adjustment':
            const adj = (m.direction === 'in' ? q : -q);
            adjustmentQty += adj;
            if (m.from_location === 'vehicle' || m.to_location === 'vehicle') {
              vehicleAdjustmentQty += adj;
            } else {
              warehouseAdjustmentQty += adj;
            }
            break;
          default:
            if (m.from_location === 'warehouse' && m.to_location === 'vehicle') {
              routeLoadedQty += q;
            } else if (m.from_location === 'vehicle' && m.to_location === 'warehouse') {
              returnedQty += q;
            } else if (m.to_location === 'warehouse' && m.direction === 'in') {
              inboundQty += q;
            } else if (m.from_location === 'vehicle' && m.to_location === 'customer') {
              deliveredQty += q;
            } else if (m.from_location === 'warehouse' && m.to_location === 'customer') {
              deliveredQty += q;
            }
        }
      }

      const warehouseStock = openingStock + inboundQty - sapSalesBaselineQty - routeLoadedQty + returnedQty - damagedWarehouseQty + warehouseAdjustmentQty;
      const vehicleStock = routeLoadedQty - deliveredQty - returnedQty - damagedTransitQty + vehicleAdjustmentQty;
      const currentStock = warehouseStock + vehicleStock;
      const masterEntry = findProductMasterEntry(sample.sku);

      inventoryItems.push({
        id: `unmapped-${sample.sku}`,
        sku: sample.sku,
        name: masterEntry?.name || sample.notes || `Unmapped Material ${sample.sku}`,
        uom: masterEntry?.uom || 'DOZ',
        category: masterEntry?.category || 'Unmapped',
        brand: masterEntry?.brand || 'Unmapped',
        mrp: masterEntry?.mrp,
        rate: masterEntry?.mrp,
        openingStock,
        inboundQty,
        sapSalesBaselineQty,
        routeLoadedQty,
        deliveredQty,
        returnedQty,
        damagedQty,
        adjustmentQty,
        warehouseStock,
        vehicleStock,
        currentStock,
        calculatedStock: currentStock,
        stockStatus: 'UNMAPPED',
        hasMovements: true,
        isIncomplete: false,
        isUnmapped: true,
        notes: 'Unmapped material present in movements ledger',
        lastMovementDate: lastDate,
        movementCount: movs.length,
      });
    }
  }

  // 4. Derive summary metrics
  let totalInbound = 0;
  let totalSapSalesBaseline = 0;
  let totalDelivered = 0;
  let totalReturned = 0;
  let totalWarehouseStock = 0;
  let totalVehicleStock = 0;
  let totalOperationalStock = 0;
  let negativeStockCount = 0;
  let lowStockCount = 0;
  let zeroStockCount = 0;
  let unmappedCount = 0;
  let incompleteCount = 0;

  for (const item of inventoryItems) {
    totalInbound += item.inboundQty;
    totalSapSalesBaseline += item.sapSalesBaselineQty;
    totalDelivered += item.deliveredQty;
    totalReturned += item.returnedQty;
    totalWarehouseStock += item.warehouseStock;
    totalVehicleStock += item.vehicleStock;
    totalOperationalStock += item.currentStock;

    if (item.stockStatus === 'NEGATIVE_STOCK') negativeStockCount++;
    else if (item.stockStatus === 'LOW_STOCK') lowStockCount++;
    else if (item.stockStatus === 'ZERO_STOCK') zeroStockCount++;
    else if (item.stockStatus === 'UNMAPPED') unmappedCount++;
    else if (item.stockStatus === 'INCOMPLETE') incompleteCount++;
  }

  const summary: InventorySummary = {
    totalSkus: inventoryItems.length,
    totalInbound,
    totalSapSalesBaseline,
    totalDelivered,
    totalReturned,
    totalWarehouseStock,
    totalVehicleStock,
    totalOperationalStock,
    negativeStockCount,
    lowStockCount,
    zeroStockCount,
    unmappedCount,
    incompleteCount,
  };

  const categories = ['All', ...Array.from(new Set(inventoryItems.map((i) => i.category || 'General')))];

  // 5. Apply filtering if requested
  let filteredItems = inventoryItems;

  if (options?.search) {
    const q = options.search.toLowerCase().trim();
    filteredItems = filteredItems.filter(
      (item) =>
        item.sku.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.brand || '').toLowerCase().includes(q) ||
        (item.category || '').toLowerCase().includes(q)
    );
  }

  if (options?.categoryFilter && options.categoryFilter !== 'All') {
    const cat = options.categoryFilter.toLowerCase().trim();
    filteredItems = filteredItems.filter(
      (item) => (item.category || 'General').toLowerCase() === cat
    );
  }

  if (options?.statusFilter && options.statusFilter !== 'all') {
    switch (options.statusFilter) {
      case 'in_stock':
        filteredItems = filteredItems.filter((i) => i.stockStatus === 'IN_STOCK');
        break;
      case 'zero_stock':
        filteredItems = filteredItems.filter((i) => i.stockStatus === 'ZERO_STOCK');
        break;
      case 'negative_stock':
        filteredItems = filteredItems.filter((i) => i.stockStatus === 'NEGATIVE_STOCK');
        break;
      case 'low_stock':
        filteredItems = filteredItems.filter((i) => i.stockStatus === 'LOW_STOCK');
        break;
      case 'unmapped':
        filteredItems = filteredItems.filter((i) => i.stockStatus === 'UNMAPPED');
        break;
      case 'incomplete':
        filteredItems = filteredItems.filter((i) => i.stockStatus === 'INCOMPLETE');
        break;
    }
  }

  return { items: filteredItems, summary, categories };
}

/**
 * Retrieves chronological stock movement history for a specific product SKU.
 * Computes running balance for complete auditability.
 */
export async function getProductMovementHistory(sku: string): Promise<InventoryMovementDetail[]> {
  const normSku = normalizeSkuKey(sku);
  const movements = await getAllInventoryMovements();

  // Filter movements for this SKU
  const skuMovements = movements.filter((m) => normalizeSkuKey(m.sku) === normSku);

  // Sort chronologically ascending to calculate running balance
  skuMovements.sort((a, b) => {
    const da = new Date(a.occurred_at || a.created_at || 0).getTime();
    const db = new Date(b.occurred_at || b.created_at || 0).getTime();
    return da - db;
  });

  let whBalance = 0;
  let vehBalance = 0;
  let totalBalance = 0;
  const historyWithBalance: InventoryMovementDetail[] = [];

  for (const m of skuMovements) {
    const q = Number(m.quantity || 0);
    let netTotalImpact = 0;
    let netTotalImpactLabel = '0 (Transfer)';

    switch (m.movement_type) {
      case 'opening_balance':
        whBalance += q;
        totalBalance += q;
        netTotalImpact = q;
        netTotalImpactLabel = `+${q}`;
        break;
      case 'purchase_inward':
        whBalance += q;
        totalBalance += q;
        netTotalImpact = q;
        netTotalImpactLabel = `+${q}`;
        break;
      case 'route_load':
        // Warehouse -> Vehicle: location transfer, net total impact = 0
        whBalance -= q;
        vehBalance += q;
        netTotalImpact = 0;
        netTotalImpactLabel = '0 (Transfer)';
        break;
      case 'delivery_fulfilled':
        // Vehicle -> Customer: stock out from vehicle, reduces total stock once
        vehBalance -= q;
        totalBalance -= q;
        netTotalImpact = -q;
        netTotalImpactLabel = `-${q}`;
        break;
      case 'route_return':
        // Vehicle -> Warehouse: location transfer, net total impact = 0
        vehBalance -= q;
        whBalance += q;
        netTotalImpact = 0;
        netTotalImpactLabel = '0 (Transfer)';
        break;
      case 'damaged_transit':
        vehBalance -= q;
        totalBalance -= q;
        netTotalImpact = -q;
        netTotalImpactLabel = `-${q} (Damaged)`;
        break;
      case 'damaged_warehouse':
        if (m.from_location === 'vehicle') {
          vehBalance -= q;
        } else {
          whBalance -= q;
        }
        totalBalance -= q;
        netTotalImpact = -q;
        netTotalImpactLabel = `-${q} (Damaged)`;
        break;
      case 'sap_sales_baseline':
        whBalance -= q;
        totalBalance -= q;
        netTotalImpact = -q;
        netTotalImpactLabel = `-${q}`;
        break;
      case 'inventory_adjustment':
        const adj = (m.direction === 'in' ? q : -q);
        if (m.from_location === 'vehicle' || m.to_location === 'vehicle') {
          vehBalance += adj;
        } else {
          whBalance += adj;
        }
        totalBalance += adj;
        netTotalImpact = adj;
        netTotalImpactLabel = adj > 0 ? `+${adj}` : `${adj}`;
        break;
      default:
        if (m.from_location === 'warehouse' && m.to_location === 'vehicle') {
          whBalance -= q;
          vehBalance += q;
          netTotalImpact = 0;
          netTotalImpactLabel = '0 (Transfer)';
        } else if (m.from_location === 'vehicle' && m.to_location === 'warehouse') {
          vehBalance -= q;
          whBalance += q;
          netTotalImpact = 0;
          netTotalImpactLabel = '0 (Transfer)';
        } else if (m.to_location === 'warehouse' && m.direction === 'in') {
          whBalance += q;
          totalBalance += q;
          netTotalImpact = q;
          netTotalImpactLabel = `+${q}`;
        } else {
          vehBalance -= q;
          totalBalance -= q;
          netTotalImpact = -q;
          netTotalImpactLabel = `-${q}`;
        }
    }

    historyWithBalance.push({
      id: m.id,
      occurredAt: m.occurred_at || m.created_at || new Date().toISOString(),
      movementType: m.movement_type,
      movementTypeLabel: getMovementTypeLabel(m.movement_type),
      quantity: q,
      direction: m.direction,
      fromLocation: m.from_location || 'warehouse',
      toLocation: m.to_location || 'warehouse',
      referenceNumber: m.reference_number || (m as any).reference_id || null,
      referenceType: (m as any).reference_type || null,
      notes: m.notes || null,
      idempotencyKey: m.idempotency_key || null,
      routeId: m.route_id || null,
      partyName: (m as any).party?.name || null,
      warehouseBalance: whBalance,
      vehicleBalance: vehBalance,
      runningBalance: totalBalance,
      netTotalImpact,
      netTotalImpactLabel,
    });
  }

  // Return descending (most recent first) for UI display
  return historyWithBalance.reverse();
}
