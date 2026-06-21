# Meta WhatsApp Phase 1

Phase 1 is receiving-only. It verifies the Meta webhook, captures inbound WhatsApp events, stores them in OPPS, and exposes them in the inbox and hub surfaces. It does not send WhatsApp messages, auto-reply, confirm payments, create discounts, create refunds, or promise delivery dates.

## Environment Variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `META_VERIFY_TOKEN`
- `META_APP_SECRET`

## Edge Function

- `supabase/functions/meta-whatsapp-webhook/index.ts`

## Webhook Callback URL

Use the deployed Supabase Edge Function URL for the webhook callback, for example:

- `https://<project-ref>.functions.supabase.co/meta-whatsapp-webhook`

## Meta Dashboard Setup

1. Create or open the Meta App connected to the WhatsApp Business account.
2. Add the webhook callback URL above.
3. Set the verify token to the same value as `META_VERIFY_TOKEN`.
4. Subscribe the app to WhatsApp webhook fields for messages and statuses.
5. Store `META_APP_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` only in Supabase function secrets.
6. Confirm the webhook responds to verification GET requests with the challenge token.

## Test Payload Example

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "WABA_ID",
      "changes": [
        {
          "value": {
            "metadata": {
              "display_phone_number": "+27 75 453 4646",
              "phone_number_id": "PHONE_NUMBER_ID"
            },
            "contacts": [
              {
                "profile": { "name": "Demo Client" },
                "wa_id": "27820001111"
              }
            ],
            "messages": [
              {
                "from": "27820001111",
                "id": "wamid.demo1",
                "timestamp": "1718970000",
                "text": { "body": "Can I get a quote for 50 shirts?" },
                "type": "text"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

## Known Constraints

- Receiving-only; no outbound send path exists in this phase.
- No auto reply or AI automation beyond rule-based classification.
- No payment confirmation behavior.
- No discount, refund, or delivery promise behavior.
- Webhook payloads are stored raw for traceability.
- Admin-only RLS is used first; role-based access can be refined later.

## Verification Notes

Use the SQL verification file under `supabase/tests` after applying the migration.

The expected checks are:

- tables exist
- inserts work
- conversation upsert works
- a sample inbound payload creates a conversation, message, intelligence row, and agent log
- there is no outbound send function in this phase
