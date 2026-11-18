import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import handler from '../api/opps106-qr-status.js'

const rid='f50bd2bf-7ee5-4389-b9d6-9867e04d8e66'
const makeRes=()=>{
  const obj={headers:{},statusCode:200,result:null,
    setHeader(key,value){this.headers[key]=value;return this},
    status(code){this.statusCode=code;return this},
    json(value){this.result=value;return this}}
  return obj
}
test('return page stays same-origin and has a Vercel API route before SPA rewrite',()=>{
  const html=readFileSync('public/opps106-qr-return.html','utf8')
  const cfg=JSON.parse(readFileSync('vercel.json','utf8'))
  assert.match(html,/const base='\/api\/opps106-qr-status'/)
  assert.match(html,/mode:'same-origin'/)
  assert.match(html,/connect-src 'self'/)
  assert.equal(cfg.rewrites[0].source,'/api/opps106-qr-status')
  assert.equal(cfg.rewrites[0].destination,'/api/opps106-qr-status')
})
test('read-only relay cannot scan/start payment: pinned status=1 and minimal status response',async()=>{
  const original=globalThis.fetch
  let called=0
  globalThis.fetch=async (url,options)=>{
    called+=1
    const parsed=new URL(String(url))
    assert.equal(parsed.origin,'https://tijiamrfnxrbitafiflj.supabase.co')
    assert.equal(parsed.pathname,'/functions/v1/quick-solution-qr-opps106-scan')
    assert.equal(parsed.searchParams.get('rid'),rid)
    assert.equal(parsed.searchParams.get('status'),'1')
    assert.equal(parsed.searchParams.size,2)
    assert.equal(options.method,'GET')
    assert.equal(options.redirect,'error')
    return {ok:true,async json(){return {state:'paid',secret:'never expose'}}}
  }
  try {
    const res=makeRes()
    await handler({method:'GET',query:{rid}},res)
    assert.equal(called,1)
    assert.equal(res.statusCode,200)
    assert.deepEqual(res.result,{state:'paid'})
    assert.match(res.headers['Cache-Control'],/no-store/)
  } finally {globalThis.fetch=original}
})
test('malformed, excess parameters and POST fail before upstream access',async()=>{
  const original=globalThis.fetch
  globalThis.fetch=()=>{throw Error('Should not be called')}
  try{
    for(const req of [
      {method:'POST',query:{rid}},
      {method:'GET',query:{rid:'not-a-uuid'}},
      {method:'GET',query:{rid,status:'0'}},
      {method:'GET',query:{rid:[rid]}}
    ]){
      const res=makeRes()
      await handler(req,res)
      assert.ok([400,405].includes(res.statusCode))
      assert.deepEqual(res.result,{state:'unavailable'})
    }
  }finally{globalThis.fetch=original}
})
test('upstream failure never becomes a paid claim',async()=>{
  const original=globalThis.fetch
  globalThis.fetch=async()=>{throw Error('network unavailable')}
  try{
    const res=makeRes()
    await handler({method:'GET',query:{rid}},res)
    assert.equal(res.statusCode,503)
    assert.deepEqual(res.result,{state:'unavailable'})
  }finally{globalThis.fetch=original}
})
