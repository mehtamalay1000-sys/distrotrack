// ================================================================
// DistroTrack v2 — Stage 9D: Background Synchronization Types
// File: src/lib/offline/background/backgroundTypes.ts
// ================================================================

import type { SyncBatchResult } from '../sync/syncTypes.ts';

/**
 * Enumeration of all valid triggers that can request background synchronization.
 */
export type SyncTriggerReason =
  | 'network-reconnected'
  | 'visibility-restored'
  | 'app-focused'
  | 'startup'
  | 'manual'
  | 'background-sync'
  | 'scheduled-retry';

/**
 * Standard stable tag used for the Service Worker Background Sync API.
 */
export const BACKGROUND_SYNC_TAG = 'distrotrack-outbox-sync';

/**
 * Message identifier posted from the Service Worker to client windows
 * when a background sync event fires.
 */
export const SW_BACKGROUND_SYNC_MESSAGE = 'DISTROTRACK_BACKGROUND_SYNC_TRIGGER';

/**
 * Browser capability diagnostics for background execution.
 */
export interface BackgroundSyncCapability {
  hasServiceWorker: boolean;
  hasSyncManager: boolean;
  isBackgroundSyncSupported: boolean;
  registrationTag: string;
}

/**
 * Configuration options for the Background Sync Coordinator.
 */
export interface BackgroundSyncOptions {
  /**
   * Debounce delay (in ms) to coalesce rapid repeated triggers (e.g. focus).
   * Default: 200ms.
   */
  debounceDelayMs?: number;

  /**
   * Stable tag for SyncManager registration.
   * Default: 'distrotrack-outbox-sync'.
   */
  syncTag?: string;

  /**
   * Whether to automatically register window focus listener.
   * Default: true.
   */
  enableFocusTrigger?: boolean;

  /**
   * Whether to automatically register document visibility listener.
   * Default: true.
   */
  enableVisibilityTrigger?: boolean;

  /**
   * Whether to automatically register network online listener.
   * Default: true.
   */
  enableReconnectTrigger?: boolean;

  /**
   * Whether to attempt Service Worker Background Sync registration if supported.
   * Default: true.
   */
  enableBackgroundSyncApi?: boolean;
}

/**
 * Runtime snapshot of the Background Sync Coordinator state.
 */
export interface BackgroundSyncStatus {
  isInitialized: boolean;
  activeWorkerId: string | null;
  lastTriggerReason: SyncTriggerReason | null;
  lastTriggerAt: string | null;
  lastCompletedAt: string | null;
  lastResult: SyncBatchResult | null;
  coalescedCount: number;
  isSyncInProgress: boolean;
  capability: BackgroundSyncCapability;
}
