// ================================================================
// DistroTrack v2 — Stage 9D: Background Synchronization Triggers
// File: src/lib/offline/background/backgroundSyncTriggers.ts
// ================================================================

import { SW_BACKGROUND_SYNC_MESSAGE } from './backgroundTypes.ts';

export type TriggerHandler = () => void;

/**
 * Attaches a listener for network reconnection ('online' event).
 * Returns a cleanup function that detaches the listener.
 */
export function setupReconnectTrigger(onReconnect: TriggerHandler): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleOnline = () => {
    onReconnect();
  };

  window.addEventListener('online', handleOnline);
  return () => {
    window.removeEventListener('online', handleOnline);
  };
}

/**
 * Attaches a listener for browser visibility change.
 * Fires when document transitions from hidden to 'visible'.
 * Returns a cleanup function that detaches the listener.
 */
export function setupVisibilityTrigger(onVisible: TriggerHandler): () => void {
  if (typeof document === 'undefined') return () => {};

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      onVisible();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

/**
 * Attaches a listener for window/app focus.
 * Applies a debounce/throttle to prevent rapid repeated focus events
 * (e.g. clicking back and forth between inputs) from flooding the sync queue.
 * Returns a cleanup function that detaches the listener and cancels timers.
 */
export function setupFocusTrigger(
  onFocus: TriggerHandler,
  throttleWindowMs = 1000
): () => void {
  if (typeof window === 'undefined') return () => {};

  let lastFocusFiredAt = 0;

  const handleFocus = () => {
    const now = Date.now();
    if (now - lastFocusFiredAt >= throttleWindowMs) {
      lastFocusFiredAt = now;
      onFocus();
    }
  };

  window.addEventListener('focus', handleFocus);
  return () => {
    window.removeEventListener('focus', handleFocus);
  };
}

/**
 * Attaches a listener for background sync events posted from the Service Worker.
 * When the browser's Background Sync API fires in the Service Worker,
 * the worker posts a message to active client windows.
 * Returns a cleanup function that detaches the listener.
 */
export function setupServiceWorkerMessageTrigger(onSwSync: TriggerHandler): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {};
  }

  const handleMessage = (event: MessageEvent) => {
    if (event.data && event.data.type === SW_BACKGROUND_SYNC_MESSAGE) {
      onSwSync();
    }
  };

  navigator.serviceWorker.addEventListener('message', handleMessage);
  return () => {
    navigator.serviceWorker.removeEventListener('message', handleMessage);
  };
}
