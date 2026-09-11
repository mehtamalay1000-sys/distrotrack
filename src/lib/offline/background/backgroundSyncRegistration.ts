// ================================================================
// DistroTrack v2 — Stage 9D: Background Sync Registration
// File: src/lib/offline/background/backgroundSyncRegistration.ts
// ================================================================

import {
  BACKGROUND_SYNC_TAG,
  type BackgroundSyncCapability,
} from './backgroundTypes.ts';

/**
 * Detects browser capabilities for Service Worker and Background Sync API.
 */
export function detectBackgroundSyncCapabilities(
  syncTag: string = BACKGROUND_SYNC_TAG
): BackgroundSyncCapability {
  const hasServiceWorker =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const hasSyncManager =
    typeof window !== 'undefined' && 'SyncManager' in window;

  return {
    hasServiceWorker,
    hasSyncManager,
    isBackgroundSyncSupported: hasServiceWorker && hasSyncManager,
    registrationTag: syncTag,
  };
}

/**
 * Registers the Service Worker script if supported by the browser runtime.
 * Fails safely without throwing if Service Workers are unavailable or registration fails.
 */
export async function registerServiceWorker(
  swUrl = '/sw.js'
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: '/',
    });
    return registration;
  } catch (err) {
    console.warn('[Background Sync] Service Worker registration skipped or unavailable:', err);
    return null;
  }
}

/**
 * Requests the browser to register a Background Sync tag with the active Service Worker.
 * When connectivity returns or the browser schedules background work,
 * the Service Worker will receive a 'sync' event with this tag.
 *
 * If the browser does not support Background Sync, returns false safely.
 */
export async function requestBackgroundSyncRegistration(
  syncTag: string = BACKGROUND_SYNC_TAG
): Promise<boolean> {
  const capability = detectBackgroundSyncCapabilities(syncTag);
  if (!capability.isBackgroundSyncSupported) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    if (!registration || !('sync' in registration)) {
      return false;
    }

    await (registration as any).sync.register(syncTag);
    return true;
  } catch (err) {
    console.warn('[Background Sync] Background sync registration failed safely:', err);
    return false;
  }
}
