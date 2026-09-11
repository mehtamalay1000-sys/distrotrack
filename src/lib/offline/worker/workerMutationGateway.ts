// ================================================================
// DistroTrack v2 — Stage 9C: Worker Mutation Gateway
// File: src/lib/offline/worker/workerMutationGateway.ts
// ================================================================

import {
  OFFLINE_STORES,
} from '../stores.ts';
import type {
  OfflineDelivery,
  OfflinePayment,
  OfflineExpense,
  OfflinePicklist,
  OutboxEntry,
} from '../types.ts';
import {
  saveRecordWithOutbox,
  getRecord,
  generateIdempotencyKey,
  validateNumericAmount,
  validateIdempotencyKey,
} from '../db.ts';
import { syncPendingOutbox } from '../sync/index.ts';

// In-flight mutation mutex by entity ID to prevent double-click / race duplicates
const inFlightEntityMutations = new Set<string>();

export interface CompleteDeliveryOfflineInput {
  deliveryId: string;
  picklistId: string;
  partyId: string;
  invoiceId?: string | null;
  workerId: string;
  deliveredItems: Array<{
    delivery_item_id: string;
    delivered_qty: number;
    delivered_free_qty: number;
    returned_qty: number;
    returned_free_qty: number;
    damaged_qty: number;
    damaged_free_qty: number;
  }>;
  payment: {
    mode: 'cash' | 'upi' | 'cheque' | 'credit';
    amount: number;
    reference_number?: string | null;
    cheque_number?: string | null;
    cheque_date?: string | null;
    cheque_bank?: string | null;
    notes?: string | null;
  };
  payments?: Array<{
    mode: 'cash' | 'upi' | 'cheque' | 'credit';
    amount: number;
    reference_number?: string | null;
    cheque_number?: string | null;
    cheque_date?: string | null;
    cheque_bank?: string | null;
    notes?: string | null;
  }> | null;
}

export interface RecordPaymentOfflineInput {
  partyId: string;
  amount: number;
  paymentMethod: 'cash' | 'upi' | 'cheque' | 'credit';
  workerId: string;
  picklistId?: string | null;
  routeId?: string | null;
  deliveryId?: string | null;
  invoiceId?: string | null;
  reference?: string | null;
  chequeNumber?: string | null;
  chequeDate?: string | null;
  chequeBank?: string | null;
  notes?: string | null;
}

export interface CreateExpenseOfflineInput {
  category: string;
  amount: number;
  workerId: string;
  date?: string;
  paymentMethod?: 'cash' | 'upi' | 'bank' | 'other';
  description?: string | null;
  routeId?: string | null;
  picklistId?: string | null;
  receiptUrl?: string | null;
}

export interface CloseRouteOfflineInput {
  picklistId: string;
  workerId: string;
  returnItems?: Array<{
    product_id: string;
    sku: string;
    returned_qty: number;
    damaged_qty: number;
    reason?: string;
  }>;
}

/**
 * Atomically records delivery completion locally and queues a COMPLETE_DELIVERY outbox event.
 */
export async function completeDeliveryOffline(
  input: CompleteDeliveryOfflineInput
): Promise<{ delivery: OfflineDelivery; outbox: OutboxEntry }> {
  if (inFlightEntityMutations.has(input.deliveryId)) {
    throw new Error(`Delivery [${input.deliveryId}] is already being processed.`);
  }

  inFlightEntityMutations.add(input.deliveryId);

  try {
    const existing = await getRecord<OfflineDelivery>(OFFLINE_STORES.DELIVERIES, input.deliveryId);
    if (!existing) {
      throw new Error(`Offline delivery [${input.deliveryId}] not found in local storage.`);
    }

    if (existing.syncState === 'synced' && existing.status === 'delivered') {
      throw new Error(`Delivery [${input.deliveryId}] has already been finalized and synced.`);
    }

    const idempotencyKey = existing.idempotencyKey || generateIdempotencyKey();
    validateIdempotencyKey(idempotencyKey);

    // Determine status (delivered vs partial vs refused)
    let allDelivered = true;
    let allZero = true;
    let totalDeliveredAmt = 0;

    const updatedItems = existing.items.map((item) => {
      const match = input.deliveredItems.find((d) => d.delivery_item_id === item.deliveryItemId);
      if (!match) return item;

      const delQty = Number(match.delivered_qty || 0);
      const delFree = Number(match.delivered_free_qty || 0);
      const retQty = Number(match.returned_qty || 0);
      const retFree = Number(match.returned_free_qty || 0);
      const damQty = Number(match.damaged_qty || 0);
      const damFree = Number(match.damaged_free_qty || 0);

      if (delQty < item.orderedQty) allDelivered = false;
      if (delQty > 0) allZero = false;

      const lineAmt = delQty * item.rate;
      totalDeliveredAmt += lineAmt;

      return {
        ...item,
        deliveredQty: delQty,
        deliveredFreeQty: delFree,
        returnedQty: retQty,
        returnedFreeQty: retFree,
        damagedQty: damQty,
        damagedFreeQty: damFree,
        amount: lineAmt,
      };
    });

    let finalStatus: 'delivered' | 'partial' | 'refused' = 'delivered';
    if (allDelivered) {
      finalStatus = 'delivered';
    } else if (allZero) {
      finalStatus = 'refused';
    } else {
      finalStatus = 'partial';
    }

    const now = new Date().toISOString();
    const updatedDelivery: OfflineDelivery = {
      ...existing,
      status: finalStatus,
      items: updatedItems,
      paymentMode: input.payment.mode,
      collectedAmount: input.payment.mode === 'credit' ? 0 : input.payment.amount,
      deliveredAmount: totalDeliveredAmt,
      notes: input.payment.notes || existing.notes,
      updatedAt: now,
      syncState: 'pending',
      idempotencyKey,
    };

    const outboxEntry: OutboxEntry = {
      id: `outbox-${input.deliveryId}`,
      idempotencyKey,
      operationType: 'COMPLETE_DELIVERY',
      entityType: 'delivery',
      entityId: input.deliveryId,
      payload: {
        deliveryId: input.deliveryId,
        picklistId: input.picklistId,
        partyId: input.partyId,
        invoiceId: input.invoiceId || null,
        workerId: input.workerId,
        deliveredItems: input.deliveredItems,
        payment: input.payment,
        payments: input.payments || null,
      },
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
      lastAttemptAt: null,
      nextRetryAt: null,
      status: 'pending',
      errorCode: null,
      errorMessage: null,
    };

    // Atomically commit delivery + outbox in 1 IndexedDB transaction
    const res = await saveRecordWithOutbox(OFFLINE_STORES.DELIVERIES, updatedDelivery, outboxEntry);

    // Trigger Stage 9B replay in background
    void syncPendingOutbox();

    return { delivery: res.record, outbox: res.outbox };
  } finally {
    inFlightEntityMutations.delete(input.deliveryId);
  }
}

/**
 * Atomically records an offline party payment and queues a RECORD_PAYMENT outbox event.
 */
export async function recordPaymentOffline(
  input: RecordPaymentOfflineInput
): Promise<{ payment: OfflinePayment; outbox: OutboxEntry }> {
  validateNumericAmount(input.amount, 'Payment amount', false);
  if (input.amount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }

  const paymentId = `pay-${generateIdempotencyKey().replace('DT-', '')}`;
  const idempotencyKey = generateIdempotencyKey();
  validateIdempotencyKey(idempotencyKey);
  const now = new Date().toISOString();

  const newPayment: OfflinePayment = {
    id: paymentId,
    routeId: input.routeId || null,
    picklistId: input.picklistId || null,
    partyId: input.partyId,
    workerId: input.workerId,
    deliveryId: input.deliveryId || null,
    invoiceId: input.invoiceId || null,
    paymentMethod: input.paymentMethod,
    amount: input.amount,
    reference: input.reference || null,
    chequeNumber: input.chequeNumber || null,
    chequeDate: input.chequeDate || null,
    chequeBank: input.chequeBank || null,
    notes: input.notes || null,
    createdAt: now,
    syncState: 'pending',
    idempotencyKey,
  };

  const outboxEntry: OutboxEntry = {
    id: `outbox-${paymentId}`,
    idempotencyKey,
    operationType: 'RECORD_PAYMENT',
    entityType: 'payment',
    entityId: paymentId,
    payload: {
      partyId: input.partyId,
      amount: input.amount,
      paymentMethod: input.paymentMethod,
      workerId: input.workerId,
      picklistId: input.picklistId || null,
      routeId: input.routeId || null,
      deliveryId: input.deliveryId || null,
      invoiceId: input.invoiceId || null,
      reference: input.reference || null,
      chequeNumber: input.chequeNumber || null,
      chequeDate: input.chequeDate || null,
      chequeBank: input.chequeBank || null,
      notes: input.notes || null,
      paymentDate: now.split('T')[0],
    },
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    status: 'pending',
    errorCode: null,
    errorMessage: null,
  };

  const res = await saveRecordWithOutbox(OFFLINE_STORES.PAYMENTS, newPayment, outboxEntry);
  void syncPendingOutbox();
  return { payment: res.record, outbox: res.outbox };
}

/**
 * Atomically records an offline route operating expense and queues a LOG_EXPENSE outbox event.
 * Server-side authorization strictly enforces 'pending' status for workers.
 */
export async function createExpenseOffline(
  input: CreateExpenseOfflineInput
): Promise<{ expense: OfflineExpense; outbox: OutboxEntry }> {
  validateNumericAmount(input.amount, 'Expense amount', false);
  if (input.amount <= 0) {
    throw new Error('Expense amount must be greater than zero.');
  }

  const expenseId = `exp-${generateIdempotencyKey().replace('DT-', '')}`;
  const idempotencyKey = generateIdempotencyKey();
  validateIdempotencyKey(idempotencyKey);
  const now = new Date().toISOString();

  const newExpense: OfflineExpense = {
    id: expenseId,
    routeId: input.routeId || null,
    picklistId: input.picklistId || null,
    workerId: input.workerId,
    expenseType: 'route_operating',
    category: input.category,
    amount: input.amount,
    paymentMethod: input.paymentMethod || 'cash',
    description: input.description || null,
    receiptUrl: input.receiptUrl || null,
    createdAt: now,
    syncState: 'pending',
    idempotencyKey,
  };

  const outboxEntry: OutboxEntry = {
    id: `outbox-${expenseId}`,
    idempotencyKey,
    operationType: 'LOG_EXPENSE',
    entityType: 'expense',
    entityId: expenseId,
    payload: {
      category: input.category,
      amount: input.amount,
      workerId: input.workerId,
      date: input.date || now.split('T')[0],
      paymentMethod: input.paymentMethod || 'cash',
      description: input.description || null,
      routeId: input.routeId || null,
      picklistId: input.picklistId || null,
      expenseType: 'route_operating',
      receiptUrl: input.receiptUrl || null,
    },
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    status: 'pending',
    errorCode: null,
    errorMessage: null,
  };

  const res = await saveRecordWithOutbox(OFFLINE_STORES.EXPENSES, newExpense, outboxEntry);
  void syncPendingOutbox();
  return { expense: res.record, outbox: res.outbox };
}

/**
 * Atomically records a route-start action locally and queues a START_ROUTE outbox event.
 */
export async function startRouteOffline(
  picklistId: string,
  workerId: string
): Promise<{ picklist: OfflinePicklist; outbox: OutboxEntry }> {
  const existing = await getRecord<OfflinePicklist>(OFFLINE_STORES.PICKLISTS, picklistId);
  const now = new Date().toISOString();

  const picklistRecord: OfflinePicklist = existing
    ? { ...existing, status: 'in_progress', updatedAt: now }
    : {
        id: picklistId,
        routeId: null,
        workerId,
        status: 'in_progress',
        picklistDate: now.split('T')[0],
        picklistNumber: `PL-${picklistId.slice(0, 8)}`,
        totalAmount: 0,
        totalParties: 0,
        totalItems: 0,
        cachedAt: now,
        updatedAt: now,
      };

  const idempotencyKey = generateIdempotencyKey();
  const outboxEntry: OutboxEntry = {
    id: `outbox-start-${picklistId}`,
    idempotencyKey,
    operationType: 'START_ROUTE',
    entityType: 'route',
    entityId: picklistId,
    payload: {
      picklistId,
      workerId,
    },
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    status: 'pending',
    errorCode: null,
    errorMessage: null,
  };

  const res = await saveRecordWithOutbox(OFFLINE_STORES.PICKLISTS, picklistRecord, outboxEntry);
  void syncPendingOutbox();
  return { picklist: res.record, outbox: res.outbox };
}

/**
 * Atomically records an end-of-day route close request and queues a CLOSE_ROUTE outbox event.
 * Note: Never falsely claims the route is server-closed before server confirmation.
 */
export async function requestCloseRouteOffline(
  input: CloseRouteOfflineInput
): Promise<{ picklist: OfflinePicklist; outbox: OutboxEntry }> {
  const existing = await getRecord<OfflinePicklist>(OFFLINE_STORES.PICKLISTS, input.picklistId);
  const now = new Date().toISOString();

  const picklistRecord: OfflinePicklist = existing
    ? { ...existing, status: 'close_requested', updatedAt: now }
    : {
        id: input.picklistId,
        routeId: null,
        workerId: input.workerId,
        status: 'close_requested',
        picklistDate: now.split('T')[0],
        picklistNumber: `PL-${input.picklistId.slice(0, 8)}`,
        totalAmount: 0,
        totalParties: 0,
        totalItems: 0,
        cachedAt: now,
        updatedAt: now,
      };

  const idempotencyKey = generateIdempotencyKey();
  const outboxEntry: OutboxEntry = {
    id: `outbox-close-${input.picklistId}`,
    idempotencyKey,
    operationType: 'CLOSE_ROUTE',
    entityType: 'picklist',
    entityId: input.picklistId,
    payload: {
      picklistId: input.picklistId,
      workerId: input.workerId,
      returnItems: input.returnItems || [],
    },
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    status: 'pending',
    errorCode: null,
    errorMessage: null,
  };

  const res = await saveRecordWithOutbox(OFFLINE_STORES.PICKLISTS, picklistRecord, outboxEntry);
  void syncPendingOutbox();
  return { picklist: res.record, outbox: res.outbox };
}
