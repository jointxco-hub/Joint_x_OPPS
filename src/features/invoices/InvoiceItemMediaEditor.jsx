import { useState } from "react";
import { FileImage, ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dataClient } from "@/api/dataClient";
import { useSignedFileUrl } from "@/lib/privateFiles";

const SPEC_FIELDS = [
  ["garment", "Garment / product"],
  ["colour", "Colour"],
  ["sizes", "Size breakdown"],
  ["print_method", "Print method"],
  ["placement", "Placement / dimensions"],
  ["finishing", "Finishing / packaging"],
];

function uniqueKey(prefix = "item") {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function SignedImage({ value, alt = "" }) {
  const { url, loading } = useSignedFileUrl(value);
  if (loading) return <div className="grid h-full w-full place-items-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (!url) return <div className="grid h-full w-full place-items-center"><FileImage className="h-5 w-5 text-muted-foreground" /></div>;
  return <img src={url} alt={alt} className="h-full w-full object-cover" />;
}

export default function InvoiceItemMediaEditor({ item, onChange }) {
  const [uploading, setUploading] = useState("");
  const proofs = Array.isArray(item.proofs) ? item.proofs : [];
  const specifications = item.specifications || {};

  const uploadOne = async (file, folder) => {
    const result = await dataClient.integrations.Core.UploadFile({ file, visibility: "private", folder });
    return result.file_url;
  };

  const uploadThumbnail = async (file) => {
    if (!file) return;
    setUploading("image");
    try {
      const imageUrl = await uploadOne(file, "invoice-items/images");
      onChange({ image_url: imageUrl });
      toast.success("Item image uploaded");
    } catch (error) {
      toast.error(error?.message || "Could not upload item image");
    } finally {
      setUploading("");
    }
  };

  const uploadProofs = async (files) => {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (!selected.length) return;
    setUploading("proof");
    try {
      const uploaded = await Promise.all(selected.map(async (file) => ({
        id: uniqueKey("proof"),
        file_url: await uploadOne(file, "invoice-items/proofs"),
        file_name: file.name,
        file_type: file.type,
        status: "draft",
        include_in_pdf: true,
        client_visible: false,
        notes: "",
        created_at: new Date().toISOString(),
      })));
      onChange({ proofs: [...proofs, ...uploaded] });
      toast.success(`${uploaded.length} proof${uploaded.length === 1 ? "" : "s"} uploaded`);
    } catch (error) {
      toast.error(error?.message || "Could not upload proof");
    } finally {
      setUploading("");
    }
  };

  const updateProof = (proofId, patch) => onChange({
    proofs: proofs.map((proof) => proof.id === proofId ? { ...proof, ...patch } : proof),
  });

  const removeProof = (proofId) => onChange({ proofs: proofs.filter((proof) => proof.id !== proofId) });

  return (
    <details className="md:col-span-12 rounded-xl border border-border bg-secondary/20 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">Images, print proofs & production specs</summary>
      <div className="mt-3 space-y-4">
        <div className="grid gap-3 sm:grid-cols-[112px_1fr]">
          <div className="h-28 w-28 overflow-hidden rounded-xl border border-border bg-card">
            {item.image_url ? <SignedImage value={item.image_url} alt={item.item_name || "Invoice item"} /> : (
              <div className="grid h-full place-items-center text-center text-xs text-muted-foreground"><ImagePlus className="h-5 w-5" />No item image</div>
            )}
          </div>
          <div className="flex flex-wrap content-start gap-2">
            <Button type="button" variant="outline" size="sm" asChild className="rounded-xl">
              <label className="cursor-pointer">
                {uploading === "image" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {item.image_url ? "Replace image" : "Upload image"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => uploadThumbnail(event.target.files?.[0])} />
              </label>
            </Button>
            {item.image_url && (
              <Button type="button" variant="outline" size="sm" onClick={() => onChange({ image_url: "" })} className="rounded-xl text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            )}
            <p className="w-full text-xs leading-5 text-muted-foreground">This thumbnail stays with the invoice snapshot and becomes the default for this client’s reusable item.</p>
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Full-size proofs / mockups</p>
              <p className="text-xs text-muted-foreground">Selected proofs are added as full-size pages after the invoice.</p>
            </div>
            <Button type="button" variant="outline" size="sm" asChild className="rounded-xl">
              <label className="cursor-pointer">
                {uploading === "proof" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Add proofs
                <input type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => uploadProofs(event.target.files)} />
              </label>
            </Button>
          </div>
          {proofs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-card px-3 py-4 text-sm text-muted-foreground">No print proofs attached.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {proofs.map((proof) => (
                <div key={proof.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex gap-3">
                    <div className="h-20 w-20 flex-none overflow-hidden rounded-lg border border-border bg-secondary/30"><SignedImage value={proof.file_url} alt={proof.file_name} /></div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="truncate text-sm font-semibold">{proof.file_name || "Print proof"}</p>
                      <select value={proof.status || "draft"} onChange={(event) => updateProof(proof.id, { status: event.target.value })} className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs">
                        <option value="draft">Draft</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                        <option value="superseded">Superseded</option>
                      </select>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <label className="flex items-center gap-1"><input type="checkbox" checked={proof.include_in_pdf !== false} onChange={(event) => updateProof(proof.id, { include_in_pdf: event.target.checked })} /> Include in PDF</label>
                        <label className="flex items-center gap-1"><input type="checkbox" checked={proof.client_visible === true} onChange={(event) => updateProof(proof.id, { client_visible: event.target.checked })} /> Client visible</label>
                      </div>
                    </div>
                    <button type="button" onClick={() => removeProof(proof.id)} className="grid h-8 w-8 flex-none place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive" aria-label="Remove proof"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <Input value={proof.notes || ""} onChange={(event) => updateProof(proof.id, { notes: event.target.value })} placeholder="Proof note, placement, or approval detail" className="mt-2 h-9 rounded-lg text-sm" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-foreground">Production specifications</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SPEC_FIELDS.map(([field, label]) => (
              <Input key={field} value={specifications[field] || ""} onChange={(event) => onChange({ specifications: { ...specifications, [field]: event.target.value } })} placeholder={label} className="h-9 rounded-lg text-sm" />
            ))}
          </div>
          <Textarea value={specifications.production_notes || ""} onChange={(event) => onChange({ specifications: { ...specifications, production_notes: event.target.value } })} placeholder="Production notes and details that must not be missed" className="mt-2 min-h-20 rounded-lg text-sm" />
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-amber-900">Why was this item changed?</label>
          <Textarea value={item.change_reason || ""} onChange={(event) => onChange({ change_reason: event.target.value })} placeholder="Required when changing a previously saved image, proof, description, price, or specification" className="mt-2 min-h-16 rounded-lg bg-white text-sm" />
          <p className="mt-1 text-xs text-amber-800">The reason, user, time, previous version, client, and invoice are saved in the audit history.</p>
        </div>
      </div>
    </details>
  );
}
