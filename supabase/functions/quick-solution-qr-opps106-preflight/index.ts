import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

// OPPS-106 staging counter QR eligibility only.
// No payment request creation, PayFast call, checkout URL or receipt mutation.
const PREVIEW_ORIGIN = 'https://quick-solution-cafe-staging-git-feature-opps106-d3a1f2-joint-x.vercel.app'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function headers(req: Request) {
  const h = new Headers({
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'vary': 'Origin',
    'x-content-type-options': 'nosniff',
  })
  if (req.headers.get('origin') === PREVIEW_ORIGIN) {
    h.set('access-control-allow-origin', PREVIEW_ORIGIN)
    h.set('access-control-allow-methods', 'POST, OPTIONS')
    h.set('access-control-allow-headers', 'authorization, apikey, content-type, x-client-info')
  }
  return h
}
function reply(req: Request, code: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status: code, headers: headers(req) })
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(req) })
  if (req.method !== 'POST') return reply(req,405,{ok:false,reason:'METHOD_NOT_ALLOWED'})
  if (Number(req.headers.get('content-length') || '0') > 4096) {
    return reply(req,413,{ok:false,reason:'INVALID_REQUEST'})
  }

  // Validate the caller as a Supabase Auth user, never as an API key.
  const authorization = req.headers.get('authorization') || ''
  const jwt = /^Bearer ([-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+)$/.exec(authorization)?.[1]
  if (!jwt) return reply(req,401,{ok:false,reason:'AUTH_REQUIRED'})
  const url = Deno.env.get('SUPABASE_URL') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  if (!url || !anonKey) return reply(req,503,{ok:false,reason:'UNAVAILABLE'})
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: 'Bearer ' + jwt } },
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data: auth, error: authError } = await client.auth.getUser(jwt)
  if (authError || !auth?.user?.id) return reply(req,401,{ok:false,reason:'AUTH_REQUIRED'})

  let body: unknown
  try { body = await req.json() } catch { return reply(req,400,{ok:false,reason:'INVALID_REQUEST'}) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return reply(req,400,{ok:false,reason:'INVALID_REQUEST'})
  }
  const { action, orderId } = body as { action?: unknown, orderId?: unknown }
  if (action !== 'check' || typeof orderId !== 'string' || !UUID.test(orderId)) {
    return reply(req,400,{ok:false,reason:'INVALID_REQUEST'})
  }
  const { data, error } = await client.rpc('qs_opps106_counter_qr_preflight',{ p_order_id:orderId })
  if (error) {
    console.error('[opps106-qr-preflight] RPC unavailable', error.code || 'unknown')
    return reply(req,503,{ok:false,reason:'UNAVAILABLE'})
  }
  if (!data?.ok) return reply(req,403,{ok:false,reason:data?.reason || 'NOT_AUTHORIZED'})
  return reply(req,200,data)
})
