/**
 * DistroTrack v2 — Safe Versioned Client Storage Cleanup
 *
 * Runs synchronously on application bootstrap before any module or component loads.
 * Purges obsolete test transaction stores, stale mockStore persistence, and orphaned
 * test operation caches while preserving authentication tokens and user preferences.
 */

const STORAGE_CLEANUP_VERSION = '2026.10.clean_authoritative_v1';
const VERSION_KEY = 'distrotrack_storage_cleanup_version';

// Exact keys that must NEVER be deleted (whitelist)
const WHITELIST_PREFIXES = ['sb-', 'supabase.auth'];
const WHITELIST_EXACT_KEYS = ['distrotrack-theme', VERSION_KEY];

// Known obsolete transactional store keys from testing
const OBSOLETE_TRANSACTIONAL_KEYS = [
  'distrotrack_v6_clean',
  'distrotrack_clean_v5',
  'distrotrack_clean_v4',
  'distrotrack_clean_v3',
  'distrotrack_clean_v2',
  'distrotrack_storage_v2',
  'distrotrack_mock_store',
  'distrotrack_store',
  'distrotrack_dev_mock',
  'distrotrack_offline_outbox',
  'distrotrack_pending_payments',
  'distrotrack_offline_payments',
  'distrotrack_cached_routes',
  'distrotrack_cached_deliveries',
];

export function runStorageCleanup(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }

  try {
    const currentVersion = localStorage.getItem(VERSION_KEY);
    const needsCleanup = currentVersion !== STORAGE_CLEANUP_VERSION;

    // 1. Purge known obsolete transactional stores unconditionally
    for (const key of OBSOLETE_TRANSACTIONAL_KEYS) {
      try {
        if (localStorage.getItem(key) !== null) {
          localStorage.removeItem(key);
        }
      } catch {
        // Ignore single-key removal failure
      }
    }

    // 2. If storage cleanup version is not current, perform deep inspection
    if (needsCleanup) {
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;

        // Check whitelist
        const isWhitelisted =
          WHITELIST_EXACT_KEYS.includes(key) ||
          WHITELIST_PREFIXES.some((prefix) => key.startsWith(prefix));

        if (isWhitelisted) {
          continue;
        }

        // Check for test/mock transactional prefixes
        if (
          key.startsWith('distrotrack_mock') ||
          key.startsWith('distrotrack_clean') ||
          key.startsWith('distrotrack_test') ||
          key.startsWith('distrotrack_dev') ||
          key.startsWith('distrotrack_offline')
        ) {
          keysToRemove.push(key);
        }
      }

      for (const k of keysToRemove) {
        try {
          localStorage.removeItem(k);
        } catch {
          // Ignore
        }
      }

      // 3. Sanitize notifications store
      try {
        const notifKey = 'distrotrack_notifications_v1';
        const rawNotifs = localStorage.getItem(notifKey);
        if (rawNotifs) {
          const parsed = JSON.parse(rawNotifs);
          if (Array.isArray(parsed)) {
            // Remove test notifications that reference payments, deliveries, or test parties
            const sanitized = parsed.filter((n: any) => {
              if (!n) return false;
              if (n.type === 'payment' || n.type === 'delivery' || n.type === 'picklist') return false;
              const text = `${n.title || ''} ${n.message || ''}`.toLowerCase();
              if (
                text.includes('krushnai') ||
                text.includes('jay hind') ||
                text.includes('pitamberdas') ||
                text.includes('14,538') ||
                text.includes('14538') ||
                text.includes('september')
              ) {
                return false;
              }
              return true;
            });
            localStorage.setItem(notifKey, JSON.stringify(sanitized));
          }
        }
      } catch {
        try {
          localStorage.removeItem('distrotrack_notifications_v1');
        } catch {
          // Ignore
        }
      }

      // 4. Clean Service Workers, Caches, and IndexedDB
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const reg of registrations) {
            void reg.unregister();
          }
        }).catch(() => {});
      }

      if ('caches' in window) {
        caches.keys().then((keys) => {
          for (const key of keys) {
            if (key.startsWith('distrotrack-')) {
              void caches.delete(key);
            }
          }
        }).catch(() => {});
      }

      if ('indexedDB' in window) {
        try {
          window.indexedDB.deleteDatabase('distrotrack_offline_db');
        } catch {
          // Ignore
        }
      }

      // Stamp cleanup version
      try {
        localStorage.setItem(VERSION_KEY, STORAGE_CLEANUP_VERSION);
      } catch {
        // Ignore
      }
    }
  } catch (err) {
    console.warn('[STORAGE_CLEANUP] Safe cleanup encountered warning:', err);
  }
}

// Immediately execute on script evaluation
runStorageCleanup();
