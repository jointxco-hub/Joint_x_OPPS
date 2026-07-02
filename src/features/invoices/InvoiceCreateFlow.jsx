import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, Save, Share2, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dataClient } from "@/api/dataClient";
import { applyInvoiceTotals } from "./invoiceCalculations";
import { validateInvoice } from "./invoiceValidation";
import InvoiceLineItemsEditor from "./InvoiceLineItemsEditor";

const steps = ["Customer", "Details", "Items", "Review", "Finish"];
const DEFAULT_PAYMENT_TERMS = "Due on receipt";
const DEFAULT_TERMS = "Prices are valid for the listed items and quantities. Production starts after approval and required assets are received.";

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

function downloadTextFile(fileName, contents) {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function invoicePreviewText(invoice = {}, items = []) {
  const lines = [
    `Invoice for ${invoice.customer_name || "Customer"}`,
    `Date: ${invoice.invoice_date || ""}`,
    `Due: ${invoice.due_date || invoice.payment_terms || ""}`,
    "",
    ...items.map((item) => `${item.quantity || 1} x ${item.item_name || "Item"} @ ${money(item.rate)} = ${money(item.item_total)}`),
    "",
    `Total: ${money(invoice.total)}`,
    `Balance due: ${money(invoice.balance_due)}`,
  ];
  return lines.join("\n");
}

function fuzzyScore(query, target) {
  const q = String(query || "").toLowerCase().trim();
  const t = String(target || "").toLowerCase();
  if (!q) return 0;
  if (t === q) return 1;
  if (t.includes(q)) return 0.9;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length && words.every((word) => t.includes(word))) return 0.75;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i += 1) {
    if (t[i] === q[qi]) qi += 1;
  }
  return (qi / q.length) * 0.45;
}

function searchableClientText(client = {}) {
  return [
    client.name,
    client.client_name,
    client.email,
    client.client_email,
    client.phone,
    client.client_phone,
    client.whatsapp,
    client.brand_name,
  ].filter(Boolean).join(" ").toLowerCase();
}

function clientInvoiceFields(client = {}) {
  return {
    customer_id: client.id || "",
    customer_name: client.name || client.client_name || "",
    customer_email: client.email || client.client_email || "",
    customer_phone: client.phone || client.client_phone || client.whatsapp || "",
    customer_billing_address: client.billing_address || client.delivery_address || client.delivery_note || "",
  };
}

export default function InvoiceCreateFlow({ initialInvoice, onSave, onCancel, isSaving = false }) {
  const isEditing = Boolean(initialInvoice?.id);
  const topRef = useRef(null);
  const [step, setStep] = useState(0);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [invoice, setInvoice] = useState({
    customer_id: initialInvoice?.customer_id || "",
    customer_name: initialInvoice?.customer_name || "",
    customer_email: initialInvoice?.customer_email || "",
    customer_phone: initialInvoice?.customer_phone || "",
    customer_billing_address: initialInvoice?.customer_billing_address || "",
    source_order_id: initialInvoice?.source_order_id || "",
    invoice_date: initialInvoice?.invoice_date || todayIso(),
    due_date: initialInvoice?.due_date || "",
    payment_terms: initialInvoice?.payment_terms || DEFAULT_PAYMENT_TERMS,
    currency_code: initialInvoice?.currency_code || "ZAR",
    status: initialInvoice?.status || "draft",
    reference_number: initialInvoice?.reference_number || "",
    salesperson_name: initialInvoice?.salesperson_name || "",
    shipping_charge: initialInvoice?.shipping_charge || 0,
    adjustment: initialInvoice?.adjustment || 0,
    amount_paid: initialInvoice?.amount_paid || 0,
    notes: initialInvoice?.notes || "",
    terms: initialInvoice?.terms || DEFAULT_TERMS,
    internal_notes: initialInvoice?.internal_notes || "",
  });
  const [items, setItems] = useState(
    Array.isArray(initialInvoice?.items) && initialInvoice.items.length
      ? initialInvoice.items
      : [{ ...starterItem }]
  );

  const userQuery = useQuery({
    queryKey: ["currentUser", "invoice-create"],
    queryFn: () => dataClient.auth.me(),
    staleTime: 300_000,
  });

  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ["clients", "invoice-create"],
    queryFn: () => dataClient.entities.Client.list("-created_date", 200),
    enabled: step === 0,
    staleTime: 60_000,
  });

  const { data: existingOrderNames = [] } = useQuery({
    queryKey: ["invoice-create", "order-client-names"],
    queryFn: () => dataClient.entities.Order.list("-created_date", 300),
    enabled: step === 0,
    staleTime: 60_000,
    select: (orders) => {
      const known = new Set(clients.map((client) => String(client.name || client.client_name || "").toLowerCase()));
      return Array.from(new Set(
        (orders || [])
          .map((order) => order.client_name || order.whatsapp_name || order.saved_contact_name)
          .filter((name) => name && !known.has(String(name).toLowerCase()))
      ));
    },
  });

  const clientSuggestions = useMemo(() => {
    const query = String(invoice.customer_name || invoice.customer_email || "").trim();
    const activeClients = clients.filter((client) => !client.is_archived);
    if (!query) return activeClients.slice(0, 6).map((client) => ({ type: "client", item: client, score: 0 }));

    const clientMatches = activeClients
      .map((client) => ({ type: "client", item: client, score: fuzzyScore(query, searchableClientText(client)) }))
      .filter((entry) => entry.score > 0.25);

    const historyMatches = existingOrderNames
      .map((name) => ({ type: "history", item: { name, client_name: name }, score: fuzzyScore(query, name) }))
      .filter((entry) => entry.score > 0.35);

    return [...clientMatches, ...historyMatches]
      .sort((a, b) => b.score - a.score)
      .slice(0, 7);
  }, [clients, existingOrderNames, invoice.customer_email, invoice.customer_name]);

  const calculated = useMemo(() => applyInvoiceTotals(invoice, items), [invoice, items]);
  const validation = useMemo(
    () => validateInvoice({ ...calculated.invoice, invoice_number: initialInvoice?.invoice_number || "pending" }, calculated.items),
    [calculated, initialInvoice?.invoice_number]
  );

  useEffect(() => {
    topRef.current?.scrollIntoView({ block: "start" });
  }, [step]);

  useEffect(() => {
    const name = userQuery.data?.full_name || userQuery.data?.name || userQuery.data?.email || "";
    if (!name) return;
    setInvoice((current) => current.salesperson_name ? current : { ...current, salesperson_name: name });
  }, [userQuery.data]);

  const setField = (field, value) => setInvoice((current) => ({ ...current, [field]: value }));
  const goToStep = (nextStep) => setStep(Math.max(0, Math.min(nextStep, steps.length - 1)));
  const canAdvance = step < steps.length - 1;

  const selectClient = (client) => {
    setInvoice((current) => ({
      ...current,
      ...clientInvoiceFields(client),
    }));
    setShowClientSuggestions(false);
  };

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
      <div ref={topRef} className="mx-auto max-w-5xl px-4 py-4 md:py-8">
        <div className="mb-4 flex flex-col gap-3 md:mb-6 md:flex-row md:items-center md:justify-between">
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
                onClick={() => goToStep(index)}
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                  step === index ? "bg-card text-foreground shadow-apple-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {index + 1}. {label}
              </button>
            ))}
          </div>
        </div>

        <Card className="rounded-xl border-border shadow-apple-sm">
          <CardContent className="p-3 md:p-6">
            {step === 0 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Customer</h2>
                  <p className="text-sm text-muted-foreground">Who should this invoice be made out to?</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="relative">
                    <Input
                      value={invoice.customer_name}
                      onChange={(event) => {
                        setField("customer_name", event.target.value);
                        setShowClientSuggestions(true);
                      }}
                      onFocus={() => setShowClientSuggestions(true)}
                      placeholder="Customer name"
                      className="h-10 rounded-xl"
                    />
                    {showClientSuggestions && (
                      <div className="absolute left-0 right-0 top-12 z-20 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
                        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <Users className="h-3.5 w-3.5" /> Existing clients
                        </div>
                        {clientsLoading ? (
                          <p className="px-3 py-3 text-sm text-muted-foreground">Loading clients...</p>
                        ) : clientSuggestions.length === 0 ? (
                          <p className="px-3 py-3 text-sm text-muted-foreground">No matching clients. Continue typing to create a new invoice customer.</p>
                        ) : (
                          <div className="max-h-72 overflow-y-auto py-1">
                            {clientSuggestions.map((suggestion) => {
                              const client = suggestion.item;
                              return (
                                <button
                                  key={`${suggestion.type}-${client.id || client.email || client.name}`}
                                  type="button"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => selectClient(client)}
                                  className="block w-full px-3 py-2 text-left hover:bg-secondary/60"
                                >
                                  <span className="block truncate text-sm font-semibold text-foreground">{client.name || client.client_name}</span>
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {suggestion.type === "history"
                                      ? "Seen in order history"
                                      : [client.email || client.client_email, client.phone || client.client_phone || client.whatsapp].filter(Boolean).join(" / ") || "No contact details"}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <Input value={invoice.customer_email} onChange={(event) => setField("customer_email", event.target.value)} type="email" placeholder="Email" className="h-10 rounded-xl" />
                  <Input value={invoice.customer_phone} onChange={(event) => setField("customer_phone", event.target.value)} placeholder="Phone" className="h-10 rounded-xl" />
                  <Input value={invoice.customer_billing_address} onChange={(event) => setField("customer_billing_address", event.target.value)} placeholder="Billing address" className="h-10 rounded-xl" />
                </div>
                {invoice.customer_id && (
                  <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    Linked to existing client record.
                  </p>
                )}
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Invoice details</h2>
                  <p className="text-sm text-muted-foreground">Set dates, terms, and the reference the team will recognize.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Input value={invoice.invoice_date} onChange={(event) => setField("invoice_date", event.target.value)} type="date" className="h-10 rounded-xl" />
                  <Input value={invoice.due_date} onChange={(event) => setField("due_date", event.target.value)} type="date" className="h-10 rounded-xl" />
                  <Input value={invoice.payment_terms} onChange={(event) => setField("payment_terms", event.target.value)} placeholder="Payment terms" className="h-10 rounded-xl" />
                  <Input value={invoice.reference_number} onChange={(event) => setField("reference_number", event.target.value)} placeholder="Reference number" className="h-10 rounded-xl" />
                  <Input value={invoice.salesperson_name} onChange={(event) => setField("salesperson_name", event.target.value)} placeholder="Salesperson" className="h-10 rounded-xl" />
                  <Select value={invoice.currency_code} onValueChange={(value) => setField("currency_code", value)}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
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
                <InvoiceLineItemsEditor items={items} onChange={setItems} customerId={invoice.customer_id} />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Review before approving</h2>
                  <p className="text-sm text-muted-foreground">Check totals before the invoice moves to export-ready.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Input value={invoice.shipping_charge} onChange={(event) => setField("shipping_charge", event.target.value)} type="number" min="0" step="0.01" placeholder="Shipping charge" className="h-10 rounded-xl" />
                  <Input value={invoice.adjustment} onChange={(event) => setField("adjustment", event.target.value)} type="number" step="0.01" placeholder="Adjustment" className="h-10 rounded-xl" />
                  <Input value={invoice.amount_paid} onChange={(event) => setField("amount_paid", event.target.value)} type="number" min="0" step="0.01" placeholder="Amount paid" className="h-10 rounded-xl" />
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_280px]">
                  <div className="space-y-3">
                    <Textarea value={invoice.notes} onChange={(event) => setField("notes", event.target.value)} placeholder="Notes for the customer" className="min-h-20 rounded-xl" />
                    <details className="rounded-xl border border-border bg-card p-3 text-sm">
                      <summary className="cursor-pointer font-semibold text-foreground">Terms and internal details</summary>
                      <div className="mt-3 space-y-3">
                        <Textarea value={invoice.terms} onChange={(event) => setField("terms", event.target.value)} placeholder="Terms" className="min-h-20 rounded-xl" />
                        <Textarea value={invoice.internal_notes} onChange={(event) => setField("internal_notes", event.target.value)} placeholder="Internal notes" className="min-h-16 rounded-xl" />
                      </div>
                    </details>
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
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Invoice preview</h2>
                    <p className="text-sm text-muted-foreground">Check what the team and client will read before you save or approve.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => downloadTextFile(`${invoice.customer_name || "invoice"}-draft.txt`, invoicePreviewText(calculated.invoice, calculated.items))}
                      className="h-9 rounded-xl"
                    >
                      <Download className="h-3.5 w-3.5" /> Download
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const text = invoicePreviewText(calculated.invoice, calculated.items);
                        if (navigator.share) navigator.share({ title: "Invoice draft", text });
                        else navigator.clipboard?.writeText(text);
                      }}
                      className="h-9 rounded-xl"
                    >
                      <Share2 className="h-3.5 w-3.5" /> Share
                    </Button>
                  </div>
                </div>
                {(validation.errors.length > 0 || validation.warnings.length > 0) && (
                  <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    {validation.errors.map((error) => <p key={`${error.field}-${error.message}`}>Required: {error.message}</p>)}
                    {validation.warnings.map((warning) => <p key={`${warning.field}-${warning.message}`}>Check: {warning.message}</p>)}
                  </div>
                )}
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="border-b border-border px-3 py-2.5">
                    <p className="text-sm font-semibold text-foreground">{invoice.customer_name || "Missing customer"}</p>
                    <p className="text-xs text-muted-foreground">{invoice.invoice_date} / {invoice.payment_terms}</p>
                  </div>
                  <div className="divide-y divide-border">
                    {calculated.items.map((item, index) => (
                      <div key={`${item.item_name}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2.5 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{item.item_name}</p>
                          <p className="text-xs text-muted-foreground">Qty {item.quantity} / {money(item.rate)}</p>
                        </div>
                        <p className="font-semibold text-foreground">{money(item.item_total)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1 border-t border-border bg-secondary/25 px-3 py-2.5 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-semibold text-foreground">{money(calculated.invoice.total)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Balance due</span><span className="font-semibold text-foreground">{money(calculated.invoice.balance_due)}</span></div>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="outline" onClick={() => goToStep(step - 1)} disabled={step === 0} className="rounded-xl">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              {canAdvance ? (
                <Button onClick={() => goToStep(step + 1)} className="rounded-xl">
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
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-bold text-foreground">{value}</p>
    </div>
  );
}
