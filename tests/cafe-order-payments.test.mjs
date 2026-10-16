import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const hooks = `export function useState(initial){const h=globalThis.__cafeHooks,i=h.index++;if(!(i in h.values))h.values[i]=initial;return[h.values[i],v=>h.values[i]=typeof v==='function'?v(h.values[i]):v]} export function useRef(initial){const h=globalThis.__cafeHooks,i=h.index++;return h.values[i]??=( {current:initial} )}`;
const query = `export const useQuery=()=>globalThis.__cafeQuery;export const useQueryClient=()=>({setQueryData:(key,value)=>{globalThis.__cafeQuery.data=value},invalidateQueries:async(key)=>{globalThis.__invalidated.push(key.queryKey[0])}})`;
const api = `export const reconcileCafeInvoiceReceipts=(orderId)=>globalThis.__syncCafeInvoice(orderId);export const getCafeOrderPaymentState=async()=>({});export const recordCafeOrderPayment=(payload)=>globalThis.__saveCafeReceipt(payload)`;
const bundled = await build({ entryPoints:["src/components/orders/drawer/CafeOrderPayments.jsx"], bundle:true,write:false,format:"cjs",platform:"node",jsx:"transform",jsxFactory:"h",tsconfigRaw:{compilerOptions:{jsx:"react",jsxFactory:"h"}},plugins:[{name:"mock",setup(b){b.onResolve({filter:/^(react|@tanstack\/react-query|@\/api\/cafePayments)$/},a=>({path:a.path,namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},a=>({contents:a.path==="react"?hooks:a.path.includes("react-query")?query:api,loader:"js"}))}}] });
const m={exports:{}};const h=(type,props,...children)=>({type,props:{...props,children}});
new Function("module","exports","require","h","React",bundled.outputFiles[0].text)(m,m.exports,createRequire(import.meta.url),h,{createElement:h,Fragment:Symbol.for("react.fragment")});
const Component=m.exports.default;
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[];
const txt=n=>Array.isArray(n)?n.map(txt).join(''):n&&typeof n==='object'?txt(n.props?.children):n==null||typeof n==='boolean'?'':String(n);
const button=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&txt(n)===label);
const input=(tree,predicate)=>nodes(tree).find(n=>n.type==='input'&&predicate(n.props));
function setup(patch={},error=null){globalThis.__cafeHooks={index:0,values:[]};globalThis.__invalidated=[];globalThis.__cafeQuery={data:{balanceDue:5,cafePaid:0,receipts:[],reviewRequired:false,closed:false,...patch},error,refetch(){},isLoading:false};return()=>{globalThis.__cafeHooks.index=0;return Component({orderId:"opps-test"})};}
const submit=tree=>nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
const confirm=tree=>input(tree,p=>p.type==='checkbox').props.onChange({target:{checked:true}});

test("a failed response retains receipt identity and confirmed retries update shared readers",async()=>{
 const render=setup();let fail=true;const calls=[];globalThis.__saveCafeReceipt=async p=>{calls.push(p);if(fail)throw Error("Network interrupted");return{payment:{balanceDue:0,cafePaid:5,receipts:[]}}};
 button(render(),"Record payment").props.onClick();await submit(render());assert.equal(calls.length,0);
 confirm(render());await submit(render());assert.match(txt(render()),/Network interrupted/);
 fail=false;await submit(render());assert.equal(calls.length,2);assert.equal(calls[0].operationKey,calls[1].operationKey);assert.equal(calls[0].oppsOrderId,"opps-test");assert.equal(calls[0].amount,5);
 assert.equal(button(render(),"Record payment"),undefined);for(const key of ['payments','transactions','income','orders','productionReadiness','orderLineProductionReadiness'])assert.ok(globalThis.__invalidated.includes(key));
});
test("rapid double submission sends one receipt request",async()=>{
 const render=setup();let release;let calls=0;globalThis.__saveCafeReceipt=async()=>{calls++;await new Promise(r=>release=r);return{payment:{balanceDue:0,cafePaid:5,receipts:[]}}};
 button(render(),"Record payment").props.onClick();confirm(render());const tree=render();const first=submit(tree);await submit(tree);assert.equal(calls,1);release();await first;
});
test("EFT needs verification and a bank reference",async()=>{
 const render=setup();let calls=0;globalThis.__saveCafeReceipt=async()=>{calls++;};button(render(),"Record payment").props.onClick();confirm(render());
 nodes(render()).find(n=>n.type==='select').props.onChange({target:{value:'eft'}});assert.equal(button(render(),"Confirm payment received").props.disabled,true);
 assert.equal(input(render(),p=>p.maxLength===120).props.required,true);confirm(render());await submit(render());assert.equal(calls,0);assert.match(txt(render()),/Enter the bank reference/);
});
test("closed, review, fully paid and failed reads cannot record payments",()=>{
 for(const patch of [{closed:true},{reviewRequired:true,balanceDue:null},{balanceDue:0}])assert.equal(button(setup(patch)(),"Record payment"),undefined);
 assert.equal(button(setup({},Error('unavailable'))(),"Record payment"),undefined);
 const tree=setup({reviewRequired:true,issues:['invoice_reconciliation_required']})();assert.match(txt(tree),/linked invoice needs reconciliation/);
 assert.equal(button(tree,"Edit payment"),undefined);assert.equal(button(tree,"Remove payment"),undefined);
});

test("existing receipts sync to invoices without collecting money",async()=>{
 const render=setup({orderId:"cafe-test",reviewRequired:true,balanceDue:null,issues:["invoice_projection_missing"]});let calls=0;
 globalThis.__syncCafeInvoice=async id=>{assert.equal(id,"cafe-test");calls++;return{balanceDue:0,cafePaid:5,receipts:[],issues:[]}};
 assert.equal(button(render(),"Record payment"),undefined);
 await button(render(),"Sync existing invoice receipts").props.onClick();assert.equal(calls,1);
 for(const key of ['invoices','invoicePayments','invoicePaymentSummary'])assert.ok(globalThis.__invalidated.includes(key));
 for(const issues of [["invoice_reconciliation_required"],["invoice_projection_missing","order_total_mismatch"]])assert.equal(button(setup({reviewRequired:true,issues})(),"Sync existing invoice receipts"),undefined);
});
