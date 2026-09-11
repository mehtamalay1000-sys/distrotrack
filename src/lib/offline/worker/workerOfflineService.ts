// ================================================================
// DistroTrack v2 — Stage 9C: Worker Offline Coordinator Service
// File: src/lib/offline/worker/workerOfflineService.ts
// ================================================================

import {
  hydrateWorkerRoute,
  getCachedWorkerRoute,
  isRouteOfflineReady,
  type OfflineCachedRouteBundle,
} from './workerHydrationService.ts';
import {
  completeDeliveryOffline,
  recordPaymentOffline,
  createExpenseOffline,
  startRouteOffline,
  requestCloseRouteOffline,
  type CompleteDeliveryOfflineInput,
  type RecordPaymentOfflineInput,
  type CreateExpenseOfflineInput,
  type CloseRouteOfflineInput,
} from './workerMutationGateway.ts';
import {
  isNetworkOnline,
  getSyncStatus,
  retryFailedOutboxEntry,
  syncPendingOutbox,
} from '../sync/index.ts';
import {
  getRecord,
  getAllRecords,
} from '../db.ts';
import { OFFLINE_STORES } from '../stores.ts';
import type { OfflineDelivery, OutboxEntry } from '../types.ts';

/**
 * Orchestrates worker route retrieval: tries network hydration when online,
 * falls back to local IndexedDB cached operational state when offline.
 */
export async function getWorkerOperationalRoute(
  workerId: string,
  workerName?: string
): Promise<OfflineCachedRouteBundle | null> {
  if (!workerId) return null;

  if (isNetworkOnline()) {
    try {
      await hydrateWorkerRoute(workerId, workerName);
    } catch (err) {
      console.warn('[Offline Worker] Online hydration failed, falling back to local cache:', err);
    }
  }

  return getCachedWorkerRoute(workerId);
}

/**
 * Get a specific delivery from local storage.
 */
export async function getWorkerOfflineDelivery(
  deliveryId: string
): Promise<OfflineDelivery | null> {
  return getRecord<OfflineDelivery>(OFFLINE_STORES.DELIVERIES, deliveryId);
}

/**
 * Get all failed mutations that require worker/supervisor attention.
 */
export async function getFailedWorkerMutations(): Promise<OutboxEntry[]> {
  const all = await getAllRecords<OutboxEntry>(OFFLINE_STORES.OUTBOX);
  return all.filter((e) => e.status === 'failed');
}

/**
 * Retries a failed mutation through Stage 9B.
 */
export async function retryWorkerMutation(outboxId: string): Promise<OutboxEntry> {
  const retried = await retryFailedOutboxEntry(outboxId);
  void syncPendingOutbox();
  return retried;
}

export {
  hydrateWorkerRoute,
  getCachedWorkerRoute,
  isRouteOfflineReady,
  completeDeliveryOffline,
  recordPaymentOffline,
  createExpenseOffline,
  startRouteOffline,
  requestCloseRouteOffline,
  getSyncStatus,
};

export type {
  OfflineCachedRouteBundle,
  CompleteDeliveryOfflineInput,
  RecordPaymentOfflineInput,
  CreateExpenseOfflineInput,
  CloseRouteOfflineInput,
};
