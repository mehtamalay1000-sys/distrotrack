// ================================================================
// DistroTrack v2 — Stage 9C: Worker Offline & Synchronization Banner
// File: src/features/worker/components/OfflineSyncBanner.tsx
// ================================================================

import { useEffect, useState } from 'react';
import {
  WifiOff,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Download,
} from 'lucide-react';
import {
  subscribeSyncStatus,
  getSyncStatus,
  type SyncStatus,
} from '@/lib/offline/sync/index.ts';
import {
  getFailedWorkerMutations,
  retryWorkerMutation,
} from '@/lib/offline/worker/index.ts';
import { requestBackgroundSync } from '@/lib/offline/background/index.ts';
import {
  subscribePwaStatus,
  applyPwaUpdate,
  type ServiceWorkerStatus,
  subscribePwaInstall,
  promptPwaInstall,
  type PwaInstallState,
} from '@/lib/offline/pwa/index.ts';
import type { OutboxEntry } from '@/lib/offline/types.ts';
import { toast } from 'sonner';

interface OfflineSyncBannerProps {
  cachedAt?: string | null;
  className?: string;
}

export function OfflineSyncBanner({ cachedAt, className = '' }: OfflineSyncBannerProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [failedEntries, setFailedEntries] = useState<OutboxEntry[]>([]);
  const [showFailedModal, setShowFailedModal] = useState(false);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [pwaStatus, setPwaStatus] = useState<ServiceWorkerStatus | null>(null);
  const [pwaInstall, setPwaInstall] = useState<PwaInstallState | null>(null);

  useEffect(() => {
    // Initial fetch
    void getSyncStatus().then(setStatus);
    void getFailedWorkerMutations().then(setFailedEntries);

    // Subscribe to live sync status updates
    const unsubscribeSync = subscribeSyncStatus((newStatus) => {
      setStatus(newStatus);
      void getFailedWorkerMutations().then(setFailedEntries);
    });

    const unsubscribePwa = subscribePwaStatus(setPwaStatus);
    const unsubscribeInstall = subscribePwaInstall(setPwaInstall);

    return () => {
      unsubscribeSync();
      unsubscribePwa();
      unsubscribeInstall();
    };
  }, []);

  const handleManualSync = async () => {
    setIsManualSyncing(true);
    try {
      const res = await requestBackgroundSync('manual', true);
      if (res.succeeded > 0) {
        toast.success(`Successfully synced ${res.succeeded} change(s).`);
      } else if (res.failed > 0) {
        toast.error(`${res.failed} change(s) failed server validation.`);
      } else if (res.totalProcessed === 0) {
        toast.info('Everything is up to date.');
      }
    } catch {
      toast.error('Sync attempt failed. Please check network connection.');
    } finally {
      setIsManualSyncing(false);
      void getSyncStatus().then(setStatus);
      void getFailedWorkerMutations().then(setFailedEntries);
    }
  };

  const handleRetryItem = async (outboxId: string) => {
    try {
      await retryWorkerMutation(outboxId);
      toast.info('Queued for retry.');
      void getFailedWorkerMutations().then(setFailedEntries);
    } catch (err: any) {
      toast.error(`Retry failed: ${err?.message || 'Unknown error'}`);
    }
  };

  if (!status) return null;

  const isOffline = !status.isOnline;
  const isSyncing = status.isProcessing || isManualSyncing;
  const hasPending = status.pendingCount > 0;
  const hasFailed = status.failedCount > 0 || failedEntries.length > 0;

  // Compute friendly cachedAt text
  let cachedText: string | null = null;
  if (cachedAt) {
    try {
      const diffMinutes = Math.floor((Date.now() - new Date(cachedAt).getTime()) / 60000);
      if (diffMinutes < 1) cachedText = 'Updated just now';
      else if (diffMinutes < 60) cachedText = `Updated ${diffMinutes}m ago`;
      else cachedText = `Updated ${Math.floor(diffMinutes / 60)}h ago`;
    } catch {
      cachedText = 'Cached locally';
    }
  }

  // Compute friendly lastSyncedText
  let lastSyncedText: string | null = null;
  if (status.lastSuccessfulSyncAt) {
    try {
      const diff = Math.floor((Date.now() - new Date(status.lastSuccessfulSyncAt).getTime()) / 60000);
      if (diff < 1) lastSyncedText = 'Synced just now';
      else if (diff < 60) lastSyncedText = `Synced ${diff}m ago`;
      else lastSyncedText = `Synced ${Math.floor(diff / 60)}h ago`;
    } catch {
      lastSyncedText = null;
    }
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      {/* 0. PWA Update Notification Banner */}
      {pwaStatus?.hasUpdate && (
        <div className="flex items-center justify-between px-3 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-800 dark:text-blue-200 rounded-lg text-xs font-medium">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <span>New application update available.</span>
          </div>
          <button
            onClick={() => {
              applyPwaUpdate();
              window.location.reload();
            }}
            className="bg-blue-600 text-white px-2.5 py-0.5 rounded text-[11px] font-semibold hover:bg-blue-700 transition-colors"
          >
            Update Now
          </button>
        </div>
      )}

      {/* 1. Offline Notification Banner */}
      {isOffline && (
        <div className="flex items-center justify-between px-3 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200 rounded-lg text-xs font-medium">
          <div className="flex items-center gap-2">
            <WifiOff className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Offline — changes will sync automatically when connection returns.</span>
          </div>
          {hasPending && (
            <span className="bg-amber-500/20 px-2 py-0.5 rounded-full text-[10px]">
              {status.pendingCount} queued
            </span>
          )}
        </div>
      )}

      {/* 2. Syncing in Progress Banner */}
      {!isOffline && isSyncing && (
        <div className="flex items-center justify-between px-3 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-800 dark:text-blue-200 rounded-lg text-xs font-medium">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
            <span>Connection restored — syncing pending changes...</span>
          </div>
          <span className="text-[10px] text-blue-600 dark:text-blue-400">
            {status.pendingCount} remaining
          </span>
        </div>
      )}

      {/* 3. Failed Mutations Warning Banner */}
      {hasFailed && (
        <div className="flex items-center justify-between px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-800 dark:text-red-200 rounded-lg text-xs font-medium">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
            <span>
              {failedEntries.length} mutation(s) rejected by server.
            </span>
          </div>
          <button
            onClick={() => setShowFailedModal(true)}
            className="text-[11px] underline font-semibold text-red-700 dark:text-red-300 hover:opacity-80"
          >
            Review & Retry
          </button>
        </div>
      )}

      {/* 4. Compact Status Strip (Always present when route is cached) */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-100 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700/60 rounded-lg text-[11px]">
        <div className="flex items-center gap-2">
          {isOffline ? (
            <span className="flex items-center gap-1 text-surface-500 dark:text-surface-400">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Offline Mode
            </span>
          ) : (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Connected
            </span>
          )}

          {cachedText && (
            <span className="text-surface-400 dark:text-surface-500 hidden sm:inline">
              • {cachedText}
            </span>
          )}

          {lastSyncedText && !isOffline && (
            <span className="text-surface-400 dark:text-surface-500 hidden md:inline">
              • {lastSyncedText}
            </span>
          )}

          {cachedAt && (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 px-1.5 py-0.2 rounded font-medium text-[10px]">
              <CheckCircle2 className="h-3 w-3" />
              Offline ready
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasPending && !isSyncing && (
            <span className="text-amber-600 dark:text-amber-400 font-medium text-[10px]">
              {status.pendingCount} pending sync
            </span>
          )}

          {pwaInstall?.isInstallable && (
            <button
              onClick={() => void promptPwaInstall()}
              className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline text-[11px] font-medium"
              title="Install DistroTrack App"
            >
              <Download className="h-3 w-3" />
              Install
            </button>
          )}

          {!isOffline && (
            <button
              onClick={handleManualSync}
              disabled={isSyncing}
              className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 text-[11px]"
              title="Trigger immediate sync"
            >
              <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
              Sync Now
            </button>
          )}
        </div>
      </div>

      {/* 5. Failed Items Review Modal */}
      {showFailedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-surface-800 rounded-xl shadow-xl max-w-md w-full p-4 border border-surface-200 dark:border-surface-700 space-y-3">
            <div className="flex items-center justify-between border-b border-surface-200 dark:border-surface-700 pb-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <h3 className="font-semibold text-sm">Failed Mutations</h3>
              </div>
              <button
                onClick={() => setShowFailedModal(false)}
                className="text-surface-400 hover:text-surface-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {failedEntries.map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 bg-surface-50 dark:bg-surface-900 border border-red-500/20 rounded-lg text-xs space-y-1"
                >
                  <div className="flex items-center justify-between font-medium">
                    <span className="uppercase text-surface-800 dark:text-surface-200">
                      {item.operationType.replace('_', ' ')}
                    </span>
                    <button
                      onClick={() => handleRetryItem(item.id)}
                      className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-[11px]"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Retry
                    </button>
                  </div>
                  <p className="text-[11px] text-red-600 dark:text-red-400">
                    {item.errorMessage || 'Server validation rejected operation.'}
                  </p>
                  <div className="text-[10px] text-surface-400">
                    ID: {item.id} • Key: {item.idempotencyKey.slice(0, 15)}...
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowFailedModal(false)}
                className="px-3 py-1.5 bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-200 rounded-lg text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
