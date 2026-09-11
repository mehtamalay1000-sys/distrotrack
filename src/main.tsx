import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './index.css';
import { registerPwaServiceWorker, initPwaInstallPrompt } from './lib/offline/pwa/index.ts';

// Initialize PWA Service Worker & install prompt listener
if (typeof window !== 'undefined') {
  initPwaInstallPrompt();
  // Register in production or when service worker is available
  void registerPwaServiceWorker();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
