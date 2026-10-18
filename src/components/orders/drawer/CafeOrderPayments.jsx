import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCafeOrderPaymentState, recordCafeOrderPayment, reconcileCafeInvoiceReceipts } from "@/api/cafePayments";

const money = value => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(value || 0));
const sharedReaders = ["payments", "transactions", "income", "orders", "productionReadiness", "orderLineProductionReadiness", "invoices", "invoice", "invoicePayments", "invoicePaymentSummary", "invoiceActivity", "orderOppsInvoices"];
const issues = {
  finance_receipt_identity_missing: "The older Finance entry needs receipt verification before linking it to this invoice.",
  invoice_projection_missing: "An existing receipt needs to be linked to the invoice. Sync it below without recording another payment.",
  multiple_linked_invoices: "More than one invoice is linked to this order. Review the invoice links first.",
  invoice_total_or_currency_mismatch: "The invoice total or currency differs from the Café order. Review it first.",
  invoice_not_approved: "Approve the linked invoice before recording payment.",
  invoice_reconciliation_required: "A linked invoice needs reconciliation before another payment can be recorded.",
  payment_balance_mismatch: "Café and OPPS payment records differ. Review the existing receipts first.",
  order_total_mismatch: "Café and OPPS order totals differ. Review the order price first.",
};

export default function CafeOrderPayments({ orderId }) {
  const queryClient = useQueryClient();
  const queryKey = ["cafeOrderPaymentState", orderId];
  const query = useQuery({ queryKey, queryFn: () => getCafeOrderPaymentState(orderId), staleTime: 0, retry: false });
  const [draft, setDraft] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const state = query.data;
  const payable = state && !query.error && !state.reviewRequired && !state.closed && Number(state.balanceDue) > 0;

  const canSyncInvoice = !query.error && state?.issues?.length === 1 && state.issues[0] === "invoice_projection_missing";
  async function syncInvoice() {
    if (inFlight.current || !canSyncInvoice) return;
    inFlight.current = true; setSaving(true); setError("");
    try {
      const result = await reconcileCafeInvoiceReceipts(state.orderId);
      queryClient.setQueryData(queryKey, result);
      await Promise.all(sharedReaders.map(key => queryClient.invalidateQueries({ queryKey: [key] })));
    } catch (failure) { setError(failure.message || "Could not sync existing invoice receipts."); }
    finally { inFlight.current = false; setSaving(false); }
  }

  async function submit(event) {
    event.preventDefault();
    if (inFlight.current || !confirmed || !draft || !payable) return;
    if (draft.method === "eft" && !draft.reference.trim()) { setError("Enter the bank reference."); return; }
    inFlight.current = true;
    setSaving(true); setError("");
    try {
      const result = await recordCafeOrderPayment({ oppsOrderId: orderId, ...draft });
      queryClient.setQueryData(queryKey, result.payment);
      setDraft(null); setConfirmed(false);
      // Refresh every OPPS reader of the same settled amount. Café refetches the
      // original receipts on its next read; no second receipt is created here.
      await Promise.all(sharedReaders
        .map(key => queryClient.invalidateQueries({ queryKey: [key] })));
    } catch (failure) {
      setError(failure.message || "Could not confirm the receipt. Retry with the same details.");
    } finally { inFlight.current = false; setSaving(false); }
  }

  return <section aria-label="Café payment record" aria-busy={query.isLoading || saving} className="space-y-4">
    <div><h3 className="text-sm font-semibold">Payment record</h3><p className="mt-1 text-xs text-muted-foreground">Shared with Café and OPPS Finance.</p></div>
    {query.isLoading && <p role="status" className="text-sm text-muted-foreground">Checking payments…</p>}
    {query.error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Could not check payments. Re-check before recording a receipt.</p>}
    {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    {state && !query.error && <>
      {state.reviewRequired ? <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>Payment review required</strong><p className="mt-1">{state.issues?.map(issue => issues[issue]).filter(Boolean).join(" ") || "Review the linked payment records before recording another receipt."}</p></div> :
        <div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-secondary/40 p-3"><p className="text-xs text-muted-foreground">Received</p><p className="mt-1 text-lg font-semibold">{money(state.cafePaid)}</p></div><div className={`rounded-xl p-3 ${payable ? "bg-amber-50" : "bg-emerald-50"}`}><p className="text-xs text-muted-foreground">Outstanding</p><p className="mt-1 text-lg font-semibold">{money(state.balanceDue)}</p></div></div>}
      {canSyncInvoice && <button type="button" disabled={saving || query.isFetching} className="rounded-xl border border-border px-4 py-2 text-sm font-semibold" onClick={syncInvoice}>{saving ? "Syncing…" : "Sync existing invoice receipts"}</button>}
      {(state.receipts || []).length > 0 && <ul className="divide-y divide-border">{state.receipts.map(receipt => <li key={receipt.id} className="py-3 text-sm"><strong>{money(receipt.amount)}</strong><span className="ml-2 text-muted-foreground">{receipt.method === "payfast" ? "PayFast" : receipt.method?.toUpperCase()}{receipt.receivedAt ? ` · ${new Date(receipt.receivedAt).toLocaleString("en-ZA")}` : ""}</span></li>)}</ul>}
      {payable && !draft && <button type="button" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" onClick={() => { setError(""); setConfirmed(false); setDraft({ method: "cash", reference: "", amount: state.balanceDue, operationKey: crypto.randomUUID() }); }}>Record payment</button>}
      {payable && draft && <form onSubmit={submit} className="space-y-3 rounded-xl border border-border p-4">
        <label className="block text-sm">Payment method<select className="mt-1 block w-full rounded-lg border border-border bg-background p-2" value={draft.method} disabled={saving} onChange={event => { setConfirmed(false); setDraft({ ...draft, method: event.target.value }); }}><option value="cash">Cash</option><option value="eft">EFT</option></select></label>
        <p className="text-sm">Amount received: <strong>{money(draft.amount)}</strong></p>
        <label className="block text-sm">{draft.method === "eft" ? "Bank reference" : "Reference (optional)"}<input className="mt-1 block w-full rounded-lg border border-border bg-background p-2" maxLength={120} required={draft.method === "eft"} disabled={saving} value={draft.reference} onChange={event => { setConfirmed(false); setDraft({ ...draft, reference: event.target.value }); }}/></label>
        <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" required disabled={saving} checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>{draft.method === "eft" ? "I verified that the money arrived in our bank account." : "I received this cash from the customer."}</label>
        <div className="flex flex-wrap gap-2"><button type="submit" disabled={saving || !confirmed} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{saving ? "Recording…" : "Confirm payment received"}</button><button type="button" disabled={saving} className="rounded-xl border border-border px-4 py-2 text-sm" onClick={() => { setDraft(null); setConfirmed(false); setError(""); }}>Cancel</button></div>
      </form>}
      <p className="text-xs text-muted-foreground">Receipt corrections require a payment review. Existing receipts cannot be edited or deleted here.</p>
    </>}
    <button type="button" disabled={query.isFetching || saving} className="text-sm font-medium text-primary disabled:opacity-50" onClick={() => { setDraft(null); setConfirmed(false); setError(""); query.refetch(); }}>Re-check payments</button>
  </section>;
}
