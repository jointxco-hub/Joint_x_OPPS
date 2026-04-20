import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Upload, Image, Loader2, Trash2, Plus } from "lucide-react";
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
  });
  const [receiptUrls, setReceiptUrls] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const vatAmount = form.vat_type === "vatable"
    ? parseFloat(form.amount || 0) - (parseFloat(form.amount || 0) / (1 + VAT_RATE))
    : 0;

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    for (const file of files) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
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
    await base44.entities.Expense.create({
      ...form,
      amount: parseFloat(form.amount),
      vat_amount: parseFloat(vatAmount.toFixed(2)),
      receipt_urls: receiptUrls,
    });
    toast.success("Expense added");
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-4">
      <div className="w-full max-w-lg bg-card rounded-2xl border border-border shadow-apple-xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" /> Add Expense
          </h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-border transition-all">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Date + Vendor */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>Vendor *</Label>
              <Input placeholder="e.g. Makro, Uber" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} required />
            </div>
          </div>

          {/* Amount + VAT Type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount (R) *</Label>
              <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
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

          {/* VAT calc display */}
          {form.vat_type === "vatable" && form.amount > 0 && (
            <div className="bg-blue-50 text-blue-700 text-xs rounded-xl px-3 py-2">
              Input VAT claimable: <strong>R{vatAmount.toFixed(2)}</strong> · Net (excl. VAT): <strong>R{(parseFloat(form.amount) - vatAmount).toFixed(2)}</strong>
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

          {/* Receipt Upload */}
          <div className="space-y-2">
            <Label>Receipts / Screenshots</Label>
            <label className="flex items-center gap-2 w-full cursor-pointer border-2 border-dashed border-border rounded-xl p-4 hover:border-primary/50 hover:bg-accent/30 transition-all">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <Upload className="w-4 h-4 text-muted-foreground" />}
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
                      className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
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
            <Button type="submit" disabled={saving} className="flex-1 rounded-xl">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Expense"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}