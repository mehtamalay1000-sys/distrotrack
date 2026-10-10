import './lib/storageCleanup';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './index.css';
import { runStorageCleanup } from './lib/storageCleanup';

// Run proactive storage cleanup on startup (PRESERVES theme and auth session)
if (typeof window !== 'undefined') {
  runStorageCleanup();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        void registration.unregister();
      }
    });
  }
  if ('caches' in window) {
    caches.keys().then((keys) => {
      for (const key of keys) {
        if (key.startsWith('distrotrack-')) {
          void caches.delete(key);
        }
      }
    });
  }
  if ('indexedDB' in window) {
    try {
      window.indexedDB.deleteDatabase('distrotrack_offline_db');
    } catch {
      // Ignore if already absent
    }
  }

  // Obsolete test transactional store cleanup (PRESERVES theme and auth session)
  if (typeof localStorage !== 'undefined') {
    const obsoleteTransactionalKeys = [
      'distrotrack_v6_clean',
      'distrotrack_clean_v5',
      'distrotrack_clean_v4',
      'distrotrack_clean_v3',
      'distrotrack_clean_v2',
      'distrotrack_storage_v2',
      'distrotrack_mock_store',
      'distrotrack_store',
      'distrotrack_dev_mock',
    ];
    for (const key of obsoleteTransactionalKeys) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore
      }
    }
  }
}


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
