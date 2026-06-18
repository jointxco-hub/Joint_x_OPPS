import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyInvoiceTotals } from "./invoiceCalculations";
import { validateInvoice } from "./invoiceValidation";
import InvoiceLineItemsEditor from "./InvoiceLineItemsEditor";

const steps = ["Customer", "Invoice details", "Line items", "Review", "Save"];

const starterItem = {
  item_name: "",
  item_description: "",
  item_type: "goods",
  quantity: 1,
  unit: "",
  rate: 0,
  discount: 0,
  tax_name: "",
  tax_percentage: 0,
  account_name: "",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function InvoiceCreateFlow({ initialInvoice, onSave, onCancel, isSaving = false }) {
  const isEditing = Boolean(initialInvoice?.id);
  const [step, setStep] = useState(0);
  const [invoice, setInvoice] = useState({
    customer_id: initialInvoice?.customer_id || "",
    customer_name: initialInvoice?.customer_name || "",
    customer_email: initialInvoice?.customer_email || "",
    customer_phone: initialInvoice?.customer_phone || "",
    customer_billing_address: initialInvoice?.customer_billing_address || "",
    source_order_id: initialInvoice?.source_order_id || "",
    invoice_date: initialInvoice?.invoice_date || todayIso(),
    due_date: initialInvoice?.due_date || "",
    payment_terms: initialInvoice?.payment_terms || "",
    currency_code: initialInvoice?.currency_code || "ZAR",
    status: initialInvoice?.status || "draft",
    reference_number: initialInvoice?.reference_number || "",
    salesperson_name: initialInvoice?.salesperson_name || "",
    shipping_charge: initialInvoice?.shipping_charge || 0,
    adjustment: initialInvoice?.adjustment || 0,
    amount_paid: initialInvoice?.amount_paid || 0,
    notes: initialInvoice?.notes || "",
    terms: initialInvoice?.terms || "",
    internal_notes: initialInvoice?.internal_notes || "",
  });
  const [items, setItems] = useState(
    Array.isArray(initialInvoice?.items) && initialInvoice.items.length
      ? initialInvoice.items
      : [{ ...starterItem }]
  );

  const calculated = useMemo(() => applyInvoiceTotals(invoice, items), [invoice, items]);
  const validation = useMemo(
    () => validateInvoice({ ...calculated.invoice, invoice_number: initialInvoice?.invoice_number || "pending" }, calculated.items),
    [calculated, initialInvoice?.invoice_number]
  );

  const setField = (field, value) => setInvoice((current) => ({ ...current, [field]: value }));
  const canAdvance = step < steps.length - 1;

  const submit = (status) => {
    onSave({
      ...calculated.invoice,
      id: initialInvoice?.id,
      invoice_number: initialInvoice?.invoice_number,
      status,
      items: calculated.items,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6 md:py-8">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <button onClick={onCancel} className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Back to invoices
            </button>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{isEditing ? "Edit invoice" : "Create invoice"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Approved invoices can be exported to Zoho Books.</p>
          </div>
          <div className="flex flex-wrap gap-1 rounded-2xl bg-secondary/60 p-1">
            {steps.map((label, index) => (
              <button
                key={label}
                onClick={() => setStep(index)}
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                  step === index ? "bg-card text-foreground shadow-apple-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {index + 1}. {label}
              </button>
            ))}
          </div>
        </div>

        <Card className="rounded-2xl border-border shadow-apple-sm">
          <CardContent className="p-4 md:p-6">
            {step === 0 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Customer</h2>
                  <p className="text-sm text-muted-foreground">Who should this invoice be made out to?</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Input value={invoice.customer_name} onChange={(event) => setField("customer_name", event.target.value)} placeholder="Customer name" className="h-11 rounded-xl" />
                  <Input value={invoice.customer_email} onChange={(event) => setField("customer_email", event.target.value)} type="email" placeholder="Email" className="h-11 rounded-xl" />
                  <Input value={invoice.customer_phone} onChange={(event) => setField("customer_phone", event.target.value)} placeholder="Phone" className="h-11 rounded-xl" />
                  <Input value={invoice.customer_billing_address} onChange={(event) => setField("customer_billing_address", event.target.value)} placeholder="Billing address" className="h-11 rounded-xl" />
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Invoice details</h2>
                  <p className="text-sm text-muted-foreground">Set dates, terms, and the reference the team will recognize.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Input value={invoice.invoice_date} onChange={(event) => setField("invoice_date", event.target.value)} type="date" className="h-11 rounded-xl" />
                  <Input value={invoice.due_date} onChange={(event) => setField("due_date", event.target.value)} type="date" className="h-11 rounded-xl" />
                  <Input value={invoice.payment_terms} onChange={(event) => setField("payment_terms", event.target.value)} placeholder="Payment terms" className="h-11 rounded-xl" />
                  <Input value={invoice.reference_number} onChange={(event) => setField("reference_number", event.target.value)} placeholder="Reference number" className="h-11 rounded-xl" />
                  <Input value={invoice.salesperson_name} onChange={(event) => setField("salesperson_name", event.target.value)} placeholder="Salesperson name" className="h-11 rounded-xl" />
                  <Select value={invoice.currency_code} onValueChange={(value) => setField("currency_code", value)}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ZAR">ZAR</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">What are you billing for?</h2>
                  <p className="text-sm text-muted-foreground">Add products, services, discounts, and optional tax details.</p>
                </div>
                <InvoiceLineItemsEditor items={items} onChange={setItems} />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Review before approving</h2>
                  <p className="text-sm text-muted-foreground">Check totals before the invoice moves to export-ready.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Input value={invoice.shipping_charge} onChange={(event) => setField("shipping_charge", event.target.value)} type="number" min="0" step="0.01" placeholder="Shipping charge" className="h-11 rounded-xl" />
                  <Input value={invoice.adjustment} onChange={(event) => setField("adjustment", event.target.value)} type="number" step="0.01" placeholder="Adjustment" className="h-11 rounded-xl" />
                  <Input value={invoice.amount_paid} onChange={(event) => setField("amount_paid", event.target.value)} type="number" min="0" step="0.01" placeholder="Amount paid" className="h-11 rounded-xl" />
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_280px]">
                  <div className="space-y-3">
                    <Textarea value={invoice.notes} onChange={(event) => setField("notes", event.target.value)} placeholder="Notes for the customer" className="min-h-24 rounded-xl" />
                    <Textarea value={invoice.terms} onChange={(event) => setField("terms", event.target.value)} placeholder="Terms" className="min-h-20 rounded-xl" />
                  </div>
                  <div className="rounded-2xl border border-border bg-secondary/30 p-4">
                    {[
                      ["Subtotal", calculated.invoice.subtotal],
                      ["Discount", -calculated.invoice.discount_total],
                      ["Shipping", calculated.invoice.shipping_charge],
                      ["Adjustment", calculated.invoice.adjustment],
                      ["Tax", calculated.invoice.tax_total],
                      ["Total", calculated.invoice.total],
                      ["Paid", calculated.invoice.amount_paid],
                      ["Balance due", calculated.invoice.balance_due],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                        <span className="text-sm text-muted-foreground">{label}</span>
                        <span className="text-sm font-semibold text-foreground">{money(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Save / Approve</h2>
                  <p className="text-sm text-muted-foreground">Save as draft if you still need to check details. Approve when it is ready for Zoho export.</p>
                </div>
                {(validation.errors.length > 0 || validation.warnings.length > 0) && (
                  <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    {validation.errors.map((error) => <p key={`${error.field}-${error.message}`}>Required: {error.message}</p>)}
                    {validation.warnings.map((warning) => <p key={`${warning.field}-${warning.message}`}>Check: {warning.message}</p>)}
                  </div>
                )}
                <div className="grid gap-3 md:grid-cols-3">
                  <SummaryTile label="Customer" value={invoice.customer_name || "Missing"} />
                  <SummaryTile label="Total" value={money(calculated.invoice.total)} />
                  <SummaryTile label="Balance due" value={money(calculated.invoice.balance_due)} />
                </div>
              </div>
            )}

            <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="outline" onClick={() => setStep(Math.max(step - 1, 0))} disabled={step === 0} className="rounded-xl">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              {canAdvance ? (
                <Button onClick={() => setStep(Math.min(step + 1, steps.length - 1))} className="rounded-xl">
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button variant="outline" onClick={() => submit("draft")} disabled={isSaving || !validation.isValid} className="rounded-xl">
                    <Save className="h-4 w-4" /> Save draft
                  </Button>
                  <Button onClick={() => submit("approved")} disabled={isSaving || !validation.isValid} className="rounded-xl">
                    <Check className="h-4 w-4" /> Approve invoice
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryTile({ label, value }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}
