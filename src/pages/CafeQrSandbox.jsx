import { useState } from "react";
import { AlertCircle, LockKeyhole, QrCode, ShieldCheck } from "lucide-react";
import { useWorkspace } from "@/lib/WorkspaceContext";
import { checkCafeCounterQr, issueCafeCounterQr } from "@/api/cafeCounterQr";
import { getCafeQrPresentation } from "@/features/cafeQr/paymentRequestView";

// Isolated OPPS-106 feature-branch staff test screen. Not linked in production nav.
// The private backend issuance switch defaults OFF, so a user cannot force
// PayFast activation from this browser page.
const STAGING_SUPABASE = "https://tijiamrfnxrbitafiflj.supabase.co";
const money = cents => new Intl.NumberFormat("en-ZA",{
  style:"currency",currency:"ZAR",
}).format(cents/100);
const reasonText = reason => ({
  NOT_AUTHORIZED:"This staff account cannot access that Café order.",
  NOT_PAYABLE:"The order is not eligible for online QR payment.",
  QR_ISSUANCE_DISABLED:"QR payments remain disabled while the sandbox safety checks are completed.",
  OPERATION_KEY_ALREADY_USED:"This QR attempt has expired. Refresh and request a new one.",
  STALE_OPERATION_KEY:"The order amount changed. Recheck the order before retrying.",
}[reason] || "The request was not approved by the payment server.");

export default function CafeQrSandbox() {
  const { currentWorkspace } = useWorkspace();
  const [orderId,setOrderId] = useState("");
  const [result,setResult] = useState(null);
  const [qr,setQr] = useState(null);
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const isCafe = currentWorkspace?.slug === "quick-solution";
  // The screen is safe even when accidentally opened on a production host:
  // no user controls are displayed unless the configured Supabase project
  // is the dedicated staging project.
  const isStaging = import.meta.env.VITE_SUPABASE_URL === STAGING_SUPABASE;
  const enabled = isCafe && isStaging;
  async function check() {
    setBusy(true);setMessage("");setResult(null);setQr(null);
    try {
      const data=await checkCafeCounterQr(orderId);
      setResult(data);
      if(data?.ok!==true) setMessage(reasonText(data?.reason));
    } catch(e) {
      setMessage(e?.message || "Unable to check this order.");
    } finally {setBusy(false);}
  }
  async function issue() {
    if(result?.ok!==true)return;
    setBusy(true);setMessage("");setQr(null);
    try {
      // Unique, idempotent per deliberate staff action; no amount is sent.
      const key="opps106_"+crypto.randomUUID().replaceAll("-","");
      const data=await issueCafeCounterQr(orderId,key);
      if(data?.ok!==true) {setMessage(reasonText(data?.reason));return;}
      const candidate=getCafeQrPresentation({
        paymentRequestId:data.paymentRequestId,status:data.status,
        amountCents:Number(data.amountCents),currency:data.currency,
        expiresAt:data.expiresAt,checkoutUrl:data.scanUrl,
      },Date.now(),{allowStagingScan:isStaging});
      if(!candidate.canShowQr) {
        setMessage("The server response did not pass the staging QR URL check.");
        return;
      }
      setQr(candidate);
    } catch(e) {
      setMessage(e?.message || "QR request unavailable.");
    } finally {setBusy(false);}
  }
  return <section className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:px-8">
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#157761]">
        <ShieldCheck className="h-4 w-4"/> Quick Solution · OPPS-106
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">Counter QR sandbox</h1>
      <p className="text-sm leading-6 text-muted-foreground">Staff-only staging eligibility check. QR issuance remains disabled at the payment server until the sandbox release tests pass.</p>
    </div>
    {!enabled ? <div role="alert" className="rounded-2xl border border-border bg-card p-5 text-sm">
      <LockKeyhole className="mb-3 h-5 w-5"/> Select the Quick Solution Café workspace in the staging OPPS environment to use this test.
    </div> : <>
      <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <label htmlFor="qr-order-id" className="block text-sm font-semibold">Café service-order ID</label>
        <input id="qr-order-id" value={orderId} onChange={e=>{setOrderId(e.target.value);setResult(null);setQr(null);setMessage("");}}
          type="text" autoComplete="off" spellCheck={false} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          className="w-full rounded-xl border border-border bg-background px-3 py-3 font-mono text-sm"/>
        <button type="button" onClick={check} disabled={busy || !orderId.trim()}
          className="rounded-xl bg-[#176c5b] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {busy?"Checking…":"Check eligibility"}
        </button>
        {message && <div role="status" className="flex gap-2 rounded-xl bg-secondary px-3 py-3 text-sm"><AlertCircle className="h-4 w-4 shrink-0"/>{message}</div>}
        {result?.ok===true && <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Eligible balance</span><strong>{money(Number(result.amountCents))}</strong></div>
          <p className="text-xs text-muted-foreground">Verified against the canonical Café order by the staging server. No payment initiated.</p>
          <button type="button" onClick={issue} disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-[#9877c5] px-4 py-3 text-sm font-semibold disabled:opacity-50">
            <QrCode className="h-4 w-4"/> Request sandbox QR
          </button>
          <p className="text-xs text-muted-foreground">The server's private issuance switch is currently OFF. A blocked request will not create a QR or PayFast charge.</p>
        </div>}
      </div>
      {qr && <div className="space-y-2 rounded-2xl border border-border bg-card p-5" role="status">
        <strong>Staging scan link issued</strong>
        <p className="text-sm">Amount {money(qr.amountCents)} · Expires {new Date(qr.expiresAt).toLocaleTimeString("en-ZA")}</p>
        <a href={qr.checkoutUrl} target="_blank" rel="noreferrer" className="block break-all text-sm text-[#176c5b] underline">{qr.checkoutUrl}</a>
        <p className="text-xs text-muted-foreground">Use only for an approved PayFast sandbox test. Never share as a live payment link.</p>
      </div>}
    </>}
  </section>;
}
