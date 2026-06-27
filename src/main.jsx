import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { subscribeToPush } from './lib/push.js'
import { isXosAdminHost } from './lib/xosHost.js'

const isXosBoundaryHost = isXosAdminHost();

if (isXosBoundaryHost) {
  document.documentElement.dataset.xosBoundary = 'active';
  console.log('XOS_PRE_REACT_BOUNDARY_ACTIVE', window.location.hostname);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>,
)

async function disableServiceWorkerForXos() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    console.info('XOS_BOUNDARY_ACTIVE service_worker_disabled');

    if (navigator.serviceWorker.controller) {
      window.location.reload();
    }
  } catch (err) {
    console.warn('XOS service worker cleanup failed:', err);
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    if (isXosBoundaryHost) {
      await disableServiceWorkerForXos();
      return;
    }

    try {
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      const registration = await navigator.serviceWorker.register('/sw.js');
      registration.update?.();
      
      // Attempt to subscribe to push notifications after a short delay
      // to ensure user is authenticated
      setTimeout(() => {
        subscribeToPush().catch(err => {
          console.warn('Push notification setup failed:', err);
        });
      }, 2000);
    } catch (err) {
      console.error('Service Worker registration failed:', err);
    }
  });
  
  // Listen for messages from service worker about new orders/updates
  if (!isXosBoundaryHost && navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const { type, payload } = event.data || {};
      if (type === 'ORDER_SYNCED' && payload) {
        // Re-fetch orders or update UI as needed
        window.dispatchEvent(new CustomEvent('orderSynced', { detail: payload }));
      }
    });
  }
}

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:beforeUpdate' }, '*');
  });
  import.meta.hot.on('vite:afterUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:afterUpdate' }, '*');
  });
}

