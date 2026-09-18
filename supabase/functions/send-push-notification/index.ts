import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as webpush from 'https://esm.sh/web-push@3';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') || 'mailto:support@joint-x.com',
  Deno.env.get('VAPID_PUBLIC_KEY') || '',
  Deno.env.get('VAPID_PRIVATE_KEY') || ''
);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const event = await req.json();

    // Durable commercial-alert mode is backend-only. Do not let a normal
    // authenticated browser replay arbitrary tenant alerts by ID.
    if (event?.commercial_alert_id) {
      const authHeader = req.headers.get('authorization') || '';
      const bearer = authHeader.replace(/^Bearer\s+/i, '');
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

      if (!serviceRoleKey || bearer !== serviceRoleKey) {
        return json({ error: 'Service role required for commercial alert dispatch' }, 403);
      }

      return await dispatchCommercialAlert(String(event.commercial_alert_id));
    }

    // Existing direct/user-targeted mode remains backward-compatible.
    return await dispatchLegacyNotification(event);
  } catch (err) {
    console.error('Error processing notification request:', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function dispatchCommercialAlert(alertId: string) {
  const { data: alert, error: alertError } = await supabase
    .from('commercial_alerts')
    .select('*')
    .eq('id', alertId)
    .single();

  if (alertError || !alert) {
    return json({ error: alertError?.message || 'Commercial alert not found' }, 404);
  }

  // Idempotency: already delivered alerts are harmless replays.
  if (alert.delivery_status === 'sent') {
    return json({ ok: true, replayed: true, sent: 0, failed: 0 }, 200);
  }

  if (alert.delivery_status === 'processing') {
    return json({ ok: true, already_processing: true, sent: 0, failed: 0 }, 202);
  }

  // Atomic claim: only one dispatcher may move pending/failed -> processing.
  // This prevents duplicate pushes when workers overlap or a request is retried.
  const { data: claimed, error: claimError } = await supabase
    .from('commercial_alerts')
    .update({
      delivery_status: 'processing',
      delivery_attempts: Number(alert.delivery_attempts || 0) + 1,
      last_attempt_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', alert.id)
    .in('delivery_status', ['pending', 'failed'])
    .select('id')
    .maybeSingle();

  if (claimError) {
    return json({ error: claimError.message }, 500);
  }

  if (!claimed) {
    return json({ ok: true, already_claimed: true, sent: 0, failed: 0 }, 202);
  }

  const { data: subscriptions, error: subError } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('tenant_id', alert.tenant_id);

  if (subError) {
    await markCommercialAlertFailed(alert.id, subError.message);
    return json({ error: subError.message }, 500);
  }

  if (!subscriptions || subscriptions.length === 0) {
    await markCommercialAlertFailed(alert.id, 'No tenant push subscriptions');
    return json({ ok: true, sent: 0, failed: 0, skipped: 0, reason: 'no_subscriptions' }, 200);
  }

  const recipientEmails = [
    ...new Set(
      subscriptions
        .map((subscription) => String(subscription.user_email || '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  const { data: prefRows } = await supabase
    .from('notification_preferences')
    .select('user_email,push_enabled')
    .eq('tenant_id', alert.tenant_id)
    .in('user_email', recipientEmails);

  const pushDisabled = new Set(
    (prefRows || [])
      .filter((row) => row.push_enabled === false)
      .map((row) => String(row.user_email || '').trim().toLowerCase())
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const failures: string[] = [];

  const notification = {
    title: alert.title || 'Joint X update',
    body: alert.body || 'You have a new commercial update',
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    event_type: alert.event_type || 'commercial_alert',
    payload: alert.payload || {},
    url: alert.action_url || '/',
    tag: `commercial-alert-${alert.id}`,
    requireInteraction: ['invoice_paid', 'quote_accepted', 'quote_changes_requested'].includes(alert.event_type),
  };

  for (const subscription of subscriptions) {
    const email = String(subscription.user_email || '').trim().toLowerCase();

    if (pushDisabled.has(email)) {
      skipped++;
      continue;
    }

    try {
      await sendPush(subscription, notification);
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(message);
      failed++;

      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        const { error: deleteError } = await supabase
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', subscription.endpoint);

        if (deleteError) {
          console.error('Failed to delete invalid subscription:', deleteError);
        }
      }
    }
  }

  // Consider the alert delivered if at least one active subscription received it.
  // Otherwise leave it failed so a later dispatcher/retry can pick it up.
  if (sent > 0) {
    await supabase
      .from('commercial_alerts')
      .update({
        delivery_status: 'sent',
        delivered_at: new Date().toISOString(),
        last_error: failed > 0 ? `${failed} subscription(s) failed` : null,
      })
      .eq('id', alert.id);
  } else {
    await markCommercialAlertFailed(
      alert.id,
      failures[0] || (skipped > 0 ? 'All tenant subscriptions have push disabled' : 'No push delivered')
    );
  }

  console.log('Commercial alert push result', {
    alert_id: alert.id,
    tenant_id: alert.tenant_id,
    sent,
    failed,
    skipped,
  });

  return json({ ok: true, sent, failed, skipped }, 200);
}

async function dispatchLegacyNotification(event: any) {
  const { event_type, payload, user_email } = event;

  if (!user_email) {
    return json({ error: 'user_email is required' }, 400);
  }

  const { data: subscriptions, error: subError } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_email', user_email);

  if (subError) {
    console.error('Error fetching subscriptions:', subError);
    return json({ error: subError.message }, 500);
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log(`No push subscriptions found for ${user_email}`);
    return json({ sent: 0 }, 200);
  }

  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_email', user_email)
    .maybeSingle();

  if (prefs?.push_enabled === false) {
    console.log(`Push notifications disabled for ${user_email}`);
    return json({ sent: 0, skipped: subscriptions.length }, 200);
  }

  let sent = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    try {
      await sendPush(subscription, buildNotification(event_type, payload));
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to send push to ${subscription.endpoint}:`, message);

      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        const { error: deleteError } = await supabase
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', subscription.endpoint);

        if (deleteError) {
          console.error('Failed to delete invalid subscription:', deleteError);
        }
      }
      failed++;
    }
  }

  console.log(`Push notifications sent: ${sent}, failed: ${failed}`);
  return json({ sent, failed }, 200);
}

async function sendPush(subscription: any, notification: any) {
  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      auth: subscription.auth,
      p256dh: subscription.p256dh,
    },
  };

  await webpush.sendNotification(pushSubscription, JSON.stringify(notification));
}

async function markCommercialAlertFailed(alertId: string, message: string) {
  await supabase
    .from('commercial_alerts')
    .update({
      delivery_status: 'failed',
      last_error: String(message || 'Push delivery failed').slice(0, 1000),
    })
    .eq('id', alertId);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function buildNotification(eventType: string, payload: any) {
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
