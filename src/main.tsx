import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './index.css';
// Proactively clean up any previously registered Service Workers, caches, or offline DBs
if (typeof window !== 'undefined') {
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
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
