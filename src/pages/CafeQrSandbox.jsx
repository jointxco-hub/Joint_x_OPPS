import { useState } from "react";
import { AlertCircle, LockKeyhole, QrCode, ShieldCheck } from "lucide-react";
import { useWorkspace } from "@/lib/WorkspaceContext";
import { checkCafeCounterQr, issueCafeCounterQr } from "@/api/cafeCounterQr";
import { getCafeQrPresentation } from "@/features/cafeQr/paymentRequestView";
import { previewCafeHandoff, sendCafeHandoff } from "@/api/cafeQrHandoff";
import { listUnresolvedCafeQrCheckouts, listCafeQrCheckoutReviewEvents, logCafeQrCheckoutReview } from "@/api/cafeQrReview";

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
  const [handoff,setHandoff] = useState(null);
  const [handoffStatus,setHandoffStatus] = useState("");
  const [confirmSend,setConfirmSend] = useState(false);
  const [qrReviews,setQrReviews] = useState(null);
  const [qrReviewError,setQrReviewError] = useState("");
  const [qrReviewBusy,setQrReviewBusy] = useState(false);
  const [selectedQrReview,setSelectedQrReview] = useState(null);
  const [qrAuditEvents,setQrAuditEvents] = useState([]);
  const [qrReviewType,setQrReviewType] = useState("case_opened");
  const [qrProviderRef,setQrProviderRef] = useState("");
  const [qrReviewNotes,setQrReviewNotes] = useState("");
  const [qrAuditMessage,setQrAuditMessage] = useState("");
  const [qrAuditBusy,setQrAuditBusy] = useState(false);
  const isCafe = currentWorkspace?.slug === "quick-solution";
  // The screen is safe even when accidentally opened on a production host:
  // no user controls are displayed unless the configured Supabase project
  // is the dedicated staging project.
  const isStaging = import.meta.env.VITE_SUPABASE_URL === STAGING_SUPABASE;
  const enabled = isCafe && isStaging;
  async function loadQrReviews() {
    if (!enabled || qrReviewBusy) return;
    setQrReviewBusy(true);setQrReviewError("");
    try { setQrReviews(await listUnresolvedCafeQrCheckouts()); }
    catch (error) {setQrReviews(null);setQrReviewError(error?.message || "QR review unavailable.");}
    finally {setQrReviewBusy(false);}
  }
  async function openQrAudit(id) {
    if (!enabled || qrAuditBusy) return;
    setSelectedQrReview(id);setQrAuditBusy(true);setQrAuditMessage("");
    try { setQrAuditEvents(await listCafeQrCheckoutReviewEvents(id)); }
    catch (error) { setQrAuditEvents([]);setQrAuditMessage(error?.message || "Review history unavailable."); }
    finally { setQrAuditBusy(false); }
  }
  async function submitQrReview() {
    if (!enabled || !selectedQrReview || qrAuditBusy) return;
    setQrAuditBusy(true);setQrAuditMessage("");
    try {
      await logCafeQrCheckoutReview({
        requestId:selectedQrReview,type:qrReviewType,
        providerReference:qrProviderRef,notes:qrReviewNotes
      });
      setQrAuditEvents(await listCafeQrCheckoutReviewEvents(selectedQrReview));
      setQrReviewNotes("");
      setQrAuditMessage("Finding recorded with your staff identity. Payment remains on hold; no release or additional charge was made.");
    } catch (error) { setQrAuditMessage(error?.message || "Unable to save review."); }
    finally { setQrAuditBusy(false); }
  }
  async function previewHandoff() {
    setBusy(true);setHandoffStatus("");setHandoff(null);setConfirmSend(false);
    try {
      const preview = await previewCafeHandoff(orderId);
      setHandoff(preview);
      if (preview?.ready !== true) setHandoffStatus("The handoff is blocked. Review the listed blockers before sending.");
    } catch(e) { setHandoffStatus(e?.message || "Could not preview OPPS handoff."); }
    finally {setBusy(false);}
  }
  async function sendHandoff() {
    if(!confirmSend || handoff?.ready !== true || !enabled) return;
    setBusy(true);setHandoffStatus("");
    try {
      const response = await sendCafeHandoff(orderId);
      if(response?.ok !== true || response?.handoffStatus !== "sent") {
        setHandoffStatus("OPPS did not accept the handoff: " + (response?.blockers?.map(x=>x.message || x.code).join("; ") || response?.error || "Review the order."));
      } else {
        setHandoffStatus("Sent to OPPS. Order ID: " + response.oppsOrderId + (response.replayed ? " (existing handoff reused)." : ""));
        setHandoff(null);
      }
    } catch(e) {setHandoffStatus(e?.message || "OPPS handoff unavailable.");}
    finally {setConfirmSend(false);setBusy(false);}
  }
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
        <input id="qr-order-id" value={orderId} onChange={e=>{setOrderId(e.target.value);setResult(null);setQr(null);setMessage("");setHandoff(null);setHandoffStatus("");setConfirmSend(false);}}
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
      <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <div>
          <h2 className="font-semibold text-lg">Send paid order to OPPS</h2>
          <p className="mt-1 text-sm text-muted-foreground">Staff-authorized handoff only. Preview first; this action never initiates PayFast or creates a second Café receipt.</p>
        </div>
        <button type="button" disabled={busy || !orderId.trim()} onClick={previewHandoff}
          className="rounded-xl border border-[#176c5b] px-4 py-3 text-sm font-semibold disabled:opacity-50">
          {busy?"Checking…":"Preview OPPS handoff"}
        </button>
        {handoff && <div className="space-y-3 rounded-xl bg-secondary p-4 text-sm">
          <div className="flex justify-between gap-3"><strong>Handoff readiness</strong><strong>{handoff.ready === true ? "Ready" : "Blocked"}</strong></div>
          <div className="flex justify-between gap-3"><span>Payment carried to OPPS</span><strong>{handoff.proposedOppsOrder?.payment_status || "Unknown"}</strong></div>
          <div className="flex justify-between gap-3"><span>Recorded deposit</span><strong>{money(Math.round(Number(handoff.proposedOppsOrder?.deposit_paid || 0)*100))}</strong></div>
          {Array.isArray(handoff.warnings) && handoff.warnings.length>0 && <div>
            <strong>Warnings</strong>
            {handoff.warnings.map((w,i)=><p key={i} className="mt-1 text-xs">{w.message || w.code}</p>)}
          </div>}
          {Array.isArray(handoff.blockers) && handoff.blockers.length>0 && <div>
            <strong>Blockers</strong>
            {handoff.blockers.map((w,i)=><p key={i} className="mt-1 text-xs">{w.message || w.code}</p>)}
          </div>}
          {handoff.ready===true && <div className="space-y-3 border-t border-border pt-3">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={confirmSend} onChange={e=>setConfirmSend(e.target.checked)}/>
              <span>I reviewed the order, payment and warnings. Send this Café order to OPPS.</span>
            </label>
            <button type="button" disabled={busy || !confirmSend} onClick={sendHandoff}
              className="rounded-xl bg-[#176c5b] px-4 py-3 font-semibold text-white disabled:opacity-50">
              Confirm Send to OPPS
            </button>
          </div>}
        </div>}
        {handoffStatus && <p role="status" className="rounded-xl bg-secondary p-3 text-sm">{handoffStatus}</p>}
      </div>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold text-lg">Unresolved PayFast checkouts</h2>
        <p className="text-sm text-muted-foreground">Staff-only checkout queue and append-only review history. Expired QR does not prove no charge; never accept Cash/Card until a separate authorized reconciliation.</p>
        <button type="button" onClick={loadQrReviews} disabled={qrReviewBusy}
          className="rounded-xl border border-[#176c5b] px-4 py-3 text-sm font-semibold disabled:opacity-50">
          {qrReviewBusy ? "Checking…" : "Refresh unresolved checkouts"}
        </button>
        {qrReviewError && <p role="alert" className="rounded-xl bg-secondary p-3 text-sm">{qrReviewError}</p>}
        {Array.isArray(qrReviews) && <div role="status" className="space-y-3">
          <p className="text-sm">{qrReviews.length === 0 ? "No unresolved checkouts found." : qrReviews.length + " checkout(s) require provider verification."}</p>
          {qrReviews.map(item => <div key={item.payment_request_id} className="rounded-xl bg-secondary p-3 text-sm space-y-1">
            <div className="flex flex-wrap justify-between gap-2"><strong>{item.order_number}</strong><strong>{money(Number(item.amount_cents))}</strong></div>
            <p className="text-xs">QR: {item.qr_status} · Intent: {item.payment_intent_status || "unknown"}</p>
            <p className="text-xs">Started: {item.checkout_started_at ? new Date(item.checkout_started_at).toLocaleString("en-ZA") : "unknown"}</p>
            <p className="text-xs font-medium">Review PayFast and the canonical Café payment record before manually taking another payment.</p>
            <button type="button" onClick={() => openQrAudit(item.payment_request_id)}
              disabled={qrAuditBusy} className="mt-2 rounded-lg border border-[#176c5b] px-3 py-2 text-xs font-semibold disabled:opacity-50">
              View / record review
            </button>
          </div>)}
        </div>}
      </div>
      {selectedQrReview && <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">PayFast review evidence</h3>
          <button type="button" className="text-xs underline" onClick={() => {setSelectedQrReview(null);setQrAuditMessage("");}}>Close</button>
        </div>
        <p className="text-xs text-muted-foreground">This is an audit record, not approval to release the order. Provider findings are reported by staff and must be independently verified.</p>
        <label className="grid gap-1 text-sm font-medium">Finding
          <select value={qrReviewType} onChange={e=>setQrReviewType(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2">
            <option value="case_opened">Opened review</option>
            <option value="provider_no_capture_reported">Provider reports no capture</option>
            <option value="provider_capture_reported">Provider reports a capture</option>
            <option value="escalated">Escalated to Finance</option>
            <option value="second_review_confirmed">Independent second review</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">Provider case/reference
          <input value={qrProviderRef} onChange={e=>setQrProviderRef(e.target.value)}
            autoComplete="off" maxLength={160} placeholder="PayFast case or transaction reference"
            className="rounded-lg border border-border bg-background px-3 py-2"/>
        </label>
        <label className="grid gap-1 text-sm font-medium">Factual review note
          <textarea value={qrReviewNotes} onChange={e=>setQrReviewNotes(e.target.value)}
            maxLength={1000} rows={3} placeholder="What did you verify with the provider, and when?"
            className="rounded-lg border border-border bg-background px-3 py-2"/>
        </label>
        <button type="button" disabled={qrAuditBusy || qrReviewNotes.trim().length<12}
          onClick={submitQrReview} className="rounded-lg bg-[#176c5b] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {qrAuditBusy?"Saving…":"Record finding (no payment release)"}
        </button>
        {qrAuditMessage && <p role="status" className="rounded-xl bg-secondary p-3 text-sm">{qrAuditMessage}</p>}
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-sm font-semibold">Previous review entries</p>
          {qrAuditEvents.length===0 ? <p className="text-xs text-muted-foreground">No review entries recorded.</p> :
            qrAuditEvents.map(ev=><div key={ev.event_id} className="rounded-xl bg-secondary p-3 text-xs space-y-1">
              <strong>{String(ev.event_type).replaceAll("_"," ")}</strong>
              <p>{ev.notes}</p>
              <p className="text-muted-foreground">Reference: {ev.provider_reference || "not supplied"} · Reviewer: {ev.reviewer_id} · {new Date(ev.created_at).toLocaleString("en-ZA")}</p>
            </div>)}
        </div>
      </section>}
      {qr && <div className="space-y-2 rounded-2xl border border-border bg-card p-5" role="status">
        <strong>Staging scan link issued</strong>
        <p className="text-sm">Amount {money(qr.amountCents)} · Expires {new Date(qr.expiresAt).toLocaleTimeString("en-ZA")}</p>
        <a href={qr.checkoutUrl} target="_blank" rel="noreferrer" className="block break-all text-sm text-[#176c5b] underline">{qr.checkoutUrl}</a>
        <p className="text-xs text-muted-foreground">Use only for an approved PayFast sandbox test. Never share as a live payment link.</p>
      </div>}
    </>}
  </section>;
}
