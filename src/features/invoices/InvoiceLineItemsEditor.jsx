import { useMemo, useState } from "react";
import { Package, Plus, Save, Search, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dataClient } from "@/api/dataClient";
import {
  invoiceItemFromTemplate,
  listInvoiceItemTemplates,
  recordInvoiceItemTemplateUse,
  saveInvoiceItemTemplate,
} from "@/api/invoices";
import { calculateInvoiceLine } from "./invoiceCalculations";



const pickerModes = [
  ["all", "All"],
  ["products", "Products"],
  ["printing", "Printing"],
  ["packaging", "Packaging"],
  ["content", "Content"],
  ["stock", "Stock"],
];
const emptyItem = {
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

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function thumbFor(item = {}) {
  const image = item.image_url || item.primary_image || item.thumbnail_url || item.cover_image_url || (Array.isArray(item.images) ? (item.images[0]?.src || item.images[0]) : "");
  return typeof image === "string" ? image : "";
}

function listFrom(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" || typeof item === "number").map(String)
    : [];
}

function optionListFrom(value) {
  return Array.isArray(value)
    ? value.filter(Boolean).map((option) => {
      if (typeof option === "string" || typeof option === "number") return String(option);
      const locations = listFrom(option.locations || option.placements || option.placement);
      return [option.name || option.label || option.title || option.type || "Option", locations.join("/")].filter(Boolean).join(" - ");
    })
    : [];
}

function describeProduct(product = {}) {
  const parts = [product.category, product.size, product.color, product.notes || product.description]
    .filter(Boolean);
  const printOptions = optionListFrom(product.print_options || product.printOptions || product.selected_print_options);
  const addons = optionListFrom(product.addons || product.add_ons || product.addOns || product.selected_addons);
  if (printOptions.length) parts.push(`Print: ${printOptions.join(", ")}`);
  if (addons.length) parts.push(`Add-ons: ${addons.join(", ")}`);
  return parts.join(" | ");
}

function lineFromPickerItem(item = {}, current = {}) {
  const quantity = numberOrZero(current.quantity) > 0 ? current.quantity : 1;
  return {
    ...current,
    item_name: item.name || current.item_name || "Invoice item",
    item_description: item.description || describeProduct(item),
    item_type: item.item_type || (item.source === "template" ? "services" : "goods"),
    quantity,
    unit: item.unit || current.unit || "",
    rate: item.price !== "" && item.price !== null && item.price !== undefined ? item.price : current.rate || 0,
    tax_name: item.tax_name ?? current.tax_name ?? "",
    tax_percentage: item.tax_percentage ?? current.tax_percentage ?? 0,
    account_name: item.account_name ?? current.account_name ?? "",
    invoice_item_template_id: item.source === "template" ? item.id : "",
    catalog_item_id: item.source === "catalog" ? item.id : "",
    inventory_item_id: item.source === "stock" ? item.id : "",
    source_metadata: {
      source: item.source,
      category: item.category || "",
      template_id: item.source === "template" ? item.id : undefined,
      image_url: item.image_url || "",
      sizes: item.sizes || [],
      colors: item.colors || [],
    },
  };
}

function templateInputFromItem(item = {}) {
  return {
    name: item.item_name,
    item_description: item.item_description,
    item_type: item.item_type || "goods",
    unit: item.unit || "",
    rate: item.rate || 0,
    tax_name: item.tax_name || "",
    tax_percentage: item.tax_percentage || 0,
    account_name: item.account_name || "",
    category: item.source_metadata?.category || "",
    catalog_item_id: item.catalog_item_id || "",
    inventory_item_id: item.inventory_item_id || "",
    source_metadata: item.source_metadata || {},
  };
}

export default function InvoiceLineItemsEditor({ items = [], onChange, customerId = "" }) {
  const queryClient = useQueryClient();
  const safeItems = items.length ? items : [emptyItem];
  const [pickerOpenIndex, setPickerOpenIndex] = useState(null);
  const [pickerMode, setPickerMode] = useState("all");
  const [savedSearch, setSavedSearch] = useState("");

  const { data: templates = [] } = useQuery({
    queryKey: ["invoiceItemTemplates", customerId],
    queryFn: () => listInvoiceItemTemplates({ clientId: customerId || undefined, limit: 120 }),
    staleTime: 60_000,
  });

  const { data: catalogItems = [] } = useQuery({
    queryKey: ["catalogItems", "invoice-lines"],
    queryFn: () => dataClient.entities.CatalogItem.list("name", 500),
    staleTime: 300_000,
  });

  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["inventory", "invoice-lines"],
    queryFn: () => dataClient.entities.InventoryItem.list("name", 200),
    staleTime: 300_000,
  });

  const saveTemplateMutation = useMutation({
    mutationFn: saveInvoiceItemTemplate,
    onSuccess: () => {
      toast.success("Invoice item saved for reuse");
      queryClient.invalidateQueries({ queryKey: ["invoiceItemTemplates"] });
    },
    onError: (error) => toast.error(error?.message || "Could not save invoice item"),
  });

  const recordTemplateUseMutation = useMutation({ mutationFn: recordInvoiceItemTemplateUse });

  const allPickerItems = useMemo(() => [
    ...templates
      .filter((item) => item.is_active !== false)
      .filter((item) => item.item_type === "services" || ["Printing", "Packaging & tagging", "XLAB content studio", "Custom work"].includes(item.category))
      .map((item) => ({
        id: item.id,
        name: item.name,
        price: item.rate ?? "",
        source: "template",
        sourceLabel: "saved",
        category: item.category || "Custom work",
        image_url: "",
        description: item.description || "",
        item_type: item.item_type || "services",
        unit: item.unit || "",
        tax_name: item.tax_name || "",
        tax_percentage: item.tax_percentage || 0,
        account_name: item.account_name || "",
      })),
    ...catalogItems
      .filter((item) => item.is_archived !== true)
      .filter((item) => item.store_visible !== false)
      .filter((item) => item.is_active !== false && item.hidden !== true && item.is_hidden !== true)
      .filter((item) => !["draft", "hidden", "inactive", "archived"].includes(String(item.status || "active").toLowerCase()))
      .map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price ?? item.base_price ?? item.selling_price ?? "",
        source: "catalog",
        category: item.category || "",
        image_url: thumbFor(item),
        sizes: listFrom(item.sizes || item.size_options || item.sizes_available || item.variants?.sizes),
        colors: listFrom(item.colors || item.colours || item.color_options || item.colour_options || item.colors_available || item.variants?.colors),
        print_options: item.print_options || item.printOptions || [],
        addons: item.addons || item.add_ons || item.addOns || [],
      })),
    ...inventoryItems
      .filter((item) => !item.is_archived && !catalogItems.some((catalog) => catalog.name?.toLowerCase() === item.name?.toLowerCase()))
      .map((item) => ({
        id: item.id,
        name: item.name,
        price: item.selling_price ?? "",
        source: "stock",
        category: item.category || "",
        image_url: thumbFor(item),
        sizes: listFrom(item.sizes_available),
        colors: listFrom(item.colors_available),
        print_options: item.print_options || item.printOptions || [],
        addons: item.addons || item.add_ons || item.addOns || [],
      })),
  ], [catalogItems, inventoryItems, templates]);

  const filteredTemplates = useMemo(() => {
    const query = savedSearch.trim().toLowerCase();
    return templates
      .filter((template) => !query || [template.name, template.description, template.category].filter(Boolean).join(" ").toLowerCase().includes(query))
      .slice(0, 8);
  }, [savedSearch, templates]);

  const pickerItemsFor = (query) => {
    const q = String(query || "").trim().toLowerCase();
    return allPickerItems
      .filter((item) => {
        if (pickerMode === "all") return true;
        if (pickerMode === "products") return item.source === "catalog";
        if (pickerMode === "stock") return item.source === "stock";
        if (pickerMode === "printing") return item.category === "Printing";
        if (pickerMode === "packaging") return item.category === "Packaging & tagging";
        if (pickerMode === "content") return item.category === "XLAB content studio";
        return true;
      })
      .filter((item) => !q || [item.name, item.category, item.source, item.sourceLabel].filter(Boolean).join(" ").toLowerCase().includes(q))
      .slice(0, 8);
  };

  const updateItem = (index, patch) => {
    onChange(safeItems.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )));
  };

  const addItem = () => onChange([...safeItems, { ...emptyItem }]);
  const removeItem = (index) => {
    const next = safeItems.filter((_, itemIndex) => itemIndex !== index);
    onChange(next.length ? next : [{ ...emptyItem }]);
  };

  const appendTemplate = (template) => {
    const nextItem = invoiceItemFromTemplate(template);
    onChange([...safeItems.filter((item) => item.item_name || item.item_description || Number(item.rate || 0) > 0), nextItem]);
    recordTemplateUseMutation.mutate(template.id);
  };

  const saveLineAsTemplate = (item) => {
    if (!String(item.item_name || "").trim()) {
      toast.info("Name the line before saving it");
      return;
    }
    saveTemplateMutation.mutate(templateInputFromItem(item));
  };

  return (
    <div className="space-y-4">
      <details className="rounded-xl border border-border bg-secondary/25 p-3" open>
        <summary className="cursor-pointer text-sm font-semibold text-foreground">Saved invoice items</summary>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">Reuse repeat jobs or save a line after pricing it once.</p>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={savedSearch}
              onChange={(event) => setSavedSearch(event.target.value)}
              placeholder="Search saved items"
              className="h-9 rounded-xl pl-9 text-sm"
            />
          </div>
        </div>
        {filteredTemplates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-card/70 px-3 py-3 text-sm text-muted-foreground">
            No saved invoice items yet. Save any priced line below to reuse it later.
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {filteredTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => appendTemplate(template)}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 text-left hover:bg-secondary/50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">{template.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[template.category, template.description].filter(Boolean).join(" | ") || "Reusable line"}</span>
                </span>
                <span className="text-xs font-semibold text-primary">R{Number(template.rate || 0).toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
      </details>

      {safeItems.map((item, index) => {
        const calculated = calculateInvoiceLine(item);
        const pickerItems = pickerItemsFor(item.item_name);
        return (
          <div key={index} className="rounded-xl border border-border bg-card p-2.5 shadow-apple-sm md:p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line {index + 1}</p>
                {(item.catalog_item_id || item.inventory_item_id || item.invoice_item_template_id) && (
                  <p className="mt-0.5 truncate text-xs text-primary">Linked source item</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => saveLineAsTemplate(item)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary"
                  aria-label="Save line item"
                  title="Save line item"
                >
                  <Save className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive"
                  aria-label="Remove line item"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-12">
              <div className="relative md:col-span-5">
                <Input
                  value={item.item_name || ""}
                  onChange={(event) => {
                    updateItem(index, {
                      item_name: event.target.value,
                      catalog_item_id: "",
                      inventory_item_id: "",
                      invoice_item_template_id: "",
                      source_metadata: {},
                    });
                    setPickerOpenIndex(index);
                  }}
                  onFocus={() => setPickerOpenIndex(index)}
                  onBlur={() => setTimeout(() => setPickerOpenIndex(null), 150)}
                  placeholder="Search shop, stock, or type item"
                  className="h-10 rounded-xl"
                />
                {pickerOpenIndex === index && (
                  <div className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-xl border border-border bg-card shadow-apple-lg">
                    <div className="flex gap-1 overflow-x-auto border-b border-border p-2">
                      {pickerModes.map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => setPickerMode(value)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${pickerMode === value ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-muted-foreground"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="max-h-64 overflow-y-auto py-1">
                      {pickerItems.map((pickerItem) => (
                        <button
                          key={`${pickerItem.source}-${pickerItem.id}`}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            updateItem(index, lineFromPickerItem(pickerItem, item));
                            setPickerOpenIndex(null);
                          }}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary/60"
                        >
                          <span className="grid h-9 w-9 flex-shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-secondary/60">
                            {pickerItem.image_url ? <img src={pickerItem.image_url} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-muted-foreground" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-foreground">{pickerItem.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{[pickerItem.category, pickerItem.sourceLabel || pickerItem.source].filter(Boolean).join(" / ")}</span>
                          </span>
                          {pickerItem.price !== "" && <span className="text-xs font-semibold text-primary">R{Number(pickerItem.price || 0).toLocaleString()}</span>}
                        </button>
                      ))}
                      {item.item_name?.trim() && (
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => setPickerOpenIndex(null)}
                          className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm font-semibold text-primary hover:bg-primary/5"
                        >
                          <Plus className="h-3.5 w-3.5" /> Use custom item
                        </button>
                      )}
                      {!pickerItems.length && !item.item_name?.trim() && (
                        <p className="px-3 py-3 text-sm text-muted-foreground">Type an item name to search or add a custom line.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <LabeledNumber label="Qty" className="md:col-span-2">
                <Input
                  value={item.quantity ?? ""}
                  onChange={(event) => updateItem(index, { quantity: event.target.value })}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="1"
                  className="h-8 rounded-lg text-sm"
                />
              </LabeledNumber>
              <LabeledNumber label="Rate" className="md:col-span-2">
                <Input
                  value={item.rate ?? ""}
                  onChange={(event) => updateItem(index, { rate: event.target.value })}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  className="h-8 rounded-lg text-sm"
                />
              </LabeledNumber>
              <LabeledNumber label="Discount" className="md:col-span-2">
                <Input
                  value={item.discount ?? ""}
                  onChange={(event) => updateItem(index, { discount: event.target.value })}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  className="h-8 rounded-lg text-sm"
                />
              </LabeledNumber>
              <div className="rounded-lg bg-secondary/50 px-2 py-1 md:col-span-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
                <p className="text-sm font-semibold text-foreground">R{Number(calculated.item_total || 0).toLocaleString()}</p>
              </div>
              <Input
                value={item.item_description || ""}
                onChange={(event) => updateItem(index, { item_description: event.target.value })}
                placeholder="Description"
                className="h-9 rounded-xl md:col-span-5"
              />
              <select
                value={item.item_type || "goods"}
                onChange={(event) => updateItem(index, { item_type: event.target.value })}
                className="h-9 rounded-xl border border-input bg-background px-3 text-sm md:col-span-2"
              >
                <option value="goods">Goods</option>
                <option value="services">Services</option>
              </select>
              <Input
                value={item.unit || ""}
                onChange={(event) => updateItem(index, { unit: event.target.value })}
                placeholder="Unit"
                className="h-9 rounded-xl md:col-span-1"
              />
              <Input
                value={item.tax_name || ""}
                onChange={(event) => updateItem(index, { tax_name: event.target.value })}
                placeholder="Tax name"
                className="h-9 rounded-xl md:col-span-2"
              />
              <Input
                value={item.tax_percentage ?? ""}
                onChange={(event) => updateItem(index, { tax_percentage: event.target.value })}
                type="number"
                min="0"
                step="0.01"
                placeholder="Tax %"
                className="h-9 rounded-xl md:col-span-2"
              />
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" onClick={addItem} className="h-10 rounded-xl">
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
