// ================================================================
// DistroTrack v2 — Stage 9B: Persistent Outbox & Synchronization Engine
// File: src/lib/offline/sync/syncEngine.ts
// ================================================================

import { supabase as defaultSupabase } from '../../supabase.ts';
import {
  OFFLINE_STORES,
  type OfflineStoreName,
} from '../stores.ts';
import type {
  OutboxEntry,
  OperationType,
  SyncState,
} from '../types.ts';
import {
  getAllRecords,
  getRecord,
  putRecord,
  updateOutboxEntry,
  getPendingOutbox,
  getSyncMetadata,
  updateSyncMetadata,
} from '../db.ts';
import type {
  SyncStatus,
  SyncEntryResult,
  SyncBatchResult,
  SyncEngineOptions,
  SyncStatusListener,
  RpcDispatchHandler,
  RpcDispatchResponse,
} from './syncTypes.ts';
import {
  PayloadValidationSyncError,
  UnsupportedOperationSyncError,
  BlockedMissingServerRpcSyncError,
  classifySupabaseError,
} from './syncErrors.ts';

// ── Default Constants ───────────────────────────────────────────
const DEFAULT_BASE_DELAY_MS = 2000; // 2 seconds
const DEFAULT_MAX_DELAY_MS = 300000; // 5 minutes
const DEFAULT_PROCESSING_TIMEOUT_MS = 300000; // 5 minutes lease

// ── State Variables ─────────────────────────────────────────────
let isEngineRunning = false;
let isProcessingMutex = false;
let onlineListener: (() => void) | null = null;
let offlineListener: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let customClient: any = null;
const statusListeners = new Set<SyncStatusListener>();

let engineOptions: Required<SyncEngineOptions> = {
  baseDelayMs: DEFAULT_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  processingTimeoutMs: DEFAULT_PROCESSING_TIMEOUT_MS,
  deterministicMode: false,
  customSupabaseClient: null,
  autoStartListeners: true,
  pollIntervalMs: 0,
};

// ── Client Resolution ───────────────────────────────────────────
function getClient(): any {
  if (customClient) return customClient;
  if (engineOptions.customSupabaseClient) return engineOptions.customSupabaseClient;
  return defaultSupabase;
}

export function setCustomSupabaseClient(client: any): void {
  customClient = client;
}

export function setDeterministicMode(enabled: boolean): void {
  engineOptions.deterministicMode = enabled;
}

// ── Network Connectivity Awareness ──────────────────────────────
export function isNetworkOnline(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true; // Default optimistic in non-browser runtimes
}

// ── Authenticated Session Check ─────────────────────────────────
export async function getAuthenticatedSession(): Promise<any | null> {
  try {
    const client = getClient();
    if (!client || !client.auth || typeof client.auth.getSession !== 'function') {
      return null;
    }
    const { data, error } = await client.auth.getSession();
    if (error || !data || !data.session || !data.session.user) {
      return null;
    }
    return data.session;
  } catch {
    return null;
  }
}

// ── Exponential Backoff Calculation ─────────────────────────────
export function calculateBackoffDelay(
  retryCount: number,
  baseDelayMs: number = engineOptions.baseDelayMs,
  maxDelayMs: number = engineOptions.maxDelayMs,
  deterministic: boolean = engineOptions.deterministicMode
): number {
  const count = Math.max(0, retryCount);
  const exponential = baseDelayMs * Math.pow(2, count);
  const bounded = Math.min(exponential, maxDelayMs);

  if (deterministic) {
    return bounded;
  }

  // Add ±20% jitter to prevent synchronized retry storms
  const jitterFactor = 0.8 + Math.random() * 0.4;
  return Math.round(bounded * jitterFactor);
}

// ── Sanitize Diagnostic Logging ─────────────────────────────────
export function sanitizeForLogging(obj: any): string {
  if (!obj || typeof obj !== 'object') return String(obj);
  try {
    const sanitized = { ...obj };
    const forbidden = ['pin', 'password', 'token', 'access_token', 'refresh_token', 'secret'];
    for (const key of Object.keys(sanitized)) {
      if (forbidden.some((f) => key.toLowerCase().includes(f))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    return JSON.stringify(sanitized);
  } catch {
    return '[Unserializable]';
  }
}

// ── Fixed RPC Dispatch Handlers ─────────────────────────────────

async function dispatchStartRoute(
  entry: OutboxEntry,
  client: any
): Promise<RpcDispatchResponse> {
  const p = entry.payload as any;
  if (!p || !p.picklistId) {
    throw new PayloadValidationSyncError('START_ROUTE payload missing required picklistId.');
  }

  const { data, error } = await client.rpc('start_route_with_load', {
    p_picklist_id: p.picklistId,
    p_worker_id: p.workerId || null,
  });

  if (error) throw classifySupabaseError(error);

  const alreadyApplied = Boolean(data && data.already_started);
  return { success: true, data, alreadyApplied };
}

async function dispatchCompleteDelivery(
  entry: OutboxEntry,
  client: any
): Promise<RpcDispatchResponse> {
  const p = entry.payload as any;
  if (!p || !p.deliveryId) {
    throw new PayloadValidationSyncError('COMPLETE_DELIVERY payload missing deliveryId.');
  }
  if (!p.workerId) {
    throw new PayloadValidationSyncError('COMPLETE_DELIVERY payload missing workerId.');
  }
  if (!Array.isArray(p.deliveredItems)) {
    throw new PayloadValidationSyncError('COMPLETE_DELIVERY payload deliveredItems must be an array.');
  }

  const payment = p.payment || { mode: 'cash', amount: 0 };

  const { data, error } = await client.rpc('complete_delivery_with_ledger', {
    p_delivery_id: p.deliveryId,
    p_worker_id: p.workerId,
    p_items: p.deliveredItems,
    p_payment_mode: payment.mode || 'cash',
    p_payment_amount: payment.amount || 0,
    p_reference_number: payment.reference_number || null,
    p_cheque_number: payment.cheque_number || null,
    p_cheque_date: payment.cheque_date || null,
    p_cheque_bank: payment.cheque_bank || null,
    p_notes: payment.notes || null,
    p_payments: Array.isArray(p.payments) && p.payments.length > 0 ? p.payments : null,
  });

  if (error) throw classifySupabaseError(error);

  const alreadyApplied = Boolean(data && data.already_completed);
  return { success: true, data, alreadyApplied };
}

async function dispatchRecordPayment(
  entry: OutboxEntry,
  client: any
): Promise<RpcDispatchResponse> {
  const p = entry.payload as any;
  if (!p || !p.partyId) {
    throw new PayloadValidationSyncError('RECORD_PAYMENT payload missing partyId.');
  }
  if (p.amount === undefined || Number(p.amount) <= 0) {
    throw new PayloadValidationSyncError('RECORD_PAYMENT amount must be a positive number.');
  }
  if (!entry.idempotencyKey) {
    throw new PayloadValidationSyncError('RECORD_PAYMENT missing idempotencyKey.');
  }

  const { data, error } = await client.rpc('record_party_payment_with_ledger', {
    p_party_id: p.partyId,
    p_amount: Number(p.amount),
    p_payment_mode: p.paymentMethod || p.payment_mode || 'cash',
    p_worker_id: p.workerId || null,
    p_invoice_id: p.invoiceId || null,
    p_delivery_id: p.deliveryId || null,
    p_picklist_id: p.picklistId || null,
    p_route_id: p.routeId || null,
    p_reference_number: p.reference || p.reference_number || null,
    p_cheque_number: p.chequeNumber || p.cheque_number || null,
    p_cheque_date: p.chequeDate || p.cheque_date || null,
    p_cheque_bank: p.chequeBank || p.cheque_bank || null,
    p_notes: p.notes || null,
    p_payment_date: p.paymentDate || p.payment_date || new Date().toISOString().split('T')[0],
    p_idempotency_key: entry.idempotencyKey,
  });

  if (error) throw classifySupabaseError(error);

  const alreadyApplied = Boolean(data && data.already_recorded);
  return { success: true, data, alreadyApplied };
}

async function dispatchLogExpense(
  entry: OutboxEntry,
  client: any
): Promise<RpcDispatchResponse> {
  const p = entry.payload as any;
  if (!p || !p.category) {
    throw new PayloadValidationSyncError('LOG_EXPENSE payload missing category.');
  }
  if (p.amount === undefined || Number(p.amount) <= 0) {
    throw new PayloadValidationSyncError('LOG_EXPENSE amount must be a positive number.');
  }
  if (!entry.idempotencyKey) {
    throw new PayloadValidationSyncError('LOG_EXPENSE missing idempotencyKey.');
  }

  const { data, error } = await client.rpc('create_expense_with_idempotency', {
    p_category: p.category,
    p_amount: Number(p.amount),
    p_date: p.date || new Date().toISOString().split('T')[0],
    p_payment_method: p.paymentMethod || p.payment_method || 'cash',
    p_description: p.description || null,
    p_worker_id: p.workerId || null,
    p_route_id: p.routeId || null,
    p_picklist_id: p.picklistId || null,
    p_expense_type: p.expenseType || 'route_operating',
    p_status: 'pending', // Server strictly enforces pending for non-admins
    p_receipt_url: p.receiptUrl || null,
    p_visible_to_worker: true,
    p_idempotency_key: entry.idempotencyKey,
  });

  if (error) throw classifySupabaseError(error);

  const alreadyApplied = Boolean(data && data.already_recorded);
  return { success: true, data, alreadyApplied };
}

async function dispatchCloseRoute(
  entry: OutboxEntry,
  client: any
): Promise<RpcDispatchResponse> {
  const p = entry.payload as any;
  if (!p || !p.picklistId) {
    throw new PayloadValidationSyncError('CLOSE_ROUTE payload missing picklistId.');
  }

  const { data, error } = await client.rpc('close_route_with_reconciliation', {
    p_picklist_id: p.picklistId,
    p_worker_id: p.workerId || null,
    p_return_items: Array.isArray(p.returnItems) ? p.returnItems : [],
  });

  if (error) throw classifySupabaseError(error);

  const alreadyApplied = Boolean(data && data.already_completed);
  return { success: true, data, alreadyApplied };
}

async function dispatchRecordReturn(
  _entry: OutboxEntry,
  _client: any
): Promise<RpcDispatchResponse> {
  // Standalone RECORD_RETURN has no independent RPC in Stage 9B; items return through COMPLETE_DELIVERY or CLOSE_ROUTE
  throw new BlockedMissingServerRpcSyncError(
    'RECORD_RETURN has no dedicated standalone server RPC in Stage 9B. Route stock returns flow via COMPLETE_DELIVERY or CLOSE_ROUTE.'
  );
}

// Fixed RPC allowlist mapping
const RPC_ALLOWLIST: Record<OperationType, RpcDispatchHandler> = {
  START_ROUTE: dispatchStartRoute,
  COMPLETE_DELIVERY: dispatchCompleteDelivery,
  RECORD_PAYMENT: dispatchRecordPayment,
  LOG_EXPENSE: dispatchLogExpense,
  CLOSE_ROUTE: dispatchCloseRoute,
  RECORD_RETURN: dispatchRecordReturn,
};

// ── Update Local Entity Sync State ──────────────────────────────
async function updateLocalEntitySyncState(
  entityType: string,
  entityId: string,
  state: SyncState
): Promise<void> {
  try {
    let storeName: OfflineStoreName | null = null;
    switch (entityType) {
      case 'delivery':
        storeName = OFFLINE_STORES.DELIVERIES;
        break;
      case 'payment':
        storeName = OFFLINE_STORES.PAYMENTS;
        break;
      case 'return':
        storeName = OFFLINE_STORES.RETURNS;
        break;
      case 'expense':
        storeName = OFFLINE_STORES.EXPENSES;
        break;
      default:
        return;
    }

    const record = await getRecord<any>(storeName, entityId);
    if (record) {
      record.syncState = state;
      record.updatedAt = new Date().toISOString();
      await putRecord(storeName, record);
    }
  } catch {
    // Non-fatal: operational record may have been cleared
  }
}

// ── Stale Processing Recovery ───────────────────────────────────

/**
 * Recovers outbox mutations that were left in 'processing' state due to a tab crash,
 * browser restart, or unexpected interruption.
 */
export async function recoverStaleProcessingEntries(
  timeoutMs: number = engineOptions.processingTimeoutMs
): Promise<number> {
  const all = await getAllRecords<OutboxEntry>(OFFLINE_STORES.OUTBOX);
  const now = Date.now();
  let recoveredCount = 0;

  for (const entry of all) {
    if (entry.status === 'processing') {
      const lastAttempt = entry.lastAttemptAt ? new Date(entry.lastAttemptAt).getTime() : 0;
      if (!lastAttempt || now - lastAttempt > timeoutMs) {
        await updateOutboxEntry(entry.id, {
          status: 'pending',
          errorCode: 'STALE_LEASE_RECOVERED',
          errorMessage: 'Recovered from stale processing lease timeout.',
        });
        recoveredCount++;
      }
    }
  }

  return recoveredCount;
}

// ── Single Outbox Entry Replay ──────────────────────────────────

/**
 * Synchronize a single outbox entry against authoritative Supabase RPCs.
 */
export async function syncOneOutboxEntry(id: string): Promise<SyncEntryResult> {
  const entry = await getRecord<OutboxEntry>(OFFLINE_STORES.OUTBOX, id);
  if (!entry) {
    throw new Error(`Outbox entry [${id}] not found.`);
  }

  const client = getClient();
  const attemptTimestamp = new Date().toISOString();

  // 1. Mark as processing
  await updateOutboxEntry(id, {
    status: 'processing',
    lastAttemptAt: attemptTimestamp,
  });

  try {
    // 2. Dispatcher allowlist check
    const handler = RPC_ALLOWLIST[entry.operationType];
    if (!handler) {
      throw new UnsupportedOperationSyncError(
        `Operation type [${entry.operationType}] is not in the allowed RPC dispatch list.`
      );
    }

    // 3. Execute RPC
    const response = await handler(entry, client);

    // 4. Mark synced
    await updateOutboxEntry(id, {
      status: 'synced',
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    });

    await updateLocalEntitySyncState(entry.entityType, entry.entityId, 'synced');

    return {
      entryId: entry.id,
      idempotencyKey: entry.idempotencyKey,
      operationType: entry.operationType,
      entityType: entry.entityType,
      success: true,
      status: 'synced',
      retryCount: entry.retryCount,
      nextRetryAt: null,
      error: null,
      idempotentServerMatch: Boolean(response.alreadyApplied),
    };
  } catch (rawErr) {
    const syncErr = classifySupabaseError(rawErr);

    if (syncErr.code === 'AUTH_REQUIRED') {
      // Non-permanent: keep entry pending without incrementing retry count
      await updateOutboxEntry(id, {
        status: 'pending',
        errorCode: 'AUTH_REQUIRED',
        errorMessage: syncErr.message,
      });

      return {
        entryId: entry.id,
        idempotencyKey: entry.idempotencyKey,
        operationType: entry.operationType,
        entityType: entry.entityType,
        success: false,
        status: 'pending',
        retryCount: entry.retryCount,
        nextRetryAt: null,
        error: { code: syncErr.code, message: syncErr.message, retryable: true },
        idempotentServerMatch: false,
      };
    }

    if (syncErr.retryable) {
      // Retryable network or rate-limit error: increment retry count and schedule backoff
      const newRetryCount = (entry.retryCount || 0) + 1;
      const delayMs = calculateBackoffDelay(
        newRetryCount,
        engineOptions.baseDelayMs,
        engineOptions.maxDelayMs,
        engineOptions.deterministicMode
      );
      const nextRetryAt = new Date(Date.now() + delayMs).toISOString();

      await updateOutboxEntry(id, {
        status: 'pending',
        retryCount: newRetryCount,
        nextRetryAt,
        errorCode: syncErr.code,
        errorMessage: syncErr.message,
      });

      return {
        entryId: entry.id,
        idempotencyKey: entry.idempotencyKey,
        operationType: entry.operationType,
        entityType: entry.entityType,
        success: false,
        status: 'pending',
        retryCount: newRetryCount,
        nextRetryAt,
        error: { code: syncErr.code, message: syncErr.message, retryable: true },
        idempotentServerMatch: false,
      };
    }

    // Permanent failure: mark failed
    await updateOutboxEntry(id, {
      status: 'failed',
      errorCode: syncErr.code,
      errorMessage: syncErr.message,
    });

    await updateLocalEntitySyncState(entry.entityType, entry.entityId, 'failed');

    return {
      entryId: entry.id,
      idempotencyKey: entry.idempotencyKey,
      operationType: entry.operationType,
      entityType: entry.entityType,
      success: false,
      status: 'failed',
      retryCount: entry.retryCount,
      nextRetryAt: null,
      error: { code: syncErr.code, message: syncErr.message, retryable: false },
      idempotentServerMatch: false,
    };
  }
}

// ── Batch Synchronization Loop ──────────────────────────────────

/**
 * Sequentially drains and synchronizes pending outbox mutations in FIFO order.
 */
export async function syncPendingOutbox(): Promise<SyncBatchResult> {
  const startedAt = new Date().toISOString();
  const results: SyncEntryResult[] = [];

  // 1. In-process mutex check
  if (isProcessingMutex) {
    return {
      totalProcessed: 0,
      succeeded: 0,
      failed: 0,
      deferred: 0,
      results: [],
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  isProcessingMutex = true;
  notifyStatusListeners();

  try {
    // 2. Connectivity check
    if (!isNetworkOnline()) {
      return {
        totalProcessed: 0,
        succeeded: 0,
        failed: 0,
        deferred: 0,
        results: [],
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    // 3. Stale processing lease recovery
    await recoverStaleProcessingEntries();

    // 4. Authenticated session check
    const session = await getAuthenticatedSession();
    if (!session) {
      const pending = await getPendingOutbox();
      return {
        totalProcessed: 0,
        succeeded: 0,
        failed: 0,
        deferred: pending.length,
        results: [],
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    // 5. Query pending outbox entries (FIFO order, strictly pending status)
    const allOutbox = await getPendingOutbox();
    const pendingEntries = allOutbox.filter((e) => e.status === 'pending');
    const now = Date.now();

    for (const entry of pendingEntries) {
      // Respect exponential backoff delay
      if (entry.nextRetryAt && new Date(entry.nextRetryAt).getTime() > now) {
        continue;
      }

      // Replay single mutation
      const result = await syncOneOutboxEntry(entry.id);
      results.push(result);

      if (result.success) {
        // Continue sequentially to next operation
        continue;
      }

      // If retryable failure occurred, STOP queue progression to preserve deterministic dependencies
      if (result.error && result.error.retryable) {
        break;
      }
    }

    // 6. Update Sync Metadata
    const remainingPending = await getPendingOutbox();
    const hasSuccess = results.some((r) => r.success);
    const hasError = results.some((r) => !r.success);

    await updateSyncMetadata({
      lastAttemptAt: new Date().toISOString(),
      ...(hasSuccess ? { lastSuccessfulSyncAt: new Date().toISOString() } : {}),
      ...(hasError ? { lastErrorAt: new Date().toISOString() } : {}),
      pendingCount: remainingPending.length,
    });

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success && r.status === 'failed').length;
    const deferred = results.filter((r) => !r.success && r.status === 'pending').length;

    return {
      totalProcessed: results.length,
      succeeded,
      failed,
      deferred,
      results,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } finally {
    isProcessingMutex = false;
    notifyStatusListeners();
  }
}

// ── Manual Retry Capability ─────────────────────────────────────

/**
 * Manually reset a permanently failed outbox entry back to 'pending' state.
 */
export async function retryFailedOutboxEntry(id: string): Promise<OutboxEntry> {
  const existing = await getRecord<OutboxEntry>(OFFLINE_STORES.OUTBOX, id);
  if (!existing) {
    throw new Error(`Outbox entry [${id}] not found.`);
  }

  if (existing.status !== 'failed') {
    throw new Error(`Only failed entries can be manually retried. Current status: [${existing.status}]`);
  }

  const updated: OutboxEntry = {
    ...existing,
    status: 'pending',
    nextRetryAt: null,
    errorCode: null,
    errorMessage: null,
    updatedAt: new Date().toISOString(),
  };

  await putRecord<OutboxEntry>(OFFLINE_STORES.OUTBOX, updated);
  notifyStatusListeners();
  return updated;
}

// ── Diagnostics & Status ────────────────────────────────────────

/**
 * Retrieve a comprehensive snapshot of synchronization health and queue size.
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  const all = await getAllRecords<OutboxEntry>(OFFLINE_STORES.OUTBOX);
  const meta = await getSyncMetadata();
  const session = await getAuthenticatedSession();

  const pendingCount = all.filter((e) => e.status === 'pending').length;
  const processingCount = all.filter((e) => e.status === 'processing').length;
  const failedCount = all.filter((e) => e.status === 'failed').length;

  return {
    isRunning: isEngineRunning,
    isProcessing: isProcessingMutex,
    pendingCount,
    processingCount,
    failedCount,
    lastAttemptAt: meta.lastAttemptAt,
    lastSuccessfulSyncAt: meta.lastSuccessfulSyncAt,
    lastErrorAt: meta.lastErrorAt,
    isOnline: isNetworkOnline(),
    hasAuthSession: Boolean(session),
  };
}

export function subscribeSyncStatus(listener: SyncStatusListener): () => void {
  statusListeners.add(listener);
  void getSyncStatus().then((status) => listener(status));
  return () => {
    statusListeners.delete(listener);
  };
}

function notifyStatusListeners(): void {
  if (statusListeners.size === 0) return;
  void getSyncStatus().then((status) => {
    for (const listener of statusListeners) {
      try {
        listener(status);
      } catch {
        // Ignore listener error
      }
    }
  });
}

// ── Engine Lifecycle ────────────────────────────────────────────

export function isSyncEngineRunning(): boolean {
  return isEngineRunning;
}

/**
 * Start the synchronization engine, registering online/offline event listeners.
 */
export async function startSyncEngine(options: SyncEngineOptions = {}): Promise<void> {
  if (isEngineRunning) {
    return;
  }

  engineOptions = {
    baseDelayMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    processingTimeoutMs: options.processingTimeoutMs ?? DEFAULT_PROCESSING_TIMEOUT_MS,
    deterministicMode: options.deterministicMode ?? false,
    customSupabaseClient: options.customSupabaseClient ?? null,
    autoStartListeners: options.autoStartListeners ?? true,
    pollIntervalMs: options.pollIntervalMs ?? 0,
  };

  if (options.customSupabaseClient) {
    customClient = options.customSupabaseClient;
  }

  isEngineRunning = true;

  if (engineOptions.autoStartListeners && typeof window !== 'undefined') {
    onlineListener = () => {
      void syncPendingOutbox();
    };
    offlineListener = () => {
      notifyStatusListeners();
    };

    window.addEventListener('online', onlineListener);
    window.addEventListener('offline', offlineListener);
  }

  if (engineOptions.pollIntervalMs > 0) {
    pollTimer = setInterval(() => {
      void syncPendingOutbox();
    }, engineOptions.pollIntervalMs);
  }

  notifyStatusListeners();
}

/**
 * Stop the synchronization engine and remove event listeners.
 */
export function stopSyncEngine(): void {
  if (!isEngineRunning) {
    return;
  }

  if (typeof window !== 'undefined') {
    if (onlineListener) {
      window.removeEventListener('online', onlineListener);
      onlineListener = null;
    }
    if (offlineListener) {
      window.removeEventListener('offline', offlineListener);
      offlineListener = null;
    }
  }

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  isEngineRunning = false;
  isProcessingMutex = false;
  notifyStatusListeners();
}
