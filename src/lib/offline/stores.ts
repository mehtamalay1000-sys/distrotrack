// ================================================================
// DistroTrack v2 — Stage 9A: Object Store Definitions & Schema Migrations
// File: src/lib/offline/stores.ts
// ================================================================

export const OFFLINE_DB_NAME = 'distrotrack_offline_db';
export const OFFLINE_DB_VERSION = 1;

export const OFFLINE_STORES = {
  SESSION_CONTEXT: 'session_context',
  ROUTES: 'routes',
  PICKLISTS: 'picklists',
  PARTIES: 'parties',
  PRODUCTS: 'products',
  DELIVERIES: 'deliveries',
  PAYMENTS: 'payments',
  RETURNS: 'returns',
  EXPENSES: 'expenses',
  OUTBOX: 'outbox',
  SYNC_METADATA: 'sync_metadata',
} as const;

export type OfflineStoreName = typeof OFFLINE_STORES[keyof typeof OFFLINE_STORES];

export const ALL_OFFLINE_STORES: OfflineStoreName[] = [
  OFFLINE_STORES.SESSION_CONTEXT,
  OFFLINE_STORES.ROUTES,
  OFFLINE_STORES.PICKLISTS,
  OFFLINE_STORES.PARTIES,
  OFFLINE_STORES.PRODUCTS,
  OFFLINE_STORES.DELIVERIES,
  OFFLINE_STORES.PAYMENTS,
  OFFLINE_STORES.RETURNS,
  OFFLINE_STORES.EXPENSES,
  OFFLINE_STORES.OUTBOX,
  OFFLINE_STORES.SYNC_METADATA,
];

/**
 * Configure and migrate object stores across database versions.
 * Safely creates stores and indexes without wiping existing user data.
 */
export function setupObjectStores(
  db: IDBDatabase,
  oldVersion: number,
  _newVersion: number | null
): void {
  // ── Version 1: Initial Stage 9A Schema Foundation ─────────────
  if (oldVersion < 1) {
    // 1. Session Context
    if (!db.objectStoreNames.contains(OFFLINE_STORES.SESSION_CONTEXT)) {
      db.createObjectStore(OFFLINE_STORES.SESSION_CONTEXT, { keyPath: 'id' });
    }

    // 2. Routes Cache
    if (!db.objectStoreNames.contains(OFFLINE_STORES.ROUTES)) {
      const store = db.createObjectStore(OFFLINE_STORES.ROUTES, { keyPath: 'id' });
      store.createIndex('idx_workerId', 'workerId', { unique: false });
      store.createIndex('idx_picklistId', 'picklistId', { unique: false });
    }

    // 3. Picklists Cache
    if (!db.objectStoreNames.contains(OFFLINE_STORES.PICKLISTS)) {
      const store = db.createObjectStore(OFFLINE_STORES.PICKLISTS, { keyPath: 'id' });
      store.createIndex('idx_workerId', 'workerId', { unique: false });
      store.createIndex('idx_routeId', 'routeId', { unique: false });
      store.createIndex('idx_status', 'status', { unique: false });
    }

    // 4. Parties Cache
    if (!db.objectStoreNames.contains(OFFLINE_STORES.PARTIES)) {
      const store = db.createObjectStore(OFFLINE_STORES.PARTIES, { keyPath: 'id' });
      store.createIndex('idx_customerCode', 'customerCode', { unique: false });
      store.createIndex('idx_routeId', 'routeId', { unique: false });
      store.createIndex('idx_picklistId', 'picklistId', { unique: false });
    }

    // 5. Products Cache
    if (!db.objectStoreNames.contains(OFFLINE_STORES.PRODUCTS)) {
      const store = db.createObjectStore(OFFLINE_STORES.PRODUCTS, { keyPath: 'id' });
      store.createIndex('idx_sku', 'sku', { unique: false });
    }

    // 6. Deliveries Local Store
    if (!db.objectStoreNames.contains(OFFLINE_STORES.DELIVERIES)) {
      const store = db.createObjectStore(OFFLINE_STORES.DELIVERIES, { keyPath: 'id' });
      store.createIndex('idx_picklistId', 'picklistId', { unique: false });
      store.createIndex('idx_partyId', 'partyId', { unique: false });
      store.createIndex('idx_workerId', 'workerId', { unique: false });
      store.createIndex('idx_syncState', 'syncState', { unique: false });
    }

    // 7. Payments Local Store
    if (!db.objectStoreNames.contains(OFFLINE_STORES.PAYMENTS)) {
      const store = db.createObjectStore(OFFLINE_STORES.PAYMENTS, { keyPath: 'id' });
      store.createIndex('idx_picklistId', 'picklistId', { unique: false });
      store.createIndex('idx_partyId', 'partyId', { unique: false });
      store.createIndex('idx_workerId', 'workerId', { unique: false });
      store.createIndex('idx_syncState', 'syncState', { unique: false });
      store.createIndex('idx_idempotencyKey', 'idempotencyKey', { unique: true });
    }

    // 8. Returns Local Store
    if (!db.objectStoreNames.contains(OFFLINE_STORES.RETURNS)) {
      const store = db.createObjectStore(OFFLINE_STORES.RETURNS, { keyPath: 'id' });
      store.createIndex('idx_picklistId', 'picklistId', { unique: false });
      store.createIndex('idx_deliveryId', 'deliveryId', { unique: false });
      store.createIndex('idx_workerId', 'workerId', { unique: false });
      store.createIndex('idx_syncState', 'syncState', { unique: false });
      store.createIndex('idx_idempotencyKey', 'idempotencyKey', { unique: true });
    }

    // 9. Expenses Local Store
    if (!db.objectStoreNames.contains(OFFLINE_STORES.EXPENSES)) {
      const store = db.createObjectStore(OFFLINE_STORES.EXPENSES, { keyPath: 'id' });
      store.createIndex('idx_picklistId', 'picklistId', { unique: false });
      store.createIndex('idx_workerId', 'workerId', { unique: false });
      store.createIndex('idx_syncState', 'syncState', { unique: false });
      store.createIndex('idx_idempotencyKey', 'idempotencyKey', { unique: true });
    }

    // 10. Outbox Persistent Queue
    if (!db.objectStoreNames.contains(OFFLINE_STORES.OUTBOX)) {
      const store = db.createObjectStore(OFFLINE_STORES.OUTBOX, { keyPath: 'id' });
      store.createIndex('idx_idempotencyKey', 'idempotencyKey', { unique: true });
      store.createIndex('idx_status', 'status', { unique: false });
      store.createIndex('idx_createdAt', 'createdAt', { unique: false });
      store.createIndex('idx_entityType', 'entityType', { unique: false });
    }

    // 11. Sync Metadata
    if (!db.objectStoreNames.contains(OFFLINE_STORES.SYNC_METADATA)) {
      db.createObjectStore(OFFLINE_STORES.SYNC_METADATA, { keyPath: 'id' });
    }
  }

  // Future schema version migrations can be chained here:
  // if (oldVersion < 2 && newVersion && newVersion >= 2) { ... }
}
