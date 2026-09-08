import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, Search, TriangleAlert, Plus, Check } from "lucide-react";
import { dataClient } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  catalogItemToQuoteLine,
  clientProductToQuoteLine,
  addonLinesFromCatalogItem,
  brandingLineFromClientProduct,
  isClientProductApproved,
  isClientProductArchived,
} from "./quoteProductMapping";

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function NeedsPriceChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
      <TriangleAlert className="h-3 w-3" /> Needs price — staff review
    </span>
  );
}

function ClientStatusBadge({ status }) {
  const approved = isClientProductApproved({ status });
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        approved ? "bg-emerald-100 text-emerald-700" : "bg-secondary text-muted-foreground"
      }`}
    >
      {approved ? "Client-approved" : String(status || "unconfigured").replace(/_/g, " ")}
    </span>
  );
}

// One selectable catalogue / client-product row. Emits a primary line plus
// any add-on / branding lines the staff member ticked.
function ResultRow({ title, subtitle, imageUrl, priceLabel, needsPrice, badge, extras, onAdd }) {
  const [pickedExtras, setPickedExtras] = useState(() => new Set());
  const toggleExtra = (key) =>
    setPickedExtras((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary/50">
          {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{title}</p>
            {badge}
          </div>
          {subtitle ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{subtitle}</p> : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {needsPrice ? <NeedsPriceChip /> : <span className="text-sm font-semibold text-foreground">{priceLabel}</span>}
          </div>
          {extras.length ? (
            <div className="mt-2 space-y-1 rounded-lg bg-secondary/30 p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Branding &amp; add-ons (optional)</p>
              {extras.map((ex) => (
                <label key={ex.key} className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                  <input type="checkbox" checked={pickedExtras.has(ex.key)} onChange={() => toggleExtra(ex.key)} className="h-3.5 w-3.5" />
                  <span className="flex-1">{ex.label}</span>
                  {ex.needsPrice ? <span className="text-[10px] font-semibold text-amber-700">set price</span> : <span className="text-muted-foreground">{money(ex.rate)}</span>}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => onAdd(extras.filter((ex) => pickedExtras.has(ex.key)).map((ex) => ex.line))}
          className="h-9 shrink-0 rounded-lg"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}

export default function QuoteProductPicker({ open, onOpenChange, clientId = null, onPick }) {
  const [tab, setTab] = useState(clientId ? "client" : "catalogue");
  const [term, setTerm] = useState("");

  const { data: clientProducts = [], isLoading: cpLoading } = useQuery({
    queryKey: ["quoteClientProducts", clientId],
    enabled: Boolean(open && clientId),
    queryFn: () => dataClient.entities.ClientProduct.filter({ client_id: clientId }, "client_facing_name", 200),
  });

  const { data: catalogItems = [], isLoading: catLoading } = useQuery({
    queryKey: ["quoteCatalogItems"],
    enabled: Boolean(open),
    queryFn: () => dataClient.entities.CatalogItem.list("name", 500),
  });

  const q = term.trim().toLowerCase();
  const filteredClientProducts = useMemo(
    () =>
      (clientProducts || [])
        .filter((cp) => !isClientProductArchived(cp))
        .filter((cp) => !q || `${cp.client_facing_name || ""} ${cp.internal_name || ""}`.toLowerCase().includes(q)),
    [clientProducts, q],
  );
  const filteredCatalog = useMemo(
    () =>
      (catalogItems || [])
        .filter((p) => p.store_visible !== false && p.status !== "archived")
        .filter((p) => !q || `${p.name || ""} ${p.category || ""} ${p.code || ""}`.toLowerCase().includes(q)),
    [catalogItems, q],
  );

  const finish = (primaryLine, extraLines = []) => {
    onPick(primaryLine, extraLines);
    onOpenChange(false);
    setTerm("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add a product</DialogTitle>
          <DialogDescription>
            Pull item name, description and configured price from the catalogue. Custom lines are still available.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-2 inline-flex rounded-xl bg-secondary/60 p-1 text-xs">
          <button
            type="button"
            onClick={() => setTab("client")}
            disabled={!clientId}
            className={`rounded-lg px-3 py-1.5 font-semibold ${tab === "client" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"} ${!clientId ? "opacity-40" : ""}`}
          >
            Client products
          </button>
          <button
            type="button"
            onClick={() => setTab("catalogue")}
            className={`rounded-lg px-3 py-1.5 font-semibold ${tab === "catalogue" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            Catalogue
          </button>
        </div>

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={tab === "client" ? "Search this client's products" : "Search catalogue by name, category or code"}
            className="h-10 rounded-xl pl-9"
          />
        </div>

        <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
          {tab === "client" && !clientId ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Link this quote to a client to see their approved products and configured pricing.
            </p>
          ) : tab === "client" ? (
            cpLoading ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Loading client products…</p>
            ) : filteredClientProducts.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">No matching client products.</p>
            ) : (
              filteredClientProducts.map((cp) => {
                const line = clientProductToQuoteLine(cp);
                const branding = brandingLineFromClientProduct(cp);
                const extras = branding
                  ? [{ key: `br-${cp.id}`, label: branding.item_name, rate: branding.rate, needsPrice: branding._needs_price_review, line: branding }]
                  : [];
                return (
                  <ResultRow
                    key={cp.id}
                    title={line.item_name}
                    subtitle={line.item_description}
                    imageUrl={line.image_url}
                    priceLabel={money(line.rate)}
                    needsPrice={line._needs_price_review}
                    badge={<ClientStatusBadge status={cp.status} />}
                    extras={extras}
                    onAdd={(chosen) => finish(line, chosen)}
                  />
                );
              })
            )
          ) : catLoading ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Loading catalogue…</p>
          ) : filteredCatalog.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No matching catalogue items.</p>
          ) : (
            filteredCatalog.map((p) => {
              const line = catalogItemToQuoteLine(p);
              const addons = addonLinesFromCatalogItem(p);
              const extras = addons.map((a, i) => ({
                key: `ad-${p.id}-${i}`,
                label: a.item_name,
                rate: a.rate,
                needsPrice: a._needs_price_review,
                line: a,
              }));
              return (
                <ResultRow
                  key={p.id}
                  title={line.item_name}
                  subtitle={line.item_description}
                  imageUrl={line.image_url}
                  priceLabel={money(line.rate)}
                  needsPrice={line._needs_price_review}
                  badge={p.category ? <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{p.category}</span> : null}
                  extras={extras}
                  onAdd={(chosen) => finish(line, chosen)}
                />
              );
            })
          )}
        </div>

        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Check className="h-3 w-3" /> Selected product data is copied onto the quote line and frozen into the revision snapshot on save.
        </p>
      </DialogContent>
    </Dialog>
  );
}
