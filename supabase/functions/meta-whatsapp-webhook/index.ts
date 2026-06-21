import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

const VERIFY_TOKEN = Deno.env.get('META_VERIFY_TOKEN') || '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') || '';

const INTENT_RULES = [
  { intent: 'team_log', department: 'admin', keywords: ['logged in', 'done', 'finished', 'prepared', 'printed', 'dtf', 'artwork', 'design done', 'order packed', 'paxi', 'courier', 'sent', 'delivered', 'internal', 'team', 'ops note', 'log', 'handover'] },
  { intent: 'complaint', department: 'support', keywords: ['complaint', 'wrong order', 'angry', 'refund', 'issue', 'problem', 'late delivery'] },
  { intent: 'payment_query', department: 'finance', keywords: ['payment issue', 'payment', 'paid', 'eft', 'deposit', 'balance', 'proof of payment', 'not paid', 'chargeback'] },
  { intent: 'invoice_request', department: 'finance', keywords: ['invoice', 'statement', 'receipt', 'invoice please', 'receipt please'] },
  { intent: 'delivery_request', department: 'delivery', keywords: ['delivery', 'courier', 'tracking', 'late', 'eta', 'arrive', 'paxi'] },
  { intent: 'production_update', department: 'production', keywords: ['production update', 'production', 'printing', 'printed', 'ready for production', 'in production', 'packed'] },
  { intent: 'order_update', department: 'production', keywords: ['order update', 'status of my order', 'where is my order', 'progress', 'ready yet', 'update on my order'] },
  { intent: 'artwork_request', department: 'design', keywords: ['artwork', 'send artwork', 'logo', 'design', 'mockup', 'proof', 'file'] },
  { intent: 'design_update', department: 'design', keywords: ['design update', 'design done', 'design approved', 'proof approved', 'artwork updated'] },
  { intent: 'quote_request', department: 'support', keywords: ['quote', 'price', 'pricing', 'estimate', 'cost', 'how much', 'quote please'] },
  { intent: 'general_support', department: 'support', keywords: ['hello', 'hi', 'help', 'support', 'assist'] },
];

const RISK_KEYWORDS = ['refund', 'payment issue', 'complaint', 'urgent', 'angry', 'wrong order', 'late delivery', 'late', 'not paid', 'chargeback'];

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    return handleVerification(url);
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');

  if (signature && !APP_SECRET) {
    await logEvent('signature_secret_missing', 'failure', { signature_present: true });
    return new Response('Webhook secret not configured', { status: 500 });
  }

  if (signature && !(await verifySignature(rawBody, signature, APP_SECRET))) {
    await logEvent('signature_invalid', 'failure', { signature_present: true });
    return new Response('Invalid signature', { status: 403 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await logEvent('payload_parse_error', 'failure', { raw_length: rawBody.length });
    return new Response('Invalid JSON payload', { status: 400 });
  }

  try {
    const results = await processWebhookPayload(payload);
    return new Response(JSON.stringify({ ok: true, ...results }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    console.error('meta-whatsapp-webhook error:', error);
    await logEvent('webhook_processing_error', 'failure', {
      message: error?.message || 'Unknown error',
    });
    return new Response(JSON.stringify({ error: 'Webhook processing failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});

function handleVerification(url) {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && VERIFY_TOKEN && token === VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }

  return new Response('Forbidden', { status: 403 });
}

async function processWebhookPayload(payload) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  let inboundCount = 0;
  let statusCount = 0;

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const metadata = value?.metadata || {};
      const businessPhone = metadata?.display_phone_number || metadata?.phone_number_id || null;
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];

      for (const message of messages) {
        if (!message?.from) continue;
        const contact = contacts[0] || {};
        const displayName = contact?.profile?.name || message?.profile?.name || contact?.wa_id || message.from;
        const conversation = await upsertConversation({
          tenantId: null,
          waId: contact?.wa_id || message.from,
          phone: contact?.wa_id || message.from || businessPhone,
          displayName,
        });

        const messageRow = await insertMessage({
          conversationId: conversation.id,
          direction: 'inbound',
          metaMessageId: message.id || null,
          waId: contact?.wa_id || message.from,
          phone: contact?.wa_id || message.from || businessPhone,
          messageType: message.type || 'text',
          body: extractMessageBody(message),
          rawPayload: message,
          receivedAt: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });

        await insertAttachments(conversation.id, messageRow.id, message);
        await insertIntelligence(conversation.id, messageRow.id, message);
        await incrementConversationSignals(conversation.id, conversation.tenant_id, message);
        await logEvent('message_received', 'success', {
          conversation_id: conversation.id,
          message_id: messageRow.id,
          message_type: message.type || 'text',
        }, conversation.id, messageRow.id);
        inboundCount += 1;
      }

      for (const status of statuses) {
        const linked = await findMessageByMetaId(status.id);
        const conversationId = linked?.conversation_id || null;
        const messageRow = await insertMessage({
          conversationId: conversationId || (await ensureStatusConversation(value, businessPhone)).id,
          direction: 'status',
          metaMessageId: status.id || null,
          waId: status.recipient_id || businessPhone,
          phone: status.recipient_id || businessPhone,
          messageType: 'status',
          body: status.status || 'status_update',
          rawPayload: status,
          receivedAt: status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });
        await logEvent('status_received', 'success', {
          conversation_id: messageRow.conversation_id,
          message_id: messageRow.id,
          status: status.status,
        }, messageRow.conversation_id, messageRow.id);
        statusCount += 1;
      }
    }
  }

  return { inboundCount, statusCount };
}

async function upsertConversation({ tenantId, waId, phone, displayName }) {
  const { data, error } = await supabase.rpc('upsert_opps_conversation', {
    p_tenant_id: tenantId,
    p_wa_id: waId,
    p_phone: phone,
    p_display_name: displayName,
    p_channel: 'whatsapp',
  });

  if (error) throw error;
  return data;
}

async function ensureStatusConversation(value, fallbackPhone) {
  const statusPhone = value?.metadata?.display_phone_number || fallbackPhone || value?.metadata?.phone_number_id || null;
  return upsertConversation({
    tenantId: null,
    waId: statusPhone,
    phone: statusPhone,
    displayName: value?.contacts?.[0]?.profile?.name || value?.contacts?.[0]?.wa_id || statusPhone || 'WhatsApp Status',
  });
}

async function insertMessage({ conversationId, direction, metaMessageId, waId, phone, messageType, body, rawPayload, receivedAt }) {
  const { data, error } = await supabase
    .from('opps_messages')
    .insert({
      conversation_id: conversationId,
      channel: 'whatsapp',
      direction,
      meta_message_id: metaMessageId,
      wa_id: waId,
      phone: normalizePhone(phone),
      message_type: messageType,
      body,
      raw_payload: rawPayload || {},
      received_at: receivedAt,
    })
    .select('*')
    .single();

  if (error) throw error;

  if (direction === 'inbound') {
    const preview = (body || messagePreview(rawPayload) || '').slice(0, 180);
    const { data: currentConversation, error: conversationReadError } = await supabase
      .from('opps_conversations')
      .select('unread_count')
      .eq('id', conversationId)
      .maybeSingle();

    if (conversationReadError) throw conversationReadError;

    const { error: updateError } = await supabase
      .from('opps_conversations')
      .update({
        last_message_at: receivedAt,
        last_message_preview: preview,
        unread_count: Number(currentConversation?.unread_count || 0) + 1,
      })
      .eq('id', conversationId);
    if (updateError) throw updateError;
  }

  return data;
}

async function insertIntelligence(conversationId, messageId, message) {
  const analysis = classifyMessage(extractMessageBody(message));
  const { error } = await supabase.from('opps_message_intelligence').insert({
    message_id: messageId,
    conversation_id: conversationId,
    intent: analysis.intent,
    sentiment: analysis.sentiment,
    risk_level: analysis.riskLevel,
    suggested_department: analysis.department,
    suggested_next_action: analysis.nextAction,
    summary: analysis.summary,
  });
  if (error) throw error;
}

async function insertAttachments(conversationId, messageId, message) {
  const attachments = [];
  const mimeType = message?.image?.mime_type || message?.video?.mime_type || message?.audio?.mime_type || message?.document?.mime_type || null;
  const mediaId = message?.image?.id || message?.video?.id || message?.audio?.id || message?.document?.id || null;
  const caption = message?.image?.caption || message?.video?.caption || message?.document?.caption || null;
  if (mediaId || mimeType) {
    attachments.push({
      conversation_id: conversationId,
      message_id: messageId,
      media_id: mediaId,
      mime_type: mimeType,
      sha256: message?.image?.sha256 || message?.video?.sha256 || message?.document?.sha256 || null,
      filename: message?.document?.filename || message?.image?.filename || message?.video?.filename || null,
      caption,
      raw_payload: message,
    });
  }
  if (attachments.length === 0) return;
  const { error } = await supabase.from('opps_message_attachments').insert(attachments);
  if (error) throw error;
}

async function incrementConversationSignals(conversationId, tenantId, message) {
  const body = extractMessageBody(message);
  const analysis = classifyMessage(body);
  await upsertSignal(tenantId, 'inbound_today', 1, { conversation_id: conversationId, intent: analysis.intent });
  if (analysis.riskLevel === 'high') {
    await upsertSignal(tenantId, 'high_risk_today', 1, { conversation_id: conversationId, intent: analysis.intent });
  }
  if (['quote_request', 'order_update', 'artwork_request', 'invoice_request', 'delivery_request', 'team_log'].includes(analysis.intent)) {
    await upsertSignal(tenantId, `${analysis.intent}_today`, 1, { conversation_id: conversationId });
  }
}

async function upsertSignal(tenantId, signalKey, incrementBy, details) {
  const signalDate = new Date().toISOString().slice(0, 10);
  const { data: existing, error: readError } = await supabase
    .from('opps_daily_activity_signals')
    .select('id, signal_value')
    .eq('tenant_id', tenantId)
    .eq('signal_date', signalDate)
    .eq('signal_key', signalKey)
    .maybeSingle();

  if (readError) throw readError;

  if (existing) {
    const { error } = await supabase
      .from('opps_daily_activity_signals')
      .update({ signal_value: Number(existing.signal_value || 0) + incrementBy, details })
      .eq('id', existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from('opps_daily_activity_signals').insert({
    tenant_id: tenantId,
    signal_date: signalDate,
    signal_key: signalKey,
    signal_value: incrementBy,
    details,
  });
  if (error) throw error;
}

async function findMessageByMetaId(metaMessageId) {
  if (!metaMessageId) return null;
  const { data, error } = await supabase
    .from('opps_messages')
    .select('id, conversation_id')
    .eq('meta_message_id', metaMessageId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function logEvent(eventType, status, details = {}, conversationId = null, messageId = null) {
  const { error } = await supabase.from('opps_agent_logs').insert({
    source: 'meta_whatsapp_webhook',
    event_type: eventType,
    status,
    conversation_id: conversationId,
    message_id: messageId,
    details,
  });
  if (error) throw error;
}

function extractMessageBody(message) {
  return (
    message?.text?.body ||
    message?.button?.text ||
    message?.interactive?.button_reply?.title ||
    message?.interactive?.list_reply?.title ||
    message?.image?.caption ||
    message?.video?.caption ||
    message?.document?.caption ||
    message?.system?.body ||
    ''
  );
}

function messagePreview(rawPayload) {
  return extractMessageBody(rawPayload).trim();
}

function normalizePhone(value) {
  const cleaned = String(value || '').trim().toLowerCase().replace(/[^0-9+]/g, '');
  return cleaned ? cleaned : null;
}

function classifyMessage(body) {
  const normalized = String(body || '').toLowerCase();
  const matchedRule = INTENT_RULES.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)));
  const intent = matchedRule?.intent || 'unknown';
  const department = matchedRule?.department || 'support';
  const highRisk = RISK_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const sentiment = highRisk ? 'negative' : normalized ? 'neutral' : 'unknown';
  const nextAction = getNextAction(intent, highRisk);
  return {
    intent,
    department,
    riskLevel: highRisk ? 'high' : 'normal',
    sentiment,
    nextAction,
    summary: body ? body.slice(0, 220) : 'Inbound WhatsApp message captured.',
  };
}

function getNextAction(intent, highRisk) {
  if (highRisk) return 'Review immediately and respond manually.';
  const nextActions = {
    quote_request: 'Route to quotes review and confirm scope.',
    order_update: 'Check order status and respond with a human update.',
    artwork_request: 'Check artwork files and design queue.',
    invoice_request: 'Review invoice or payment query with finance.',
    payment_query: 'Review payment status and confirm funds manually.',
    delivery_request: 'Check delivery status before replying.',
    complaint: 'Escalate to support and production lead.',
    production_update: 'Review production queue and update operations.',
    design_update: 'Review design queue and update the creative team.',
    team_log: 'Log internally and review in Ops.',
    general_support: 'Triage and assign to support.',
    unknown: 'Review the message and assign a department.',
  };
  return nextActions[intent] || nextActions.unknown;
}

async function verifySignature(rawBody, signatureHeader, appSecret) {
  const provided = signatureHeader.replace(/^sha256=/i, '').trim();
  if (!provided) return false;
  const encoded = new TextEncoder().encode(rawBody);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoded);
  const expected = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, provided.toLowerCase());
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}
