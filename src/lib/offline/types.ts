// ================================================================
// DistroTrack v2 — Stage 9A: Offline Storage Types & Domain Models
// File: src/lib/offline/types.ts
// ================================================================

export type SyncState = 'local' | 'pending' | 'synced' | 'failed';

export type OutboxStatus = 'pending' | 'processing' | 'failed' | 'synced';

export type OperationType =
  | 'START_ROUTE'
  | 'COMPLETE_DELIVERY'
  | 'RECORD_PAYMENT'
  | 'RECORD_RETURN'
  | 'LOG_EXPENSE'
  | 'CLOSE_ROUTE';

export type EntityType =
  | 'route'
  | 'picklist'
  | 'party'
  | 'product'
  | 'delivery'
  | 'payment'
  | 'return'
  | 'expense';

// ── 1. Session Context (Non-secret identity metadata) ───────────
// SECURITY RULE: Never store passwords, PINs, auth tokens, or keys here.
export interface OfflineSessionContext {
  id: 'current';
  userId: string;
  workerId: string | null;
  role: string;
  sessionStartedAt: string;
  lastAuthenticatedAt: string;
  updatedAt: string;
}

// ── 2. Operational Cache: Routes ────────────────────────────────
export interface OfflineRoute {
  id: string; // route UUID
  picklistId: string | null;
  workerId: string | null;
  routeDate: string;
  status: string;
  name: string;
  code?: string;
  startedAt: string | null;
  cachedAt: string;
  updatedAt: string;
}

// ── 3. Operational Cache: Picklists ─────────────────────────────
export interface OfflinePicklist {
  id: string; // picklist UUID
  routeId: string | null;
  workerId: string | null;
  status: string;
  picklistDate: string;
  picklistNumber: string;
  totalAmount: number;
  totalParties: number;
  totalItems: number;
  cachedAt: string;
  updatedAt: string;
}

// ── 4. Operational Cache: Parties (Customers) ───────────────────
export interface OfflineParty {
  id: string; // party UUID
  customerCode: string;
  customerName: string;
  address: string | null;
  phone: string | null;
  routeId: string | null;
  picklistId: string | null;
  outstandingAmount: number;
  cachedAt: string;
  updatedAt: string;
}

// ── 5. Operational Cache: Products (SKU Catalog) ────────────────
// SAP SKU is the canonical product identity
export interface OfflineProduct {
  id: string; // product UUID
  sku: string; // canonical SKU code
  name: string;
  unit: string;
  mrp: number;
  rate: number;
  availableQty?: number;
  cachedAt: string;
  updatedAt: string;
}

// ── 6. Deliveries (Event-oriented local delivery state) ─────────
export interface OfflineDeliveryItem {
  deliveryItemId: string;
  productId?: string;
  sku: string;
  productName: string;
  orderedQty: number;
  deliveredQty: number;
  freeQuantity: number;
  deliveredFreeQty: number;
  returnedQty: number;
  returnedFreeQty: number;
  damagedQty: number;
  damagedFreeQty: number;
  rate: number;
  amount: number;
}

export interface OfflineDelivery {
  id: string; // unique local or server UUID
  deliveryId: string | null; // server delivery ID if already assigned
  routeId: string | null;
  picklistId: string;
  partyId: string;
  workerId: string;
  invoiceId: string | null;
  status: 'pending' | 'delivered' | 'partial' | 'failed' | 'refused' | 'cancelled';
  items: OfflineDeliveryItem[];
  paymentMode?: string;
  collectedAmount?: number;
  deliveredAmount?: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  syncState: SyncState;
  idempotencyKey?: string;
}

// ── 7. Payments (Local payment event) ───────────────────────────
// SECURITY RULE: Never store bank credentials, CVVs, or card numbers.
export interface OfflinePayment {
  id: string;
  routeId: string | null;
  picklistId: string | null;
  partyId: string;
  workerId: string;
  deliveryId: string | null;
  invoiceId: string | null;
  paymentMethod: 'cash' | 'cheque' | 'credit' | 'upi';
  amount: number;
  reference: string | null;
  chequeNumber?: string | null;
  chequeDate?: string | null;
  chequeBank?: string | null;
  notes?: string | null;
  createdAt: string;
  syncState: SyncState;
  idempotencyKey: string;
}

// ── 8. Returns (Local stock return event) ───────────────────────
export interface OfflineReturnItem {
  sku: string;
  productId?: string;
  returnedQty: number;
  damagedWarehouseQty: number;
  reason?: string;
}

export interface OfflineReturn {
  id: string;
  routeId: string | null;
  picklistId: string | null;
  partyId: string;
  workerId: string;
  deliveryId: string | null;
  items: OfflineReturnItem[];
  reason: string | null;
  createdAt: string;
  syncState: SyncState;
  idempotencyKey: string;
}

// ── 9. Expenses (Local route expense event) ─────────────────────
// SECURITY RULE: Local expense state is strictly pending until server authorizes.
export interface OfflineExpense {
  id: string;
  routeId: string | null;
  picklistId: string | null;
  workerId: string;
  expenseType: 'route_operating' | 'worker_personal';
  category: string;
  amount: number;
  paymentMethod: 'cash' | 'upi' | 'bank' | 'other';
  description: string | null;
  receiptUrl?: string | null;
  createdAt: string;
  syncState: SyncState;
  idempotencyKey: string;
}

// ── 10. Outbox (Persistent queue of mutations for future sync) ──
export interface OutboxEntry<T = unknown> {
  id: string; // client UUID
  idempotencyKey: string; // unique format e.g. DT-<uuid>
  operationType: OperationType;
  entityType: EntityType;
  entityId: string;
  payload: T;
  createdAt: string;
  updatedAt: string;
  retryCount: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  status: OutboxStatus;
  errorCode: string | null;
  errorMessage: string | null;
}

// ── 11. Sync Metadata (Bookkeeping record) ──────────────────────
export interface SyncMetadata {
  id: 'global';
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;
  lastErrorAt: string | null;
  pendingCount: number;
  updatedAt: string;
}
