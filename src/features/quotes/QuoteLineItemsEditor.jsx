import { useState } from "react";
import { Plus, PackageSearch, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { calculateInvoiceLine } from "@/features/invoices/invoiceCalculations";
import { QUOTE_LINE_ROLES } from "./quoteCalculations";
import { lineIsReviewEligible } from "./quoteProductMapping";
import QuoteProductPicker from "./QuoteProductPicker";
import LabeledNumber from "@/features/lineItems/LabeledNumber";
import MoneyRow from "@/features/lineItems/MoneyRow";
import LineItemCard from "@/features/lineItems/LineItemCard";
import StickyAddBar from "@/features/lineItems/StickyAddBar";

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
    source_client_product_id: null,
    source_metadata: {},
    _needs_price_review: false,
  };
}

function isBlankLine(item = {}) {
  return (
    !String(item.item_name || "").trim() &&
    !String(item.item_description || "").trim() &&
    Number(item.rate || 0) === 0 &&
    !item.source_client_product_id
  );
}

// Local-only collapse-state key. Keyed by the item's own stable line_key
// (not its array index) so removing one line never corrupts another
// line's expanded/collapsed state.
function lineKeyFor(item, index) {
  return item?.line_key || `idx-${index}`;
}

// Same card/grid language as InvoiceLineItemsEditor, minus the template
// picker / DTF / media editor (out of scope for Q2). Adds the Q1 `role`
// selector (product / addon / setup_fee / shipping / discount) and the
// catalogue product picker (client-approved products + internal catalogue).
export default function QuoteLineItemsEditor({ items = [], onChange, clientId = null }) {
  const safeItems = items.length ? items : [newQuoteLine()];
  const [pickerOpen, setPickerOpen] = useState(false);
  // Keys present here are COLLAPSED; everything else is expanded. Nothing
  // starts in this set, so every existing line opens expanded (unchanged
  // from today) and every newly added line is expanded by construction —
  // collapsing only ever happens via an explicit user toggle below. Never
  // persisted onto the item or sent through onChange.
  const [collapsedKeys, setCollapsedKeys] = useState(() => new Set());

  const updateItem = (index, patch) => {
    onChange(safeItems.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };
  const addItem = () => onChange([...safeItems, newQuoteLine()]);
  const removeItem = (index) => {
    const removedKey = lineKeyFor(safeItems[index], index);
    const next = safeItems.filter((_, i) => i !== index);
    setCollapsedKeys((prev) => {
      if (!prev.has(removedKey)) return prev;
      const nextSet = new Set(prev);
      nextSet.delete(removedKey);
      return nextSet;
    });
    onChange(next.length ? next : [newQuoteLine()]);
  };
  const toggleExpand = (item, index) => {
    const key = lineKeyFor(item, index);
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // A picked product replaces the first still-blank line, otherwise appends.
  const addFromPicker = (primaryLine, extraLines = []) => {
    const additions = [primaryLine, ...extraLines].filter(Boolean);
    const firstBlank = safeItems.findIndex(isBlankLine);
    let next;
    if (firstBlank >= 0) {
      next = [...safeItems.slice(0, firstBlank), ...additions, ...safeItems.slice(firstBlank + 1)];
    } else {
      next = [...safeItems, ...additions];
    }
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)} className="h-10 rounded-xl">
          <PackageSearch className="h-4 w-4" /> Add from catalogue
        </Button>
        <span className="text-xs text-muted-foreground">or add manual lines below.</span>
      </div>

      <QuoteProductPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        clientId={clientId}
        onPick={addFromPicker}
      />

      {safeItems.map((item, index) => {
        const calculated = calculateInvoiceLine(item);
        const fromCatalogue = Boolean(item.source_client_product_id) || item?.source_metadata?.source === "catalog";
        const key = lineKeyFor(item, index);
        const expanded = !collapsedKeys.has(key);
        const badges = (fromCatalogue || item._needs_price_review) ? (
          <>
            {fromCatalogue ? (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {item.source_client_product_id ? "Client product" : "Catalogue"}
              </span>
            ) : null}
            {item._needs_price_review ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                <TriangleAlert className="h-3 w-3" /> Price needs staff review — set the rate below
              </span>
            ) : null}
          </>
        ) : null;
        return (
          <LineItemCard
            key={key}
            index={index}
            itemName={item.item_name}
            quantity={item.quantity}
            rate={item.rate}
            total={calculated.item_total}
            expanded={expanded}
            onToggleExpand={() => toggleExpand(item, index)}
            onRemove={() => removeItem(index)}
            removeLabel={`Remove line ${index + 1}`}
            badges={badges}
          >
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
            <MoneyRow
              quantity={item.quantity}
              onQuantityChange={(e) => updateItem(index, { quantity: e.target.value })}
              rate={item.rate}
              onRateChange={(e) => {
                const patch = { rate: e.target.value };
                // On a catalogue / client-product line: a positive rate
                // resolves the review; resetting it to 0 re-requires review.
                if (lineIsReviewEligible(item)) {
                  patch._needs_price_review = !(Number(e.target.value) > 0);
                }
                updateItem(index, patch);
              }}
              rateInputClassName={item._needs_price_review ? "border-amber-400 bg-amber-50" : ""}
              discount={item.discount}
              onDiscountChange={(e) => updateItem(index, { discount: e.target.value })}
              total={calculated.item_total}
              totalLabel="Line total"
            />
            <LabeledNumber label="Unit" className="md:col-span-2">
              <Input value={item.unit || ""} onChange={(e) => updateItem(index, { unit: e.target.value })} placeholder="ea" className="h-8 rounded-lg text-sm" />
            </LabeledNumber>
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
          </LineItemCard>
        );
      })}
      <StickyAddBar>
        <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)} className="h-11 rounded-xl flex-1 sm:h-10 sm:flex-none">
          <PackageSearch className="h-4 w-4" /> Add from catalogue
        </Button>
        <Button type="button" variant="outline" onClick={addItem} className="h-11 rounded-xl flex-1 sm:h-10 sm:flex-none">
          <Plus className="h-4 w-4" /> Add line
        </Button>
      </StickyAddBar>
    </div>
  );
}
