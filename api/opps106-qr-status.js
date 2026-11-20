// OPPS-106 staging only. Same-origin, read-only status relay for static
// PayFast return pages. The browser never receives a service-role credential.
// No checkout, payment, settlement, or Finance mutations are possible here.
const QR_STATUS_ORIGIN = 'https://tijiamrfnxrbitafiflj.supabase.co'
const QR_SCAN_PATH = '/functions/v1/quick-solution-qr-opps106-scan'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const noStore = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
}
function send(res, code, state) {
  for (const [key,value] of Object.entries(noStore)) res.setHeader(key,value)
  return res.status(code).json({state})
}
export default async function handler(req,res) {
  if(req.method !== 'GET') return send(res,405,'unavailable')
  const rid = req.query?.rid
  if(typeof rid !== 'string' || !UUID.test(rid) ||
     Object.keys(req.query || {}).length !== 1) return send(res,400,'unavailable')
  const url = new URL(QR_SCAN_PATH,QR_STATUS_ORIGIN)
  url.searchParams.set('rid',rid)
  url.searchParams.set('status','1') // Never call the PayFast scan/checkout route.
  try {
    const response = await fetch(url,{method:'GET',headers:{accept:'application/json'},
      redirect:'error',cache:'no-store',signal:AbortSignal.timeout(6000)})
    if(!response.ok) return send(res,503,'unavailable')
    const body = await response.json()
    if(!body || !['paid','pending','unavailable'].includes(body.state))
      return send(res,503,'unavailable')
    return send(res,200,body.state)
  }catch {
    return send(res,503,'unavailable')
  }
}
