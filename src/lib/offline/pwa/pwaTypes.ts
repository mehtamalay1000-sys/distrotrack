// ================================================================
// DistroTrack v2 — Stage 9E: PWA & Service Worker Types
// File: src/lib/offline/pwa/pwaTypes.ts
// ================================================================

export interface ServiceWorkerStatus {
  isSupported: boolean;
  isRegistered: boolean;
  isControlling: boolean;
  hasUpdate: boolean;
  scope?: string;
  registration: ServiceWorkerRegistration | null;
}

export interface PwaInstallState {
  isInstallable: boolean;
  isInstalled: boolean;
}

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface PwaLifecycleOptions {
  swUrl?: string;
  scope?: string;
  enableAutoUpdateCheck?: boolean;
  updateCheckIntervalMs?: number;
}
