// ================================================================
// DistroTrack v2 — Stage 9A: IndexedDB Offline Foundation Engine
// File: src/lib/offline/db.ts
// ================================================================

import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_STORES,
  ALL_OFFLINE_STORES,
  type OfflineStoreName,
  setupObjectStores,
} from './stores.ts';
import type {
  OfflineSessionContext,
  OfflineDelivery,
  OfflinePayment,
  OfflineExpense,
  OutboxEntry,
  SyncMetadata,
} from './types.ts';

let activeDb: IDBDatabase | null = null;
let customFactory: IDBFactory | null = null;

/**
 * Configure a custom IDBFactory (used primarily for test runners in non-browser runtimes).
 */
export function setCustomIndexedDBFactory(factory: IDBFactory | null): void {
  customFactory = factory;
  if (activeDb) {
    activeDb.close();
    activeDb = null;
  }
}

function getIndexedDB(): IDBFactory {
  if (customFactory) return customFactory;
  if (typeof window !== 'undefined' && window.indexedDB) return window.indexedDB;
  if (typeof globalThis !== 'undefined' && (globalThis as any).indexedDB) {
    return (globalThis as any).indexedDB;
  }
  throw new Error('IndexedDB is not available in the current environment.');
}

// ── 1. Database Lifecycle ────────────────────────────────────────

/**
 * Open or retrieve the cached IndexedDB connection for DistroTrack offline database.
 */
export async function openOfflineDb(): Promise<IDBDatabase> {
  if (activeDb) {
    return activeDb;
  }

  const idb = getIndexedDB();

  return new Promise((resolve, reject) => {
    const request = idb.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;
      const newVersion = event.newVersion;
      setupObjectStores(db, oldVersion, newVersion);
    };

    request.onsuccess = () => {
      const db = request.result;
      activeDb = db;

      db.onversionchange = () => {
        db.close();
        activeDb = null;
      };

      resolve(db);
    };

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB [${OFFLINE_DB_NAME}]: ${request.error?.message}`));
    };

    request.onblocked = () => {
      console.warn(`IndexedDB [${OFFLINE_DB_NAME}] open request was blocked by an older connection.`);
    };
  });
}

/**
 * Gracefully close the active IndexedDB connection.
 */
export function closeOfflineDb(): void {
  if (activeDb) {
    activeDb.close();
    activeDb = null;
  }
}

/**
 * Clear all data from all object stores in the offline database.
 */
export async function clearOfflineDb(): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ALL_OFFLINE_STORES, 'readwrite');

    for (const storeName of ALL_OFFLINE_STORES) {
      tx.objectStore(storeName).clear();
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Failed to clear offline database: ${tx.error?.message}`));
    tx.onabort = () => reject(new Error(`Clear offline database transaction aborted: ${tx.error?.message}`));
  });
}

// ── 2. Idempotency Foundation ───────────────────────────────────

/**
 * Generate a cryptographically secure, unique idempotency key.
 * Format: DT-<UUID> (e.g. DT-9104ac06-478b-4f4b-bdab-bc30d85e9383)
 */
export function generateIdempotencyKey(prefix = 'DT'): string {
  let uuid: string;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    uuid = crypto.randomUUID();
  } else {
    // Standard RFC4122 v4 UUID generator fallback
    uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  return `${prefix}-${uuid}`;
}

// ── 3. Boundary Data Validation ─────────────────────────────────

export function validateIdempotencyKey(key: unknown): string {
  if (!key || typeof key !== 'string' || key.trim().length < 8) {
    throw new Error('Validation Error: A valid idempotencyKey of at least 8 characters is required.');
  }
  return key.trim();
}

export function validateNumericAmount(amount: unknown, fieldName: string, allowNegative = false): number {
  const num = Number(amount);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw new Error(`Validation Error: ${fieldName} must be a valid finite number.`);
  }
  if (!allowNegative && num < 0) {
    throw new Error(`Validation Error: ${fieldName} cannot be negative.`);
  }
  return num;
}

export function validateOutboxEntry<T>(entry: OutboxEntry<T>): void {
  if (!entry.id || typeof entry.id !== 'string') {
    throw new Error('Validation Error: Outbox entry must have a non-empty string id.');
  }
  validateIdempotencyKey(entry.idempotencyKey);
  if (!entry.operationType || typeof entry.operationType !== 'string') {
    throw new Error('Validation Error: Outbox entry must have a valid operationType.');
  }
  if (!entry.entityType || typeof entry.entityType !== 'string') {
    throw new Error('Validation Error: Outbox entry must have a valid entityType.');
  }
  if (!entry.entityId || typeof entry.entityId !== 'string') {
    throw new Error('Validation Error: Outbox entry must have a valid entityId.');
  }
  if (!['pending', 'processing', 'failed', 'synced'].includes(entry.status)) {
    throw new Error(`Validation Error: Invalid outbox status [${entry.status}].`);
  }
  if (typeof entry.retryCount !== 'number' || entry.retryCount < 0) {
    throw new Error('Validation Error: Outbox retryCount must be a non-negative integer.');
  }
}

export function validateDeliveryDraft(delivery: OfflineDelivery): void {
  if (!delivery.id) throw new Error('Validation Error: Delivery must have an id.');
  if (!delivery.picklistId) throw new Error('Validation Error: Delivery must belong to a picklistId.');
  if (!delivery.partyId) throw new Error('Validation Error: Delivery must specify a partyId.');
  if (!delivery.workerId) throw new Error('Validation Error: Delivery must specify a workerId.');
  if (!Array.isArray(delivery.items)) {
    throw new Error('Validation Error: Delivery items must be an array.');
  }
}

export function validatePaymentDraft(payment: OfflinePayment): void {
  if (!payment.id) throw new Error('Validation Error: Payment must have an id.');
  if (!payment.partyId) throw new Error('Validation Error: Payment must have a partyId.');
  if (!payment.workerId) throw new Error('Validation Error: Payment must have a workerId.');
  validateNumericAmount(payment.amount, 'Payment amount', false);
  validateIdempotencyKey(payment.idempotencyKey);
  if (!['cash', 'cheque', 'credit', 'upi'].includes(payment.paymentMethod)) {
    throw new Error(`Validation Error: Invalid paymentMethod [${payment.paymentMethod}].`);
  }
}

export function validateExpenseDraft(expense: OfflineExpense): void {
  if (!expense.id) throw new Error('Validation Error: Expense must have an id.');
  if (!expense.workerId) throw new Error('Validation Error: Expense must have a workerId.');
  validateNumericAmount(expense.amount, 'Expense amount', false);
  validateIdempotencyKey(expense.idempotencyKey);
}

export function validateSessionContext(context: OfflineSessionContext): void {
  if (context.id !== 'current') {
    throw new Error('Validation Error: Session context id must be "current".');
  }
  if (!context.userId) {
    throw new Error('Validation Error: Session context must specify a userId.');
  }

  // Security check: ensure no credentials or tokens accidentally slip into context
  const forbiddenKeys = [
    'password',
    'pin',
    'hash',
    'token',
    'access_token',
    'refresh_token',
    'secret',
    'service_role',
    'service_role_key',
  ];
  const recordKeys = Object.keys(context).map((k) => k.toLowerCase());
  for (const forbidden of forbiddenKeys) {
    if (recordKeys.includes(forbidden)) {
      throw new Error(`Security Violation: Storing credential field [${forbidden}] in IndexedDB is strictly prohibited.`);
    }
  }

  // Value inspection: verify no token strings or credentials in property values
  for (const [key, val] of Object.entries(context)) {
    if (typeof val === 'string') {
      const lower = val.toLowerCase();
      if (lower.startsWith('eyj') || lower.includes('bearer ') || lower.includes('service_role')) {
        throw new Error(`Security Violation: Value of [${key}] appears to contain credential material.`);
      }
    }
  }
}

// ── 4. Generic CRUD Primitives ──────────────────────────────────

/**
 * Retrieve a single record by primary key from an object store.
 */
export async function getRecord<T>(
  storeName: OfflineStoreName,
  key: IDBValidKey
): Promise<T | null> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve((request.result as T) ?? null);
    };

    request.onerror = () => {
      reject(new Error(`Failed to get record from [${storeName}]: ${request.error?.message}`));
    };
  });
}

/**
 * Insert or update a single record in an object store.
 */
export async function putRecord<T>(
  storeName: OfflineStoreName,
  value: T
): Promise<T> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(value);

    request.onsuccess = () => {
      resolve(value);
    };

    request.onerror = () => {
      reject(new Error(`Failed to put record in [${storeName}]: ${request.error?.message}`));
    };

    tx.onabort = () => {
      reject(new Error(`Transaction aborted on [${storeName}]: ${tx.error?.message}`));
    };
  });
}

/**
 * Delete a single record by primary key from an object store.
 */
export async function deleteRecord(
  storeName: OfflineStoreName,
  key: IDBValidKey
): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      reject(new Error(`Failed to delete record from [${storeName}]: ${request.error?.message}`));
    };
  });
}

/**
 * Retrieve all records from an object store, optionally filtering by index and key range.
 */
export async function getAllRecords<T>(
  storeName: OfflineStoreName,
  indexName?: string,
  query?: IDBValidKey | IDBKeyRange
): Promise<T[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const target = indexName ? store.index(indexName) : store;
    const request = query ? target.getAll(query) : target.getAll();

    request.onsuccess = () => {
      resolve((request.result as T[]) || []);
    };

    request.onerror = () => {
      reject(new Error(`Failed to fetch records from [${storeName}]: ${request.error?.message}`));
    };
  });
}

/**
 * Clear all records from a specific object store.
 */
export async function clearStore(storeName: OfflineStoreName): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => {
      reject(new Error(`Failed to clear store [${storeName}]: ${request.error?.message}`));
    };
  });
}

// ── 5. Transaction Safety: Atomic Record + Outbox ───────────────

/**
 * Atomically writes a local business record and its corresponding outbox mutation entry
 * in a single IndexedDB transaction. Ensures zero orphan outbox entries or lost mutations.
 */
export async function saveRecordWithOutbox<T extends { id: string }>(
  storeName: OfflineStoreName,
  record: T,
  outboxEntry: OutboxEntry
): Promise<{ record: T; outbox: OutboxEntry }> {
  validateOutboxEntry(outboxEntry);

  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName, OFFLINE_STORES.OUTBOX], 'readwrite');
    const dataStore = tx.objectStore(storeName);
    const outboxStore = tx.objectStore(OFFLINE_STORES.OUTBOX);

    dataStore.put(record);
    outboxStore.put(outboxEntry);

    tx.oncomplete = () => {
      resolve({ record, outbox: outboxEntry });
    };

    tx.onerror = () => {
      reject(new Error(`Atomic save failed for [${storeName} + outbox]: ${tx.error?.message}`));
    };

    tx.onabort = () => {
      reject(new Error(`Atomic transaction aborted for [${storeName} + outbox]: ${tx.error?.message}`));
    };
  });
}

// ── 6. Outbox Queue Primitives ──────────────────────────────────

/**
 * Add an entry to the outbox mutation queue.
 * Strictly checks that idempotencyKey is unique.
 */
export async function addOutboxEntry<T>(entry: OutboxEntry<T>): Promise<OutboxEntry<T>> {
  validateOutboxEntry(entry);

  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORES.OUTBOX, 'readwrite');
    const store = tx.objectStore(OFFLINE_STORES.OUTBOX);
    const request = store.add(entry); // .add fails if primary key or unique index already exists

    request.onsuccess = () => resolve(entry);
    request.onerror = () => {
      if (request.error?.name === 'ConstraintError') {
        reject(new Error(`Duplicate entry or idempotencyKey violation: ${entry.idempotencyKey}`));
      } else {
        reject(new Error(`Failed to add outbox entry: ${request.error?.message}`));
      }
    };
  });
}

/**
 * Query all pending outbox entries ordered for synchronization.
 */
export async function getPendingOutbox(): Promise<OutboxEntry[]> {
  const all = await getAllRecords<OutboxEntry>(OFFLINE_STORES.OUTBOX);
  return all
    .filter((entry) => entry.status === 'pending' || entry.status === 'failed')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/**
 * Update the status, retry count, or error message of an existing outbox entry.
 */
export async function updateOutboxEntry(
  id: string,
  updates: Partial<OutboxEntry>
): Promise<OutboxEntry> {
  const existing = await getRecord<OutboxEntry>(OFFLINE_STORES.OUTBOX, id);
  if (!existing) {
    throw new Error(`Outbox entry [${id}] not found.`);
  }

  const updated: OutboxEntry = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  validateOutboxEntry(updated);
  return putRecord<OutboxEntry>(OFFLINE_STORES.OUTBOX, updated);
}

/**
 * Delete a synchronized outbox entry.
 */
export async function deleteOutboxEntry(id: string): Promise<void> {
  return deleteRecord(OFFLINE_STORES.OUTBOX, id);
}

// ── 7. Synchronization Metadata Primitives ──────────────────────

/**
 * Fetch the global synchronization metadata record.
 */
export async function getSyncMetadata(): Promise<SyncMetadata> {
  const record = await getRecord<SyncMetadata>(OFFLINE_STORES.SYNC_METADATA, 'global');
  if (record) return record;

  const initial: SyncMetadata = {
    id: 'global',
    lastSuccessfulSyncAt: null,
    lastAttemptAt: null,
    lastErrorAt: null,
    pendingCount: 0,
    updatedAt: new Date().toISOString(),
  };
  await putRecord(OFFLINE_STORES.SYNC_METADATA, initial);
  return initial;
}

/**
 * Update global synchronization metadata.
 */
export async function updateSyncMetadata(updates: Partial<SyncMetadata>): Promise<SyncMetadata> {
  const current = await getSyncMetadata();
  const updated: SyncMetadata = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  return putRecord<SyncMetadata>(OFFLINE_STORES.SYNC_METADATA, updated);
}

// ── 8. User / Session Isolation & Safe Logout ───────────────────

/**
 * Get current cached offline session context.
 */
export async function getSessionContext(): Promise<OfflineSessionContext | null> {
  return getRecord<OfflineSessionContext>(OFFLINE_STORES.SESSION_CONTEXT, 'current');
}

/**
 * Set current cached offline session context.
 */
export async function setSessionContext(
  context: Omit<OfflineSessionContext, 'id' | 'updatedAt'>
): Promise<OfflineSessionContext> {
  const fullContext: OfflineSessionContext = {
    ...context,
    id: 'current',
    updatedAt: new Date().toISOString(),
  };
  validateSessionContext(fullContext);
  return putRecord<OfflineSessionContext>(OFFLINE_STORES.SESSION_CONTEXT, fullContext);
}

/**
 * Verifies that the local offline storage corresponds to the currently authenticated user.
 * If a different user identity is detected, wipes the previous user's cached operational
 * data while preserving any unsynced outbox entries to prevent cross-user data leakage.
 */
export async function verifySessionIsolation(
  currentUserId: string,
  currentWorkerId: string | null = null,
  role = 'worker'
): Promise<{ valid: boolean; previousUserId?: string }> {
  const existing = await getSessionContext();

  if (!existing) {
    await setSessionContext({
      userId: currentUserId,
      workerId: currentWorkerId,
      role,
      sessionStartedAt: new Date().toISOString(),
      lastAuthenticatedAt: new Date().toISOString(),
    });
    return { valid: true };
  }

  if (existing.userId === currentUserId) {
    await setSessionContext({
      ...existing,
      workerId: currentWorkerId,
      role,
      lastAuthenticatedAt: new Date().toISOString(),
    });
    return { valid: true };
  }

  // Different user detected: protect privacy by clearing operational cache
  const previousUserId = existing.userId;
  const pending = await getPendingOutbox();

  // Clear operational caches of previous user
  await Promise.all([
    clearStore(OFFLINE_STORES.ROUTES),
    clearStore(OFFLINE_STORES.PICKLISTS),
    clearStore(OFFLINE_STORES.PARTIES),
    clearStore(OFFLINE_STORES.PRODUCTS),
    clearStore(OFFLINE_STORES.DELIVERIES),
    clearStore(OFFLINE_STORES.PAYMENTS),
    clearStore(OFFLINE_STORES.RETURNS),
    clearStore(OFFLINE_STORES.EXPENSES),
  ]);

  // Set new session context
  await setSessionContext({
    userId: currentUserId,
    workerId: currentWorkerId,
    role,
    sessionStartedAt: new Date().toISOString(),
    lastAuthenticatedAt: new Date().toISOString(),
  });

  console.warn(
    `[Offline DB] Switched authenticated user from ${previousUserId} to ${currentUserId}. ` +
      `Operational cache cleared. Outbox retained ${pending.length} pending operations.`
  );

  return { valid: false, previousUserId };
}

/**
 * Handles clean logout without destroying un-synced offline work.
 * Clears session_context and transient caches, while safely preserving pending outbox entries.
 */
export async function handleOfflineLogout(
  preservePendingOutbox = true
): Promise<{ outboxPreservedCount: number }> {
  const pending = await getPendingOutbox();

  await deleteRecord(OFFLINE_STORES.SESSION_CONTEXT, 'current');

  // Clear transient operational caches
  await Promise.all([
    clearStore(OFFLINE_STORES.ROUTES),
    clearStore(OFFLINE_STORES.PICKLISTS),
    clearStore(OFFLINE_STORES.PARTIES),
    clearStore(OFFLINE_STORES.PRODUCTS),
    clearStore(OFFLINE_STORES.DELIVERIES),
    clearStore(OFFLINE_STORES.PAYMENTS),
    clearStore(OFFLINE_STORES.RETURNS),
    clearStore(OFFLINE_STORES.EXPENSES),
  ]);

  if (!preservePendingOutbox) {
    await clearStore(OFFLINE_STORES.OUTBOX);
    await clearStore(OFFLINE_STORES.SYNC_METADATA);
    return { outboxPreservedCount: 0 };
  }

  return { outboxPreservedCount: pending.length };
}
