import { FileClock, Package } from "lucide-react";
import { useSignedFileUrl } from "@/lib/privateFiles";

function ItemImage({ value, alt }) {
  const { url } = useSignedFileUrl(value);
  return url
    ? <img src={url} alt={alt || ""} className="h-full w-full object-cover" />
    : <div className="grid h-full w-full place-items-center"><Package className="h-4 w-4 text-slate-400" /></div>;
}

function dateTime(value) {
  if (!value) return "Unknown time";
  return new Date(value).toLocaleString();
}

export default function ClientInvoiceItemHistory({ items = [], history = [] }) {
  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center gap-2">
        <FileClock className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Products, proofs & change history</h3>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No client-specific invoiced products have been saved yet.</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {items.slice(0, 12).map((item) => (
            <div key={item.id} className="flex gap-3 rounded-lg bg-slate-50 p-3">
              <div className="h-14 w-14 flex-none overflow-hidden rounded-lg border border-slate-200 bg-white"><ItemImage value={item.image_url} alt={item.name} /></div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.description || "Reusable client invoice item"}</p>
                <p className="mt-1 text-[11px] text-slate-500">Version {item.current_version || 1} · {(item.proofs || []).length} proof(s)</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-slate-200 pt-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Latest changes</p>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No item changes recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {history.slice(0, 12).map((version) => (
              <div key={version.id} className="rounded-md border border-slate-100 p-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <p className="text-sm font-medium text-slate-800">{version.snapshot?.item_name || "Invoice item"} · v{version.version_number}</p>
                  <p className="text-xs text-slate-400">{dateTime(version.created_at)}</p>
                </div>
                <p className="mt-1 text-sm text-slate-600">{version.change_reason}</p>
                <p className="mt-1 text-[11px] text-slate-400">Changed by {version.changed_by || "system"}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
