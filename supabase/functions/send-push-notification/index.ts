import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as webpush from 'https://esm.sh/web-push@3';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

// Configure web-push with VAPID keys
webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') || 'mailto:support@joint-x.com',
  Deno.env.get('VAPID_PUBLIC_KEY') || '',
  Deno.env.get('VAPID_PRIVATE_KEY') || ''
);

Deno.serve(async (req) => {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const event = await req.json();
    const { event_type, payload, user_email, channels = ['push'] } = event;

    // Get user's push subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_email', user_email);

    if (subError) {
      console.error('Error fetching subscriptions:', subError);
      return new Response(JSON.stringify({ error: subError.message }), { status: 500 });
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log(`No push subscriptions found for ${user_email}`);
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    // Check user's notification preferences
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_email', user_email)
      .single();

    if (prefs?.push_enabled === false) {
      console.log(`Push notifications disabled for ${user_email}`);
      return new Response(JSON.stringify({ sent: 0, skipped: subscriptions.length }), { status: 200 });
    }

    // Send push notifications to all subscriptions
    let sent = 0;
    let failed = 0;

    for (const subscription of subscriptions) {
      try {
        const pushSubscription = {
          endpoint: subscription.endpoint,
          keys: {
            auth: subscription.auth,
            p256dh: subscription.p256dh,
          },
        };

        // Build notification payload
        const notification = buildNotification(event_type, payload);

        await webpush.sendNotification(pushSubscription, JSON.stringify(notification));
        sent++;
      } catch (err) {
        console.error(`Failed to send push to ${subscription.endpoint}:`, err.message);
        
        // If subscription is invalid, remove it from database
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', subscription.endpoint)
            .catch(e => console.error('Failed to delete invalid subscription:', e));
        }
        failed++;
      }
    }

    console.log(`Push notifications sent: ${sent}, failed: ${failed}`);
    return new Response(JSON.stringify({ sent, failed }), { status: 200 });
  } catch (err) {
    console.error('Error processing notification request:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

function buildNotification(eventType, payload) {
  const baseNotification = {
    title: 'Joint X Notification',
    body: 'You have an update',
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    event_type: eventType,
    payload: payload || {},
    url: '/',
  };

  switch (eventType) {
    case 'ORDER_SYNCED':
      return {
        ...baseNotification,
        title: 'Order Synced',
        body: payload?.order_number 
          ? `Order ${payload.order_number} from xLab has been synced` 
          : 'Your order has been synced from xLab',
        url: '/orders',
        tag: 'order-sync',
      };
    
    case 'ORDER_RECEIVED':
      return {
        ...baseNotification,
        title: 'Order Received',
        body: `Order #${payload?.order_number || ''} has been received`,
        url: '/orders',
        tag: `order-${payload?.order_id}`,
      };

    case 'PO_APPROVED':
      return {
        ...baseNotification,
        title: 'PO Approved',
        body: `Purchase order ${payload?.po_number || ''} has been approved`,
        url: '/purchaseorders',
        tag: `po-${payload?.po_id}`,
      };

    case 'PO_RECEIVED':
      return {
        ...baseNotification,
        title: 'PO Received',
        body: `Purchase order ${payload?.po_number || ''} has been received`,
        url: '/purchaseorders',
        tag: `po-${payload?.po_id}`,
      };

    case 'INVENTORY_LOW':
      return {
        ...baseNotification,
        title: 'Low Stock Alert',
        body: `${payload?.item_name || 'An item'} is running low on stock`,
        url: '/inventory',
        tag: 'inventory-alert',
        requireInteraction: true,
      };

    case 'TASK_ASSIGNED':
      return {
        ...baseNotification,
        title: 'New Task',
        body: payload?.task_title || 'A new task has been assigned to you',
        url: '/tasks',
        tag: `task-${payload?.task_id}`,
      };

    default:
      return baseNotification;
  }
}
