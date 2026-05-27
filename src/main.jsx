import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { subscribeToPush } from './lib/push.js'

ReactDOM.createRoot(document.getElementById('root')).render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
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
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
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



