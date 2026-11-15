import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import md5 from 'https://esm.sh/js-md5@0.8.3'

// PayFast ITN: reject before any privileged database mutation unless the
// merchant, signature, trusted source, transaction intent and PayFast's
// server-to-server validation all match.
// PHP urlencode semantics used for PayFast's signed form fields.
// encodeURIComponent alone leaves ! ' ( ) * and ~ unescaped.
const encode = (value: string) => encodeURIComponent(value.trim())
  .replace(/[!'()*~]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())
  .replace(/%20/g, '+')
const response = (status = 200) => new Response('OK', { status })
const isIPv4 = (ip: string) => {
  const a = ip.split('.')
  return a.length === 4 && a.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}
const ipNumber = (ip: string) => {
  if (!isIPv4(ip)) return null
  return ip.split('.').reduce((n,octet) => ((n << 8) | Number(octet)) >>> 0,0)
}
function inSourceRange(ip: string, range: string) {
  const [base,prefix,...extra] = range.split('/')
  if (extra.length > 0 || !isIPv4(base)) return false
  const bits = prefix === undefined ? 32 : Number(prefix)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32 ||
      (prefix !== undefined && !/^\d{1,2}$/.test(prefix))) return false
  const value=ipNumber(ip), network=ipNumber(base)
  if (value === null || network === null) return false
  const mask = bits === 0 ? 0 : (0xffffffff << (32-bits)) >>> 0
  return (value & mask) === (network & mask)
}
const same = (a: string, b: string) => {
  // Equal-length comparison without early exit; signature is not a password
  // but this avoids an unnecessary timing oracle on the verification check.
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
function signedPayload(body: string, passphrase: string) {
  const pairs = new URLSearchParams(body)
  const seen = new Set<string>()
  const fields: [string, string][] = []
  let signature = ''
  for (const [key, value] of pairs) {
    if (seen.has(key)) return null // Ambiguous signature/field interpretation
    seen.add(key)
    if (key === 'signature') {
      signature = value
      // PayFast's reference PHP code ends the signed field sequence here.
      // A signature followed by more fields is ambiguous: fail closed.
      if ([...pairs.keys()].at(-1) !== 'signature') return null
    } else {
      // Empty values are signed too. Omitting them changes the hash.
      fields.push([key, value])
    }
  }
  if (!/^[a-f\d]{32}$/i.test(signature)) return null
  const serialized = fields.map(([key, value]) => key + '=' + encode(value)).join('&')
  const source = serialized + (passphrase ? '&passphrase=' + encode(passphrase) : '')
  return { fields: Object.fromEntries(pairs), expected: String(md5(source)), signature: signature.toLowerCase() }
}
function trustedSource(req: Request, sandbox: boolean) {
  // The ingress MUST overwrite/remove the configured header on all requests.
  // Never use arbitrary X-Forwarded-For supplied by the calling client.
  if (Deno.env.get('PAYFAST_SOURCE_IP_GATEWAY_VERIFIED') !== 'true') return false
  const header = (Deno.env.get('PAYFAST_TRUSTED_CLIENT_IP_HEADER') || '').trim().toLowerCase()
  // Only an explicitly reviewed edge proxy may supply this single-hop header.
  if (!header || header === 'x-forwarded-for' || header === 'forwarded') return false
  const ip = (req.headers.get(header) || '').trim()
  if (!isIPv4(ip)) return false
  const allow = (Deno.env.get(sandbox ? 'PAYFAST_SANDBOX_SOURCE_IPS' : 'PAYFAST_LIVE_SOURCE_IPS') || '')
    .split(',').map(x => x.trim()).filter(Boolean)
  return allow.length > 0 && allow.some(range => inSourceRange(ip,range))
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return response(405)
  if (Number(req.headers.get('content-length') || '0') > 8192) return response(413)
  const mode = Deno.env.get('PAYFAST_SANDBOX')
  const merchantId = Deno.env.get('PAYFAST_MERCHANT_ID') || ''
  const passphrase = Deno.env.get('PAYFAST_PASSPHRASE') || ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const roleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!['true','false'].includes(String(mode)) || !merchantId || !passphrase || !supabaseUrl || !roleKey) {
    console.error('[qr-itn] Required configuration missing')
    return response(503)
  }
  const sandbox = mode === 'true'
  // This new endpoint is sandbox-only until independently released.
  if (!sandbox) return response(503)
  if (!trustedSource(req, sandbox)) {
    console.error('[qr-itn] Untrusted source or unconfigured proxy/IP allowlist')
    return response(403)
  }

  const body = await req.text()
  if (body.length > 8192) return response(413)
  const verified = signedPayload(body, passphrase)
  if (!verified || !same(verified.signature, verified.expected)) {
    // Only non-secret signature diagnostics: no raw payload, hash, passphrase or PII.
    // This helps distinguish key ordering/encoding from merchant passphrase drift.
    const pairs = new URLSearchParams(body)
    const signedFieldNames = [...pairs.keys()].filter(k => k !== 'signature')
    console.error('[qr-itn] Signature diagnostic', {
      count: signedFieldNames.length,
      keys: signedFieldNames.join(','),
      hasSignature: pairs.has('signature'),
      duplicateCount: signedFieldNames.length - new Set(signedFieldNames).size
    })
    console.error('[qr-itn] Invalid ITN signature')
    return response(403)
  }
  const p = verified.fields
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (p.merchant_id !== merchantId || p.custom_str2 !== 'jointx_qr_v1'
      || p.custom_str4 !== 'cafe_order'
      || !uuid.test(p.custom_str1 || '') || !uuid.test(p.custom_str3 || '')
      || !uuid.test(p.custom_str5 || '') || !p.pf_payment_id
      || p.m_payment_id !== 'JXQR-' + p.custom_str3
      || !['COMPLETE','FAILED','CANCELLED'].includes(p.payment_status)) {
    console.error('[qr-itn] Invalid merchant/order/intent identity')
    return response(403)
  }
  const gross = Number(p.amount_gross)
  if (!Number.isFinite(gross) || gross <= 0 || !/^\d+(\.\d{1,2})?$/.test(p.amount_gross || '')) {
    return response(403)
  }

  const supabase = createClient(supabaseUrl, roleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  // QR request and canonical checkout intent are checked atomically by
  // qs_opps106_settle_counter_qr after merchant/signature/source/remote VALID.
  // Never invoke the ordinary Café ITN handler for QR-marked notifications.

  const validateUrl = sandbox
    ? 'https://sandbox.payfast.co.za/eng/query/validate'
    : 'https://www.payfast.co.za/eng/query/validate'
  try {
    const confirm = await fetch(validateUrl,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body,
      signal:AbortSignal.timeout(12000)
    })
    if (!confirm.ok || (await confirm.text()).trim() !== 'VALID') {
      console.error('[qr-itn] PayFast server validation failed')
      return response(403)
    }
  } catch {
    // Retry rather than pretending a transient validation outage succeeded.
    console.error('[qr-itn] PayFast validation unavailable')
    return response(503)
  }

  const amountCents = Math.round(gross * 100)
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 ||
      Math.abs(amountCents / 100 - gross) > 0.000001) return response(403)

  if (p.payment_status !== 'COMPLETE') {
    // Only a signed, merchant-matched, source-allowlisted and remotely
    // validated noncomplete gateway event may close the matching intent.
    // A late COMPLETE must be quarantined, never silently credited.
    const { data: closed, error: closeError } = await supabase.rpc(
      'qs_opps106_record_counter_qr_noncomplete',{
        p_request_id: p.custom_str3,
        p_order_id: p.custom_str1,
        p_tenant_id: p.custom_str5,
        p_amount_cents: amountCents,
        p_pf_payment_id: p.pf_payment_id,
        p_status: p.payment_status === 'CANCELLED' ? 'cancelled' : 'failed'
      })
    if (closeError || closed?.ok !== true) {
      console.error('[qr-itn] Failed/cancelled event not durably recorded',closeError?.code || 'unknown')
      return response(503)
    }
    if (closed.status === 'mismatched') {
      console.warn('[qr-itn] Noncomplete event identity mismatch logged')
    }
    return response(200)
  }

  const { data, error } = await supabase.rpc('qs_opps106_settle_counter_qr',{
    p_request_id: p.custom_str3,
    p_order_id: p.custom_str1,
    p_tenant_id: p.custom_str5,
    p_amount_cents: amountCents,
    p_pf_payment_id: p.pf_payment_id,
    p_raw_itn: p
  })
  if (error || !data?.ok || !['settled','replayed','review_required'].includes(data.status)) {
    console.error('[qr-itn] Settlement or review ledger unavailable',error?.code || 'unknown')
    return response(503)
  }
  if (data.status === 'review_required') {
    console.warn('[qr-itn] Verified capture requires Finance reconciliation')
  }
  return response(200)
})
