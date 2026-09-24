import type {
  Worker, Route, Party, Product, Picklist, Delivery, Payment, Expense, PicklistItem, DeliveryItem,
  RouteStockException, UnmappedSkuException, SapStockReconciliation, SapStockReconciliationItem,
  InventoryMovement, SapPurchaseImport, SapPurchaseImportItem, ProductMrpHistory, HistoricalSalesProduct,
  SapSalesImport, SapSalesImportItem, RouteDeletePreview, MonthEndPurchaseMarginSummary,
  PurchaseBatchDrilldown, SalesRouteDrilldown, ExpenseBreakdownItem
} from '@/lib/database.types';
import { registerProductMasterEntry, findSapReferenceCatalog } from '@/features/products/data/productMaster';
import { HISTORICAL_SALES_CATALOG } from '@/features/products/data/historicalSalesCatalog';
import { getLocalDateString } from '@/shared/utils/format';

const INITIAL_WORKERS: Worker[] = [
  {
    id: 'w-balu',
    name: 'Balu Murtadak',
    phone: '7972761898',
    email: null,
    pin: '1234',
    status: 'active',
    notes: 'Salesman',
    monthly_target: 75000,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'w-mahindra',
    name: 'Mahindra Rashinkar',
    phone: '8208091610',
    email: null,
    pin: '5678',
    status: 'active',
    notes: 'Salesman',
    monthly_target: 75000,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const INITIAL_ROUTES: Route[] = [
  // ── Worker 1: Mahendra Rashinkar (w-mahindra) — Sangamner 1 to 6 ──
  { id: 'r-sangamner-1', code: 'SANGAMNER_1', name: 'SANGAMNER 1', description: null, assigned_worker_id: 'w-mahindra', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-sangamner-2', code: 'SANGAMNER_2', name: 'SANGAMNER 2', description: null, assigned_worker_id: 'w-mahindra', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-sangamner-3', code: 'SANGAMNER_3', name: 'SANGAMNER 3', description: null, assigned_worker_id: 'w-mahindra', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-sangamner-4', code: 'SANGAMNER_4', name: 'SANGAMNER 4', description: null, assigned_worker_id: 'w-mahindra', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-sangamner-5', code: 'SANGAMNER_5', name: 'SANGAMNER 5', description: null, assigned_worker_id: 'w-mahindra', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-sangamner-6', code: 'SANGAMNER_6', name: 'SANGAMNER 6', description: null, assigned_worker_id: 'w-mahindra', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },

  // ── Worker 2: Balu Murtadak (w-balu) — Rajur, Akole, Kotul, etc. ──
  { id: 'r-rajur-1', code: 'RAJUR_1', name: 'RAJUR 1', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-rajur-2', code: 'RAJUR_2', name: 'RAJUR 2', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-aashvi-1', code: 'AASHVI_1', name: 'AASHVI 1', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-akole-1', code: 'AKOLE_1', name: 'AKOLE 1', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-ghulewadi', code: 'GHULEWADI', name: 'GHULEWADI', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-akole-2', code: 'AKOLE_2', name: 'AKOLE 2', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-kotul-1', code: 'KOTUL_1', name: 'KOTUL 1', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-kotul-2', code: 'KOTUL_2', name: 'KOTUL 2', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-sakur', code: 'SAKUR', name: 'SAKUR', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-jorve', code: 'JORVE', name: 'JORVE', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-saykhindi', code: 'SAYKHINDI', name: 'SAYKHINDI', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-aklapur', code: 'AKLAPUR', name: 'AKLAPUR', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-samsherpur', code: 'SAMSHERPUR', name: 'SAMSHERPUR', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r-kumbephal', code: 'KUMBEPHAL', name: 'KUMBEPHAL', description: null, assigned_worker_id: 'w-balu', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];

const INITIAL_PARTIES: Party[] = [];
const INITIAL_PRODUCTS: Product[] = [];
const INITIAL_PICKLISTS: Picklist[] = [];
const INITIAL_DELIVERIES: Delivery[] = [];
const INITIAL_PAYMENTS: Payment[] = [];
const INITIAL_EXPENSES: Expense[] = [];

export function isPaymentLinkedToActiveRoute(
  p: Payment,
  parties: Party[],
  deliveries: Delivery[],
  picklists: Picklist[],
  routes: Route[]
): boolean {
  if (!p) return false;

  // 1. Through delivery: if payment is linked to a delivery that exists in active deliveries
  if (p.delivery_id) {
    const del = deliveries.find((d) => d.id === p.delivery_id);
    if (!del) return false; // Orphaned payment from a deleted delivery

    if (del.picklist_id) {
      const pl = picklists.find((x) => x.id === del.picklist_id);
      if (!pl) return false; // Picklist was deleted
    }
    return true;
  }

  // 2. Through party: if party exists in active parties
  if (p.party_id) {
    const pt = parties.find((x) => x.id === p.party_id || x.code === p.party_id) || p.party;
    if (!pt) return false;
    return true;
  }

  // 3. Direct route link
  if ((p as any).route_id) {
    return routes.some((r) => r.id === (p as any).route_id);
  }

  return true;
}

export function isLegacyManualProduct(sku: string, name?: string): boolean {
  if (!sku) return false;
  const s = sku.trim().toUpperCase();
  const n = (name || '').trim().toLowerCase();
  if (
    s === '12000-130908-0' || s === 'CIBACA' || s === '34800-309336-0' || s === 'TOTAL' ||
    s === 'CAS-38G-BUNDLE' || s.startsWith('CDC-') || s === 'COL-ZZ-PO3' || s === 'SUPER' ||
    s.startsWith('KIDS-') || s === 'COLGATE' || s === 'PAIN-OUT-TUBE' || s.startsWith('SF-') ||
    s === 'COLACTSALT' || s.startsWith('VW-') || s === 'VISIBLE' || s.startsWith('ZZ-') ||
    n.includes('manual master') || n.includes('ztin:') || n.includes('tax invoice')
  ) {
    return true;
  }
  return false;
}

class MockStore {
  private workers: Worker[] = [];
  private routes: Route[] = [];
  private parties: Party[] = [];
  private products: Product[] = [];
  private picklists: Picklist[] = [];
  private deliveries: Delivery[] = [];
  private payments: Payment[] = [];
  private expenses: Expense[] = [];
  private picklistItems: PicklistItem[] = [];
  private deliveryItems: DeliveryItem[] = [];
  private routeStockExceptions: RouteStockException[] = [];
  private unmappedSkuExceptions: UnmappedSkuException[] = [];
  private sapStockReconciliations: SapStockReconciliation[] = [];
  private sapStockReconciliationItems: SapStockReconciliationItem[] = [];
  private inventoryMovements: InventoryMovement[] = [];
  private sapPurchaseImports: SapPurchaseImport[] = [];
  private sapPurchaseImportItems: SapPurchaseImportItem[] = [];
  private sapSalesImports: SapSalesImport[] = [];
  private sapSalesImportItems: SapSalesImportItem[] = [];
  private productMrpHistory: ProductMrpHistory[] = [];
  private historicalSalesProducts: HistoricalSalesProduct[] = [];
  private deletedRouteCodes: Set<string> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      this.resetToDefaults();
      return;
    }
    try {
      // Clean reset: purge all previous legacy stores containing old test products
      const legacyKeys = [
        'distrotrack_clean_v5',
        'distrotrack_clean_v4',
        'distrotrack_clean_v3',
        'distrotrack_clean_v2',
        'distrotrack_storage_v2',
        'distrotrack_mock_store',
        'distrotrack_store',
      ];
      for (const k of legacyKeys) {
        if (localStorage.getItem(k)) {
          localStorage.removeItem(k);
        }
      }

      let stored = localStorage.getItem('distrotrack_v6_clean');
      if (!stored) {
        this.resetToDefaults();
        return;
      }

      if (stored) {
        const parsed = JSON.parse(stored);
        this.workers = parsed.workers || INITIAL_WORKERS;
        this.deletedRouteCodes = new Set(parsed.deletedRouteCodes || []);

        const loadedRoutes: Route[] = parsed.routes || [];
        const existingRouteCodes = new Set(loadedRoutes.map((r) => r.code.toUpperCase()));
        const mergedRoutes = [...loadedRoutes];
        INITIAL_ROUTES.forEach((initR) => {
          if (!existingRouteCodes.has(initR.code.toUpperCase()) && !this.deletedRouteCodes.has(initR.code.toUpperCase())) {
            mergedRoutes.push(initR);
          }
        });
        this.routes = mergedRoutes;
        this.parties = parsed.parties || INITIAL_PARTIES;

        this.products = (parsed.products || []).filter(
          (p: Product) => p && p.name && !isLegacyManualProduct(p.sku, p.name)
        );

        this.picklists = parsed.picklists || INITIAL_PICKLISTS;
        
        // Deduplicate deliveries by canonical identity to prevent duplicate UI cards from cached state
        const rawDeliveries: Delivery[] = parsed.deliveries || INITIAL_DELIVERIES;
        const seenDelKeys = new Map<string, Delivery>();
        const dedupedDeliveries: Delivery[] = [];
        for (const del of rawDeliveries) {
          const delKey = del.invoice_id
            ? `inv:${del.invoice_id}`
            : (del.picklist_id && del.party_id)
            ? `pl:${del.picklist_id}_${del.party_id}`
            : `id:${del.id}`;

          const existing = seenDelKeys.get(delKey);
          if (!existing) {
            seenDelKeys.set(delKey, del);
            dedupedDeliveries.push(del);
          } else {
            // Keep the one with higher or non-zero total_amount
            if ((existing.total_amount === 0 && del.total_amount > 0) || (del.total_amount > existing.total_amount)) {
              const idx = dedupedDeliveries.indexOf(existing);
              if (idx !== -1) {
                dedupedDeliveries[idx] = { ...existing, ...del };
                seenDelKeys.set(delKey, dedupedDeliveries[idx]);
              }
            }
          }
        }
        this.deliveries = dedupedDeliveries;
        this.payments = parsed.payments || INITIAL_PAYMENTS;
        this.expenses = parsed.expenses || [];

        // Strict route integrity: every payment MUST belong to an existing active route
        this.payments = (this.payments || []).filter((p) =>
          isPaymentLinkedToActiveRoute(p, this.parties, this.deliveries, this.picklists, this.routes)
        );
        // Deduplicate picklistItems to prevent doubled quantities
        const rawItems: PicklistItem[] = parsed.picklistItems || [];
        const seenKeys = new Set<string>();
        const dedupedItems: PicklistItem[] = [];
        for (const item of rawItems) {
          const key = item.id
            ? item.id
            : `${item.picklist_id}_${item.sku}_${item.quantity}_${item.amount}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            dedupedItems.push(item);
          }
        }
        this.picklistItems = dedupedItems;
        this.deliveryItems = parsed.deliveryItems || [];
        this.routeStockExceptions = parsed.routeStockExceptions || [];
        this.unmappedSkuExceptions = parsed.unmappedSkuExceptions || [];
        this.sapStockReconciliations = parsed.sapStockReconciliations || [];
        this.sapStockReconciliationItems = parsed.sapStockReconciliationItems || [];
        this.inventoryMovements = (parsed.inventoryMovements || []).filter(
          (m: InventoryMovement) => m && m.sku && !isLegacyManualProduct(m.sku)
        );
        this.sapPurchaseImports = parsed.sapPurchaseImports || [];
        this.sapPurchaseImportItems = parsed.sapPurchaseImportItems || [];
        this.sapSalesImports = parsed.sapSalesImports || [];
        this.sapSalesImportItems = parsed.sapSalesImportItems || [];
        this.productMrpHistory = parsed.productMrpHistory || [];
        this.historicalSalesProducts = parsed.historicalSalesProducts || [...HISTORICAL_SALES_CATALOG];
      } else {
        this.resetToDefaults();
      }
    } catch {
      this.resetToDefaults();
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(
        'distrotrack_v6_clean',
        JSON.stringify({
          workers: this.workers,
          routes: this.routes,
          parties: this.parties,
          products: this.products,
          picklists: this.picklists,
          deliveries: this.deliveries,
          payments: this.payments,
          expenses: this.expenses,
          picklistItems: this.picklistItems,
          deliveryItems: this.deliveryItems,
          routeStockExceptions: this.routeStockExceptions,
          unmappedSkuExceptions: this.unmappedSkuExceptions,
          sapStockReconciliations: this.sapStockReconciliations,
          sapStockReconciliationItems: this.sapStockReconciliationItems,
          inventoryMovements: this.inventoryMovements,
          sapPurchaseImports: this.sapPurchaseImports,
          sapPurchaseImportItems: this.sapPurchaseImportItems,
          sapSalesImports: this.sapSalesImports,
          sapSalesImportItems: this.sapSalesImportItems,
          productMrpHistory: this.productMrpHistory,
          deletedRouteCodes: Array.from(this.deletedRouteCodes),
        })
      );
    } catch (e) {
      console.warn('Failed to persist mock store to localStorage:', e);
    }
  }

  public resetToDefaults() {
    this.workers = [...INITIAL_WORKERS];
    this.routes = [...INITIAL_ROUTES];
    this.parties = [...INITIAL_PARTIES];
    this.products = [...INITIAL_PRODUCTS];
    this.picklists = [...INITIAL_PICKLISTS];
    this.deliveries = [...INITIAL_DELIVERIES];
    this.payments = [...INITIAL_PAYMENTS];
    this.expenses = [...INITIAL_EXPENSES];
    this.picklistItems = [];
    this.deliveryItems = [];
    this.routeStockExceptions = [];
    this.unmappedSkuExceptions = [];
    this.sapStockReconciliations = [];
    this.sapStockReconciliationItems = [];
    this.inventoryMovements = [];
    this.sapPurchaseImports = [];
    this.sapPurchaseImportItems = [];
    this.sapSalesImports = [];
    this.sapSalesImportItems = [];
    this.productMrpHistory = [];
    this.historicalSalesProducts = [...HISTORICAL_SALES_CATALOG];
    this.deletedRouteCodes.clear();
    this.saveToStorage();
  }

  // ── Workers ────────────────────────────────────────────────────────
  getWorkers(): Worker[] {
    // Filter out any accidental phantom unnamed workers
    return this.workers.filter((w) => w && w.name && w.name !== 'New Salesman');
  }
  saveWorker(wData: Partial<Worker>): Worker {
    let existingIdx = this.workers.findIndex((w) => Boolean(wData.id && w.id === wData.id));
    if (existingIdx === -1 && wData.name) {
      existingIdx = this.workers.findIndex(
        (w) => w.name.trim().toLowerCase() === wData.name!.trim().toLowerCase()
      );
    }
    if (existingIdx === -1 && wData.phone) {
      existingIdx = this.workers.findIndex((w) => Boolean(w.phone && w.phone === wData.phone));
    }

    if (existingIdx >= 0) {
      const updated = {
        ...this.workers[existingIdx],
        ...wData,
        id: wData.id || this.workers[existingIdx].id,
        name: wData.name || this.workers[existingIdx].name,
        monthly_target: wData.monthly_target !== undefined ? Number(wData.monthly_target) : this.workers[existingIdx].monthly_target,
        updated_at: new Date().toISOString(),
      };
      this.workers[existingIdx] = updated;
      this.saveToStorage();
      return updated;
    } else {
      const created: Worker = {
        id: wData.id || `w-${Date.now()}`,
        name: wData.name || 'Salesman',
        phone: wData.phone || '',
        email: wData.email || null,
        pin: wData.pin || '1234',
        status: wData.status || 'active',
        notes: wData.notes || null,
        monthly_target: Number(wData.monthly_target ?? 50000),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.workers.unshift(created);
      this.saveToStorage();
      return created;
    }
  }
  deleteWorker(id: string) {
    this.workers = this.workers.filter((w) => w.id !== id);
    this.saveToStorage();
  }

  // ── Routes ─────────────────────────────────────────────────────────
  getRoutes(): Route[] {
    return this.routes.map((r) => ({
      ...r,
      assigned_worker: this.workers.find((w) => w.id === r.assigned_worker_id) || null,
    }));
  }
  saveRoute(rData: Partial<Route>): Route {
    if (rData.code) {
      this.deletedRouteCodes.delete(rData.code.toUpperCase());
    }
    const existingIdx = this.routes.findIndex((r) => r.id === rData.id || (rData.code && r.code === rData.code && r.status !== 'archived'));
    if (existingIdx >= 0) {
      const updated = { ...this.routes[existingIdx], ...rData, updated_at: new Date().toISOString() };
      this.routes[existingIdx] = updated;
      this.saveToStorage();
      return updated;
    } else {
      const created: Route = {
        id: rData.id || `route-${Date.now()}`,
        code: rData.code || `R-${Date.now().toString().slice(-4)}`,
        name: rData.name || 'New Distribution Route',
        assigned_worker_id: rData.assigned_worker_id || null,
        description: rData.description || null,
        status: rData.status || 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.routes.unshift(created);
      this.saveToStorage();
      return created;
    }
  }

  deleteRoute(id: string, force: boolean = true, hardDelete: boolean = true) {
    const route = this.routes.find(
      (r) =>
        r.id === id ||
        (r.code && r.code.toLowerCase() === id.toLowerCase()) ||
        (r.name && r.name.toLowerCase() === id.toLowerCase())
    );
    if (!route) return;
    const targetId = route.id;
    const routeCode = route.code;
    const routeName = route.name;

    if (hardDelete) {
      const routePicklists = this.picklists.filter(
        (pl) =>
          pl.route_id === id ||
          pl.route_id === targetId ||
          (routeCode && pl.route?.code?.toLowerCase() === routeCode.toLowerCase()) ||
          (routeName && pl.route?.name?.toLowerCase() === routeName.toLowerCase()) ||
          (routeCode && (pl as any).route_code?.toLowerCase() === routeCode.toLowerCase())
      );
      const plIds = new Set(routePicklists.map((pl) => pl.id));

      const routeDeliveries = this.deliveries.filter(
        (d: any) =>
          d.route_id === id ||
          d.route_id === targetId ||
          (d.picklist_id && plIds.has(d.picklist_id)) ||
          (routeCode && d.route_code?.toLowerCase() === routeCode.toLowerCase())
      );
      const delIds = new Set(routeDeliveries.map((d) => d.id));

      // 1. Remove delivery items
      this.deliveryItems = this.deliveryItems.filter((di) => !delIds.has(di.delivery_id));

      // 2. Remove deliveries
      this.deliveries = this.deliveries.filter((d) => !delIds.has(d.id));

      // 3. Remove picklist items
      this.picklistItems = this.picklistItems.filter((pi) => !plIds.has(pi.picklist_id));

      // 4. Remove picklists
      this.picklists = this.picklists.filter((pl) => !plIds.has(pl.id));

      // 6. Remove payments linked specifically to this route / picklist / delivery
      this.payments = this.payments.filter(
        (p: any) =>
          p.route_id !== id &&
          p.route_id !== targetId &&
          (!p.picklist_id || !plIds.has(p.picklist_id)) &&
          (!p.delivery_id || !delIds.has(p.delivery_id))
      );

      // 7. Remove expenses linked specifically to this route / picklist
      this.expenses = this.expenses.filter(
        (e: any) =>
          e.route_id !== id &&
          e.route_id !== targetId &&
          (!e.picklist_id || !plIds.has(e.picklist_id))
      );

      // 8. Remove route stock exceptions
      this.routeStockExceptions = this.routeStockExceptions.filter(
        (rse: any) =>
          rse.route_id !== id &&
          rse.route_id !== targetId &&
          (!rse.picklist_id || !plIds.has(rse.picklist_id))
      );

      // 9. Remove route-owned inventory movements ONLY (NEVER purchase_inward or sap_sales_baseline or opening_balance)
      if (this.inventoryMovements) {
        this.inventoryMovements = this.inventoryMovements.filter((im) => {
          const isThisRoute =
            im.route_id === id ||
            im.route_id === targetId ||
            (im.picklist_id && plIds.has(im.picklist_id)) ||
            (im.delivery_id && delIds.has(im.delivery_id));
          const isSharedMaster = ['purchase_inward', 'sap_sales_baseline', 'opening_balance'].includes(
            im.movement_type
          );
          return !(isThisRoute && !isSharedMaster);
        });
      }

      // 10. Unlink parties assigned to this route (preserve customer master & balances)
      this.parties = this.parties.map((p) =>
        p.route_id === id || p.route_id === targetId ? { ...p, route_id: null, route: null } : p
      );

      // 11. Remove route record
      this.routes = this.routes.filter((r) => r.id !== id && r.id !== targetId);

      // 12. Track deleted route code so it doesn't reappear on reload
      if (route.code) {
        this.deletedRouteCodes.add(route.code.toUpperCase());
      }
    } else {
      // Legacy decoupling if hardDelete is false
      if (!force) {
        throw new Error('This route contains operational history and cannot be permanently deleted. Archive it instead.');
      }
      this.routes = this.routes.filter((r) => r.id !== id);
      this.parties = this.parties.map((p) => (p.route_id === id ? { ...p, route_id: null, route: null } : p));
      this.picklists = this.picklists.map((pl) => (pl.route_id === id ? { ...pl, route_id: null, route: null } : pl));
      this.deliveries = this.deliveries.map((d: any) => (d.route_id === id ? { ...d, route_id: null, route: null } : d));
      this.payments = this.payments.map((p) => (p.route_id === id ? { ...p, route_id: null } : p));
      this.expenses = this.expenses.map((e) => (e.route_id === id ? { ...e, route_id: null } : e));
      if (this.inventoryMovements) {
        this.inventoryMovements = this.inventoryMovements.map((im) => (im.route_id === id ? { ...im, route_id: null } : im));
      }
    }

    this.saveToStorage();
  }

  getRouteDeletePreview(id: string): RouteDeletePreview {
    const route = this.routes.find(
      (r) =>
        r.id === id ||
        (r.code && r.code.toLowerCase() === id.toLowerCase()) ||
        (r.name && r.name.toLowerCase() === id.toLowerCase())
    );
    if (!route) {
      throw new Error(`Route with ID ${id} not found`);
    }
    const routeCode = route.code;
    const routeName = route.name;

    const routePicklists = this.picklists.filter(
      (pl) =>
        pl.route_id === id ||
        (routeCode && pl.route?.code?.toLowerCase() === routeCode.toLowerCase()) ||
        (routeName && pl.route?.name?.toLowerCase() === routeName.toLowerCase()) ||
        (routeCode && (pl as any).route_code?.toLowerCase() === routeCode.toLowerCase())
    );
    const plIds = new Set(routePicklists.map((pl) => pl.id));

    const routeDeliveries = this.deliveries.filter(
      (d: any) =>
        d.route_id === id ||
        (d.picklist_id && plIds.has(d.picklist_id)) ||
        (routeCode && d.route_code?.toLowerCase() === routeCode.toLowerCase())
    );
    const delIds = new Set(routeDeliveries.map((d) => d.id));

    const delItemCount = this.deliveryItems.filter((di) => delIds.has(di.delivery_id)).length;

    const payments = this.payments.filter(
      (p: any) =>
        p.route_id === id ||
        (p.picklist_id && plIds.has(p.picklist_id)) ||
        (p.delivery_id && delIds.has(p.delivery_id))
    );

    const expenses = this.expenses.filter(
      (e: any) => e.route_id === id || (e.picklist_id && plIds.has(e.picklist_id))
    );

    const exceptions = this.routeStockExceptions.filter(
      (rse: any) => rse.route_id === id || (rse.picklist_id && plIds.has(rse.picklist_id))
    );

    const routeMovements = (this.inventoryMovements || []).filter((im) => {
      const isThisRoute =
        im.route_id === id ||
        (im.picklist_id && plIds.has(im.picklist_id)) ||
        (im.delivery_id && delIds.has(im.delivery_id));
      const isSharedMaster = ['purchase_inward', 'sap_sales_baseline', 'opening_balance'].includes(
        im.movement_type
      );
      return isThisRoute && !isSharedMaster;
    });

    const unlinkedParties = this.parties.filter((p) => p.route_id === id).length;
    const worker = this.workers.find((w) => w.id === route.assigned_worker_id);

    return {
      route_id: route.id,
      route_code: route.code,
      route_name: route.name,
      assigned_worker_id: route.assigned_worker_id,
      assigned_worker_name: worker?.name || null,
      assignments_count: route.assigned_worker_id ? 1 : 0,
      picklists_count: routePicklists.length,
      deliveries_count: routeDeliveries.length,
      delivery_items_count: delItemCount,
      payments_count: payments.length,
      expenses_count: expenses.length,
      returns_count: 0,
      inventory_movements_count: routeMovements.length,
      financial_records_count: payments.length,
      exceptions_count: exceptions.length,
      parties_unlinked_count: unlinkedParties,
      has_pending_offline_mutations: false,
      can_delete: true,
      block_reason: null,
    };
  }

  archiveRoute(id: string): Route | undefined {
    const route = this.routes.find((r) => r.id === id);
    if (!route) return undefined;
    route.status = 'archived';
    route.updated_at = new Date().toISOString();
    this.saveToStorage();
    return route;
  }

  unarchiveRoute(id: string): Route | undefined {
    const route = this.routes.find((r) => r.id === id);
    if (!route) return undefined;
    route.status = 'active';
    route.updated_at = new Date().toISOString();
    this.saveToStorage();
    return route;
  }

  // ── Parties ────────────────────────────────────────────────────────
  getParties(): Party[] {
    return this.parties.map((p) => ({
      ...p,
      route: this.routes.find((r) => r.id === p.route_id) || null,
    }));
  }
  saveParty(partyData: Partial<Party>): Party {
    const existingIdx = this.parties.findIndex((p) => p.id === partyData.id || (partyData.code && p.code === partyData.code));
    if (existingIdx >= 0) {
      const updated = { ...this.parties[existingIdx], ...partyData, updated_at: new Date().toISOString() };
      this.parties[existingIdx] = updated;
      this.saveToStorage();
      return updated;
    } else {
      const created: Party = {
        id: partyData.id || `party-${Date.now()}`,
        code: partyData.code || `P-${Date.now().toString().slice(-4)}`,
        name: partyData.name || 'New Retailer Party',
        contact_person: partyData.contact_person || null,
        phone: partyData.phone || '',
        email: partyData.email || null,
        address: partyData.address || null,
        city: partyData.city || null,
        route_id: partyData.route_id || null,
        outstanding_amount: Number(partyData.outstanding_amount || 0),
        status: partyData.status || 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.parties.unshift(created);
      this.saveToStorage();
      return created;
    }
  }
  deleteParty(id: string) {
    this.parties = this.parties.filter((p) => p.id !== id);
    this.saveToStorage();
  }

  // ── Products ───────────────────────────────────────────────────────
  getProducts(): Product[] {
    return this.products.filter(p => p && p.name && !isLegacyManualProduct(p.sku, p.name));
  }
  saveProduct(prodData: Partial<Product>): Product {
    const existingIdx = this.products.findIndex(
      (p) => p.id === prodData.id || (prodData.sku && p.sku.toUpperCase() === prodData.sku.toUpperCase())
    );
    let result: Product;
    if (existingIdx >= 0) {
      if (prodData.mrp !== undefined) {
        this.products[existingIdx].mrp = Number(prodData.mrp);
      }
      if (prodData.rate !== undefined) {
        this.products[existingIdx].rate = Number(prodData.rate);
      }
      result = this.products[existingIdx];
    } else {
      const created: Product = {
        id: prodData.id || `prod-${Date.now()}`,
        sku: prodData.sku || `SKU-${Date.now().toString().slice(-4)}`,
        name: prodData.name || 'New Product Item',
        category: prodData.category || null,
        mrp: Number(prodData.mrp || 0),
        rate: Number(prodData.rate || 0),
        unit: prodData.unit || (prodData.uom?.toLowerCase() === 'doz' ? 'doz' : 'pcs'),
        status: prodData.status || 'active',
        brand: prodData.brand || null,
        uom: prodData.uom || null,
        active: prodData.active || null,
        sub_category: prodData.sub_category || null,
        sub_brand: prodData.sub_brand || null,
        variant: prodData.variant || null,
        ppg: prodData.ppg || null,
        ppg_description: prodData.ppg_description || null,
        material_group: prodData.material_group || null,
        prod_hierarchy: prodData.prod_hierarchy || null,
        is_sap_master: prodData.is_sap_master ?? true,
        source: prodData.source || 'manual',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.products.unshift(created);
      result = created;
    }

    registerProductMasterEntry({
      sku: result.sku,
      name: result.name,
      mrp: result.mrp,
      category: result.category || 'General',
      unit: result.unit,
      brand: result.brand || undefined,
      uom: result.uom || undefined,
      active: result.active || undefined,
      subCategory: result.sub_category || undefined,
      subBrand: result.sub_brand || undefined,
      variant: result.variant || undefined,
      ppg: result.ppg || undefined,
      ppgDescription: result.ppg_description || undefined,
      materialGroup: result.material_group || undefined,
      prodHierarchy: result.prod_hierarchy || undefined,
    });

    this.saveToStorage();
    return result;
  }
  deleteProduct(id: string) {
    this.products = this.products.filter((p) => p.id !== id);
    this.saveToStorage();
  }

  // ── Picklists ──────────────────────────────────────────────────────
  getPicklists(): Picklist[] {
    return this.picklists.map((pl) => ({
      ...pl,
      route: this.routes.find((r) => r.id === pl.route_id) || null,
      worker: this.workers.find((w) => w.id === pl.worker_id) || null,
    }));
  }
  savePicklist(plData: Partial<Picklist>): Picklist {
    const existingIdx = this.picklists.findIndex((pl) => pl.id === plData.id || (plData.picklist_number && pl.picklist_number === plData.picklist_number));
    if (existingIdx >= 0) {
      const updated = { ...this.picklists[existingIdx], ...plData, updated_at: new Date().toISOString() };
      this.picklists[existingIdx] = updated;
      this.saveToStorage();
      return updated;
    } else {
      const created: Picklist = {
        id: plData.id || `pl-${Date.now()}`,
        picklist_number: plData.picklist_number || `PL-${Date.now().toString().slice(-4)}`,
        date: plData.date || getLocalDateString(),
        route_id: plData.route_id || null,
        worker_id: plData.worker_id || null,
        status: plData.status || 'draft',
        total_amount: Number(plData.total_amount || 0),
        total_items: Number(plData.total_items || 0),
        total_parties: Number(plData.total_parties || 0),
        completed_parties: Number(plData.completed_parties || 0),
        started_at: plData.started_at || null,
        completed_at: plData.completed_at || null,
        total_collected: Number(plData.total_collected || 0),
        total_cash: Number(plData.total_cash || 0),
        total_upi: Number(plData.total_upi || 0),
        total_cheque: Number(plData.total_cheque || 0),
        total_credit: Number(plData.total_credit || 0),
        expected_cash: plData.expected_cash ?? null,
        actual_cash_returned: plData.actual_cash_returned ?? null,
        cash_discrepancy: plData.cash_discrepancy ?? null,
        total_expenses: plData.total_expenses ?? null,
        net_cash_deposit: plData.net_cash_deposit ?? null,
        expected_upi: plData.expected_upi ?? null,
        expected_cheque: plData.expected_cheque ?? null,
        expected_credit: plData.expected_credit ?? null,
        financial_reconciled_at: plData.financial_reconciled_at ?? null,
        reconciled_by_worker_id: plData.reconciled_by_worker_id ?? null,
        financial_reconciliation_status: plData.financial_reconciliation_status ?? 'pending',
        notes: plData.notes || null,
        sap_raw_data: plData.sap_raw_data || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.picklists.unshift(created);
      this.saveToStorage();
      return created;
    }
  }
  deletePicklist(id: string) {
    const deliveryIds = new Set(
      this.deliveries.filter((d) => d.picklist_id === id).map((d) => d.id)
    );

    this.picklists = this.picklists.filter((pl) => pl.id !== id);
    this.picklistItems = this.picklistItems.filter((pli) => pli.picklist_id !== id);
    this.deliveries = this.deliveries.filter((d) => !deliveryIds.has(d.id));
    this.deliveryItems = this.deliveryItems.filter((dli) => !deliveryIds.has(dli.delivery_id));
    this.payments = this.payments.filter((p) => !p.delivery_id || !deliveryIds.has(p.delivery_id));

    this.saveToStorage();
  }

  clearAllImportedSalesData() {
    this.picklists = [];
    this.picklistItems = [];
    this.deliveries = [];
    this.deliveryItems = [];
    this.payments = [];
    this.parties.forEach((p) => {
      p.outstanding_amount = 0;
    });
    this.saveToStorage();
  }

  // ── Deliveries ─────────────────────────────────────────────────────
  getDeliveries(): Delivery[] {
    // Deduplicate by canonical identity before returning
    const seen = new Map<string, Delivery>();
    for (const d of this.deliveries) {
      const key = d.invoice_id
        ? `inv:${d.invoice_id}`
        : (d.picklist_id && d.party_id)
        ? `pl:${d.picklist_id}_${d.party_id}`
        : `id:${d.id}`;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, d);
      } else {
        // Keep record with authoritative non-zero amount
        if (existing.total_amount === 0 && d.total_amount > 0) {
          seen.set(key, { ...existing, ...d });
        }
      }
    }
    const uniqueDeliveries = Array.from(seen.values());

    return uniqueDeliveries.map((d) => {
      let party = this.parties.find((p) => p.id === d.party_id) || null;
      if (party && (!party.name || /^[CS]?0*\d+$/i.test(party.name.trim()))) {
        const codeDigits = (party.code || party.name || '').replace(/[^0-9]/g, '');
        const realParty = this.parties.find(
          (p) => p.code.replace(/[^0-9]/g, '') === codeDigits && p.name && !/^[CS]?0*\d+$/i.test(p.name)
        );
        if (realParty) {
          party = { ...party, name: realParty.name };
        }
      }
      return {
        ...d,
        party,
        worker: this.workers.find((w) => w.id === d.worker_id) || null,
      };
    });
  }
  saveDelivery(dData: Partial<Delivery>): Delivery {
    const existingIdx = this.deliveries.findIndex((d) => {
      // 1. Match by explicit delivery ID if provided
      if (dData.id && d.id === dData.id) return true;
      // 2. If invoice_id exists, delivery identity is strictly invoice_id
      if (dData.invoice_id) {
        return d.invoice_id === dData.invoice_id;
      }
      // 3. Fallback for picklist-only deliveries (no invoice): identity is (picklist_id + party_id) with no invoice
      if (!dData.id && dData.picklist_id && dData.party_id) {
        return d.picklist_id === dData.picklist_id && d.party_id === dData.party_id && !d.invoice_id;
      }
      return false;
    });
    if (existingIdx >= 0) {
      const updated = { ...this.deliveries[existingIdx], ...dData, updated_at: new Date().toISOString() };
      this.deliveries[existingIdx] = updated;
      this.saveToStorage();
      return updated;
    } else {
      const created: Delivery = {
        id: dData.id || `del-${Date.now()}`,
        picklist_id: dData.picklist_id || null,
        party_id: dData.party_id || 'p-101',
        worker_id: dData.worker_id || null,
        invoice_id: dData.invoice_id || null,
        status: dData.status || 'pending',
        sequence_order: dData.sequence_order || 0,
        delivery_date: dData.delivery_date || getLocalDateString(),
        started_at: dData.started_at || null,
        delivered_at: dData.status === 'delivered' ? new Date().toISOString() : (dData.delivered_at || null),
        total_amount: Number(dData.total_amount || 0),
        delivered_amount: Number(dData.delivered_amount || 0),
        collected_amount: Number(dData.collected_amount || 0),
        returned_amount: Number(dData.returned_amount || 0),
        payment_mode: dData.payment_mode || null,
        notes: dData.notes || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.deliveries.unshift(created);
      this.saveToStorage();
      return created;
    }
  }

  // ── Line Items (Picklists & Deliveries) ────────────────────────────
  getPicklistItems(picklistId?: string): PicklistItem[] {
    if (picklistId) {
      return this.picklistItems.filter((pli) => pli.picklist_id === picklistId);
    }
    return [...this.picklistItems];
  }
  savePicklistItem(item: Partial<PicklistItem>): PicklistItem {
    const created: PicklistItem = {
      id: item.id || `pli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      picklist_id: item.picklist_id || '',
      party_id: item.party_id || '',
      product_id: item.product_id || null,
      sku: item.sku || '',
      product_name: item.product_name || '',
      quantity: Number(item.quantity || 0),
      free_quantity: Number(item.free_quantity || 0),
      rate: Number(item.rate || 0),
      amount: Number(item.amount || 0),
      mrp: item.mrp !== undefined && item.mrp !== null ? Number(item.mrp) : null,
      mrp_at_sale: item.mrp_at_sale !== undefined && item.mrp_at_sale !== null
        ? Number(item.mrp_at_sale)
        : item.mrp !== undefined && item.mrp !== null
        ? Number(item.mrp)
        : null,
      sap_line_data: item.sap_line_data || null,
    };
    this.picklistItems.push(created);
    this.saveToStorage();
    return created;
  }

  getDeliveryItems(): DeliveryItem[] {
    return [...this.deliveryItems];
  }
  saveDeliveryItem(item: Partial<DeliveryItem>): DeliveryItem {
    const existingIdx = this.deliveryItems.findIndex((i) => i.id === item.id);
    if (existingIdx >= 0) {
      this.deliveryItems[existingIdx] = { ...this.deliveryItems[existingIdx], ...item };
      this.saveToStorage();
      return this.deliveryItems[existingIdx];
    }
    const sku = (item.sku || '').trim();
    const prod = sku ? this.products.find((p) => p.sku.toUpperCase() === sku.toUpperCase()) : null;
    const snapMrp = item.mrp_at_sale !== undefined && item.mrp_at_sale !== null
      ? Number(item.mrp_at_sale)
      : item.mrp !== undefined && item.mrp !== null
      ? Number(item.mrp)
      : prod?.mrp !== undefined && prod?.mrp !== null
      ? Number(prod.mrp)
      : null;

    const created: DeliveryItem = {
      id: item.id || `dli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      delivery_id: item.delivery_id || '',
      product_id: item.product_id || prod?.id || null,
      sku: item.sku || '',
      product_name: item.product_name || prod?.name || '',
      ordered_qty: Number(item.ordered_qty || 0),
      delivered_qty: Number(item.delivered_qty || 0),
      free_quantity: Number(item.free_quantity || 0),
      delivered_free_qty: Number(item.delivered_free_qty || 0),
      returned_qty: Number(item.returned_qty || 0),
      returned_free_qty: Number(item.returned_free_qty || 0),
      damaged_qty: Number(item.damaged_qty || 0),
      damaged_free_qty: Number(item.damaged_free_qty || 0),
      rate: Number(item.rate || 0),
      amount: Number(item.amount || 0),
      mrp: snapMrp,
      mrp_at_sale: snapMrp,
      notes: item.notes || null,
    };
    this.deliveryItems.push(created);
    this.saveToStorage();
    return created;
  }
  updateDeliveryItem(id: string, updates: Partial<DeliveryItem>) {
    const idx = this.deliveryItems.findIndex((i) => i.id === id);
    if (idx >= 0) {
      this.deliveryItems[idx] = { ...this.deliveryItems[idx], ...updates };
      this.saveToStorage();
    }
  }
  deleteDeliveryItem(id: string) {
    this.deliveryItems = this.deliveryItems.filter((i) => i.id !== id);
    this.saveToStorage();
  }
  deleteDelivery(id: string) {
    this.deliveries = this.deliveries.filter((d) => d.id !== id);
    this.deliveryItems = this.deliveryItems.filter((i) => i.delivery_id !== id);
    this.payments = this.payments.filter((p) => p.delivery_id !== id);
    this.saveToStorage();
  }
  updatePicklistItem(id: string, updates: Partial<PicklistItem>) {
    const idx = this.picklistItems.findIndex((i) => i.id === id);
    if (idx >= 0) {
      this.picklistItems[idx] = { ...this.picklistItems[idx], ...updates };
      this.saveToStorage();
    }
  }
  deletePicklistItem(id: string) {
    this.picklistItems = this.picklistItems.filter((i) => i.id !== id);
    this.saveToStorage();
  }

  // ── Payments ───────────────────────────────────────────────────────
  getPayments(): Payment[] {
    // Strict route integrity: every payment MUST belong to an existing active route
    const validPayments = this.payments.filter((p) =>
      isPaymentLinkedToActiveRoute(p, this.parties, this.deliveries, this.picklists, this.routes)
    );

    if (validPayments.length !== this.payments.length) {
      this.payments = validPayments;
      this.saveToStorage();
    }

    return this.payments.map((pay) => {
      const partyObj = this.parties.find((p) => p.id === pay.party_id || p.code === pay.party_id) || null;
      const workerObj = this.workers.find((w) => w.id === (pay.worker_id || pay.received_by_worker_id)) || null;
      const deliveryObj = this.deliveries.find((d) => d.id === pay.delivery_id) || null;
      let deliveryWithPicklist = deliveryObj;

      if (deliveryObj) {
        const picklistObj = this.picklists.find((pl) => pl.id === deliveryObj.picklist_id);
        deliveryWithPicklist = {
          ...deliveryObj,
          picklist: picklistObj
            ? {
                ...picklistObj,
                route: this.routes.find((r) => r.id === picklistObj.route_id) || null,
              }
            : null,
        } as any;
      }

      return {
        ...pay,
        party: partyObj
          ? {
              ...partyObj,
              route: this.routes.find((r) => r.id === partyObj.route_id) || null,
            }
          : null,
        worker: workerObj,
        received_by: workerObj,
        delivery: deliveryWithPicklist,
      } as Payment;
    });
  }
  savePayment(payData: Partial<Payment>): Payment {
    const created: Payment = {
      id: payData.id || `pay-${Date.now()}`,
      payment_number: payData.payment_number || `PAY-${Date.now().toString().slice(-4)}`,
      party_id: payData.party_id || 'p-101',
      delivery_id: payData.delivery_id || null,
      invoice_id: payData.invoice_id || null,
      worker_id: payData.worker_id || payData.received_by_worker_id || null,
      received_by_worker_id: payData.worker_id || payData.received_by_worker_id || null,
      amount: Number(payData.amount || 0),
      payment_mode: payData.payment_mode || 'cash',
      cheque_number: payData.cheque_number || null,
      reference_number: payData.reference_number || null,
      cheque_date: payData.cheque_date || null,
      cheque_bank: payData.cheque_bank || null,
      payment_date: payData.payment_date || getLocalDateString(),
      status: payData.status || 'collected',
      notes: payData.notes || null,
      picklist_id: payData.picklist_id || null,
      route_id: payData.route_id || null,
      idempotency_key: payData.idempotency_key || null,
      reversed_at: payData.reversed_at || null,
      reversed_by: payData.reversed_by || null,
      reversal_reason: payData.reversal_reason || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.payments.unshift(created);

    if (payData.party_id) {
      const party = this.parties.find((p) => p.id === payData.party_id);
      if (party) {
        party.outstanding_amount = Math.max(0, Number(party.outstanding_amount) - Number(payData.amount || 0));
      }
    }

    this.saveToStorage();
    return created;
  }
  deletePayment(id: string) {
    this.payments = this.payments.filter((p) => p.id !== id);
    this.saveToStorage();
  }
  deletePaymentByDelivery(deliveryId: string) {
    this.payments = this.payments.filter((p) => p.delivery_id !== deliveryId);
    this.saveToStorage();
  }

  // ── Expenses ───────────────────────────────────────────────────────
  getExpenses(): Expense[] {
    return this.expenses.map((exp) => ({
      ...exp,
      worker: this.workers.find((w) => w.id === exp.worker_id) || null,
      route: this.routes.find((r) => r.id === exp.route_id) || null,
    }));
  }
  saveExpense(expData: Partial<Expense>): Expense {
    const workerObj = this.workers.find((w) => w.id === expData.worker_id);
    const created: Expense = {
      id: expData.id || `exp-${Date.now()}`,
      expense_number: expData.expense_number || `EXP-${Date.now().toString().slice(-4)}`,
      worker_id: expData.worker_id || null,
      worker_name: expData.worker_name || workerObj?.name || null,
      route_id: expData.route_id || null,
      picklist_id: expData.picklist_id || null,
      category: expData.category || 'other',
      amount: Number(expData.amount || 0),
      payment_method: expData.payment_method || 'cash',
      status: expData.status || 'pending',
      expense_type: expData.expense_type || 'route_operating',
      date: expData.date || getLocalDateString(),
      description: expData.description || null,
      receipt_url: expData.receipt_url || null,
      visible_to_worker: expData.visible_to_worker ?? false,
      idempotency_key: expData.idempotency_key || null,
      approved_at: expData.approved_at || null,
      approved_by: expData.approved_by || null,
      rejected_at: expData.rejected_at || null,
      rejected_by: expData.rejected_by || null,
      rejection_reason: expData.rejection_reason || null,
      reversed_at: expData.reversed_at || null,
      reversed_by: expData.reversed_by || null,
      reversal_reason: expData.reversal_reason || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.expenses.unshift(created);
    this.saveToStorage();
    return created;
  }
  approveExpense(id: string, actorId?: string): Expense | null {
    const exp = this.expenses.find((e) => e.id === id);
    if (!exp) return null;
    exp.status = 'approved';
    exp.approved_at = new Date().toISOString();
    exp.approved_by = actorId || null;
    exp.updated_at = new Date().toISOString();
    this.saveToStorage();
    return exp;
  }
  rejectExpense(id: string, reason: string, actorId?: string): Expense | null {
    const exp = this.expenses.find((e) => e.id === id);
    if (!exp) return null;
    exp.status = 'rejected';
    exp.rejected_at = new Date().toISOString();
    exp.rejected_by = actorId || null;
    exp.rejection_reason = reason;
    exp.updated_at = new Date().toISOString();
    this.saveToStorage();
    return exp;
  }
  reverseExpense(id: string, reason: string, actorId?: string): Expense | null {
    const exp = this.expenses.find((e) => e.id === id);
    if (!exp) return null;
    exp.status = 'reversed';
    exp.reversed_at = new Date().toISOString();
    exp.reversed_by = actorId || null;
    exp.reversal_reason = reason;
    exp.updated_at = new Date().toISOString();
    this.saveToStorage();
    return exp;
  }

  // ── Route Stock Shortage Exceptions ─────────────────────────────
  getRouteStockExceptions(): RouteStockException[] {
    return [...this.routeStockExceptions];
  }
  saveRouteStockException(ex: Partial<RouteStockException>): RouteStockException {
    const created: RouteStockException = {
      id: ex.id || `rse-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      occurred_at: ex.occurred_at || new Date().toISOString(),
      picklist_id: ex.picklist_id || '',
      route_id: ex.route_id || null,
      worker_id: ex.worker_id || null,
      product_id: ex.product_id || null,
      sku: ex.sku || '',
      product_name: ex.product_name || '',
      required_quantity: Number(ex.required_quantity || 0),
      recorded_warehouse_stock: Number(ex.recorded_warehouse_stock || 0),
      shortage_quantity: Number(ex.shortage_quantity || 0),
      status: ex.status || 'open',
      notes: ex.notes || null,
      created_at: new Date().toISOString(),
    };
    this.routeStockExceptions.unshift(created);
    this.saveToStorage();
    return created;
  }

  // ── Unmapped SKU Exceptions ─────────────────────────────────────
  getUnmappedSkuExceptions(): UnmappedSkuException[] {
    return [...this.unmappedSkuExceptions];
  }
  saveUnmappedSkuException(ex: Partial<UnmappedSkuException>): UnmappedSkuException {
    const existing = this.unmappedSkuExceptions.find((u) => u.sku === ex.sku);
    if (existing) {
      existing.last_seen_at = new Date().toISOString();
      if (ex.source_type === 'picklist') existing.affected_picklist_count++;
      if (ex.source_type === 'bill') existing.affected_bill_count++;
      if (ex.imported_product_name) existing.imported_product_name = ex.imported_product_name;
      existing.updated_at = new Date().toISOString();
      this.saveToStorage();
      return existing;
    }
    const created: UnmappedSkuException = {
      id: ex.id || `unm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      sku: ex.sku || '',
      imported_product_name: ex.imported_product_name || null,
      source_type: ex.source_type || 'picklist',
      source_reference: ex.source_reference || null,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      affected_picklist_count: ex.source_type === 'bill' ? 0 : 1,
      affected_bill_count: ex.source_type === 'bill' ? 1 : 0,
      status: ex.status || 'unresolved',
      notes: ex.notes || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.unmappedSkuExceptions.unshift(created);
    this.saveToStorage();
    return created;
  }

  // ── SAP Stock Reconciliations & Snapshots ───────────────────────
  getSapStockReconciliations(): SapStockReconciliation[] {
    return [...this.sapStockReconciliations];
  }
  getSapStockReconciliationItems(reconciliationId?: string): SapStockReconciliationItem[] {
    if (reconciliationId) {
      return this.sapStockReconciliationItems.filter((i) => i.reconciliation_id === reconciliationId);
    }
    return [...this.sapStockReconciliationItems];
  }
  saveSapStockReconciliation(
    rec: Omit<SapStockReconciliation, 'id' | 'created_at' | 'updated_at'> & { id?: string },
    items: Array<Omit<SapStockReconciliationItem, 'id' | 'reconciliation_id' | 'created_at'> & { id?: string }>
  ): SapStockReconciliation {
    const recId = rec.id || `rec-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const createdRec: SapStockReconciliation = {
      ...rec,
      id: recId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.sapStockReconciliations.unshift(createdRec);

    for (const it of items) {
      this.sapStockReconciliationItems.push({
        ...it,
        id: it.id || `reci-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        reconciliation_id: recId,
        created_at: new Date().toISOString(),
      });
    }
    this.saveToStorage();
    return createdRec;
  }

  // ── Inventory Movements & SAP Purchase Imports ───────────────────
  getInventoryMovements(sku?: string): InventoryMovement[] {
    const valid = this.inventoryMovements.filter((m) => m && m.sku && !isLegacyManualProduct(m.sku));
    if (sku) {
      const norm = sku.toUpperCase();
      return valid.filter((m) => m.sku.toUpperCase() === norm);
    }
    return [...valid];
  }

  addInventoryMovement(
    movement: Partial<InventoryMovement> & {
      product_id: string;
      sku: string;
      movement_type: any;
      quantity: number;
      direction: any;
      from_location: string;
      to_location: string;
    }
  ): InventoryMovement {
    const created: InventoryMovement = {
      id: movement.id || `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      occurred_at: movement.occurred_at || new Date().toISOString(),
      created_at: movement.created_at || new Date().toISOString(),
      ...movement,
    };
    this.inventoryMovements.push(created);
    this.saveToStorage();
    return created;
  }

  getSapPurchaseImports(): SapPurchaseImport[] {
    return [...this.sapPurchaseImports];
  }

  getSapPurchaseImportItems(importId?: string): SapPurchaseImportItem[] {
    if (importId) {
      return this.sapPurchaseImportItems.filter((i) => i.import_id === importId);
    }
    return [...this.sapPurchaseImportItems];
  }

  saveSapPurchaseImport(
    imp: Omit<SapPurchaseImport, 'id' | 'created_at' | 'imported_at'> & { id?: string; imported_at?: string },
    items: Array<Omit<SapPurchaseImportItem, 'id' | 'import_id' | 'created_at'> & { id?: string }>
  ): { importRecord: SapPurchaseImport; items: SapPurchaseImportItem[] } {
    const importId = imp.id || `imp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const importRecord: SapPurchaseImport = {
      ...imp,
      id: importId,
      imported_at: imp.imported_at || new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    this.sapPurchaseImports.unshift(importRecord);

    const createdItems: SapPurchaseImportItem[] = [];
    for (const it of items) {
      const itemRecord: SapPurchaseImportItem = {
        ...it,
        id: it.id || `impi-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        import_id: importId,
        created_at: new Date().toISOString(),
      };
      this.sapPurchaseImportItems.push(itemRecord);
      createdItems.push(itemRecord);
    }
    this.saveToStorage();
    return { importRecord, items: createdItems };
  }

  getSkuWacCost(sku: string): number | null {
    if (!sku) return null;
    const cleanSku = sku.trim().toUpperCase();
    let totalCost = 0;
    let totalEaQty = 0;

    for (const item of this.sapPurchaseImportItems) {
      if ((item.sku || '').trim().toUpperCase() !== cleanSku) continue;
      // Only confirmed/received purchase quantities contribute to available purchase-cost inventory
      const isConfirmed =
        item.status === 'valid' ||
        item.status === 'created' ||
        item.gr_status === 'GR Completed' ||
        item.gr_status === 'Received' ||
        !item.gr_status;
      if (!isConfirmed) continue;

      const receivedQty = Number(item.received_qty ?? item.quantity ?? 0);
      if (receivedQty <= 0) continue;

      const uom = (item.uom || 'DOZ').toUpperCase().trim();
      const eaQty = uom === 'DOZ' ? receivedQty * 12 : receivedQty;
      const unitCost = Number(item.unit_purchase_cost || 0);
      const rowTotal =
        item.total_purchase_cost !== undefined && item.total_purchase_cost !== null
          ? Number(item.total_purchase_cost)
          : receivedQty * unitCost;

      if (rowTotal > 0 && eaQty > 0) {
        totalCost += rowTotal;
        totalEaQty += eaQty;
      }
    }

    if (totalEaQty > 0 && totalCost > 0) {
      return Number((totalCost / totalEaQty).toFixed(4));
    }
    return null;
  }

  getMonthEndPurchaseMargin(year: number, month: number): MonthEndPurchaseMarginSummary {
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const startDate = `${monthPrefix}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;

    // 1. Monthly Sales Revenue (commercial deliveries + SAP baseline sales)
    const monthSapSales = this.sapSalesImportItems.filter((s: any) => {
      if (s.status === 'duplicate') return false;
      const invDate = s.invoice_date || (s.created_at ? s.created_at.slice(0, 10) : '');
      return invDate.startsWith(monthPrefix);
    });

    let sapSalesTotal = 0;
    for (const s of monthSapSales) {
      const isCancel = Boolean(s.is_cancellation);
      const qty = Number(s.quantity || 0);
      const rate = Number(s.rate || 0);
      const netVal = Number(
        s.net_val !== null && s.net_val !== undefined
          ? s.net_val
          : (isCancel ? -qty : qty) * rate
      );
      sapSalesTotal += netVal;
    }

    let goLiveCutoffDate: string | null = null;
    for (const imp of this.sapSalesImports) {
      if (imp.cutoff_date && imp.cutoff_date.startsWith(monthPrefix)) {
        if (!goLiveCutoffDate || imp.cutoff_date > goLiveCutoffDate) {
          goLiveCutoffDate = imp.cutoff_date;
        }
      }
    }

    const monthDeliveries = this.deliveries.filter((d: any) => {
      const isDelivered = d.status === 'delivered' || d.status === 'partial';
      const dDate = d.delivery_date || (d.created_at ? d.created_at.slice(0, 10) : '');
      if (!isDelivered || !dDate.startsWith(monthPrefix)) return false;
      if (goLiveCutoffDate && dDate <= goLiveCutoffDate) return false;
      return true;
    });

    const deliverySales = monthDeliveries.reduce((sum, d: any) => sum + Number(d.delivered_amount || 0), 0);
    const sales_revenue = Number((sapSalesTotal + deliverySales).toFixed(2));

    // Group sales by route
    const routeSalesMap: Record<string, { route_name: string; route_code: string; sales: number; deliveries_count: number }> = {};
    if (sapSalesTotal > 0) {
      routeSalesMap['SAP_BASELINE'] = {
        route_name: 'SAP Commercial Baseline Invoices',
        route_code: 'SAP-BASE',
        sales: Number(sapSalesTotal.toFixed(2)),
        deliveries_count: monthSapSales.length,
      };
    }
    for (const d of monthDeliveries as any[]) {
      const rName = d.route?.name || d.route_name || 'Unassigned Route';
      const rCode = d.route?.code || d.route_code || 'N/A';
      const key = `${rCode}_${rName}`;
      if (!routeSalesMap[key]) {
        routeSalesMap[key] = { route_name: rName, route_code: rCode, sales: 0, deliveries_count: 0 };
      }
      routeSalesMap[key].sales += Number(d.delivered_amount || 0);
      routeSalesMap[key].deliveries_count++;
    }
    const sales_by_route: SalesRouteDrilldown[] = Object.values(routeSalesMap).sort((a, b) => b.sales - a.sales);

    // 2. Confirmed Monthly SAP Purchases
    const confirmedPurchaseItems = this.sapPurchaseImportItems.filter((pi) => {
      const isConfirmed =
        pi.status === 'valid' ||
        pi.status === 'created' ||
        pi.gr_status === 'GR Completed' ||
        pi.gr_status === 'Received' ||
        pi.gr_status === 'Completed' ||
        !pi.gr_status;
      if (!isConfirmed) return false;
      const grDate = pi.gr_date || (pi.created_at ? pi.created_at.slice(0, 10) : '');
      return grDate.startsWith(monthPrefix);
    });

    let purchase_spend = 0;
    let total_received_qty = 0;
    const batchMap: Record<string, PurchaseBatchDrilldown> = {};

    for (const pi of confirmedPurchaseItems) {
      const qty = Number(pi.received_qty ?? pi.quantity ?? 0);
      const unitCost = Number(pi.unit_purchase_cost || 0);
      const rowTotal =
        pi.total_purchase_cost !== undefined && pi.total_purchase_cost !== null
          ? Number(pi.total_purchase_cost)
          : qty * unitCost;

      purchase_spend += rowTotal;
      total_received_qty += qty;

      const importId = pi.import_id || 'unknown';
      const grDoc = pi.gr_doc_no || 'N/A';
      const batchKey = `${importId}_${grDoc}`;

      if (!batchMap[batchKey]) {
        const imp = this.sapPurchaseImports.find((b) => b.id === importId);
        batchMap[batchKey] = {
          import_id: importId,
          batch_ref: imp?.batch_ref || `BATCH-${pi.gr_date?.replace(/-/g, '') || 'SAP'}`,
          file_name: imp?.file_name || 'purchase.xlsx',
          gr_date: pi.gr_date || startDate,
          gr_doc_no: grDoc,
          sku_count: 0,
          line_items_count: 0,
          total_qty: 0,
          total_amount: 0,
        };
      }
      batchMap[batchKey].line_items_count++;
      batchMap[batchKey].total_qty += qty;
      batchMap[batchKey].total_amount += rowTotal;
    }

    const purchase_batches: PurchaseBatchDrilldown[] = Object.values(batchMap).sort(
      (a, b) => a.gr_date.localeCompare(b.gr_date)
    );

    // 3. Approved Operating Expenses
    const monthExpenses = this.expenses.filter((e) => {
      const isApproved = e.status === 'approved';
      const eDate = e.date || (e.created_at ? e.created_at.slice(0, 10) : '');
      return isApproved && eDate.startsWith(monthPrefix);
    });

    const approved_expenses = monthExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const expenseCategoryMap: Record<string, ExpenseBreakdownItem> = {};
    for (const e of monthExpenses) {
      const cat = e.category || 'General';
      if (!expenseCategoryMap[cat]) {
        expenseCategoryMap[cat] = { category: cat, count: 0, amount: 0 };
      }
      expenseCategoryMap[cat].count++;
      expenseCategoryMap[cat].amount += Number(e.amount || 0);
    }
    const expenses_breakdown: ExpenseBreakdownItem[] = Object.values(expenseCategoryMap).sort(
      (a, b) => b.amount - a.amount
    );

    // 4. Month-End Net Margin Calculation
    const month_end_net_margin = Number((sales_revenue - purchase_spend - approved_expenses).toFixed(2));
    const net_margin_pct =
      sales_revenue > 0 ? Number(((month_end_net_margin / sales_revenue) * 100).toFixed(2)) : null;

    // 5. Realized Route COGS & Profit for contrast
    let realized_cogs = 0;
    const delIds = new Set(monthDeliveries.map((d: any) => d.id));
    for (const di of this.deliveryItems) {
      if (delIds.has(di.delivery_id)) {
        const wac = this.getSkuWacCost(di.sku || '');
        const cost = Number(di.unit_cost ?? wac ?? 0);
        const qty = Number(di.delivered_qty ?? (di as any).quantity ?? 0);
        realized_cogs += qty * cost;
      }
    }
    realized_cogs = Number(realized_cogs.toFixed(2));
    const realized_gross_profit = Number((sales_revenue - realized_cogs).toFixed(2));
    const realized_net_profit = Number((realized_gross_profit - approved_expenses).toFixed(2));

    return {
      success: true,
      year,
      month,
      start_date: startDate,
      end_date: endDate,
      sales_revenue: Number(sales_revenue.toFixed(2)),
      purchase_spend: Number(purchase_spend.toFixed(2)),
      approved_expenses: Number(approved_expenses.toFixed(2)),
      month_end_net_margin,
      net_margin_pct,
      purchase_batches_count: purchase_batches.length,
      purchase_items_count: confirmedPurchaseItems.length,
      total_received_qty: Number(total_received_qty.toFixed(2)),
      purchase_batches,
      sales_by_route,
      expenses_breakdown,
      realized_cogs,
      realized_gross_profit,
      realized_net_profit,
      model_label: 'Month-End Net Margin (Purchase Basis)',
      model_explanation: 'Sales − Confirmed Monthly Purchases − Approved Expenses',
    };
  }

  // ── SAP Sales Imports ───────────────────────────────────────────
  getSapSalesImports(): SapSalesImport[] {
    return [...this.sapSalesImports];
  }

  getSapSalesImportItems(importId?: string): SapSalesImportItem[] {
    const valid = this.sapSalesImportItems.filter((i) => i.status !== 'duplicate');
    if (importId) {
      return valid.filter((i) => i.import_id === importId);
    }
    return [...valid];
  }

  saveSapSalesImport(
    imp: Omit<SapSalesImport, 'id' | 'created_at' | 'imported_at'> & { id?: string; imported_at?: string },
    items: Array<Omit<SapSalesImportItem, 'id' | 'import_id' | 'created_at'> & { id?: string }>
  ): { importRecord: SapSalesImport; items: SapSalesImportItem[] } {
    const importId = imp.id || `sales-imp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const importRecord: SapSalesImport = {
      ...imp,
      id: importId,
      imported_at: imp.imported_at || new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    this.sapSalesImports.unshift(importRecord);

    const createdItems: SapSalesImportItem[] = [];
    for (const it of items) {
      const itemRecord: SapSalesImportItem = {
        ...it,
        id: it.id || `sales-item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        import_id: importId,
        created_at: new Date().toISOString(),
      };
      this.sapSalesImportItems.push(itemRecord);
      createdItems.push(itemRecord);
    }
    this.saveToStorage();
    return { importRecord, items: createdItems };
  }

  importSapSalesBaseline(params: {
    items: Array<{
      invoice_no: string;
      invoice_date?: string | null;
      item_seq?: number;
      sku: string;
      product_name?: string;
      cust_code?: string | null;
      cust_name?: string | null;
      quantity: number;
      uom?: string;
      rate?: number | null;
      gross_val?: number | null;
      net_val?: number | null;
      is_cancellation?: boolean;
      reference_doc?: string | null;
    }>;
    batch_ref: string;
    cutoff_date: string;
    file_name?: string;
    notes?: string;
  }): {
    import_id: string;
    batch_ref: string;
    total_rows: number;
    movements_created: number;
    skipped_duplicate: number;
    skipped_unmapped: number;
    total_quantity: number;
    total_net_amount: number;
  } {
    const importId = `sales-imp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    let total_rows = 0;
    let movements_created = 0;
    let skipped_duplicate = 0;
    let skipped_unmapped = 0;
    let total_quantity = 0;
    let total_net_amount = 0;

    const createdItems: SapSalesImportItem[] = [];

    for (let idx = 0; idx < params.items.length; idx++) {
      const it = params.items[idx];
      total_rows++;
      const normSku = (it.sku || '').trim().toUpperCase();
      const unpadded = normSku.replace(/^0+/, '');
      const invoiceNo = (it.invoice_no || '').trim();
      const itemSeq = it.item_seq ?? ((idx + 1) * 10);
      const idempotencyKey = `sales_import:${invoiceNo}:${itemSeq}:${normSku}`;

      const qty = Number(it.quantity) || 0;
      const netVal = Number(it.net_val) || 0;
      const isCancel = Boolean(it.is_cancellation);
      const invDate = it.invoice_date || params.cutoff_date;

      total_quantity += qty;
      total_net_amount += netVal;

      const existingMov = this.inventoryMovements.find((m) => m.idempotency_key === idempotencyKey);
      const existingItem = this.sapSalesImportItems.find((i) => i.idempotency_key === idempotencyKey);

      if (existingMov || existingItem) {
        skipped_duplicate++;
        continue;
      }

      let prod = this.products.find(
        (p) => p.sku.toUpperCase() === normSku || (unpadded && p.sku.toUpperCase() === unpadded)
      );

      if (!prod && normSku) {
        const refEntry = findSapReferenceCatalog(normSku);
        const prodName = it.product_name || refEntry?.name || `SKU ${normSku}`;
        const newProd: Product = {
          id: `prod-sap-${normSku}`,
          sku: normSku,
          name: prodName,
          category: refEntry?.category || 'Oral Care',
          mrp: refEntry?.mrp || Number(it.rate || 100),
          rate: Number(it.rate || 100),
          unit: it.uom || refEntry?.unit || 'pcs',
          status: 'active',
          is_sap_master: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.saveProduct(newProd);
        registerProductMasterEntry({
          sku: normSku,
          name: prodName,
          mrp: newProd.mrp,
          category: newProd.category || 'General',
          unit: newProd.unit,
        });
        prod = newProd;
      }

      if (!prod) {
        skipped_unmapped++;
        createdItems.push({
          id: `sales-item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          import_id: importId,
          invoice_no: invoiceNo,
          invoice_date: invDate,
          item_seq: itemSeq,
          sku: normSku,
          product_id: null,
          product_name: it.product_name || normSku,
          cust_code: it.cust_code || null,
          cust_name: it.cust_name || null,
          quantity: qty,
          uom: it.uom || 'EA',
          rate: it.rate ?? null,
          gross_val: it.gross_val ?? null,
          net_val: netVal,
          is_cancellation: isCancel,
          reference_doc: it.reference_doc || null,
          idempotency_key: idempotencyKey,
          movement_id: null,
          status: 'unmapped',
          notes: 'Unmapped product in Product Master.',
          created_at: new Date().toISOString(),
        });
        continue;
      }

      let movementId: string | null = null;
      if (qty > 0 && invDate <= params.cutoff_date) {
        const movId = `mov-sales-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        movementId = movId;

        if (isCancel) {
          this.inventoryMovements.push({
            id: movId,
            product_id: prod.id,
            sku: normSku,
            movement_type: 'route_return',
            quantity: Math.abs(qty),
            direction: 'in',
            from_location: 'customer',
            to_location: 'warehouse',
            reference_number: invoiceNo,
            reference_type: 'sap_sales_cancellation',
            notes: `SAP Sales Cancellation: ${it.cust_name || 'Credit Note'}`,
            idempotency_key: idempotencyKey,
            occurred_at: invDate ? new Date(invDate).toISOString() : new Date().toISOString(),
            created_at: new Date().toISOString(),
          });
        } else {
          this.inventoryMovements.push({
            id: movId,
            product_id: prod.id,
            sku: normSku,
            movement_type: 'sap_sales_baseline',
            quantity: Math.abs(qty),
            direction: 'out',
            from_location: 'warehouse',
            to_location: 'customer',
            reference_number: invoiceNo,
            reference_type: 'sap_sales_baseline',
            notes: `SAP Baseline Sale: ${it.cust_name || 'Pre-Go-Live Sales'}`,
            idempotency_key: idempotencyKey,
            occurred_at: invDate ? new Date(invDate).toISOString() : new Date().toISOString(),
            created_at: new Date().toISOString(),
          });
        }
        movements_created++;
      }

      createdItems.push({
        id: `sales-item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        import_id: importId,
        invoice_no: invoiceNo,
        invoice_date: invDate,
        item_seq: itemSeq,
        sku: normSku,
        product_id: prod.id,
        product_name: prod.name || it.product_name || normSku,
        cust_code: it.cust_code || null,
        cust_name: it.cust_name || null,
        quantity: qty,
        uom: it.uom || 'EA',
        rate: it.rate ?? null,
        gross_val: it.gross_val ?? null,
        net_val: netVal,
        is_cancellation: isCancel,
        reference_doc: it.reference_doc || null,
        idempotency_key: idempotencyKey,
        movement_id: movementId,
        status: 'created',
        notes: isCancel ? 'Cancellation recorded as return.' : 'Baseline stock-out movement created.',
        created_at: new Date().toISOString(),
      });
    }

    const importRecord: SapSalesImport = {
      id: importId,
      batch_ref: params.batch_ref,
      file_name: params.file_name || 'sale.xlsx',
      cutoff_date: params.cutoff_date,
      imported_at: new Date().toISOString(),
      imported_by: null,
      total_rows,
      movements_created,
      skipped_duplicate,
      skipped_unmapped,
      total_quantity,
      total_net_amount,
      notes: params.notes || null,
      created_at: new Date().toISOString(),
    };

    if (movements_created > 0 || createdItems.length > 0) {
      this.sapSalesImports.unshift(importRecord);
      this.sapSalesImportItems.push(...createdItems);
    }
    this.saveToStorage();

    return {
      import_id: importId,
      batch_ref: params.batch_ref,
      total_rows,
      movements_created,
      skipped_duplicate,
      skipped_unmapped,
      total_quantity,
      total_net_amount,
    };
  }

  recoverMissingPurchaseMovements(items: Array<{
    sku: string;
    productName: string;
    uom: string;
    quantity: number;
    grDocNo: string;
    invoiceNo: string;
    itemNo: string;
    batch: string;
    grDate: string;
    grStatus: string;
    idempotencyKey: string;
  }>): { recoveredCount: number; totalRecoveredQty: number } {
    let recoveredCount = 0;
    let totalRecoveredQty = 0;

    for (const it of items) {
      const existing = this.inventoryMovements.find((m) => m.idempotency_key === it.idempotencyKey);
      if (existing) continue;

      const norm = it.sku.trim().toUpperCase();
      const unpadded = norm.replace(/^0+/, '');
      const prod = this.products.find(
        (p) => p.sku.toUpperCase() === norm || (unpadded && p.sku.toUpperCase() === unpadded)
      );

      this.inventoryMovements.push({
        id: `mov-rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        product_id: prod?.id || `prod-sap-${norm}`,
        sku: norm,
        movement_type: 'purchase_inward',
        quantity: it.quantity,
        direction: 'in',
        from_location: 'supplier',
        to_location: 'warehouse',
        reference_number: it.grDocNo || it.invoiceNo,
        reference_type: 'sap_purchase_recovery',
        idempotency_key: it.idempotencyKey,
        notes: `Recovered SAP Inbound: GR ${it.grDocNo} Item ${it.itemNo} Inv ${it.invoiceNo}`,
        source_location: 'warehouse',
        occurred_at: it.grDate ? new Date(it.grDate).toISOString() : new Date().toISOString(),
        created_at: new Date().toISOString(),
      });

      recoveredCount++;
      totalRecoveredQty += it.quantity;
    }

    if (recoveredCount > 0) {
      this.saveToStorage();
    }

    return { recoveredCount, totalRecoveredQty };
  }

  // ── Product MRP History & Updates ───────────────────────────────
  getProductMrpHistory(sku?: string): ProductMrpHistory[] {
    if (sku) {
      const norm = sku.trim().toUpperCase();
      return this.productMrpHistory.filter((h) => h.sku.toUpperCase() === norm);
    }
    return [...this.productMrpHistory];
  }

  saveProductMrpHistory(record: Partial<ProductMrpHistory>): ProductMrpHistory {
    const created: ProductMrpHistory = {
      id: record.id || `pmh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      product_id: record.product_id || '',
      sku: (record.sku || '').trim().toUpperCase(),
      old_mrp: Number(record.old_mrp || 0),
      new_mrp: Number(record.new_mrp || 0),
      effective_at: record.effective_at || new Date().toISOString(),
      source: record.source || 'SAP_PURCHASE_IMPORT',
      import_reference: record.import_reference || null,
      changed_by: record.changed_by || null,
      created_at: new Date().toISOString(),
    };
    this.productMrpHistory.unshift(created);
    this.saveToStorage();
    return created;
  }

  updateProductMrp(
    sku: string,
    newMrp: number,
    source: string = 'SAP_PURCHASE_IMPORT',
    importRef?: string,
    actorId?: string,
    effectiveAt?: string
  ): { status: 'updated' | 'unchanged' | 'not_found'; sku: string; oldMrp?: number; newMrp: number; message: string } {
    const norm = (sku || '').trim().toUpperCase();
    const unpadded = norm.replace(/^0+/, '');
    const idx = this.products.findIndex(
      (p) => p.sku.toUpperCase() === norm || (unpadded && p.sku.toUpperCase() === unpadded)
    );

    if (idx < 0) {
      return {
        status: 'not_found',
        sku: norm,
        newMrp,
        message: `Product with SKU ${norm} not found in Product Master`,
      };
    }

    const prod = this.products[idx];
    const oldMrp = Number(prod.mrp || 0);

    if (oldMrp === Number(newMrp)) {
      return {
        status: 'unchanged',
        sku: norm,
        oldMrp,
        newMrp: oldMrp,
        message: `Incoming MRP (${newMrp}) matches current MRP. No change.`,
      };
    }

    // Update Product Master current MRP ONLY (historical transactions remain untouched!)
    prod.mrp = Number(newMrp);
    prod.updated_at = new Date().toISOString();

    // Record in MRP History
    this.saveProductMrpHistory({
      product_id: prod.id,
      sku: norm,
      old_mrp: oldMrp,
      new_mrp: Number(newMrp),
      source,
      import_reference: importRef || null,
      changed_by: actorId || null,
      effective_at: effectiveAt || new Date().toISOString(),
    });

    this.saveToStorage();

    return {
      status: 'updated',
      sku: norm,
      oldMrp,
      newMrp: Number(newMrp),
      message: `Updated SKU ${norm} MRP from ₹${oldMrp} to ₹${newMrp}`,
    };
  }

  // ── Historical Sales Products (Product Discovery) ─────────────────────
  getHistoricalSalesProducts(): HistoricalSalesProduct[] {
    if (!this.historicalSalesProducts || this.historicalSalesProducts.length === 0) {
      this.historicalSalesProducts = [...HISTORICAL_SALES_CATALOG];
    }
    return [...this.historicalSalesProducts];
  }

  findHistoricalSalesProductBySku(sku: string): HistoricalSalesProduct | undefined {
    if (!sku) return undefined;
    const norm = sku.trim().toUpperCase();
    const unpadded = norm.replace(/^0+/, '');
    const list = this.getHistoricalSalesProducts();
    return list.find(
      (p) => p.sku.toUpperCase() === norm || (unpadded && p.sku.toUpperCase() === unpadded)
    );
  }

  saveHistoricalSalesProduct(p: Partial<HistoricalSalesProduct>): HistoricalSalesProduct {
    const list = this.getHistoricalSalesProducts();
    const norm = (p.sku || '').trim().toUpperCase();
    const existingIdx = list.findIndex((item) => item.sku.toUpperCase() === norm);
    const now = new Date().toISOString();

    const entry: HistoricalSalesProduct = {
      id: p.id || (existingIdx >= 0 ? list[existingIdx].id : `hist-${norm}`),
      sku: norm,
      product_name: p.product_name || (existingIdx >= 0 ? list[existingIdx].product_name : norm),
      category: p.category ?? (existingIdx >= 0 ? list[existingIdx].category : null),
      subcategory: p.subcategory ?? (existingIdx >= 0 ? list[existingIdx].subcategory : null),
      hsn_code: p.hsn_code ?? (existingIdx >= 0 ? list[existingIdx].hsn_code : null),
      uom: p.uom ?? (existingIdx >= 0 ? list[existingIdx].uom : 'EA'),
      first_sale_date: p.first_sale_date ?? (existingIdx >= 0 ? list[existingIdx].first_sale_date : null),
      latest_sale_date: p.latest_sale_date ?? (existingIdx >= 0 ? list[existingIdx].latest_sale_date : null),
      total_historical_qty: Number(p.total_historical_qty ?? (existingIdx >= 0 ? list[existingIdx].total_historical_qty : 0)),
      historical_invoice_count: Number(p.historical_invoice_count ?? (existingIdx >= 0 ? list[existingIdx].historical_invoice_count : 0)),
      historical_row_count: Number(p.historical_row_count ?? (existingIdx >= 0 ? list[existingIdx].historical_row_count : 0)),
      average_rate: p.average_rate !== undefined ? p.average_rate : (existingIdx >= 0 ? list[existingIdx].average_rate : null),
      latest_rate: p.latest_rate !== undefined ? p.latest_rate : (existingIdx >= 0 ? list[existingIdx].latest_rate : null),
      source_file: p.source_file || (existingIdx >= 0 ? list[existingIdx].source_file : 'sale.xlsx'),
      import_hash: p.import_hash || (existingIdx >= 0 ? list[existingIdx].import_hash : null),
      created_at: existingIdx >= 0 ? list[existingIdx].created_at : now,
      updated_at: now,
    };

    if (existingIdx >= 0) {
      list[existingIdx] = entry;
    } else {
      list.push(entry);
    }
    this.historicalSalesProducts = list;
    return entry;
  }

  saveBulkHistoricalSalesProducts(products: Partial<HistoricalSalesProduct>[]): number {
    const list = [...this.getHistoricalSalesProducts()];
    const map = new Map<string, number>();
    list.forEach((item, idx) => {
      map.set(item.sku.toUpperCase(), idx);
    });

    const now = new Date().toISOString();
    let count = 0;

    for (const p of products) {
      if (!p || !p.sku) continue;
      const norm = p.sku.trim().toUpperCase();
      const existingIdx = map.get(norm);

      const entry: HistoricalSalesProduct = {
        id: p.id || (existingIdx !== undefined ? list[existingIdx].id : `hist-${norm}`),
        sku: norm,
        product_name: p.product_name || (existingIdx !== undefined ? list[existingIdx].product_name : norm),
        category: p.category ?? (existingIdx !== undefined ? list[existingIdx].category : 'General'),
        subcategory: p.subcategory ?? (existingIdx !== undefined ? list[existingIdx].subcategory : null),
        hsn_code: p.hsn_code ?? (existingIdx !== undefined ? list[existingIdx].hsn_code : null),
        uom: p.uom ?? (existingIdx !== undefined ? list[existingIdx].uom : 'EA'),
        first_sale_date: p.first_sale_date ?? (existingIdx !== undefined ? list[existingIdx].first_sale_date : null),
        latest_sale_date: p.latest_sale_date ?? (existingIdx !== undefined ? list[existingIdx].latest_sale_date : null),
        total_historical_qty: Number(p.total_historical_qty ?? (existingIdx !== undefined ? list[existingIdx].total_historical_qty : 0)),
        historical_invoice_count: Number(p.historical_invoice_count ?? (existingIdx !== undefined ? list[existingIdx].historical_invoice_count : 0)),
        historical_row_count: Number(p.historical_row_count ?? (existingIdx !== undefined ? list[existingIdx].historical_row_count : 0)),
        average_rate: p.average_rate !== undefined ? p.average_rate : (existingIdx !== undefined ? list[existingIdx].average_rate : null),
        latest_rate: p.latest_rate !== undefined ? p.latest_rate : (existingIdx !== undefined ? list[existingIdx].latest_rate : null),
        source_file: p.source_file || (existingIdx !== undefined ? list[existingIdx].source_file : 'sale.xlsx'),
        import_hash: p.import_hash || (existingIdx !== undefined ? list[existingIdx].import_hash : null),
        created_at: existingIdx !== undefined ? list[existingIdx].created_at : now,
        updated_at: now,
      };

      if (existingIdx !== undefined) {
        list[existingIdx] = entry;
      } else {
        map.set(norm, list.length);
        list.push(entry);
      }
      count++;
    }

    this.historicalSalesProducts = list;
    return count;
  }

  clearHistoricalSalesProducts(): void {
    this.historicalSalesProducts = [];
  }

  // ── Admin Reset Controls (Reset Test Inventory + Delete SAP Sales) ──
  getLiveOperationalTransactionsCount(): {
    total: number;
    breakdown: {
      deliveries: number;
      payments: number;
      expenses: number;
      closedRoutes: number;
      closedPicklists: number;
      operationalMovements: number;
    };
  } {
    const liveDeliveries = this.deliveries.filter(
      (d) => d.status === 'delivered' || d.status === 'partial' || !!d.delivered_at
    ).length;

    const livePayments = this.payments.filter(
      (p) => p.status === 'collected' || p.status === 'cleared'
    ).length;

    const liveExpenses = this.expenses.filter(
      (e) => e.status === 'approved' || (e.status as string) === 'active'
    ).length;

    const closedRoutes = this.routes.filter((r) => r.status === 'completed').length;
    const closedPicklists = this.picklists.filter((pl) => pl.status === 'completed').length;

    const operationalMovements = this.inventoryMovements.filter(
      (m) =>
        ['delivery_fulfilled', 'damaged_transit', 'damaged_warehouse'].includes(m.movement_type) ||
        (m.movement_type === 'route_return' && !!(m as any).delivery_id)
    ).length;

    const total =
      liveDeliveries +
      livePayments +
      liveExpenses +
      closedRoutes +
      closedPicklists +
      operationalMovements;

    return {
      total,
      breakdown: {
        deliveries: liveDeliveries,
        payments: livePayments,
        expenses: liveExpenses,
        closedRoutes,
        closedPicklists,
        operationalMovements,
      },
    };
  }

  getInventoryResetPreview(): {
    inventoryMovementsCount: number;
    stockExceptionsCount: number;
    vehicleStockRecordsCount: number;
    reconciliationsCount: number;
    liveOperationalTransactionsCount: number;
    canReset: boolean;
    blockReason: string | null;
    liveBreakdown: {
      deliveries: number;
      payments: number;
      expenses: number;
      closedRoutes: number;
      closedPicklists: number;
      operationalMovements: number;
    };
  } {
    const live = this.getLiveOperationalTransactionsCount();
    const inventoryMovementsCount = this.inventoryMovements.length;
    const stockExceptionsCount = this.routeStockExceptions.length + this.unmappedSkuExceptions.length;
    const vehicleStockRecordsCount = this.inventoryMovements.filter(
      (m) => m.to_location === 'vehicle' || m.from_location === 'vehicle' || m.movement_type === 'route_load'
    ).length;
    const reconciliationsCount = this.sapStockReconciliations.length;

    return {
      inventoryMovementsCount,
      stockExceptionsCount,
      vehicleStockRecordsCount,
      reconciliationsCount,
      liveOperationalTransactionsCount: live.total,
      canReset: live.total === 0,
      blockReason:
        live.total > 0
          ? 'Inventory reset is unavailable because live operational history exists.'
          : null,
      liveBreakdown: live.breakdown,
    };
  }

  getSapSalesDeletePreview(importId?: string): {
    batchesCount: number;
    itemsCount: number;
    baselineMovementsCount: number;
    totalQuantity: number;
    totalNetAmount: number;
  } {
    let batches = this.sapSalesImports;
    let items = this.sapSalesImportItems;
    if (importId) {
      batches = batches.filter((b) => b.id === importId);
      items = items.filter((i) => i.import_id === importId);
    }

    const itemMovementIds = new Set(items.map((i) => i.movement_id).filter(Boolean));
    const itemKeySet = new Set(items.map((i) => i.idempotency_key).filter(Boolean));

    const baselineMovements = this.inventoryMovements.filter(
      (m) =>
        (m.id && itemMovementIds.has(m.id)) ||
        (m.idempotency_key && itemKeySet.has(m.idempotency_key)) ||
        (!importId && (m.movement_type === 'sap_sales_baseline' || m.idempotency_key?.startsWith('sales_import:')))
    );

    const totalQuantity = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
    const totalNetAmount = items.reduce((sum, it) => sum + (Number(it.net_val) || 0), 0);

    return {
      batchesCount: batches.length,
      itemsCount: items.length,
      baselineMovementsCount: baselineMovements.length,
      totalQuantity,
      totalNetAmount,
    };
  }

  resetTestInventory(actorInfo?: { userId?: string; userName?: string; role?: string }): {
    success: boolean;
    movements_deleted: number;
    exceptions_deleted: number;
    reconciliations_deleted: number;
    timestamp: string;
  } {
    // 1. Authorization guard
    if (actorInfo?.role && !['owner', 'master', 'admin'].includes(actorInfo.role.toLowerCase().trim())) {
      throw new Error('Unauthorized: Only Owner, Admin, or Master can reset test inventory.');
    }

    // 2. Pre-go-live / Live-transaction guard
    const live = this.getLiveOperationalTransactionsCount();
    if (live.total > 0) {
      throw new Error('Inventory reset is unavailable because live operational history exists.');
    }

    const movements_deleted = this.inventoryMovements.length;
    const exceptions_deleted = this.routeStockExceptions.length + this.unmappedSkuExceptions.length;
    const reconciliations_deleted = this.sapStockReconciliations.length;

    // Clear test inventory movements, exceptions, reconciliations
    this.inventoryMovements = [];
    this.routeStockExceptions = [];
    this.unmappedSkuExceptions = [];
    this.sapStockReconciliations = [];
    this.sapStockReconciliationItems = [];

    // Decouple movement_id from audit logs
    this.sapPurchaseImportItems = this.sapPurchaseImportItems.map((it) => ({
      ...it,
      movement_id: null,
    }));
    this.sapSalesImportItems = this.sapSalesImportItems.map((it) => ({
      ...it,
      movement_id: null,
    }));

    this.saveToStorage();

    return {
      success: true,
      movements_deleted,
      exceptions_deleted,
      reconciliations_deleted,
      timestamp: new Date().toISOString(),
    };
  }

  clearInventory(actorInfo?: { userId?: string; userName?: string; role?: string }): {
    success: boolean;
    movements_deleted: number;
    exceptions_deleted: number;
    reconciliations_deleted: number;
    timestamp: string;
  } {
    return this.resetTestInventory(actorInfo);
  }

  deleteSapSalesHistory(
    importId?: string,
    _actorInfo?: { userId?: string; userName?: string; role?: string }
  ): {
    success: boolean;
    batches_deleted: number;
    items_deleted: number;
    movements_deleted: number;
    total_quantity: number;
    total_net_amount: number;
    timestamp: string;
  } {
    let targetBatches = this.sapSalesImports;
    let targetItems = this.sapSalesImportItems;
    if (importId) {
      targetBatches = targetBatches.filter((b) => b.id === importId);
      targetItems = targetItems.filter((i) => i.import_id === importId);
    }

    const targetBatchIds = new Set(targetBatches.map((b) => b.id));
    const targetItemIds = new Set(targetItems.map((i) => i.id));
    const targetMovementIds = new Set(targetItems.map((i) => i.movement_id).filter(Boolean));
    const targetIdempotencyKeys = new Set(targetItems.map((i) => i.idempotency_key).filter(Boolean));

    const total_quantity = targetItems.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
    const total_net_amount = targetItems.reduce((sum, it) => sum + (Number(it.net_val) || 0), 0);

    // Filter out baseline inventory movements
    const initialMovCount = this.inventoryMovements.length;
    this.inventoryMovements = this.inventoryMovements.filter((m) => {
      if (m.id && targetMovementIds.has(m.id)) return false;
      if (m.idempotency_key && targetIdempotencyKeys.has(m.idempotency_key)) return false;
      if (!importId && (m.movement_type === 'sap_sales_baseline' || m.idempotency_key?.startsWith('sales_import:'))) {
        return false;
      }
      return true;
    });
    const movements_deleted = initialMovCount - this.inventoryMovements.length;

    const items_deleted = targetItems.length;
    const batches_deleted = targetBatches.length;

    this.sapSalesImportItems = this.sapSalesImportItems.filter((i) => !targetItemIds.has(i.id) && !targetBatchIds.has(i.import_id));
    this.sapSalesImports = this.sapSalesImports.filter((b) => !targetBatchIds.has(b.id));

    this.saveToStorage();

    return {
      success: true,
      batches_deleted,
      items_deleted,
      movements_deleted,
      total_quantity,
      total_net_amount,
      timestamp: new Date().toISOString(),
    };
  }

  // No physical delete - Stage 6 non-physical deletion invariant
  deleteExpense(_id: string) {
    console.warn('[mockStore] Physical delete on expenses is prohibited by Stage 6. Use reverseExpense or rejectExpense instead.');
  }
}

export const mockStore = new MockStore();
