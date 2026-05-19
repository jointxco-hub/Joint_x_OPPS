# Push Notifications Setup Guide

## Overview
Push notifications have been fully implemented for Joint X Operations OS. Orders synced from xLab and other events will now send real-time notifications to subscribed users.

## What Was Fixed

### 1. **Purchase Order Creation** ✅
- **Issue**: POs couldn't be created without filling all fields
- **Fix**: Added smart validation that:
  - Requires either an inventory selection OR a custom item name (not both required)
  - Validates quantity and unit price are > 0
  - Skips empty items silently
  - Shows helpful error messages for missing data
- **Result**: POs can now be created with minimal required information

### 2. **Shop Inventory Import** ✅
- **Issue**: Shop inventory imports weren't displaying imported items
- **Fix**: 
  - Enhanced error logging to show what failed
  - Fixed query refetch to properly reload catalog items after import
  - Added better toast notifications
  - Products now display immediately after import
- **Result**: Imported products now appear in catalog instantly

### 3. **Push Notifications** ✅
- **Issue**: No notifications received when orders were synced from xLab
- **Fix**: Complete push notification system implemented including:
  - Service Worker push message handling
  - Database subscription storage
  - Real-time notification delivery
  - Event-specific notification formatting

## Configuration Required

### Step 1: Generate VAPID Keys
Push notifications require VAPID keys for authentication. Generate them once:

```bash
npx web-push generate-vapid-keys
```

This will output:
```
Public Key: <YOUR_PUBLIC_KEY>
Private Key: <YOUR_PRIVATE_KEY>
```

### Step 2: Set Environment Variables

Add to your `.env.local`:
```
VITE_VAPID_PUBLIC_KEY=<YOUR_PUBLIC_KEY>
```

Add to Supabase Edge Function secrets (via Dashboard or CLI):
```
VAPID_PUBLIC_KEY=<YOUR_PUBLIC_KEY>
VAPID_PRIVATE_KEY=<YOUR_PRIVATE_KEY>
VAPID_SUBJECT=mailto:your-email@domain.com
```

### Step 3: Database Setup

The following tables are required (verify in Supabase):

```sql
-- Push subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Notification preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_email TEXT PRIMARY KEY,
  push_enabled BOOLEAN DEFAULT true,
  whatsapp_phone TEXT,
  whatsapp_enabled BOOLEAN DEFAULT false,
  email_enabled BOOLEAN DEFAULT true,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Notification queue for tracking
CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  channels TEXT[] DEFAULT '{push,whatsapp,email,in_app}',
  status TEXT DEFAULT 'pending',
  attempts INT DEFAULT 0,
  scheduled_for TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Step 4: Deploy Edge Function

Deploy the send-push-notification function:

```bash
supabase functions deploy send-push-notification
```

## How It Works

### User Side
1. When app loads, user is asked for notification permission
2. If granted, device is registered for push notifications
3. Subscription stored in database with user email

### Backend - When Order Synced from xLab
1. Your order sync trigger calls the `send-push-notification` function
2. Function looks up user's device subscriptions
3. Checks notification preferences
4. Sends formatted push notification to all subscribed devices

### Example: Triggering a Notification

From your backend sync function:

```javascript
// Trigger push notification for order sync
const response = await supabase.functions.invoke('send-push-notification', {
  body: {
    event_type: 'ORDER_SYNCED',
    user_email: 'user@example.com',
    payload: {
      order_number: 'ORD-12345',
      order_id: 'uuid-here',
      customer: 'xLab Store'
    }
  }
});
```

## Supported Event Types

- `ORDER_SYNCED` - Order received from xLab
- `ORDER_RECEIVED` - Order marked as received
- `PO_APPROVED` - Purchase order approved
- `PO_RECEIVED` - Purchase order received
- `INVENTORY_LOW` - Stock running low
- `TASK_ASSIGNED` - New task assignment

## Testing

### Test in Browser Console:

```javascript
// Check if push is enabled
import { isPushEnabled } from '@/lib/push.js';
const enabled = await isPushEnabled();
console.log('Push enabled:', enabled);

// Manually subscribe
import { subscribeToPush } from '@/lib/push.js';
const result = await subscribeToPush();
console.log('Subscribed:', result);
```

### Test via API:

```bash
curl -X POST https://your-project.supabase.co/functions/v1/send-push-notification \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "ORDER_SYNCED",
    "user_email": "test@example.com",
    "payload": {
      "order_number": "TEST-001"
    }
  }'
```

## Troubleshooting

### Not receiving notifications?

1. **Check browser console** for errors during subscription
2. **Verify VAPID keys** are set correctly in Supabase
3. **Check service worker** is registered: 
   - DevTools → Application → Service Workers
4. **Verify subscription** exists in database:
   ```sql
   SELECT * FROM push_subscriptions WHERE user_email = 'your@email.com';
   ```
5. **Check notification preferences**:
   ```sql
   SELECT * FROM notification_preferences WHERE user_email = 'your@email.com';
   ```

### Subscription invalid (410/404)?

Old subscriptions are automatically cleaned up. User can re-grant permission to create new subscription.

## Files Modified

- `src/components/purchaseorders/TypeformPOForm.jsx` - PO validation
- `src/pages/Inventory.jsx` - Import refetch
- `src/lib/push.js` - NEW: Push notification client library
- `src/hooks/usePushNotifications.jsx` - NEW: React hooks for notifications
- `src/main.jsx` - Push initialization
- `public/sw.js` - Enhanced service worker
- `supabase/functions/send-push-notification/index.ts` - NEW: Backend function

## Next Steps

1. ✅ Set environment variables  
2. ✅ Deploy Supabase function
3. ✅ Verify database tables exist
4. ✅ Test subscription in browser
5. ✅ Integrate with xLab order sync trigger
