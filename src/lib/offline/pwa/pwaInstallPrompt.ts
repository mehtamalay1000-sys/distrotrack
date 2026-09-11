// ================================================================
// DistroTrack v2 — Stage 9E: PWA Installation Prompt Manager
// File: src/lib/offline/pwa/pwaInstallPrompt.ts
// ================================================================

import type { PwaInstallState, BeforeInstallPromptEvent } from './pwaTypes.ts';

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<(state: PwaInstallState) => void>();

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true ||
    document.referrer.includes('android-app://');

  return isStandalone;
}

function notifyInstallListeners(): void {
  const currentState = getPwaInstallState();
  for (const listener of installListeners) {
    try {
      listener(currentState);
    } catch {
      // Ignore listener error
    }
  }
}

/**
 * Initializes the beforeinstallprompt listener if in a browser environment.
 */
export function initPwaInstallPrompt(): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleBeforeInstallPrompt = (e: Event) => {
    // Prevent the default browser mini-infobar on mobile
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notifyInstallListeners();
  };

  const handleAppInstalled = () => {
    deferredPrompt = null;
    notifyInstallListeners();
  };

  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  window.addEventListener('appinstalled', handleAppInstalled);

  return () => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.removeEventListener('appinstalled', handleAppInstalled);
  };
}

/**
 * Returns the current PWA installability and installed status.
 */
export function getPwaInstallState(): PwaInstallState {
  const isInstalled = isStandaloneMode();
  const isInstallable = Boolean(deferredPrompt) && !isInstalled;

  return {
    isInstallable,
    isInstalled,
  };
}

/**
 * Subscribes to changes in PWA installability state.
 */
export function subscribePwaInstall(
  listener: (state: PwaInstallState) => void
): () => void {
  installListeners.add(listener);
  listener(getPwaInstallState());

  return () => {
    installListeners.delete(listener);
  };
}

/**
 * Prompts the user to install the DistroTrack PWA if eligible.
 */
export async function promptPwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) {
    return 'unavailable';
  }

  try {
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    notifyInstallListeners();
    return choice.outcome;
  } catch {
    deferredPrompt = null;
    notifyInstallListeners();
    return 'unavailable';
  }
}
