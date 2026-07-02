import { useMemo, useState } from "react";
import { Archive, Pencil, Plus, Save, Search, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  archiveInvoiceItemTemplate,
  listInvoiceItemTemplates,
  saveInvoiceItemTemplate,
} from "@/api/invoices";

const emptyForm = {
  id: "",
  name: "",
  description: "",
  item_type: "services",
  unit: "",
  rate: "",
  tax_name: "",
  tax_percentage: "",
  account_name: "",
  category: "",
};

const categoryOptions = [
  "Products",
  "Printing",
  "Packaging & tagging",
  "XLAB content studio",
  "Stock",
  "Custom work",
];

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function templateToForm(template = {}) {
  return {
    id: template.id || "",
    name: template.name || "",
    description: template.description || "",
    item_type: template.item_type || "services",
    unit: template.unit || "",
    rate: template.rate ?? "",
    tax_name: template.tax_name || "",
    tax_percentage: template.tax_percentage ?? "",
    account_name: template.account_name || "",
    category: template.category || "",
  };
}

function formToPayload(form = {}) {
  return {
    id: form.id || undefined,
    name: form.name.trim(),
    item_description: form.description.trim(),
    item_type: form.item_type || "services",
    unit: form.unit.trim(),
    rate: Number(form.rate || 0),
    tax_name: form.tax_name.trim(),
    tax_percentage: Number(form.tax_percentage || 0),
    account_name: form.account_name.trim(),
    category: form.category.trim(),
  };
}

export default function InvoiceItemTemplateManager({ active = true }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);

  const templatesQuery = useQuery({
    queryKey: ["invoiceItemTemplates", "manager"],
    queryFn: () => listInvoiceItemTemplates({ limit: 300 }),
    enabled: active,
  });

  const templates = templatesQuery.data || [];
  const categories = useMemo(() => {
    const saved = templates.map((template) => template.category).filter(Boolean);
    return Array.from(new Set([...categoryOptions, ...saved]));
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return templates
      .filter((template) => category === "all" || template.category === category)
      .filter((template) => {
        if (!query) return true;
        return [
          template.name,
          template.description,
          template.category,
          template.account_name,
        ].filter(Boolean).join(" ").toLowerCase().includes(query);
      });
  }, [category, search, templates]);

  const saveMutation = useMutation({
    mutationFn: saveInvoiceItemTemplate,
    onSuccess: () => {
      toast.success("Saved invoice item updated");
      queryClient.invalidateQueries({ queryKey: ["invoiceItemTemplates"] });
      setForm(emptyForm);
      setFormOpen(false);
    },
    onError: (error) => toast.error(error?.message || "Could not save invoice item"),
  });

  const archiveMutation = useMutation({
    mutationFn: archiveInvoiceItemTemplate,
    onSuccess: () => {
      toast.success("Saved invoice item archived");
      queryClient.invalidateQueries({ queryKey: ["invoiceItemTemplates"] });
    },
    onError: (error) => toast.error(error?.message || "Could not archive invoice item"),
  });

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const startCreate = () => {
    setForm(emptyForm);
    setFormOpen(true);
  };
  const startEdit = (template) => {
    setForm(templateToForm(template));
    setFormOpen(true);
  };
  const submit = (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.info("Name the saved item first");
      return;
    }
    saveMutation.mutate(formToPayload(form));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Saved invoice items</h2>
          <p className="text-sm text-muted-foreground">Reusable products and service lines for fast invoice creation.</p>
        </div>
        <Button onClick={startCreate} className="h-10 rounded-xl">
          <Plus className="h-4 w-4" /> Add saved item
        </Button>
      </div>

      <Card className="rounded-xl border-border shadow-apple-sm">
        <CardContent className="p-3 md:p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search reusable item"
                className="h-10 rounded-xl pl-10"
              />
            </div>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="all">All departments</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      {formOpen && (
        <Card className="rounded-xl border-border shadow-apple-sm">
          <CardContent className="p-3 md:p-4">
            <form onSubmit={submit} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">{form.id ? "Edit saved item" : "New saved item"}</p>
                <button
                  type="button"
                  onClick={() => { setForm(emptyForm); setFormOpen(false); }}
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"
                  aria-label="Close saved item form"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-12">
                <Input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Item name" className="h-10 rounded-xl md:col-span-4" />
                <Input value={form.rate} onChange={(event) => updateField("rate", event.target.value)} type="number" min="0" step="0.01" placeholder="Rate" className="h-10 rounded-xl md:col-span-2" />
                <select value={form.item_type} onChange={(event) => updateField("item_type", event.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm md:col-span-2">
                  <option value="goods">Goods</option>
                  <option value="services">Services</option>
                </select>
                <select value={form.category} onChange={(event) => updateField("category", event.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm md:col-span-4">
                  <option value="">Department / category</option>
                  {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <Input value={form.description} onChange={(event) => updateField("description", event.target.value)} placeholder="Description" className="h-10 rounded-xl md:col-span-6" />
                <Input value={form.unit} onChange={(event) => updateField("unit", event.target.value)} placeholder="Unit" className="h-10 rounded-xl md:col-span-2" />
                <Input value={form.account_name} onChange={(event) => updateField("account_name", event.target.value)} placeholder="Account name" className="h-10 rounded-xl md:col-span-4" />
                <Input value={form.tax_name} onChange={(event) => updateField("tax_name", event.target.value)} placeholder="Tax name" className="h-10 rounded-xl md:col-span-3" />
                <Input value={form.tax_percentage} onChange={(event) => updateField("tax_percentage", event.target.value)} type="number" min="0" step="0.01" placeholder="Tax %" className="h-10 rounded-xl md:col-span-3" />
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => { setForm(emptyForm); setFormOpen(false); }} className="rounded-xl">Cancel</Button>
                <Button type="submit" disabled={saveMutation.isPending} className="rounded-xl">
                  <Save className="h-4 w-4" /> Save item
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {templatesQuery.isLoading ? (
        <Card className="rounded-xl border-border p-6 text-sm text-muted-foreground">Loading saved items...</Card>
      ) : filteredTemplates.length === 0 ? (
        <Card className="rounded-xl border-border p-8 text-center shadow-apple-sm">
          <p className="font-semibold text-foreground">No saved invoice items found</p>
          <p className="mt-1 text-sm text-muted-foreground">Add common products, printing, packaging, and content studio services here.</p>
        </Card>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {filteredTemplates.map((template) => (
            <div key={template.id} className="rounded-xl border border-border bg-card p-3 shadow-apple-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{template.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{[template.category, template.description].filter(Boolean).join(" / ") || "Reusable invoice item"}</p>
                </div>
                <p className="text-sm font-semibold text-primary">{money(template.rate)}</p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="rounded-full bg-secondary px-2 py-1">{template.item_type || "services"}</span>
                {template.unit && <span className="rounded-full bg-secondary px-2 py-1">Unit {template.unit}</span>}
                {template.usage_count > 0 && <span className="rounded-full bg-primary/10 px-2 py-1 font-semibold text-primary">{template.usage_count} uses</span>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={() => startEdit(template)} className="h-8 rounded-xl text-xs">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => archiveMutation.mutate(template.id)}
                  disabled={archiveMutation.isPending}
                  className="h-8 rounded-xl text-xs text-destructive hover:text-destructive"
                >
                  <Archive className="h-3.5 w-3.5" /> Archive
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
