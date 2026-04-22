import React, { useState, useEffect } from "react";
import { dataClient } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Upload, Loader2, Trash2, Plus, ChevronDown } from "lucide-react";
import { toast } from "sonner";

const VAT_RATE = 0.15;

const categoryLabels = {
  production: "Production",
  raw_materials: "Raw Materials",
  packaging: "Packaging",
  shipping: "Shipping / Courier",
  marketing: "Marketing",
  software: "Software / Tools",
  rent_utilities: "Rent & Utilities",
  wages: "Wages & Salaries",
  admin: "Admin",
  owner_drawings: "Owner Drawings",
};

const paymentLabels = {
  cash: "Cash",
  card: "Card",
  eft: "EFT",
  credit: "Credit",
};

const vatTypeLabels = {
  vatable: "VATable (15%)",
  zero_rated: "Zero-Rated (0%)",
  non_vat: "No VAT",
};

export default function AddExpenseDrawer({ onClose, onSaved }) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({
    date: today,
    vendor: "",
    amount: "",
    category: "production",
    vat_type: "vatable",
    payment_method: "eft",
    notes: "",
    project_id: "",
    client_id: "",
  });
  const [receiptUrls, setReceiptUrls] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Vendor state
  const [suppliers, setSuppliers] = useState([]);
  const [vendorMode, setVendorMode] = useState("existing"); // "existing" | "new"
  const [selectedSupplierId, setSelectedSupplierId] = useState("");

  // Client / Project
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [showLinkSection, setShowLinkSection] = useState(false);

  useEffect(() => {
    dataClient.entities.Supplier.list("-created_date", 100).then(setSuppliers).catch(() => {});
    dataClient.entities.Client.filter({ is_archived: false }, "-created_date", 100).then(setClients).catch(() => {});
    dataClient.entities.Project.list("-created_date", 100).then(setProjects).catch(() => {});
  }, []);

  const vatAmount = form.vat_type === "vatable"
    ? parseFloat(form.amount || 0) - (parseFloat(form.amount || 0) / (1 + VAT_RATE))
    : 0;

  const handleSupplierSelect = (id) => {
    setSelectedSupplierId(id);
    const sup = suppliers.find(s => s.id === id);
    if (sup) setForm(f => ({ ...f, vendor: sup.name }));
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    for (const file of files) {
      const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
      setReceiptUrls(prev => [...prev, file_url]);
    }
    setUploading(false);
    toast.success("Receipt uploaded");
  };

  const removeReceipt = (idx) => {
    setReceiptUrls(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.vendor || !form.amount || !form.date) return;
    setSaving(true);
    const payload = {
      ...form,
      amount: parseFloat(form.amount),
      vat_amount: parseFloat(vatAmount.toFixed(2)),
      receipt_urls: receiptUrls,
    };
    if (!payload.project_id) delete payload.project_id;
    if (!payload.client_id) delete payload.client_id;
    await dataClient.entities.Expense.create(payload);
    toast.success("Expense added");
    onSaved();
    onClose();
  };

  const activeProjects = projects.filter(p => p.status !== "archived");

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-4">
      <div className="w-full max-w-lg bg-card rounded-2xl border border-border shadow-apple-xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            {/* Brand dot accent */}
            <span className="w-2.5 h-2.5 rounded-full bg-[#1a7a5e] inline-block" />
            Add Expense
          </h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-border transition-all">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* Date */}
          <div className="space-y-1.5">
            <Label>Date *</Label>
            <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
          </div>

          {/* Vendor Section */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Vendor *</Label>
              <div className="flex gap-1 bg-secondary rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setVendorMode("existing")}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition-all ${vendorMode === "existing" ? "bg-card shadow-apple-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Existing
                </button>
                <button
                  type="button"
                  onClick={() => { setVendorMode("new"); setSelectedSupplierId(""); setForm(f => ({ ...f, vendor: "" })); }}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition-all ${vendorMode === "new" ? "bg-card shadow-apple-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  + New
                </button>
              </div>
            </div>

            {vendorMode === "existing" ? (
              <Select value={selectedSupplierId} onValueChange={handleSupplierSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a supplier..." />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No suppliers found</div>
                  )}
                  {suppliers.filter(s => !s.is_archived).map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.type && <span className="text-muted-foreground ml-1.5 text-xs">· {s.type.replace("_", " ")}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                placeholder="Type vendor name..."
                value={form.vendor}
                onChange={e => setForm({ ...form, vendor: e.target.value })}
                required
                autoFocus
              />
            )}
          </div>

          {/* Amount + VAT Type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount (R) *</Label>
              <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>VAT Type</Label>
              <Select value={form.vat_type} onValueChange={v => setForm({ ...form, vat_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(vatTypeLabels).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* VAT calc */}
          {form.vat_type === "vatable" && parseFloat(form.amount) > 0 && (
            <div className="bg-[#1a7a5e]/8 border border-[#1a7a5e]/20 text-[#1a7a5e] text-xs rounded-xl px-3 py-2">
              Input VAT claimable: <strong>R{vatAmount.toFixed(2)}</strong> · Net excl. VAT: <strong>R{(parseFloat(form.amount) - vatAmount).toFixed(2)}</strong>
            </div>
          )}

          {/* Category + Payment */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(categoryLabels).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <Select value={form.payment_method} onValueChange={v => setForm({ ...form, payment_method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(paymentLabels).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input placeholder="Optional notes..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>

          {/* Link Client / Project (collapsible) */}
          <div className="border border-border rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowLinkSection(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-secondary/50 hover:bg-secondary text-sm font-medium text-foreground transition-all"
            >
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#c0a4e0] inline-block" />
                Link to Client / Project
                {(form.client_id || form.project_id) && (
                  <span className="text-xs bg-[#c0a4e0]/30 text-[#7c5fa0] px-2 py-0.5 rounded-full">Linked</span>
                )}
              </span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showLinkSection ? "rotate-180" : ""}`} />
            </button>
            {showLinkSection && (
              <div className="p-4 space-y-3 border-t border-border">
                <div className="space-y-1.5">
                  <Label>Client (optional)</Label>
                  <Select value={form.client_id || "none"} onValueChange={v => setForm({ ...form, client_id: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {clients.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Project (optional)</Label>
                  <Select value={form.project_id || "none"} onValueChange={v => setForm({ ...form, project_id: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {activeProjects.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                          {p.client_name && <span className="text-muted-foreground ml-1 text-xs">· {p.client_name}</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          {/* Receipt Upload */}
          <div className="space-y-2">
            <Label>Receipts / Screenshots</Label>
            <label className="flex items-center gap-2 w-full cursor-pointer border-2 border-dashed border-[#1a7a5e]/30 rounded-xl p-4 hover:border-[#1a7a5e]/60 hover:bg-[#1a7a5e]/5 transition-all">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin text-[#1a7a5e]" /> : <Upload className="w-4 h-4 text-[#1a7a5e]" />}
              <span className="text-sm text-muted-foreground">{uploading ? "Uploading..." : "Tap to upload receipts or screenshots"}</span>
              <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>

            {receiptUrls.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {receiptUrls.map((url, idx) => (
                  <div key={idx} className="relative group rounded-xl overflow-hidden border border-border aspect-square bg-secondary">
                    <img src={url} alt="receipt" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeReceipt(idx)}
                      className="absolute top-1 right-1 w-5 h-5 bg-destructive rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-xl">Cancel</Button>
            <Button
              type="submit"
              disabled={saving || (!form.vendor && vendorMode === "new") || (!selectedSupplierId && vendorMode === "existing")}
              className="flex-1 rounded-xl bg-[#1a7a5e] hover:bg-[#155f4a] text-white"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Expense"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
