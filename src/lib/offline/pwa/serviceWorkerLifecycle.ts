// ================================================================
// DistroTrack v2 — Stage 9E: Service Worker Lifecycle Manager
// File: src/lib/offline/pwa/serviceWorkerLifecycle.ts
// ================================================================

import type { ServiceWorkerStatus, PwaLifecycleOptions } from './pwaTypes.ts';

let activeRegistration: ServiceWorkerRegistration | null = null;
let hasUpdateWaiting = false;
const listeners = new Set<(status: ServiceWorkerStatus) => void>();

function notifyListeners(): void {
  const currentStatus = getPwaStatus();
  for (const listener of listeners) {
    try {
      listener(currentStatus);
    } catch {
      // Ignore listener error
    }
  }
}

/**
 * Returns the current PWA and Service Worker operational status.
 */
export function getPwaStatus(): ServiceWorkerStatus {
  const isSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const isControlling = isSupported && Boolean(navigator.serviceWorker.controller);

  return {
    isSupported,
    isRegistered: Boolean(activeRegistration),
    isControlling,
    hasUpdate: hasUpdateWaiting,
    scope: activeRegistration?.scope,
    registration: activeRegistration,
  };
}

/**
 * Subscribes to Service Worker lifecycle status changes (e.g. update ready).
 */
export function subscribePwaStatus(
  listener: (status: ServiceWorkerStatus) => void
): () => void {
  listeners.add(listener);
  listener(getPwaStatus());

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Registers the production Progressive Web App Service Worker.
 * Safe to call across environments (fails gracefully if unsupported or in dev).
 */
export async function registerPwaServiceWorker(
  options: PwaLifecycleOptions = {}
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  const swUrl = options.swUrl || '/sw.js';
  const scope = options.scope || '/';

  try {
    const registration = await navigator.serviceWorker.register(swUrl, { scope });
    activeRegistration = registration;

    // Check if an update is already waiting (e.g. from prior page load)
    if (registration.waiting) {
      hasUpdateWaiting = true;
      notifyListeners();
    }

    // Listen for new service worker installation cycles
    registration.addEventListener('updatefound', () => {
      const installingWorker = registration.installing;
      if (!installingWorker) return;

      installingWorker.addEventListener('statechange', () => {
        if (installingWorker.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            // New version installed while existing controller is active
            hasUpdateWaiting = true;
            notifyListeners();
          }
        }
      });
    });

    // When the controlling service worker changes, notify listeners
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      notifyListeners();
    });

    notifyListeners();
    return registration;
  } catch (err) {
    console.warn('[PWA] Service Worker registration skipped or failed:', err);
    return null;
  }
}

/**
 * Checks with the server/network for an updated Service Worker script.
 */
export async function checkForPwaUpdate(): Promise<boolean> {
  if (!activeRegistration) {
    return false;
  }

  try {
    await activeRegistration.update();
    return hasUpdateWaiting;
  } catch {
    return false;
  }
}

/**
 * Tells the waiting Service Worker to take control immediately via SKIP_WAITING.
 * Does NOT force a browser reload blindly so ongoing operational input is preserved.
 */
export function applyPwaUpdate(): void {
  if (activeRegistration?.waiting) {
    activeRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    hasUpdateWaiting = false;
    notifyListeners();
  }
}
