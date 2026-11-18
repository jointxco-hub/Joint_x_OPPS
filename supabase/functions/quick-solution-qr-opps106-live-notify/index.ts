import { getPayfastGatewayProfile, matchGatewayCheckoutProfile } from '../_shared/payfastGatewayProfile.js'
import { resolveVerifiedPayfastEnvironment } from '../_shared/qrGatewayEnvironmentContract.js'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import md5 from 'https://esm.sh/js-md5@0.8.3'

// OPPS-106 live candidate (NOT DEPLOYED): reject before privileged mutation unless the
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
  const profile=getPayfastGatewayProfile(Deno.env.toObject(),'live')
  const supabaseUrl=Deno.env.get('SUPABASE_URL') || ''
  const roleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if(profile.ok!==true || !supabaseUrl || !roleKey) {
    console.error('[live-qr-itn] Gateway not authorized or backend unavailable')
    return response(503)
  }
  const merchantId=profile.merchantId
  const passphrase=profile.passphrase
  const sandbox=false
  if (!trustedSource(req, sandbox)) {
    console.error('[qr-itn] Untrusted source or unconfigured proxy/IP allowlist')
    return response(403)
  }

  // PayFast's dashboard resend uses multipart/form-data; the original
  // sandbox ITN uses application/x-www-form-urlencoded. Parse both into the
  // SAME canonical form representation before signature and remote VALID.
  // Reject files, duplicate keys, and unsupported media types.
  const contentType = (req.headers.get('content-type') || '').toLowerCase()
  let body = ''
  if (contentType.startsWith('application/x-www-form-urlencoded')) {
    body = await req.text()
  } else if (contentType.startsWith('multipart/form-data;')) {
    let form: FormData
    try { form = await req.formData() } catch { return response(400) }
    const fields = new URLSearchParams()
    const seen = new Set<string>()
    for (const [key,value] of form.entries()) {
      if (typeof value !== 'string' || seen.has(key)) return response(400)
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) return response(400)
      seen.add(key)
      fields.append(key,value)
    }
    body = fields.toString()
  } else {
    console.error('[qr-itn] Unsupported ITN content type')
    return response(415)
  }
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

  const validateUrl = profile.validationUrl
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

  // The original scanner bound these values under a canonical-order lock.
  // No environment/merchant values are accepted from the browser or raw ITN.
  // Legacy unbound requests remain review-only.
  const { data: bound, error: boundError } = await supabase.rpc(
    'qs_opps106_get_counter_qr_checkout_identity',{p_request_id:p.custom_str3})
  const contextMatches = !boundError && bound?.ok === true
    && bound.environment === 'live'
    && bound.merchantId === merchantId
    && bound.requestId === p.custom_str3
    && bound.orderId === p.custom_str1
    && bound.tenantId === p.custom_str5
    && bound.gatewayReference === p.m_payment_id
    && Number(bound.amountCents) === amountCents

  const checkoutMatch=contextMatches
    ? matchGatewayCheckoutProfile(profile,{
        environment:bound.environment,merchantId:bound.merchantId,
        gatewayReference:bound.gatewayReference,amountCents:Number(bound.amountCents)
      })
    : {ok:false}
  let approved = contextMatches && checkoutMatch.ok === true
  if (p.payment_status === 'COMPLETE' && approved) {
    const proof = resolveVerifiedPayfastEnvironment({
      serverConfig: { environment:profile.environment,merchantId },
      intent: {
        environment: bound.environment, merchantId: bound.merchantId,
        requestId: bound.requestId, orderId: bound.orderId,
        tenantId: bound.tenantId, gatewayReference: bound.gatewayReference,
        amountCents: Number(bound.amountCents)
      },
      // These booleans represent completed verification steps in THIS
      // trusted callback, never raw client or database-provided booleans.
      verifiedCallback: {
        environment:profile.environment, merchantId:p.merchant_id,
        requestId:p.custom_str3, orderId:p.custom_str1,
        tenantId:p.custom_str5, gatewayReference:p.m_payment_id,
        gatewayPaymentId:p.pf_payment_id, amountCents,
        signatureValid:true, trustedSource:true, remoteValidated:true,
        status:p.payment_status
      }
    })
    approved = proof.ok === true && proof.environment === 'live'
      && proof.evidence === 'payfast_itn_validated_live'
  }
  if (!approved) {
    // This is a verified provider notification, not a customer return URL.
    // Persist the exception; NEVER mark paid or clear the Cash/Card hold.
    const { data: quarantined, error: qError } = await supabase.rpc(
      'qs_opps106_quarantine_verified_qr_capture',{
        p_request_id:p.custom_str3,p_order_id:p.custom_str1,
        p_tenant_id:p.custom_str5,p_amount_cents:amountCents,
        p_pf_payment_id:p.pf_payment_id,
        p_reason:contextMatches
          ? 'GATEWAY_PROVENANCE_MISMATCH'
          : 'QR_CHECKOUT_PROVENANCE_REVIEW'
      })
    if (qError || quarantined?.ok !== true) {
      console.error('[qr-itn] Verified provenance mismatch could not be durably quarantined')
      return response(503)
    }
    console.warn('[qr-itn] Verified capture requires provenance review')
    return response(200)
  }

  if (p.payment_status !== 'COMPLETE') {
    // Only a signed, merchant-matched, source-allowlisted and remotely
    // validated noncomplete gateway event may close the matching intent.
    // A late COMPLETE must be quarantined, never silently credited.
    const { data: closed, error: closeError } = await supabase.rpc(
      'qs_opps106_record_counter_qr_noncomplete_live_candidate',{
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

  const { data, error } = await supabase.rpc('qs_opps106_settle_counter_qr_live_candidate',{
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
