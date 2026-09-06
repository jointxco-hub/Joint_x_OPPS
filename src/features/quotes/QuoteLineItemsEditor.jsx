import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { calculateInvoiceLine } from "@/features/invoices/invoiceCalculations";
import { QUOTE_LINE_ROLES } from "./quoteCalculations";

const ROLE_LABELS = {
  product: "Product",
  addon: "Add-on",
  setup_fee: "Setup / once-off",
  shipping: "Shipping",
  discount: "Discount",
};

function uniqueLineKey() {
  return globalThis.crypto?.randomUUID?.() || `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
export function newQuoteLine() {
  return {
    line_key: uniqueLineKey(),
    role: "product",
    item_name: "",
    item_description: "",
    quantity: 1,
    unit: "",
    rate: 0,
    discount: 0,
    tax_name: "",
    tax_percentage: 0,
    image_url: "",
  };
}

// Same card/grid language as InvoiceLineItemsEditor, minus the template
// picker / DTF / media editor (out of scope for Q2). Adds the Q1 `role`
// selector (product / addon / setup_fee / shipping / discount).
export default function QuoteLineItemsEditor({ items = [], onChange }) {
  const safeItems = items.length ? items : [newQuoteLine()];

  const updateItem = (index, patch) => {
    onChange(safeItems.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };
  const addItem = () => onChange([...safeItems, newQuoteLine()]);
  const removeItem = (index) => {
    const next = safeItems.filter((_, i) => i !== index);
    onChange(next.length ? next : [newQuoteLine()]);
  };

  return (
    <div className="space-y-4">
      {safeItems.map((item, index) => {
        const calculated = calculateInvoiceLine(item);
        return (
          <div key={item.line_key || index} className="rounded-xl border border-border bg-card p-2.5 shadow-apple-sm md:p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line {index + 1}</p>
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive sm:h-8 sm:w-8"
                aria-label={`Remove line ${index + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-12">
              <Input
                value={item.item_name || ""}
                onChange={(event) => updateItem(index, { item_name: event.target.value })}
                placeholder="Item name"
                className="h-10 rounded-xl md:col-span-5"
              />
              <label className="block rounded-lg bg-secondary/25 px-2 py-1 md:col-span-3">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Role</span>
                <select
                  value={item.role || "product"}
                  onChange={(event) => updateItem(index, { role: event.target.value })}
                  className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  {QUOTE_LINE_ROLES.map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role] || role}</option>
                  ))}
                </select>
              </label>
              <LabeledNumber label="Qty" className="md:col-span-2">
                <Input value={item.quantity ?? ""} onChange={(e) => updateItem(index, { quantity: e.target.value })} type="number" min="0" step="0.01" placeholder="1" className="h-8 rounded-lg text-sm" />
              </LabeledNumber>
              <LabeledNumber label="Rate" className="md:col-span-2">
                <Input value={item.rate ?? ""} onChange={(e) => updateItem(index, { rate: e.target.value })} type="number" min="0" step="0.01" placeholder="0.00" className="h-8 rounded-lg text-sm" />
              </LabeledNumber>
              <LabeledNumber label="Discount" className="md:col-span-2">
                <Input value={item.discount ?? ""} onChange={(e) => updateItem(index, { discount: e.target.value })} type="number" min="0" step="0.01" placeholder="0.00" className="h-8 rounded-lg text-sm" />
              </LabeledNumber>
              <LabeledNumber label="Unit" className="md:col-span-2">
                <Input value={item.unit || ""} onChange={(e) => updateItem(index, { unit: e.target.value })} placeholder="ea" className="h-8 rounded-lg text-sm" />
              </LabeledNumber>
              <div className="rounded-lg bg-secondary/50 px-2 py-1 md:col-span-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Line total</p>
                <p className="text-sm font-semibold text-foreground">R{Number(calculated.item_total || 0).toLocaleString()}</p>
              </div>
              <Textarea
                value={item.item_description || ""}
                onChange={(event) => updateItem(index, { item_description: event.target.value })}
                placeholder="Description shown on the quote (optional)"
                rows={2}
                className="min-h-16 resize-y rounded-xl md:col-span-8"
              />
              <LabeledNumber label="Tax name" className="md:col-span-2">
                <Input value={item.tax_name || ""} onChange={(e) => updateItem(index, { tax_name: e.target.value })} placeholder="VAT" className="h-8 rounded-lg text-sm" />
              </LabeledNumber>
              <LabeledNumber label="Tax %" className="md:col-span-2">
                <Input value={item.tax_percentage ?? ""} onChange={(e) => updateItem(index, { tax_percentage: e.target.value })} type="number" min="0" step="0.01" placeholder="0" className="h-8 rounded-lg text-sm" />
              </LabeledNumber>
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" onClick={addItem} className="h-11 rounded-xl sm:h-10">
        <Plus className="h-4 w-4" /> Add line
      </Button>
    </div>
  );
}

function LabeledNumber({ label, className = "", children }) {
  return (
    <label className={`block rounded-lg bg-secondary/25 px-2 py-1 ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
