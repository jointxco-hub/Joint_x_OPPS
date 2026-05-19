import { useEffect } from 'react';
import React from 'react';

/**
 * Hook to listen for notifications received from service worker
 * @param {function} callback - Called when a notification is received
 * @param {array} dependencies - Dependencies array
 */
export function usePushNotifications(callback, dependencies = []) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Listen for messages from service worker
    const handleMessage = (event) => {
      const { type, payload } = event.data || {};
      if (type === 'NOTIFICATION_RECEIVED' && callback) {
        callback(payload);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);

    // Listen for custom events dispatched from main.jsx
    const handleOrderSync = (event) => {
      if (callback) {
        callback(event.detail);
      }
    };

    window.addEventListener('orderSynced', handleOrderSync);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
      window.removeEventListener('orderSynced', handleOrderSync);
    };
  }, dependencies);
}

/**
 * Hook to check if push notifications are enabled
 * @returns {object} { enabled, loading }
 */
export function usePushNotificationsStatus() {
  const [enabled, setEnabled] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const checkStatus = async () => {
      try {
        if (!('serviceWorker' in navigator)) {
          setEnabled(false);
          setLoading(false);
          return;
        }

        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setEnabled(!!subscription);
      } catch (err) {
        console.error('Error checking push status:', err);
        setEnabled(false);
      } finally {
        setLoading(false);
      }
    };

    checkStatus();
  }, []);

  return { enabled, loading };
}
