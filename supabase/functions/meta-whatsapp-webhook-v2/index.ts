import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
const VERIFY_TOKEN = Deno.env.get('META_VERIFY_TOKEN') || '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') || '';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') return verifyChallenge(url);
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');
  if (signature && (!APP_SECRET || !(await verifySignature(rawBody, signature, APP_SECRET)))) return new Response('Invalid signature', { status: 403 });
  try {
    const result = await processPayload(JSON.parse(rawBody));
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('meta-whatsapp-webhook-v2:', error);
    await log('webhook_processing_error', 'failure', { message: error?.message || 'Unknown error' });
    return Response.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
});

function verifyChallenge(url: URL) {
  const valid = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === VERIFY_TOKEN;
  return valid ? new Response(url.searchParams.get('hub.challenge') || '', { status: 200 }) : new Response('Forbidden', { status: 403 });
}

async function processPayload(payload: any) {
  let inbound = 0; let duplicates = 0; let statuses = 0;
  for (const entry of payload?.entry || []) for (const change of entry?.changes || []) {
    const value = change?.value || {}; const contacts = value.contacts || [];
    for (const message of value.messages || []) {
      const waId = message?.from || contacts[0]?.wa_id;
      if (!waId) continue;
      const duplicate = message.id ? await findMessage(message.id) : null;
      if (duplicate) { duplicates += 1; await log('message_duplicate_ignored', 'success', { meta_message_id: message.id }, duplicate.conversation_id, duplicate.id); continue; }
      const contact = contacts.find((item: any) => item.wa_id === waId) || contacts[0] || {};
      const conversation = await upsertConversation(waId, contact?.profile?.name || waId);
      const receivedAt = message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString();
      const body = messageBody(message);
      const { data: row, error } = await supabase.from('opps_messages').insert({ conversation_id: conversation.id, channel: 'whatsapp', direction: 'inbound', meta_message_id: message.id || null, wa_id: waId, phone: normalize(waId), message_type: message.type || 'text', body, raw_payload: message, received_at: receivedAt }).select('id').single();
      if (error) throw error;
      const { data: current, error: readError } = await supabase.from('opps_conversations').select('unread_count').eq('id', conversation.id).single();
      if (readError) throw readError;
      const { error: updateError } = await supabase.from('opps_conversations').update({ display_name: contact?.profile?.name || conversation.display_name, last_message_at: receivedAt, last_message_preview: body.slice(0, 180), unread_count: Number(current?.unread_count || 0) + 1 }).eq('id', conversation.id);
      if (updateError) throw updateError;
      const classification = classify(body);
      const { error: intelligenceError } = await supabase.from('opps_message_intelligence').insert({ message_id: row.id, conversation_id: conversation.id, intent: classification.intent, sentiment: classification.sentiment, risk_level: classification.risk, suggested_department: classification.department, suggested_next_action: classification.nextAction, summary: body || 'Inbound WhatsApp message captured.' });
      if (intelligenceError) throw intelligenceError;
      await log('message_received', 'success', { message_type: message.type || 'text' }, conversation.id, row.id); inbound += 1;
    }
    for (const status of value.statuses || []) {
      const linked = status?.id ? await findMessage(status.id) : null;
      if (!linked) { await log('status_unlinked_ignored', 'success', { meta_message_id: status?.id || null, status: status?.status || null }); statuses += 1; continue; }
      await log('status_received', 'success', { status: status.status || 'status_update', meta_message_id: status.id }, linked.conversation_id, linked.id);
      statuses += 1;
    }
  }
  return { inboundCount: inbound, duplicateCount: duplicates, statusCount: statuses };
}

async function upsertConversation(waId: string, displayName: string) {
  const { data, error } = await supabase.rpc('upsert_opps_conversation', { p_tenant_id: null, p_wa_id: waId, p_phone: waId, p_display_name: displayName, p_channel: 'whatsapp' });
  if (error) throw error; return data;
}
async function findMessage(metaMessageId: string) { const { data, error } = await supabase.from('opps_messages').select('id,conversation_id').eq('meta_message_id', metaMessageId).order('created_at', { ascending: true }).limit(1).maybeSingle(); if (error) throw error; return data; }
async function log(eventType: string, status: string, details: any = {}, conversationId: string | null = null, messageId: string | null = null) { const { error } = await supabase.from('opps_agent_logs').insert({ source: 'meta_whatsapp_webhook_v2', event_type: eventType, status, details, conversation_id: conversationId, message_id: messageId }); if (error) throw error; }
function messageBody(message: any) { return message?.text?.body || message?.button?.text || message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title || message?.image?.caption || message?.video?.caption || message?.document?.caption || message?.system?.body || ''; }
function normalize(value: string) { const cleaned = String(value || '').replace(/[^0-9+]/g, ''); return cleaned || null; }
function classify(body: string) { const text = body.toLowerCase(); const risk = /refund|payment issue|complaint|urgent|angry|wrong order|late delivery|chargeback/.test(text) ? 'high' : 'normal'; const rules: Array<[string, string, RegExp]> = [['team_log', 'admin', /logged in|done|finished|prepared|printed|packed|handover/], ['payment_query', 'finance', /payment|eft|deposit|balance|proof/], ['invoice_request', 'finance', /invoice|statement|receipt/], ['delivery_request', 'delivery', /delivery|courier|tracking|paxi/], ['production_update', 'production', /production|printing|printed|packed/], ['artwork_request', 'design', /artwork|logo|design|mockup|proof/], ['quote_request', 'support', /quote|price|pricing|estimate|cost/], ['complaint', 'support', /complaint|wrong order|issue|problem/]]; const found = rules.find((rule) => rule[2].test(text)); return { intent: found?.[0] || 'unknown', department: found?.[1] || 'support', risk, sentiment: risk === 'high' ? 'negative' : text ? 'neutral' : 'unknown', nextAction: risk === 'high' ? 'Review immediately and respond manually.' : 'Review and assign internally.' }; }
async function verifySignature(raw: string, header: string, secret: string) { const supplied = header.replace(/^sha256=/i, '').trim(); const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)); const expected = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join(''); if (expected.length !== supplied.length) return false; let result = 0; for (let i = 0; i < expected.length; i += 1) result |= expected.charCodeAt(i) ^ supplied.toLowerCase().charCodeAt(i); return result === 0; }
