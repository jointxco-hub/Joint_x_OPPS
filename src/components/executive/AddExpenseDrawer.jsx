import React, { useEffect, useMemo, useState } from "react";
import { dataClient } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X, Upload, Loader2, Trash2, ChevronDown, Camera, ReceiptText } from "lucide-react";
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
  vatable: "VATable (15%)",
  zero_rated: "Zero-Rated (0%)",
  non_vat: "No VAT",
  unknown: "Unknown",
};

const linkTypeLabels = {
  none: "General business expense",
  client: "Client recoverable",
  project: "Project cost",
  order: "Order production cost",
  production_job: "Production job / request",
};

const defaultForm = (today, initialCategory) => ({
  date: today,
  expense_type: "supplier_purchase",
  vendor: "",
  paid_to_name: "",
  amount: "",
  category: initialCategory || "production",
  vat_type: "vatable",
  payment_method: "eft",
  paid_by: "",
  notes: "",
  link_type: "none",
  client_id: "",
  project_id: "",
  order_id: "",
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
  const [productionJobs, setProductionJobs] = useState([]);
  const [showLinkSection, setShowLinkSection] = useState(false);

  useEffect(() => {
    dataClient.auth.me().then(setCurrentUser).catch(() => {});
    dataClient.entities.Supplier.list("-created_date", 100).then(setSuppliers).catch(() => {});
    dataClient.entities.Client.filter({ is_archived: false }, "-created_date", 100).then(setClients).catch(() => {});
    dataClient.entities.Project.list("-created_date", 100).then(setProjects).catch(() => {});
    dataClient.entities.Order.list("-created_date", 150).then(setOrders).catch(() => {});
    dataClient.entities.OpsTask.list("-created_date", 150).then(setProductionJobs).catch(() => {});
  }, []);

  const amount = Number.parseFloat(form.amount || 0);
  const vatAmount = form.vat_type === "vatable" && amount > 0 ? amount - (amount / (1 + VAT_RATE)) : 0;
  const vendorRequired = mode === "full" && form.expense_type === "supplier_purchase";
  const activeProjects = projects.filter(p => p.status !== "archived" && !p.is_archived);
  const activeOrders = orders.filter(o => !o.is_archived && !["cancelled", "delivered"].includes(o.status));

  const selectedLinkLabel = useMemo(() => {
    if (form.link_type === "client") return clients.find(c => c.id === form.client_id)?.name;
    if (form.link_type === "project") return activeProjects.find(p => p.id === form.project_id)?.name;
    if (form.link_type === "order") return activeOrders.find(o => o.id === form.order_id)?.order_number;
    if (form.link_type === "production_job") return productionJobs.find(j => j.id === form.production_job_id)?.title;
    return "";
  }, [activeOrders, activeProjects, clients, form, productionJobs]);

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

  const removeReceipt = (idx) => {
    setReceiptUrls(prev => prev.filter((_, i) => i !== idx));
  };

  const resetLinkFields = (linkType) => ({
    link_type: linkType,
    client_id: linkType === "client" ? form.client_id : "",
    project_id: linkType === "project" ? form.project_id : "",
    order_id: linkType === "order" ? form.order_id : "",
    production_job_id: linkType === "production_job" ? form.production_job_id : "",
    is_client_recoverable: linkType === "client" ? form.is_client_recoverable : false,
  });

  const validate = () => {
    if (mode === "quick") {
      if (!receiptUrls.length && !form.amount && !form.notes.trim()) {
        toast.error("Quick capture needs a receipt, amount, or note.");
        return false;
      }
      return true;
    }

    if (!form.date || !form.amount || !form.category) {
      toast.error("Date, amount, and category are required.");
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

      const isComplete = Boolean(form.date && form.amount && form.category && (!vendorRequired || vendorName || supplierId));
      const status = mode === "quick" && !isComplete ? "needs_review" : currentUser?.role === "admin" ? "approved" : "captured";
      const linkedClientId = form.link_type === "client" ? form.client_id : "";
      const linkedProjectId = form.link_type === "project" ? form.project_id : "";
      const linkedOrderId = form.link_type === "order" ? form.order_id : "";
      const linkedProductionJobId = form.link_type === "production_job" ? form.production_job_id : "";

      const payload = {
        date: form.date || today,
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
        linked_client_id: linkedClientId,
        linked_project_id: linkedProjectId,
        linked_order_id: linkedOrderId,
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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-3 md:p-4">
      <div className="w-full max-w-2xl bg-card rounded-2xl border border-border shadow-apple-xl max-h-[94vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#1a7a5e] inline-block" />
            Add Expense
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-border transition-all">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          <Tabs value={mode} onValueChange={setMode} className="w-full">
            <TabsList className="grid w-full grid-cols-2 rounded-xl bg-secondary p-1">
              <TabsTrigger value="full" className="rounded-lg gap-2"><ReceiptText className="h-3.5 w-3.5" /> Full Form</TabsTrigger>
              <TabsTrigger value="quick" className="rounded-lg gap-2"><Camera className="h-3.5 w-3.5" /> Quick Expense</TabsTrigger>
            </TabsList>

            <TabsContent value="quick" className="space-y-4 mt-4">
              <ReceiptUploader receiptUrls={receiptUrls} uploading={uploading} onUpload={handleUpload} onRemove={removeReceipt} quick />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date">
                  <Input type="date" value={form.date} onChange={e => updateForm({ date: e.target.value })} />
                </Field>
                <Field label="Amount (R)">
                  <Input type="number" min="0" step="0.01" placeholder="Optional" value={form.amount} onChange={e => updateForm({ amount: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Category" value={form.category || "unsorted"} onValueChange={v => updateForm({ category: v })} options={categoryLabels} />
                <SelectField label="Payment" value={form.payment_method || "unknown"} onValueChange={v => updateForm({ payment_method: v })} options={paymentLabels} />
              </div>
              <Field label="Paid to / Description">
                <Input placeholder="Uber driver, parking, cash transport..." value={form.paid_to_name} onChange={e => updateForm({ paid_to_name: e.target.value })} />
              </Field>
              <Field label="Notes">
                <Textarea placeholder="Short context for finance review..." value={form.notes} onChange={e => updateForm({ notes: e.target.value })} className="min-h-20" />
              </Field>
            </TabsContent>

            <TabsContent value="full" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date *">
                  <Input type="date" value={form.date} onChange={e => updateForm({ date: e.target.value })} required />
                </Field>
                <SelectField label="Spend Type *" value={form.expense_type} onValueChange={v => updateForm({ expense_type: v })} options={spendTypeLabels} />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>Vendor / Paid To {vendorRequired ? "*" : ""}</Label>
                  <div className="grid grid-cols-3 gap-1 bg-secondary rounded-lg p-0.5 text-xs">
                    {[["existing", "Existing"], ["new", "+ New"], ["none", "No Vendor"]].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => changeVendorMode(key)}
                        className={`px-2 py-1 rounded-md font-medium transition-all ${vendorMode === key ? "bg-card shadow-apple-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {vendorMode === "existing" && (
                  <Select value={selectedSupplierId || "none"} onValueChange={v => (v === "none" ? setSelectedSupplierId("") : handleSupplierSelect(v))}>
                    <SelectTrigger><SelectValue placeholder="Select a supplier..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No supplier selected</SelectItem>
                      {suppliers.filter(s => !s.is_archived).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {vendorMode === "new" && <Input placeholder="Type vendor name..." value={form.vendor} onChange={e => updateForm({ vendor: e.target.value, paid_to_name: e.target.value })} autoFocus />}
                {vendorMode === "none" && <Input placeholder="Paid to / description, e.g. Taxi, parking, staff cash" value={form.paid_to_name} onChange={e => updateForm({ paid_to_name: e.target.value })} autoFocus />}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount (R) *">
                  <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={e => updateForm({ amount: e.target.value })} required />
                </Field>
                <SelectField label="VAT Type" value={form.vat_type || "non_vat"} onValueChange={v => updateForm({ vat_type: v })} options={vatTypeLabels} />
              </div>

              {form.vat_type === "vatable" && amount > 0 && (
                <div className="bg-[#1a7a5e]/8 border border-[#1a7a5e]/20 text-[#1a7a5e] text-xs rounded-xl px-3 py-2">
                  Input VAT claimable: <strong>R{vatAmount.toFixed(2)}</strong>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Category *" value={form.category} onValueChange={v => updateForm({ category: v })} options={categoryLabels} />
                <SelectField label="Payment Method" value={form.payment_method || "cash"} onValueChange={v => updateForm({ payment_method: v })} options={paymentLabels} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Paid By">
                  <Input placeholder={currentUser?.email || "Team member"} value={form.paid_by} onChange={e => updateForm({ paid_by: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-2 pt-6">
                  <ToggleLine label="Reimbursable?" checked={form.is_reimbursable} onCheckedChange={v => updateForm({ is_reimbursable: v })} />
                  <ToggleLine label="Recoverable?" checked={form.is_client_recoverable} onCheckedChange={v => updateForm({ is_client_recoverable: v })} />
                </div>
              </div>

              <Field label="Description / Notes">
                <Textarea placeholder="What was bought, why, and any receipt context..." value={form.notes} onChange={e => updateForm({ notes: e.target.value })} className="min-h-20" />
              </Field>

              <ReceiptUploader receiptUrls={receiptUrls} uploading={uploading} onUpload={handleUpload} onRemove={removeReceipt} />
            </TabsContent>
          </Tabs>

          <div className="border border-border rounded-xl overflow-hidden">
            <button type="button" onClick={() => setShowLinkSection(v => !v)} className="w-full flex items-center justify-between px-4 py-3 bg-secondary/50 hover:bg-secondary text-sm font-medium text-foreground transition-all">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#c0a4e0] inline-block" />
                Link / Cost Allocation
                {form.link_type !== "none" && <span className="text-xs bg-[#c0a4e0]/30 text-[#7c5fa0] px-2 py-0.5 rounded-full">{selectedLinkLabel || linkTypeLabels[form.link_type]}</span>}
              </span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showLinkSection ? "rotate-180" : ""}`} />
            </button>
            {showLinkSection && (
              <div className="p-4 space-y-3 border-t border-border">
                <SelectField label="Finance meaning" value={form.link_type} onValueChange={v => updateForm(resetLinkFields(v))} options={linkTypeLabels} />
                {form.link_type === "client" && <EntitySelect label="Client" value={form.client_id} onValueChange={v => updateForm({ client_id: v })} items={clients} getLabel={c => c.name} />}
                {form.link_type === "project" && <EntitySelect label="Project" value={form.project_id} onValueChange={v => updateForm({ project_id: v })} items={activeProjects} getLabel={p => p.client_name ? `${p.name} - ${p.client_name}` : p.name} />}
                {form.link_type === "order" && <EntitySelect label="Order" value={form.order_id} onValueChange={v => updateForm({ order_id: v })} items={activeOrders} getLabel={o => `${o.order_number || "Order"} - ${o.client_name || "Client"}`} />}
                {form.link_type === "production_job" && <EntitySelect label="Production job / request" value={form.production_job_id} onValueChange={v => updateForm({ production_job_id: v })} items={productionJobs} getLabel={j => j.title || j.name || "Production job"} />}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-xl">Cancel</Button>
            <Button type="submit" disabled={saving || uploading} className="flex-1 rounded-xl bg-[#1a7a5e] hover:bg-[#155f4a] text-white">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === "quick" ? "Save for Review" : "Save Expense"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function SelectField({ label, value, onValueChange, options }) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{Object.entries(options).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );
}

function EntitySelect({ label, value, onValueChange, items, getLabel }) {
  return (
    <Field label={label}>
      <Select value={value || "none"} onValueChange={v => onValueChange(v === "none" ? "" : v)}>
        <SelectTrigger><SelectValue placeholder="Choose..." /></SelectTrigger>
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
    <label className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium text-foreground">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function ReceiptUploader({ receiptUrls, uploading, onUpload, onRemove, quick = false }) {
  return (
    <div className="space-y-2">
      <Label>Receipts / Screenshots</Label>
      <label className={`flex items-center justify-center gap-3 w-full cursor-pointer border-2 border-dashed border-[#1a7a5e]/30 rounded-xl hover:border-[#1a7a5e]/60 hover:bg-[#1a7a5e]/5 transition-all ${quick ? "min-h-32 p-5 flex-col text-center" : "p-4"}`}>
        {uploading ? <Loader2 className="w-5 h-5 animate-spin text-[#1a7a5e]" /> : <Upload className="w-5 h-5 text-[#1a7a5e]" />}
        <span className="text-sm font-medium text-foreground">{uploading ? "Uploading..." : quick ? "Take photo / Upload receipt" : "Upload receipts or screenshots"}</span>
        <input type="file" accept="image/*,application/pdf" multiple capture={quick ? "environment" : undefined} className="hidden" onChange={onUpload} disabled={uploading} />
      </label>
      {receiptUrls.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mt-2">
          {receiptUrls.map((url, idx) => (
            <div key={`${url}-${idx}`} className="relative group rounded-xl overflow-hidden border border-border aspect-square bg-secondary">
              <MediaPreview url={url} title="Receipt" />
              <button type="button" onClick={() => onRemove(idx)} className="absolute top-1 right-1 w-6 h-6 bg-destructive rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all">
                <Trash2 className="w-3 h-3 text-white" />
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
  if (isPdf) return <div className="h-full w-full flex items-center justify-center text-xs font-medium text-muted-foreground px-2 text-center">PDF receipt</div>;
  return <img src={url} alt={title} className="h-full w-full object-cover" loading="lazy" />;
}
