import React, { useEffect, useMemo, useState } from "react";
import { dataClient } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X, Upload, Loader2, Trash2, Camera, ReceiptText, Link2, UserRound, ShoppingBag, FileText, BriefcaseBusiness, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { createWithOfflineQueue } from "@/lib/offlineQueue";

const VAT_RATE = 0.15;

const spendTypeLabels = {
  supplier_purchase: "Supplier Purchase",
  transport: "Transport",
  petty_cash: "Petty Cash",
  staff_runner: "Staff / Runner",
  courier: "Courier",
  airtime_data: "Airtime / Data",
  office: "Office",
  production: "Production",
  client_related: "Client-related",
  other: "Other",
};

const categoryLabels = {
  unsorted: "Unsorted",
  production: "Production",
  raw_materials: "Raw Materials",
  packaging: "Packaging",
  shipping: "Shipping / Courier",
  transport: "Transport",
  petty_cash: "Petty Cash",
  marketing: "Marketing",
  software: "Software / Tools",
  rent_utilities: "Rent & Utilities",
  wages: "Wages & Salaries",
  admin: "Admin",
  owner_drawings: "Owner Drawings",
};

const paymentLabels = {
  unknown: "Unknown",
  cash: "Cash",
  card: "Card",
  eft: "EFT",
  credit: "Credit",
  other: "Other",
};

const vatTypeLabels = {
  non_vat: "No VAT",
  vatable: "VATable (15%)",
  zero_rated: "Zero-Rated (0%)",
  unknown: "Unknown",
};

const linkOptions = [
  { key: "none", label: "General", helper: "Business expense, not tied to a customer job.", icon: BriefcaseBusiness },
  { key: "client", label: "Client", helper: "Useful when it may be recovered from a client.", icon: UserRound },
  { key: "order", label: "Order", helper: "Adds the cost to one order's profitability.", icon: ShoppingBag },
  { key: "purchase_order", label: "Supplier PO", helper: "Connects the spend to a buying run or supplier order.", icon: FileText },
  { key: "project", label: "Project", helper: "Tracks the cost against a broader project.", icon: ClipboardList },
  { key: "production_job", label: "Production", helper: "Links to an internal production request.", icon: Link2 },
];

const linkTypeLabels = Object.fromEntries(linkOptions.map(option => [option.key, option.label]));

const defaultForm = (today, initialCategory) => ({
  date: today,
  expense_name: "",
  expense_type: "supplier_purchase",
  vendor: "",
  paid_to_name: "",
  amount: "",
  category: initialCategory || "production",
  vat_type: "non_vat",
  payment_method: "cash",
  paid_by: "",
  notes: "",
  link_type: "none",
  client_id: "",
  project_id: "",
  order_id: "",
  purchase_order_id: "",
  production_job_id: "",
  is_reimbursable: false,
  is_client_recoverable: false,
});

export default function AddExpenseDrawer({ onClose, onSaved, initialCategory }) {
  const today = new Date().toISOString().split("T")[0];
  const [mode, setMode] = useState("full");
  const [form, setForm] = useState(defaultForm(today, initialCategory));
  const [receiptUrls, setReceiptUrls] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const [suppliers, setSuppliers] = useState([]);
  const [vendorMode, setVendorMode] = useState("existing");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");

  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [orders, setOrders] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [productionJobs, setProductionJobs] = useState([]);

  useEffect(() => {
    dataClient.auth.me().then(setCurrentUser).catch(() => {});
    dataClient.entities.Supplier.list("-created_date", 100).then(setSuppliers).catch(() => {});
    dataClient.entities.Client.filter({ is_archived: false }, "-created_date", 100).then(setClients).catch(() => {});
    dataClient.entities.Project.list("-created_date", 100).then(setProjects).catch(() => {});
    dataClient.entities.Order.list("-created_date", 150).then(setOrders).catch(() => {});
    dataClient.entities.PurchaseOrder.list("-created_date", 150).then(setPurchaseOrders).catch(() => {});
    dataClient.entities.OpsTask.list("-created_date", 150).then(setProductionJobs).catch(() => {});
  }, []);

  const amount = Number.parseFloat(form.amount || 0);
  const vatAmount = form.vat_type === "vatable" && amount > 0 ? amount - (amount / (1 + VAT_RATE)) : 0;
  const vendorRequired = mode === "full" && form.expense_type === "supplier_purchase";
  const activeProjects = projects.filter(p => p.status !== "archived" && !p.is_archived);
  const activeOrders = orders.filter(o => !o.is_archived && !["cancelled", "delivered"].includes(o.status));
  const activePurchaseOrders = purchaseOrders.filter(po => !po.is_archived && !["cancelled", "completed", "received"].includes(po.status));

  const selectedLinkLabel = useMemo(() => {
    if (form.link_type === "client") return clients.find(c => c.id === form.client_id)?.name;
    if (form.link_type === "project") return activeProjects.find(p => p.id === form.project_id)?.name;
    if (form.link_type === "order") return activeOrders.find(o => o.id === form.order_id)?.order_number;
    if (form.link_type === "purchase_order") return activePurchaseOrders.find(po => po.id === form.purchase_order_id)?.po_number;
    if (form.link_type === "production_job") return productionJobs.find(j => j.id === form.production_job_id)?.title;
    return "";
  }, [activeOrders, activeProjects, activePurchaseOrders, clients, form, productionJobs]);

  const currentLink = linkOptions.find(option => option.key === form.link_type) || linkOptions[0];
  const updateForm = (patch) => setForm(prev => ({ ...prev, ...patch }));

  const handleSupplierSelect = (id) => {
    setSelectedSupplierId(id);
    const sup = suppliers.find(s => s.id === id);
    if (sup) updateForm({ vendor: sup.name, paid_to_name: sup.name });
  };

  const changeVendorMode = (nextMode) => {
    setVendorMode(nextMode);
    setSelectedSupplierId("");
    if (nextMode === "none") {
      updateForm({ vendor: "", expense_type: form.expense_type === "supplier_purchase" ? "transport" : form.expense_type });
    } else {
      updateForm({ paid_to_name: "" });
    }
  };

  const handleUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const folder = mode === "quick" ? "finance/expense-captures" : "finance/expenses";
      for (const file of files) {
        const { file_url } = await dataClient.integrations.Core.UploadFile({ file, visibility: "private", folder });
        setReceiptUrls(prev => [...prev, file_url]);
      }
      toast.success(files.length === 1 ? "Receipt uploaded" : "Receipts uploaded");
    } catch (error) {
      toast.error(error?.message || "Receipt upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const removeReceipt = (idx) => setReceiptUrls(prev => prev.filter((_, i) => i !== idx));

  const resetLinkFields = (linkType) => ({
    link_type: linkType,
    client_id: linkType === "client" ? form.client_id : "",
    project_id: linkType === "project" ? form.project_id : "",
    order_id: linkType === "order" ? form.order_id : "",
    purchase_order_id: linkType === "purchase_order" ? form.purchase_order_id : "",
    production_job_id: linkType === "production_job" ? form.production_job_id : "",
    is_client_recoverable: ["client", "order"].includes(linkType) ? form.is_client_recoverable : false,
  });

  const validate = () => {
    if (mode === "quick") {
      if (!receiptUrls.length && !form.amount && !form.notes.trim() && !form.expense_name.trim()) {
        toast.error("Quick capture needs a receipt, amount, name, or note.");
        return false;
      }
      return true;
    }

    if (!form.expense_name.trim() || !form.date || !form.amount || !form.category) {
      toast.error("Name, date, amount, and category are required.");
      return false;
    }
    if (vendorRequired && vendorMode === "existing" && !selectedSupplierId) {
      toast.error("Select a supplier or choose another vendor mode.");
      return false;
    }
    if (vendorRequired && vendorMode === "new" && !form.vendor.trim()) {
      toast.error("Supplier purchase expenses need a vendor name.");
      return false;
    }
    return true;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      let supplierId = selectedSupplierId || null;
      let vendorName = form.vendor.trim();

      if (mode === "full" && vendorMode === "new" && vendorName) {
        const supplier = await dataClient.entities.Supplier.create({
          name: vendorName,
          type: form.expense_type === "supplier_purchase" ? "other" : form.expense_type,
          notes: "Created from Add Expense",
        });
        supplierId = supplier?.id || null;
      }

      const isComplete = Boolean(form.date && form.amount && form.category && form.expense_name.trim() && (!vendorRequired || vendorName || supplierId));
      const status = mode === "quick" && !isComplete ? "needs_review" : currentUser?.role === "admin" ? "approved" : "captured";
      const linkedClientId = form.link_type === "client" ? form.client_id : "";
      const linkedProjectId = form.link_type === "project" ? form.project_id : "";
      const linkedOrderId = form.link_type === "order" ? form.order_id : "";
      const linkedPurchaseOrderId = form.link_type === "purchase_order" ? form.purchase_order_id : "";
      const linkedProductionJobId = form.link_type === "production_job" ? form.production_job_id : "";

      const payload = {
        date: form.date || today,
        expense_name: form.expense_name.trim() || form.paid_to_name.trim() || form.notes.trim() || "Quick expense",
        expense_type: form.expense_type,
        vendor_id: supplierId,
        vendor: vendorMode === "none" ? "" : vendorName,
        paid_to_name: vendorMode === "none" ? form.paid_to_name.trim() : form.paid_to_name.trim() || vendorName,
        amount: form.amount ? Number.parseFloat(form.amount) : 0,
        category: form.category || "unsorted",
        vat_type: form.vat_type === "unknown" ? null : form.vat_type,
        vat_amount: Number.parseFloat(vatAmount.toFixed(2)),
        receipt_urls: receiptUrls,
        attachment_paths: receiptUrls,
        payment_method: form.payment_method === "unknown" ? null : form.payment_method,
        paid_by: form.paid_by.trim(),
        notes: form.notes.trim(),
        status,
        approval_status: status === "approved" ? "approved" : status === "needs_review" ? "submitted" : "captured",
        link_type: form.link_type,
        client_id: linkedClientId,
        project_id: linkedProjectId,
        order_id: linkedOrderId,
        purchase_order_id: linkedPurchaseOrderId,
        linked_client_id: linkedClientId,
        linked_project_id: linkedProjectId,
        linked_order_id: linkedOrderId,
        linked_purchase_order_id: linkedPurchaseOrderId,
        linked_production_job_id: linkedProductionJobId,
        is_reimbursable: form.is_reimbursable,
        reimbursement_status: form.is_reimbursable ? "pending" : "not_reimbursable",
        is_client_recoverable: form.is_client_recoverable,
        recovery_status: form.is_client_recoverable ? "recoverable" : "not_recoverable",
        capture_source: mode === "quick" ? "quick_capture" : "full_form",
        submitted_by: currentUser?.email,
      };

      const saved = await createWithOfflineQueue("Expense", payload);
      toast.success(saved?.isQueuedOffline ? "Expense saved offline. It will sync when online." : status === "needs_review" ? "Quick expense saved for review" : "Expense added");
      onSaved?.();
      onClose();
    } catch (error) {
      toast.error(error?.message || "Could not save expense");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm md:items-center md:p-4">
      <div className="w-full max-w-xl overflow-hidden rounded-t-3xl border border-border/70 bg-background/95 shadow-2xl ring-1 ring-black/5 md:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur md:px-5">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-foreground">Add Expense</h2>
            <p className="text-xs text-muted-foreground">Capture once. Finance can clean it up later.</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-secondary/80 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[88vh] space-y-4 overflow-y-auto px-4 py-4 md:px-5">
          <Tabs value={mode} onValueChange={setMode} className="w-full">
            <TabsList className="grid h-10 w-full grid-cols-2 rounded-full bg-secondary/70 p-1">
              <TabsTrigger value="full" className="rounded-full text-xs"><ReceiptText className="mr-1.5 h-3.5 w-3.5" /> Full</TabsTrigger>
              <TabsTrigger value="quick" className="rounded-full text-xs"><Camera className="mr-1.5 h-3.5 w-3.5" /> Quick</TabsTrigger>
            </TabsList>

            <TabsContent value="quick" className="mt-4 space-y-4">
              <ReceiptUploader receiptUrls={receiptUrls} uploading={uploading} onUpload={handleUpload} onRemove={removeReceipt} quick />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Expense name">
                  <Input placeholder="Parking, Uber, courier..." value={form.expense_name} onChange={e => updateForm({ expense_name: e.target.value })} />
                </Field>
                <Field label="Amount">
                  <Input type="number" min="0" step="0.01" placeholder="Optional" value={form.amount} onChange={e => updateForm({ amount: e.target.value })} />
                </Field>
              </div>
              <Field label="Description">
                <Textarea placeholder="What happened? Add just enough context." value={form.notes} onChange={e => updateForm({ notes: e.target.value })} className="min-h-16 resize-none" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Category" value={form.category || "unsorted"} onValueChange={v => updateForm({ category: v })} options={categoryLabels} />
                <SelectField label="Payment" value={form.payment_method || "unknown"} onValueChange={v => updateForm({ payment_method: v })} options={paymentLabels} />
              </div>
            </TabsContent>

            <TabsContent value="full" className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Expense name *">
                  <Input placeholder="DTF film run, Bolt to supplier..." value={form.expense_name} onChange={e => updateForm({ expense_name: e.target.value })} required />
                </Field>
                <Field label="Date *">
                  <Input type="date" value={form.date} onChange={e => updateForm({ date: e.target.value })} required />
                </Field>
              </div>

              <Field label="Description">
                <Textarea placeholder="Short, human description for future review." value={form.notes} onChange={e => updateForm({ notes: e.target.value })} className="min-h-16 resize-none" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Spend type" value={form.expense_type} onValueChange={v => updateForm({ expense_type: v })} options={spendTypeLabels} />
                <SelectField label="Category" value={form.category} onValueChange={v => updateForm({ category: v })} options={categoryLabels} />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>Vendor / paid to {vendorRequired ? "*" : ""}</Label>
                  <div className="grid grid-cols-3 rounded-full bg-secondary/70 p-0.5 text-[11px]">
                    {[["existing", "Existing"], ["new", "New"], ["none", "Cash"]].map(([key, label]) => (
                      <button key={key} type="button" onClick={() => changeVendorMode(key)} className={`rounded-full px-2 py-1 font-medium transition ${vendorMode === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {vendorMode === "existing" && (
                  <Select value={selectedSupplierId || "none"} onValueChange={v => (v === "none" ? setSelectedSupplierId("") : handleSupplierSelect(v))}>
                    <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No supplier selected</SelectItem>
                      {suppliers.filter(s => !s.is_archived).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {vendorMode === "new" && <Input placeholder="Vendor name" value={form.vendor} onChange={e => updateForm({ vendor: e.target.value, paid_to_name: e.target.value })} />}
                {vendorMode === "none" && <Input placeholder="Paid to, e.g. taxi, parking, runner" value={form.paid_to_name} onChange={e => updateForm({ paid_to_name: e.target.value })} />}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount *">
                  <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={e => updateForm({ amount: e.target.value })} required />
                </Field>
                <SelectField label="VAT" value={form.vat_type || "non_vat"} onValueChange={v => updateForm({ vat_type: v })} options={vatTypeLabels} />
              </div>
              {form.vat_type === "vatable" && amount > 0 && <p className="text-xs text-muted-foreground">Input VAT estimate: R{vatAmount.toFixed(2)}</p>}

              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Payment" value={form.payment_method || "cash"} onValueChange={v => updateForm({ payment_method: v })} options={paymentLabels} />
                <Field label="Paid by">
                  <Input placeholder={currentUser?.email || "Team member"} value={form.paid_by} onChange={e => updateForm({ paid_by: e.target.value })} />
                </Field>
              </div>

              <ReceiptUploader receiptUrls={receiptUrls} uploading={uploading} onUpload={handleUpload} onRemove={removeReceipt} />
            </TabsContent>
          </Tabs>

          <section className="space-y-3 border-t border-border/70 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">What is this expense for?</h3>
                <p className="text-xs text-muted-foreground">This decides where the cost appears in profit reports.</p>
              </div>
              {form.link_type !== "none" && <span className="max-w-[45%] truncate rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">{selectedLinkLabel || linkTypeLabels[form.link_type]}</span>}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {linkOptions.map(option => {
                const Icon = option.icon;
                const active = form.link_type === option.key;
                return (
                  <button key={option.key} type="button" onClick={() => updateForm(resetLinkFields(option.key))} className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-left transition ${active ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:bg-secondary/60"}`}>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="text-xs font-medium">{option.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{currentLink.helper}</p>

            {form.link_type === "client" && <EntitySelect label="Choose client" value={form.client_id} onValueChange={v => updateForm({ client_id: v })} items={clients} getLabel={c => c.name} />}
            {form.link_type === "project" && <EntitySelect label="Choose project" value={form.project_id} onValueChange={v => updateForm({ project_id: v })} items={activeProjects} getLabel={p => p.client_name ? `${p.name} - ${p.client_name}` : p.name} />}
            {form.link_type === "order" && <EntitySelect label="Choose order" value={form.order_id} onValueChange={v => updateForm({ order_id: v })} items={activeOrders} getLabel={o => `${o.order_number || "Order"} - ${o.client_name || "Client"}`} />}
            {form.link_type === "purchase_order" && <EntitySelect label="Choose supplier PO" value={form.purchase_order_id} onValueChange={v => updateForm({ purchase_order_id: v })} items={activePurchaseOrders} getLabel={po => `${po.po_number || "PO"} - ${po.supplier_name || "Supplier"}`} />}
            {form.link_type === "production_job" && <EntitySelect label="Choose production job" value={form.production_job_id} onValueChange={v => updateForm({ production_job_id: v })} items={productionJobs} getLabel={j => j.title || j.name || "Production job"} />}

            <div className="grid grid-cols-2 gap-2">
              <ToggleLine label="Reimbursable" checked={form.is_reimbursable} onCheckedChange={v => updateForm({ is_reimbursable: v })} />
              <ToggleLine label="Client recoverable" checked={form.is_client_recoverable} onCheckedChange={v => updateForm({ is_client_recoverable: v })} />
            </div>
          </section>

          <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border/70 bg-background/95 px-4 py-3 backdrop-blur md:-mx-5 md:px-5">
            <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1 rounded-full">Cancel</Button>
            <Button type="submit" disabled={saving || uploading} className="h-11 flex-1 rounded-full bg-foreground text-background hover:bg-foreground/90">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "quick" ? "Save for review" : "Save expense"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

function SelectField({ label, value, onValueChange, options }) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
        <SelectContent>{Object.entries(options).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );
}

function EntitySelect({ label, value, onValueChange, items, getLabel }) {
  return (
    <Field label={label}>
      <Select value={value || "none"} onValueChange={v => onValueChange(v === "none" ? "" : v)}>
        <SelectTrigger className="h-10"><SelectValue placeholder="Choose..." /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          {items.map(item => <SelectItem key={item.id} value={item.id}>{getLabel(item)}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function ToggleLine({ label, checked, onCheckedChange }) {
  return (
    <label className="flex h-10 items-center justify-between gap-2 rounded-2xl border border-border px-3 text-xs font-medium text-foreground">
      <span className="truncate">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function ReceiptUploader({ receiptUrls, uploading, onUpload, onRemove, quick = false }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Receipt</Label>
      <label className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-secondary/30 transition hover:bg-secondary/60 ${quick ? "min-h-24 p-4" : "p-3"}`}>
        {uploading ? <Loader2 className="h-4 w-4 animate-spin text-foreground" /> : <Upload className="h-4 w-4 text-foreground" />}
        <span className="text-sm font-medium text-foreground">{uploading ? "Uploading..." : quick ? "Take photo or upload" : "Upload receipt"}</span>
        <input type="file" accept="image/*,application/pdf" multiple capture={quick ? "environment" : undefined} className="hidden" onChange={onUpload} disabled={uploading} />
      </label>
      {receiptUrls.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {receiptUrls.map((url, idx) => (
            <div key={`${url}-${idx}`} className="group relative aspect-square overflow-hidden rounded-2xl border border-border bg-secondary">
              <MediaPreview url={url} title="Receipt" />
              <button type="button" onClick={() => onRemove(idx)} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-background/90 text-destructive shadow-sm">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MediaPreview({ url, title }) {
  const isPdf = /\.pdf($|\?)/i.test(url);
  if (isPdf) return <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs font-medium text-muted-foreground">PDF</div>;
  return <img src={url} alt={title} className="h-full w-full object-cover" loading="lazy" />;
}
