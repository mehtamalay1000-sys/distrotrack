 import type { Worker, Route, Party, Product, Picklist, Delivery, Payment, Expense, PicklistItem, DeliveryItem } from '@/lib/database.types';
import { SAP_PRODUCT_MASTER } from '@/features/products/data/productMaster';
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
const INITIAL_PRODUCTS: Product[] = SAP_PRODUCT_MASTER.map((entry, idx) => ({
  id: `prod-master-${idx}`,
  sku: entry.sku,
  name: entry.name,
  category: entry.category,
  mrp: entry.mrp,
  rate: entry.mrp,
  unit: entry.unit,
  status: 'active' as const,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}));
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

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem('distrotrack_clean_v3');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.workers = parsed.workers || INITIAL_WORKERS;

        const loadedRoutes: Route[] = parsed.routes || [];
        const existingRouteCodes = new Set(loadedRoutes.map((r) => r.code.toUpperCase()));
        const mergedRoutes = [...loadedRoutes];
        INITIAL_ROUTES.forEach((initR) => {
          if (!existingRouteCodes.has(initR.code.toUpperCase())) {
            mergedRoutes.push(initR);
          }
        });
        this.routes = mergedRoutes;
        this.parties = parsed.parties || INITIAL_PARTIES;

        const loadedProds: Product[] = (parsed.products || INITIAL_PRODUCTS).filter(
          (p: Product) => p && p.name && !p.name.includes('ZTIN:') && !p.name.includes('TAX Invoice')
        );

        const existingSKUs = new Set(loadedProds.map((p) => p.sku.toUpperCase()));
        const mergedProds = [...loadedProds];
        INITIAL_PRODUCTS.forEach((initP) => {
          if (!existingSKUs.has(initP.sku.toUpperCase())) {
            mergedProds.push(initP);
          }
        });

        this.products = mergedProds;
        this.picklists = parsed.picklists || INITIAL_PICKLISTS;
        this.deliveries = parsed.deliveries || INITIAL_DELIVERIES;
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
      } else {
        this.resetToDefaults();
      }
    } catch {
      this.resetToDefaults();
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(
        'distrotrack_clean_v3',
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
    const existingIdx = this.routes.findIndex((r) => r.id === rData.id || (rData.code && r.code === rData.code));
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
  deleteRoute(id: string) {
    const route = this.routes.find((r) => r.id === id);
    const routeCode = route?.code;
    const routeName = route?.name;

    // Find all picklists associated with this route (by route_id or route code or route name)
    const picklistIds = new Set(
      this.picklists
        .filter(
          (pl) =>
            pl.route_id === id ||
            (routeCode && pl.route?.code?.toLowerCase() === routeCode.toLowerCase()) ||
            (routeName && pl.route?.name?.toLowerCase() === routeName.toLowerCase()) ||
            (routeCode && (pl as any).route_code?.toLowerCase() === routeCode.toLowerCase())
        )
        .map((pl) => pl.id)
    );

    // Find all parties associated with this route
    const partyIds = new Set(
      this.parties
        .filter(
          (p) =>
            p.route_id === id ||
            (routeCode && (p as any).route_code?.toLowerCase() === routeCode.toLowerCase()) ||
            (routeCode && p.route?.code?.toLowerCase() === routeCode.toLowerCase())
        )
        .map((p) => p.id)
    );

    // Find all deliveries linked to these picklists, parties, or route directly
    const deliveryIds = new Set(
      this.deliveries
        .filter(
          (d) =>
            (d.picklist_id && picklistIds.has(d.picklist_id)) ||
            (d.party_id && partyIds.has(d.party_id)) ||
            (d as any).route_id === id ||
            (routeCode && (d as any).route_code?.toLowerCase() === routeCode.toLowerCase())
        )
        .map((d) => d.id)
    );

    // Filter out expenses linked to this route by route_id or route name/code
    const routeNameLower = routeName?.toLowerCase();
    const rCodeLower = routeCode?.toLowerCase();

    this.expenses = this.expenses.filter((e) => {
      if (e.route_id === id) return false;
      const desc = (e.description || '').toLowerCase();
      if (routeNameLower && desc.includes(routeNameLower)) return false;
      if (rCodeLower && desc.includes(rCodeLower)) return false;
      return true;
    });

    // Delete ALL payments belonging to this route, its deliveries, or its parties
    this.payments = this.payments.filter((p) => {
      if (p.delivery_id && deliveryIds.has(p.delivery_id)) return false;
      if (p.party_id && partyIds.has(p.party_id)) return false;
      if ((p as any).route_id === id) return false;
      if (routeCode && (p as any).route_code?.toLowerCase() === routeCode.toLowerCase()) return false;
      return true;
    });

    this.routes = this.routes.filter((r) => r.id !== id);
    this.picklists = this.picklists.filter((pl) => !picklistIds.has(pl.id));
    this.picklistItems = this.picklistItems.filter((pli) => !picklistIds.has(pli.picklist_id));
    this.deliveries = this.deliveries.filter((d) => !deliveryIds.has(d.id));
    this.deliveryItems = this.deliveryItems.filter((dli) => !deliveryIds.has(dli.delivery_id));
    this.parties = this.parties.filter((p) => !partyIds.has(p.id));

    // Also purge orphan payments: if a payment references a delivery that no longer exists
    const remainingDeliveryIds = new Set(this.deliveries.map((d) => d.id));
    this.payments = this.payments.filter((p) => {
      if (p.delivery_id && !remainingDeliveryIds.has(p.delivery_id)) return false;
      return true;
    });

    this.saveToStorage();
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
    return this.products.filter(p => p && p.name && !p.name.includes('ZTIN:') && !p.name.includes('TAX Invoice'));
  }
  saveProduct(prodData: Partial<Product>): Product {
    const existingIdx = this.products.findIndex((p) => p.id === prodData.id || (prodData.sku && p.sku === prodData.sku));
    if (existingIdx >= 0) {
      const updated = { ...this.products[existingIdx], ...prodData, updated_at: new Date().toISOString() };
      this.products[existingIdx] = updated;
      this.saveToStorage();
      return updated;
    } else {
      const created: Product = {
        id: prodData.id || `prod-${Date.now()}`,
        sku: prodData.sku || `SKU-${Date.now().toString().slice(-4)}`,
        name: prodData.name || 'New Product Item',
        category: prodData.category || 'General',
        mrp: Number(prodData.mrp || 0),
        rate: Number(prodData.rate || 0),
        unit: prodData.unit || 'pcs',
        status: prodData.status || 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.products.unshift(created);
      this.saveToStorage();
      return created;
    }
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
        total_cheque: Number(plData.total_cheque || 0),
        total_credit: Number(plData.total_credit || 0),
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
    return this.deliveries.map((d) => {
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
    const existingIdx = this.deliveries.findIndex((d) => d.id === dData.id);
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
  getPicklistItems(): PicklistItem[] {
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
    const created: DeliveryItem = {
      id: item.id || `dli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      delivery_id: item.delivery_id || '',
      product_id: item.product_id || null,
      sku: item.sku || '',
      product_name: item.product_name || '',
      ordered_qty: Number(item.ordered_qty || 0),
      delivered_qty: Number(item.delivered_qty || 0),
      free_quantity: Number(item.free_quantity || 0),
      rate: Number(item.rate || 0),
      amount: Number(item.amount || 0),
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
      category: expData.category || 'other',
      amount: Number(expData.amount || 0),
      date: expData.date || getLocalDateString(),
      description: expData.description || null,
      receipt_url: expData.receipt_url || null,
      visible_to_worker: expData.visible_to_worker ?? false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.expenses.unshift(created);
    this.saveToStorage();
    return created;
  }
  deleteExpense(id: string) {
    this.expenses = this.expenses.filter((e) => e.id !== id);
    this.saveToStorage();
  }
}

export const mockStore = new MockStore();
