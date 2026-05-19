import { supabase } from './supabaseClient';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/**
 * Request notification permission from user
 * @returns {Promise<NotificationPermission>}
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.warn('Notifications not supported in this browser');
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission;
  }

  return 'denied';
}

/**
 * Register service worker and subscribe to push notifications
 * @returns {Promise<boolean>} true if successfully subscribed
 */
export async function subscribeToPush() {
  try {
    // Check browser support
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push notifications not supported');
      return false;
    }

    // Request permission
    const permission = await requestNotificationPermission();
    if (permission !== 'granted') {
      console.log('Notification permission:', permission);
      return false;
    }

    // Register service worker
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });
    console.log('Service Worker registered');

    // Get or create push subscription
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      if (!VAPID_PUBLIC_KEY) {
        console.warn('VITE_VAPID_PUBLIC_KEY not configured');
        return false;
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      console.log('Push subscription created');
    } else {
      console.log('Push subscription already exists');
    }

    // Save subscription to database
    await savePushSubscription(subscription);
    return true;
  } catch (err) {
    console.error('Failed to subscribe to push:', err);
    return false;
  }
}

/**
 * Unsubscribe from push notifications
 * @returns {Promise<boolean>}
 */
export async function unsubscribeFromPush() {
  try {
    if (!('serviceWorker' in navigator)) return false;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      await subscription.unsubscribe();
      await removePushSubscription(subscription);
      console.log('Unsubscribed from push notifications');
      return true;
    }
    return false;
  } catch (err) {
    console.error('Failed to unsubscribe from push:', err);
    return false;
  }
}

/**
 * Save push subscription to database
 * @param {PushSubscription} subscription
 */
async function savePushSubscription(subscription) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return;

    const endpoint = subscription.endpoint;
    const auth = subscription.getKey?.('auth');
    const p256dh = subscription.getKey?.('p256dh');

    if (!auth || !p256dh) {
      console.warn('Missing subscription keys');
      return;
    }

    // Convert ArrayBuffer to base64
    const authStr = arrayBufferToBase64(auth);
    const p256dhStr = arrayBufferToBase64(p256dh);

    // Upsert subscription in database
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_email: user.email,
          endpoint,
          auth: authStr,
          p256dh: p256dhStr,
        },
        { onConflict: 'endpoint' }
      );

    if (error) throw error;
    console.log('Push subscription saved to database');
  } catch (err) {
    console.error('Failed to save push subscription:', err);
  }
}

/**
 * Remove push subscription from database
 * @param {PushSubscription} subscription
 */
async function removePushSubscription(subscription) {
  try {
    const endpoint = subscription.endpoint;
    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint);

    if (error) throw error;
    console.log('Push subscription removed from database');
  } catch (err) {
    console.error('Failed to remove push subscription:', err);
  }
}

/**
 * Convert VAPID public key from base64 to Uint8Array
 * @param {string} base64String
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Convert ArrayBuffer to base64 string
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Check if push notifications are currently enabled
 * @returns {Promise<boolean>}
 */
export async function isPushEnabled() {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}
