import { getPayfastGatewayProfile } from '../_shared/payfastGatewayProfile.js'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import md5 from 'https://esm.sh/js-md5@0.8.3'

// OPPS-106 live scanner candidate. Checkout is separately gated and NOT DEPLOYED, and the trusted
// SQL issuer switch must be explicitly enabled (currently DISABLED).
// Signed PayFast URL is derived ONLY from server-locked live QR payment intent.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const htmlEscape = (value: string) => value.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c))
function result(status: number, label: string, title: string, message: string) {
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Quick Solution · QR Payment</title><style>
*{box-sizing:border-box}body{margin:0;background:#f7f8f7;color:#10191a;font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:min(100%,480px);padding:40px 32px;border:1px solid #dae6e1;border-radius:24px;background:#fff;box-shadow:0 20px 55px #012d2511}
.eyebrow{letter-spacing:.14em;font-weight:800;text-transform:uppercase;color:#0f7766;font-size:11px}h1{font-size:clamp(26px,6vw,38px);line-height:1.15;letter-spacing:-.035em;margin:16px 0}p{color:#526263}small{color:#73817e}a{color:#076d60}
</style></head><body><main><div class="eyebrow">Quick Solution · Live</div><h1>${htmlEscape(title)}</h1><p>${htmlEscape(message)}</p><small>${htmlEscape(label)} · Payment is confirmed only after verified PayFast notification.</small></main></body></html>`
  return new Response(page,{status,headers:{
    'content-type':'text/html; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  }})
}
const phpEncode = (v: string) => encodeURIComponent(v.trim())
  .replace(/[!'()*~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  .replace(/%20/g, '+')
function payfastUrl(fields: Record<string,string>, passphrase: string, processUrl: string) {
  const valid = Object.entries(fields).filter(([,v]) => v !== '')
  const params = valid.map(([key,v]) => key + '=' + phpEncode(v)).join('&')
  const signature = md5(params + '&passphrase=' + phpEncode(passphrase))
  return processUrl + '?' + params + '&signature=' + signature
}
// Browser return pages may only read the minimal server-owned payment state.
// A QR ID is an opaque capability: never include customer, total or provider
// references in this public response. The signed PayFast ITN is still the
// sole settlement path.
const RETURN_ORIGIN = '__LIVE_ORIGIN_DISABLED_UNTIL_REVIEW__'
function statusJson(state: 'paid' | 'pending' | 'unavailable', origin: string | null, http = 200) {
  const headers: Record<string,string> = {
    'content-type':'application/json; charset=utf-8','cache-control':'no-store, max-age=0',
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'vary':'Origin'
  }
  if (origin === RETURN_ORIGIN) headers['access-control-allow-origin'] = RETURN_ORIGIN
  return new Response(JSON.stringify({state}),{status:http,headers})
}
const safeRedirect = (location: string) =>
  new Response(null,{status:303,headers:{
    location,'cache-control':'no-store','referrer-policy':'no-referrer',
    'x-content-type-options':'nosniff'
  }})
Deno.serve(async req => {
  if (req.method !== 'GET') return new Response('Method not allowed',{status:405})
  const params = new URL(req.url).searchParams
  const rid = params.get('rid') || ''
  if (params.has('status')) {
    // Status lookup never starts a checkout; reject ambiguous requests.
    if (params.size !== 2 || params.get('status') !== '1' || !UUID.test(rid)) {
      return statusJson('unavailable',req.headers.get('origin'),400)
    }
    const url = Deno.env.get('SUPABASE_URL') || ''
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!url || !key) return statusJson('unavailable',req.headers.get('origin'),503)
    try {
      const client = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
      const { data,error } = await client.rpc('qs_opps106_scan_counter_qr_status',{p_request_id:rid})
      if (error) throw error
      return statusJson(data === 'settled' ? 'paid' : ['awaiting_gateway','expired'].includes(data) ? 'pending' : 'unavailable',req.headers.get('origin'))
    } catch {
      return statusJson('unavailable',req.headers.get('origin'),503)
    }
  }
  if (params.has('return') || params.has('cancel')) {
    if (!UUID.test(rid)) return result(404,'Invalid request','This QR code is not available.','Please ask Café staff.')
    // Browser return is NEVER proof of payment. The signed webhook and
    // canonical ledger determine paid status.
    return result(200,'Processing','Payment verification in progress.','Please ask Café staff to confirm your payment before leaving.')
  }
  if (!UUID.test(rid)) return result(404,'Invalid request','This QR code is not available.','Please ask Café staff for a valid payment request.')
  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !key) return result(503,'Unavailable','Payment unavailable.','Please ask Café staff for another payment method.')
  try {
    const client = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
    const { data, error } = await client.rpc('qs_opps106_scan_counter_qr_status',{p_request_id:rid})
    if (error) throw error
    if (data === 'expired') return result(410,'Expired','This QR code has expired.','Ask Café staff for a new request. Do not retry an expired code.')
    if (data === 'revoked' || data === 'settled') return result(410,'Unavailable','This QR code is no longer valid.','Ask Café staff to confirm the payment status.')
    if (data !== 'awaiting_gateway') return result(404,'Invalid request','This QR code is not available.','Please ask Café staff for a valid payment request.')
    // A distinct private live function. Never deploy without reviewed DB
    // live RPC + gateway approvals; production issuance switch remains OFF.
    const profile = getPayfastGatewayProfile(Deno.env.toObject(), 'live')
    if (profile.ok !== true) {
      console.warn('[live-qr-scan] Gateway profile not approved:',profile.reason)
      return result(503,'Disabled','Live QR payment unavailable.','No payment has been initiated.')
    }
    const merchantId=profile.merchantId
    const merchantKey=profile.merchantKey
    const passphrase=profile.passphrase

    // Atomic server-side check: row lock + live amount + one QR intent.
    // This is fail-closed while qr_payments.issuance_controls is OFF.
    const { data: intent, error: intentError } = await client.rpc(
      'qs_opps106_start_counter_qr_checkout_live_candidate',{
        p_request_id:rid,p_checkout_environment:profile.environment,p_merchant_id:merchantId
      })
    if (intentError || intent?.ok !== true) {
      return result(503,'Not available','QR payment is not available yet.','Ask Café staff for another payment method.')
    }
    if (intent.requestId !== rid || !UUID.test(intent.paymentIntentId || '') ||
        !UUID.test(intent.tenantId || '') || !UUID.test(intent.orderId || '') ||
        !Number.isSafeInteger(Number(intent.amountCents)) ||
        Number(intent.amountCents) <= 0 || intent.currency !== 'ZAR') {
      return result(503,'Unavailable','QR payment is unavailable.','Please ask Café staff for assistance.')
    }
    // Browser return is deliberately separate from settlement. These
    // static staging pages cannot mark an order paid or read internal data.
    // The signed QR-only ITN remains the sole automatic payment trigger.
    const stagingReturnBase = profile.returnBase
    const name = String(intent.customerName || '').trim().split(/\s+/)
    const fields: Record<string,string> = {
      merchant_id:merchantId,merchant_key:merchantKey,
      return_url:stagingReturnBase + '/opps106-qr-return.html?rid=' + encodeURIComponent(rid),
      cancel_url:stagingReturnBase + '/opps106-qr-cancel.html?rid=' + encodeURIComponent(rid),
      notify_url:profile.notifyUrl,
      name_first:name[0] || 'Customer',
      name_last:name.slice(1).join(' ') || '',
      email_address:String(intent.customerEmail || ''),
      m_payment_id:'JXQR-' + rid,
      amount:(Number(intent.amountCents)/100).toFixed(2),
      item_name:'Quick Solution QR ' + String(intent.orderNumber || ''),
      custom_str1:intent.orderId,
      custom_str2:'jointx_qr_v1',
      custom_str3:rid,
      custom_str4:'cafe_order',
      custom_str5:intent.tenantId
    }
    return safeRedirect(payfastUrl(fields,passphrase,profile.processUrl))
  } catch {
    return result(503,'Unavailable','Payment unavailable.','Please ask Café staff for another payment method.')
  }
})
