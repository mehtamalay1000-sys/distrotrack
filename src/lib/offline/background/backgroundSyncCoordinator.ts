// ================================================================
// DistroTrack v2 — Stage 9D: Background Synchronization Coordinator
// File: src/lib/offline/background/backgroundSyncCoordinator.ts
// ================================================================

import {
  syncPendingOutbox,
  getAuthenticatedSession,
} from '../sync/index.ts';
import type { SyncBatchResult } from '../sync/syncTypes.ts';
import {
  BACKGROUND_SYNC_TAG,
  type SyncTriggerReason,
  type BackgroundSyncOptions,
  type BackgroundSyncStatus,
} from './backgroundTypes.ts';
import {
  setupReconnectTrigger,
  setupVisibilityTrigger,
  setupFocusTrigger,
  setupServiceWorkerMessageTrigger,
} from './backgroundSyncTriggers.ts';
import {
  detectBackgroundSyncCapabilities,
  registerServiceWorker,
  requestBackgroundSyncRegistration,
} from './backgroundSyncRegistration.ts';

// ── Coordinator Singleton State ─────────────────────────────────
let isInitialized = false;
let activeWorkerId: string | null = null;
let activeOptions: BackgroundSyncOptions = {};
let cleanupListeners: Array<() => void> = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let debounceResolvers: Array<(res: SyncBatchResult) => void> = [];

let isSyncing = false;
let queuedTriggerReason: SyncTriggerReason | null = null;
let coalescedCount = 0;
let lastTriggerReason: SyncTriggerReason | null = null;
let lastTriggerAt: string | null = null;
let lastCompletedAt: string | null = null;
let lastResult: SyncBatchResult | null = null;
let inFlightPromise: Promise<SyncBatchResult> | null = null;

/**
 * Single entry point to request synchronization from any trigger source.
 * Coalesces concurrent and rapid repeated triggers into a single effective
 * Stage 9B sync execution without creating competing loops.
 */
export async function requestBackgroundSync(
  reason: SyncTriggerReason,
  immediate = false
): Promise<SyncBatchResult> {
  lastTriggerReason = reason;
  lastTriggerAt = new Date().toISOString();

  // 1. If a sync is actively processing, coalesce this trigger for follow-up drain
  if (isSyncing) {
    queuedTriggerReason = reason;
    coalescedCount++;
    if (inFlightPromise) {
      return inFlightPromise;
    }
  }

  // 2. Debounce near-simultaneous triggers (reconnect + focus + visibility)
  const debounceDelay = immediate ? 0 : (activeOptions.debounceDelayMs ?? 150);

  if (debounceDelay > 0 && !isSyncing) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      coalescedCount++;
    }

    return new Promise<SyncBatchResult>((resolve) => {
      debounceResolvers.push(resolve);
      debounceTimer = setTimeout(async () => {
        debounceTimer = null;
        const currentResolvers = debounceResolvers;
        debounceResolvers = [];
        const res = await executeCoordinatedSync(reason);
        for (const resolver of currentResolvers) {
          try {
            resolver(res);
          } catch {
            // Ignore error
          }
        }
      }, debounceDelay);
    });
  }

  return executeCoordinatedSync(reason);
}

/**
 * Internal execution pipeline delegating strictly to Stage 9B.
 */
async function executeCoordinatedSync(reason: SyncTriggerReason): Promise<SyncBatchResult> {
  // If already syncing, preserve queued trigger and return in-flight promise
  if (isSyncing && inFlightPromise) {
    queuedTriggerReason = reason;
    coalescedCount++;
    return inFlightPromise;
  }

  // Check authenticated session before proceeding
  const session = await getAuthenticatedSession();
  if (!session) {
    const emptyResult: SyncBatchResult = {
      totalProcessed: 0,
      succeeded: 0,
      failed: 0,
      deferred: 0,
      results: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    return emptyResult;
  }

  isSyncing = true;

  const runPromise = (async () => {
    try {
      // Delegate directly to Stage 9B authoritative sync engine
      const result = await syncPendingOutbox();
      lastResult = result;
      lastCompletedAt = new Date().toISOString();

      // If background sync is supported, re-arm registration for next offline cycle
      if (activeOptions.enableBackgroundSyncApi !== false) {
        void requestBackgroundSyncRegistration(activeOptions.syncTag || BACKGROUND_SYNC_TAG);
      }

      return result;
    } finally {
      isSyncing = false;
      inFlightPromise = null;

      // Drain any trigger that arrived while this sync was in flight
      if (queuedTriggerReason) {
        const nextReason = queuedTriggerReason;
        queuedTriggerReason = null;
        void executeCoordinatedSync(nextReason);
      }
    }
  })();

  inFlightPromise = runPromise;
  return runPromise;
}

/**
 * Initializes the Stage 9D Background Sync Coordinator for an authenticated worker session.
 * Safe to call multiple times or upon React component remounts (idempotent setup).
 */
export function initializeBackgroundSync(
  workerId: string,
  options: BackgroundSyncOptions = {}
): () => void {
  if (!workerId || typeof workerId !== 'string') {
    throw new Error('Worker ID is required to initialize background synchronization.');
  }

  // If already initialized for this worker, update options and return existing cleanup
  if (isInitialized && activeWorkerId === workerId) {
    activeOptions = { ...activeOptions, ...options };
    return shutdownBackgroundSync;
  }

  // If switching worker identities, cleanly shut down previous instance
  if (isInitialized) {
    shutdownBackgroundSync();
  }

  isInitialized = true;
  activeWorkerId = workerId;
  activeOptions = {
    debounceDelayMs: 150,
    syncTag: BACKGROUND_SYNC_TAG,
    enableFocusTrigger: true,
    enableVisibilityTrigger: true,
    enableReconnectTrigger: true,
    enableBackgroundSyncApi: true,
    ...options,
  };

  cleanupListeners = [];

  // 1. Reconnect Trigger (online event)
  if (activeOptions.enableReconnectTrigger !== false) {
    const unbind = setupReconnectTrigger(() => {
      void requestBackgroundSync('network-reconnected');
    });
    cleanupListeners.push(unbind);
  }

  // 2. Visibility Trigger (tab switch or screen unlock)
  if (activeOptions.enableVisibilityTrigger !== false) {
    const unbind = setupVisibilityTrigger(() => {
      void requestBackgroundSync('visibility-restored');
    });
    cleanupListeners.push(unbind);
  }

  // 3. Focus Trigger (window focus)
  if (activeOptions.enableFocusTrigger !== false) {
    const unbind = setupFocusTrigger(() => {
      void requestBackgroundSync('app-focused');
    }, 1500);
    cleanupListeners.push(unbind);
  }

  // 4. Service Worker Background Sync Message Trigger
  if (activeOptions.enableBackgroundSyncApi !== false) {
    const unbind = setupServiceWorkerMessageTrigger(() => {
      void requestBackgroundSync('background-sync');
    });
    cleanupListeners.push(unbind);

    // Register Service Worker and sync tag in background if supported
    void registerServiceWorker().then(() => {
      void requestBackgroundSyncRegistration(activeOptions.syncTag || BACKGROUND_SYNC_TAG);
    });
  }

  // 5. Worker Startup Synchronization
  // Request immediate startup sync to process any pending offline work
  void requestBackgroundSync('startup', true);

  return shutdownBackgroundSync;
}

/**
 * Completely shuts down the Background Sync Coordinator, detaching all global
 * event listeners and cancelling any active debounce timers.
 */
export function shutdownBackgroundSync(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (debounceResolvers.length > 0) {
    const emptyResult: SyncBatchResult = {
      totalProcessed: 0,
      succeeded: 0,
      failed: 0,
      deferred: 0,
      results: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    for (const resolver of debounceResolvers) {
      try {
        resolver(emptyResult);
      } catch {
        // Ignore error
      }
    }
    debounceResolvers = [];
  }

  for (const cleanup of cleanupListeners) {
    try {
      cleanup();
    } catch {
      // Ignore cleanup error
    }
  }

  cleanupListeners = [];
  isInitialized = false;
  activeWorkerId = null;
  isSyncing = false;
  queuedTriggerReason = null;
  inFlightPromise = null;
}

/**
 * Retrieves the current status and capability diagnostics of the Background Sync Coordinator.
 */
export function getBackgroundSyncStatus(): BackgroundSyncStatus {
  return {
    isInitialized,
    activeWorkerId,
    lastTriggerReason,
    lastTriggerAt,
    lastCompletedAt,
    lastResult,
    coalescedCount,
    isSyncInProgress: isSyncing,
    capability: detectBackgroundSyncCapabilities(activeOptions.syncTag || BACKGROUND_SYNC_TAG),
  };
}
