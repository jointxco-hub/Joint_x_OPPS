import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import md5 from 'https://esm.sh/js-md5@0.8.3'

// PayFast ITN: reject before any privileged database mutation unless the
// merchant, signature, trusted source, transaction intent and PayFast's
// server-to-server validation all match.
const encode = (value: string) => encodeURIComponent(value.trim()).replace(/%20/g, '+')
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
    } else if (value !== '') {
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
    console.error('[qs-itn] Required configuration missing')
    return response(503)
  }
  const sandbox = mode === 'true'
  if (!trustedSource(req, sandbox)) {
    console.error('[qs-itn] Untrusted source or unconfigured proxy/IP allowlist')
    return response(403)
  }

  const body = await req.text()
  if (body.length > 8192) return response(413)
  const verified = signedPayload(body, passphrase)
  if (!verified || !same(verified.signature, verified.expected)) {
    console.error('[qs-itn] Invalid ITN signature')
    return response(403)
  }
  const p = verified.fields
  if (p.merchant_id !== merchantId || p.custom_str2 !== 'quick_solution'
      || !p.custom_str1 || !p.custom_str3 || !p.pf_payment_id
      || !p.m_payment_id || !['COMPLETE','FAILED','CANCELLED'].includes(p.payment_status)) {
    console.error('[qs-itn] Invalid merchant/order/intent identity')
    return response(403)
  }
  const gross = Number(p.amount_gross)
  if (!Number.isFinite(gross) || gross <= 0 || !/^\d+(\.\d{1,2})?$/.test(p.amount_gross || '')) {
    return response(403)
  }

  const supabase = createClient(supabaseUrl, roleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  // Correlate ITN with the exact checkout intent, never just a client-supplied
  // order UUID. Repeated notifications may reference a completed intent.
  const { data: binding, error: bindingError } = await supabase.rpc(
    'qs_verify_payfast_notification_intent',{
      p_order_id: p.custom_str1,
      p_intent_id: p.custom_str3,
      p_merchant_reference: p.m_payment_id,
      p_amount: gross
    }
  )
  if (bindingError) {
    console.error('[qs-itn] Payment intent verification unavailable',bindingError.code)
    return response(503)
  }
  if (binding !== true) {
    console.error('[qs-itn] Order / amount / intent mismatch')
    return response(403)
  }

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
      console.error('[qs-itn] PayFast server validation failed')
      return response(403)
    }
  } catch {
    // Retry rather than pretending a transient validation outage succeeded.
    console.error('[qs-itn] PayFast validation unavailable')
    return response(503)
  }

  if (p.payment_status === 'COMPLETE') {
    const { data, error } = await supabase.rpc('qs_apply_quick_solution_payfast_payment',{
      p_order_id: p.custom_str1, p_amount: gross, p_pf_payment_id: p.pf_payment_id,
      p_raw_itn: p
    })
    if (error || !data?.ok) {
      console.error('[qs-itn] Reconciliation failed',error?.code || data?.reason || 'unknown')
      return response(503)
    }
    return response(200)
  }
  const { error } = await supabase.rpc('qs_record_quick_solution_payfast_noncomplete',{
    p_order_id:p.custom_str1,
    p_status:p.payment_status==='CANCELLED'?'cancelled':'failed',
    p_raw_itn:p
  })
  if (error) { console.error('[qs-itn] Failed-status reconciliation failed',error.code); return response(503) }
  return response(200)
})
