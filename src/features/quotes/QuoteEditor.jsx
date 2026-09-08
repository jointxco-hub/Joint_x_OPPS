import { useMemo, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import QuoteLineItemsEditor, { newQuoteLine } from "./QuoteLineItemsEditor";
import { calculateQuoteTotals } from "./quoteCalculations";

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toEditorState(initial = {}) {
  const items = Array.isArray(initial.items) && initial.items.length
    ? initial.items.map((item, index) => ({
        line_key: item.line_key || item.id || `line-${index}`,
        role: item.role || "product",
        item_name: item.item_name || "",
        item_description: item.item_description || "",
        quantity: item.quantity ?? 1,
        unit: item.unit || "",
        rate: item.rate ?? 0,
        discount: item.discount ?? 0,
        tax_name: item.tax_name || "",
        tax_percentage: item.tax_percentage ?? 0,
        image_url: item.image_url || "",
      }))
    : [newQuoteLine()];

  return {
    id: initial.id || null,
    source_request_id: initial.source_request_id || null,
    expected_updated_at: initial.updated_at || null,
    expected_item_count: Array.isArray(initial.items) ? initial.items.length : 0,
    customer_id: initial.customer_id || "",
    customer_name: initial.customer_name || "",
    customer_email: initial.customer_email || "",
    customer_phone: initial.customer_phone || "",
    customer_whatsapp: initial.customer_whatsapp || "",
    customer_billing_address: initial.customer_billing_address || "",
    shipping_address: initial.shipping_address || "",
    reference_number: initial.reference_number || "",
    valid_until: (initial.valid_until || "").slice(0, 10),
    payment_terms: initial.payment_terms || "",
    currency_code: initial.currency_code || "ZAR",
    terms: initial.terms || "",
    notes: initial.notes || "",
    shipping_charge: initial.shipping_charge ?? 0,
    total_override_reason: "",
    items,
  };
}

export default function QuoteEditor({ initialQuote = {}, sourceRequest = null, onCancel, onSave, isSaving = false }) {
  const [state, setState] = useState(() => toEditorState(initialQuote));
  const isEdit = Boolean(state.id);

  const totals = useMemo(
    () => calculateQuoteTotals({ shipping_charge: state.shipping_charge, currency_code: state.currency_code }, state.items),
    [state.items, state.shipping_charge, state.currency_code],
  );

  const set = (patch) => setState((prev) => ({ ...prev, ...patch }));

  const overrideNeeded = false; // totals.total always reconciles — the editor sends the computed total

  const handleSave = () => {
    if (!String(state.customer_name || "").trim()) {
      toast.error("Add a customer name before saving.");
      return;
    }
    const billable = state.items.filter((item) => String(item.item_name || "").trim());
    if (billable.length === 0) {
      toast.error("Add at least one named line item before saving.");
      return;
    }
    onSave({
      ...state,
      shipping_charge: Number(state.shipping_charge || 0),
      total: totals.total,
      items: billable,
      allow_total_override: Boolean(state.total_override_reason),
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-6 md:py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={onCancel} className="h-11 rounded-xl px-2 sm:h-9">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {isEdit ? `Revise quote${initialQuote.quote_number ? ` ${initialQuote.quote_number}` : ""}` : "New quote"}
          </h1>
          <Button onClick={handleSave} disabled={isSaving} className="h-11 rounded-xl sm:h-9">
            <Save className="h-4 w-4" /> {isSaving ? "Saving..." : isEdit ? "Save revision" : "Create quote"}
          </Button>
        </div>

        {sourceRequest ? (
          <Card className="mb-4 rounded-2xl border-blue-100 bg-blue-50/60">
            <CardContent className="p-4 text-sm text-blue-900">
              Prefilled from client request <strong>{sourceRequest.preview || sourceRequest.id}</strong>. Saving links this quote to
              the request. Opening the editor alone changes nothing on the request.
            </CardContent>
          </Card>
        ) : null}

        <Card className="mb-4 rounded-2xl border-border shadow-apple-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-2">
            <Field label="Customer name" required>
              <Input value={state.customer_name} onChange={(e) => set({ customer_name: e.target.value })} className="h-10 rounded-xl" />
            </Field>
            <Field label="Reference">
              <Input value={state.reference_number} onChange={(e) => set({ reference_number: e.target.value })} className="h-10 rounded-xl" />
            </Field>
            <Field label="Email">
              <Input value={state.customer_email} onChange={(e) => set({ customer_email: e.target.value })} className="h-10 rounded-xl" />
            </Field>
            <Field label="Phone">
              <Input value={state.customer_phone} onChange={(e) => set({ customer_phone: e.target.value })} className="h-10 rounded-xl" />
            </Field>
            <Field label="WhatsApp">
              <Input value={state.customer_whatsapp} onChange={(e) => set({ customer_whatsapp: e.target.value })} className="h-10 rounded-xl" />
            </Field>
            <Field label="Currency">
              <Input value={state.currency_code} onChange={(e) => set({ currency_code: e.target.value.toUpperCase().slice(0, 3) })} className="h-10 rounded-xl" />
            </Field>
            <Field label="Billing address">
              <Textarea value={state.customer_billing_address} onChange={(e) => set({ customer_billing_address: e.target.value })} rows={2} className="min-h-16 resize-y rounded-xl" />
            </Field>
            <Field label="Shipping address">
              <Textarea value={state.shipping_address} onChange={(e) => set({ shipping_address: e.target.value })} rows={2} className="min-h-16 resize-y rounded-xl" />
            </Field>
            <Field label="Valid until">
              <Input type="date" value={state.valid_until} onChange={(e) => set({ valid_until: e.target.value })} className="h-10 rounded-xl" />
            </Field>
            <Field label="Payment terms">
              <Input value={state.payment_terms} onChange={(e) => set({ payment_terms: e.target.value })} placeholder="50% deposit to start" className="h-10 rounded-xl" />
            </Field>
            <Field label="Customer-facing terms">
              <Textarea value={state.terms} onChange={(e) => set({ terms: e.target.value })} rows={2} className="min-h-16 resize-y rounded-xl" />
            </Field>
            <Field label="Internal notes (staff only)">
              <Textarea value={state.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} className="min-h-16 resize-y rounded-xl" />
            </Field>
          </CardContent>
        </Card>

        <Card className="mb-4 rounded-2xl border-border shadow-apple-sm">
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-semibold text-foreground">Line items</p>
            <QuoteLineItemsEditor items={state.items} onChange={(items) => set({ items })} />
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border shadow-apple-sm">
          <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_260px]">
            <Field label="Shipping charge">
              <Input type="number" min="0" step="0.01" value={state.shipping_charge ?? ""} onChange={(e) => set({ shipping_charge: e.target.value })} className="h-10 rounded-xl" />
            </Field>
            <div className="rounded-xl bg-secondary/40 p-3 text-sm">
              <Row label="Subtotal" value={money(totals.subtotal)} />
              {totals.discount_total !== 0 ? <Row label="Discount" value={`- ${money(totals.discount_total)}`} /> : null}
              {totals.shipping_charge !== 0 ? <Row label="Shipping" value={money(totals.shipping_charge)} /> : null}
              {totals.tax_total !== 0 ? <Row label="Tax" value={money(totals.tax_total)} /> : null}
              <div className="my-1.5 border-t border-border" />
              <Row label="Quote total" value={money(totals.total)} strong />
            </div>
            {overrideNeeded ? (
              <Field label="Total override reason" className="md:col-span-2">
                <Input value={state.total_override_reason} onChange={(e) => set({ total_override_reason: e.target.value })} className="h-10 rounded-xl" />
              </Field>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, required = false, className = "", children }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}{required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}
function Row({ label, value, strong = false }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={strong ? "font-semibold text-foreground" : "text-muted-foreground"}>{label}</span>
      <span className={strong ? "font-semibold text-foreground" : "text-foreground"}>{value}</span>
    </div>
  );
}
