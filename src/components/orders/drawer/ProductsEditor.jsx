import { useState } from "react";
import { Copy, Minus, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ProductsEditor({ order = {}, onUpdate }) {
  const [editingIdx, setEditingIdx] = useState(/** @type {number|null} */ (null));
  const emptyRow = { name: "", quantity: 1, price: "", size: "", color: "", notes: "", catalog_item_id: "", inventory_item_id: "", image_url: "", category: "", source: "", selected_print_options: [], selected_addons: [] };
  const [editRow, setEditRow] = useState(emptyRow);
  const [addMode, setAddMode] = useState(false);
  const [newRow, setNewRow] = useState(emptyRow);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSource, setPickerSource] = useState("all");
  const [pickerCategory, setPickerCategory] = useState("all");
  const [showPicker, setShowPicker] = useState(false);

  const { data: catalogItems = [] } = useQuery({
    queryKey: ["catalogItems"],
    queryFn: () => dataClient.entities.CatalogItem.list("name", 500),
    enabled: addMode,
    staleTime: 300_000,
  });
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => dataClient.entities.InventoryItem.list("name", 200),
    enabled: addMode,
    staleTime: 300_000,
  });

  const products = Array.isArray(order.products) ? order.products : [];
  const safeCatalogItems = Array.isArray(catalogItems) ? catalogItems : [];
  const safeInventoryItems = Array.isArray(inventoryItems) ? inventoryItems : [];
  const thumbFor = (item) => {
    const image = item?.image_url || item?.primary_image || item?.thumbnail_url || item?.cover_image_url || (Array.isArray(item?.images) ? (item.images[0]?.src || item.images[0]) : "");
    return typeof image === "string" ? image : "";
  };
  const listFrom = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string" || typeof item === "number").map(String) : [];
  const optionListFrom = (value, prefix) => Array.isArray(value)
    ? value
      .filter(Boolean)
      .map((option, index) => {
        if (typeof option === "string" || typeof option === "number") {
          return { id: `${prefix}-${index}-${option}`, name: String(option), price: "" };
        }
        return {
          id: option.id || option.key || `${prefix}-${index}-${option.name || option.label || option.title || "option"}`,
          name: option.name || option.label || option.title || option.type || "Option",
          type: option.type || option.method || "",
          locations: listFrom(option.locations || option.placements || option.placement),
          price: option.price ?? option.cost ?? "",
          image_url: thumbFor(option),
        };
      })
    : [];
  const cleanProduct = (item) => {
    if (item && typeof item === "object") return item;
    return { name: String(item || "Item"), quantity: 1 };
  };
  const optionKey = (option) => String(option?.id || option?.name || option);
  const optionLabel = (option) => {
    if (typeof option === "string" || typeof option === "number") return String(option);
    const locations = Array.isArray(option?.locations)
      ? option.locations.join("/")
      : option?.locations
        ? String(option.locations)
        : "";
    return [option?.name || option?.label || option?.title || "Option", locations].filter(Boolean).join(" - ");
  };
  const toggleProductOption = (kind, option) => {
    const key = kind === "print" ? "selected_print_options" : "selected_addons";
    const selected = Array.isArray(newRow[key]) ? newRow[key] : [];
    const exists = selected.some((item) => optionKey(item) === optionKey(option));
    setNewRow((row) => ({
      ...row,
      [key]: exists ? selected.filter((item) => optionKey(item) !== optionKey(option)) : [...selected, option],
    }));
  };
  const formatMoney = (value) => {
    const amount = Number(value || 0);
    return amount > 0 ? `R${amount.toLocaleString()}` : "";
  };

  const saveRow = () => {
    if (!editRow.name.trim()) return;
    const updated = products.map((raw, i) => {
      const p = cleanProduct(raw);
      return (
      i === editingIdx ? { ...p, ...editRow, quantity: Number(editRow.quantity) || 1 } : p
      );
    });
    onUpdate(order.id, { products: updated });
    setEditingIdx(null);
  };

  const removeRow = (/** @type {number} */ idx) => {
    const updated = products.filter((_, i) => i !== idx);
    onUpdate(order.id, { products: updated });
  };

  const addRow = () => {
    if (!newRow.name.trim()) return;
    const updated = [...products, { ...newRow, quantity: Number(newRow.quantity) || 1 }];
    onUpdate(order.id, { products: updated });
    setNewRow(emptyRow);
    setAddMode(false);
    setPickerSearch("");
    setPickerSource("all");
    setPickerCategory("all");
    setShowPicker(false);
  };

  const duplicateRow = (/** @type {any} */ rawProduct) => {
    const p = cleanProduct(rawProduct);
    onUpdate(order.id, { products: [...products, { ...p, quantity: Number(p.quantity) || 1 }] });
    toast.success("Product copied on this order");
  };

  const allPickerItems = [
    ...(/** @type {any[]} */ (safeCatalogItems))
      .filter((/** @type {any} */ c) => c.is_archived !== true)
      .filter((/** @type {any} */ c) => c.store_visible !== false)
      .filter((/** @type {any} */ c) => c.is_active !== false && c.hidden !== true && c.is_hidden !== true)
      .filter((/** @type {any} */ c) => !["draft", "hidden", "inactive", "archived"].includes(String(c.status || "active").toLowerCase()))
      .map((/** @type {any} */ c) => ({
        id: c.id,
        name: c.name,
        price: c.price ?? c.base_price ?? c.selling_price ?? "",
        source: "catalog",
        category: c.category || "",
        image_url: thumbFor(c),
        sizes: listFrom(c.sizes || c.size_options || c.sizes_available || c.variants?.sizes),
        colors: listFrom(c.colors || c.colours || c.color_options || c.colour_options || c.colors_available || c.variants?.colors),
        print_options: optionListFrom(c.print_options || c.printOptions, "print"),
        addons: optionListFrom(c.addons || c.add_ons || c.addOns, "addon"),
      })),
    ...(/** @type {any[]} */ (safeInventoryItems))
      .filter((/** @type {any} */ i) => !i.is_archived && !(/** @type {any[]} */ (safeCatalogItems)).some((/** @type {any} */ c) => c.name?.toLowerCase() === i.name?.toLowerCase()))
      .map((/** @type {any} */ i) => ({
        id: i.id,
        name: i.name,
        price: i.selling_price ?? "",
        source: "stock",
        category: i.category || "",
        image_url: thumbFor(i),
        sizes: listFrom(i.sizes_available),
        colors: listFrom(i.colors_available),
        print_options: optionListFrom(i.print_options || i.printOptions, "print"),
        addons: optionListFrom(i.addons || i.add_ons || i.addOns, "addon"),
      })),
  ];

  const pickerCategories = [...new Set(allPickerItems.map((item) => item.category).filter(Boolean))].slice(0, 14);
  const sourceFiltered = allPickerItems.filter((item) => {
    const sourceMatch = pickerSource === "all" || item.source === pickerSource;
    const categoryMatch = pickerCategory === "all" || item.category === pickerCategory;
    return sourceMatch && categoryMatch;
  });
  const filtered = pickerSearch
    ? sourceFiltered.filter(p => p.name?.toLowerCase().includes(pickerSearch.toLowerCase()))
    : sourceFiltered.slice(0, 10);
  const selectedPickerItem = allPickerItems.find((item) => item.id && item.id === (newRow.catalog_item_id || newRow.inventory_item_id));

  const updateQuantity = (idx, delta) => {
    const updated = products.map((item, i) => {
      const clean = cleanProduct(item);
      return i === idx
        ? { ...clean, quantity: Math.max(1, Number(clean.quantity || 1) + delta) }
        : clean;
    });
    onUpdate(order.id, { products: updated });
  };

  return (
    <div className="bg-secondary/30 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Products</h3>
        {!addMode && (
          <button type="button" onClick={() => setAddMode(true)} className="flex items-center gap-1 text-xs text-primary font-medium">
            <Plus className="w-3 h-3" /> Add
          </button>
        )}
      </div>

      {/* Existing rows */}
      <div className="space-y-2 mb-3">
        {products.length === 0 && !addMode && (
          <p className="text-xs text-muted-foreground italic">No products - click Add to start</p>
        )}
        {products.map((/** @type {any} */ rawProduct, /** @type {number} */ i) => {
          const p = cleanProduct(rawProduct);
          return editingIdx === i ? (
            <div key={i} className="grid gap-2 bg-card rounded-lg px-2 py-2 border border-border sm:grid-cols-[1fr_56px_84px]">
              <Input value={editRow.name} onChange={(/** @type {any} */ e) => setEditRow(r => ({ ...r, name: e.target.value }))}
                className="h-7 text-xs flex-1 rounded-lg" placeholder="Name" autoFocus />
              <Input value={editRow.quantity} onChange={(/** @type {any} */ e) => setEditRow(r => ({ ...r, quantity: e.target.value }))}
                type="number" className="h-7 text-xs w-12 rounded-lg" placeholder="Qty" />
              <Input value={editRow.price} onChange={(/** @type {any} */ e) => setEditRow(r => ({ ...r, price: e.target.value }))}
                type="number" className="h-7 text-xs w-16 rounded-lg" placeholder="R" />
              <Input value={editRow.size} onChange={(/** @type {any} */ e) => setEditRow(r => ({ ...r, size: e.target.value }))}
                className="h-7 text-xs rounded-lg" placeholder="Size" />
              <Input value={editRow.color} onChange={(/** @type {any} */ e) => setEditRow(r => ({ ...r, color: e.target.value }))}
                className="h-7 text-xs rounded-lg" placeholder="Colour" />
              <Input value={editRow.notes} onChange={(/** @type {any} */ e) => setEditRow(r => ({ ...r, notes: e.target.value }))}
                className="h-7 text-xs rounded-lg sm:col-span-3" placeholder="Item notes / print placement" />
              <div className="flex gap-2 sm:col-span-3">
                <button type="button" onClick={saveRow} className="text-xs text-primary font-medium whitespace-nowrap">Save</button>
                <button type="button" onClick={() => setEditingIdx(null)} className="text-xs text-muted-foreground">Cancel</button>
              </div>
            </div>
          ) : (
            <div key={i} className="flex flex-col gap-3 group px-2 py-2 rounded-xl hover:bg-card/70 transition-all sm:flex-row sm:items-center">
              <div className="h-12 w-12 overflow-hidden rounded-xl border border-border bg-secondary/50 flex-shrink-0">
                {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Package className="m-3 h-6 w-6 text-muted-foreground/50" />}
              </div>
              <div className="min-w-0 flex-1">
              <span className="text-sm text-foreground flex-1 truncate">
                {p.name}
                {(p.size || p.color) && <span className="ml-2 text-xs text-muted-foreground">{[p.size, p.color].filter(Boolean).join(" / ")}</span>}
              </span>
              {(p.category || p.source) && <p className="mt-0.5 truncate text-xs text-muted-foreground">{[p.category, p.source].filter(Boolean).join(" / ")}</p>}
              {(Array.isArray(p.selected_print_options) && p.selected_print_options.length > 0) && (
                <p className="mt-1 truncate text-xs text-primary">Print: {p.selected_print_options.map(optionLabel).join(", ")}</p>
              )}
              {(Array.isArray(p.selected_addons) && p.selected_addons.length > 0) && (
                <p className="mt-0.5 truncate text-xs text-amber-700">Add-ons: {p.selected_addons.map(optionLabel).join(", ")}</p>
              )}
              {p.notes && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.notes}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                <button type="button" onClick={() => updateQuantity(i, -1)} className="grid h-6 w-6 place-items-center rounded-full border border-border bg-background hover:bg-secondary">
                  <Minus className="h-3 w-3" />
                </button>
                <span className="min-w-5 text-center text-xs font-semibold">{p.quantity || 1}</span>
                <button type="button" onClick={() => updateQuantity(i, 1)} className="grid h-6 w-6 place-items-center rounded-full border border-border bg-background hover:bg-secondary">
                  <Plus className="h-3 w-3" />
                </button>
                {p.price && (
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                    {formatMoney(Number(p.price) * Number(p.quantity || 1))}
                  </span>
                )}
                <button type="button" onClick={() => duplicateRow(p)}
                  className="opacity-100 text-muted-foreground hover:text-primary transition-all sm:opacity-0 sm:group-hover:opacity-100"
                  title="Copy product">
                  <Copy className="w-3 h-3" />
                </button>
                <button type="button" onClick={() => { setEditingIdx(i); setEditRow({ name: p.name, quantity: p.quantity || 1, price: p.price || "", size: p.size || "", color: p.color || "", notes: p.notes || "", catalog_item_id: p.catalog_item_id || "", inventory_item_id: p.inventory_item_id || "", image_url: p.image_url || "", category: p.category || "", source: p.source || "", selected_print_options: p.selected_print_options || [], selected_addons: p.selected_addons || [] }); }}
                  className="opacity-100 text-muted-foreground hover:text-foreground transition-all sm:opacity-0 sm:group-hover:opacity-100">
                  <Pencil className="w-3 h-3" />
                </button>
                <button type="button" onClick={() => removeRow(i)}
                  className="opacity-100 text-muted-foreground hover:text-destructive transition-all sm:opacity-0 sm:group-hover:opacity-100">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add new row */}
      {addMode && (
        <div className="bg-card rounded-xl border border-border p-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-foreground">Add product</p>
              <p className="text-[11px] text-muted-foreground">Choose from catalog, stock, or save a custom item with only the details you have.</p>
            </div>
            {allPickerItems.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                {allPickerItems.length} options
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              ["all", "All"],
              ["catalog", "Catalog"],
              ["stock", "Stock"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPickerSource(value)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all ${
                  pickerSource === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/40"
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setNewRow((r) => ({ ...r, catalog_item_id: "", inventory_item_id: "", image_url: "", category: "", source: "custom" }));
                setPickerSearch("");
                setShowPicker(false);
              }}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all ${
                newRow.source === "custom" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/40"
              }`}
            >
              Custom
            </button>
          </div>
          {pickerCategories.length > 0 && (
            <select
              value={pickerCategory}
              onChange={(e) => setPickerCategory(e.target.value)}
              className="h-8 w-full rounded-xl border border-input bg-background px-3 text-xs text-foreground"
            >
              <option value="all">All categories</option>
              {pickerCategories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          )}
          <div className="relative">
            <Input
              value={newRow.name}
              onChange={(/** @type {any} */ e) => { setNewRow(r => ({ ...r, name: e.target.value, source: "custom", catalog_item_id: "", inventory_item_id: "", image_url: "", category: "" })); setPickerSearch(e.target.value); setShowPicker(true); }}
              onFocus={() => setShowPicker(true)}
              onBlur={() => setTimeout(() => setShowPicker(false), 150)}
              placeholder="Search inventory or type name..."
              className="h-8 text-sm rounded-xl"
              autoFocus
            />
            {showPicker && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-apple-lg z-30 max-h-56 overflow-y-auto">
                {filtered.map((item, idx) => (
                  <button key={idx} type="button"
                    onMouseDown={() => {
                      setNewRow(r => ({
                        ...r,
                        name: item.name,
                        price: item.price ? String(item.price) : r.price,
                        catalog_item_id: item.source === "catalog" ? item.id : "",
                        inventory_item_id: item.source === "stock" ? item.id : "",
                        image_url: item.image_url || "",
                        category: item.category || "",
                        source: item.source,
                        size: "",
                        color: "",
                        selected_print_options: [],
                        selected_addons: [],
                      }));
                      setPickerSearch("");
                      setShowPicker(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-secondary transition-all flex items-center gap-3">
                    <div className="h-10 w-10 overflow-hidden rounded-lg border border-border bg-secondary/60 flex-shrink-0">
                      {item.image_url ? <img src={item.image_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Package className="m-2.5 h-5 w-5 text-muted-foreground/50" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{item.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{[item.category, item.source].filter(Boolean).join(" / ")}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {item.price ? <span className="text-xs font-semibold text-primary">R{Number(item.price).toLocaleString()}</span> : null}
                    </div>
                  </button>
                ))}
                {/* Always-visible custom item option */}
                {newRow.name.trim() && (
                  <button
                    type="button"
                    onMouseDown={() => {
                      setNewRow((r) => ({ ...r, catalog_item_id: "", inventory_item_id: "", image_url: "", category: "", source: "custom" }));
                      setPickerSearch("");
                      setShowPicker(false);
                    }}
                    className="w-full text-left px-3 py-2.5 border-t border-border hover:bg-primary/5 transition-all rounded-b-xl flex items-center gap-2"
                  >
                    <Plus className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    <span className="text-sm text-primary font-medium">
                      Add &ldquo;{newRow.name.trim()}&rdquo; as custom item
                    </span>
                  </button>
                )}
                {!newRow.name.trim() && filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground px-3 py-2">No matching active products. Type a product name to add a custom item.</p>
                )}
              </div>
            )}
          </div>
          {(newRow.name || newRow.image_url) && (
            <div className="flex gap-3 rounded-2xl border border-border bg-secondary/30 p-3">
              <div className="h-16 w-16 overflow-hidden rounded-2xl border border-border bg-background flex-shrink-0">
                {newRow.image_url ? <img src={newRow.image_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Package className="m-5 h-6 w-6 text-muted-foreground/50" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{newRow.name || "Custom product"}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{[newRow.category, newRow.source || "custom"].filter(Boolean).join(" / ")}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded-full bg-background px-2 py-1">Qty {Number(newRow.quantity) || 1}</span>
                  {newRow.size && <span className="rounded-full bg-background px-2 py-1">{newRow.size}</span>}
                  {newRow.color && <span className="rounded-full bg-background px-2 py-1">{newRow.color}</span>}
                  {newRow.price && <span className="rounded-full bg-primary/10 px-2 py-1 font-semibold text-primary">{formatMoney(Number(newRow.price) * Number(newRow.quantity || 1))}</span>}
                  {(newRow.selected_print_options || []).length > 0 && <span className="rounded-full bg-primary/10 px-2 py-1 font-semibold text-primary">{newRow.selected_print_options.length} print</span>}
                  {(newRow.selected_addons || []).length > 0 && <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800">{newRow.selected_addons.length} add-on</span>}
                </div>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Input value={newRow.quantity} onChange={(/** @type {any} */ e) => setNewRow(r => ({ ...r, quantity: e.target.value }))}
              type="number" placeholder="Qty" className="h-8 text-sm rounded-xl w-16" />
            <Input value={newRow.price} onChange={(/** @type {any} */ e) => setNewRow(r => ({ ...r, price: e.target.value }))}
              type="number" placeholder="Price (R)" className="h-8 text-sm rounded-xl flex-1" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {selectedPickerItem?.sizes?.length ? (
              <select value={newRow.size} onChange={(e) => setNewRow(r => ({ ...r, size: e.target.value }))}
                className="h-8 rounded-xl border border-input bg-background px-3 text-sm">
                <option value="">Size</option>
                {selectedPickerItem.sizes.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            ) : (
              <Input value={newRow.size} onChange={(/** @type {any} */ e) => setNewRow(r => ({ ...r, size: e.target.value }))}
                placeholder="Size" className="h-8 text-sm rounded-xl" />
            )}
            {selectedPickerItem?.colors?.length ? (
              <select value={newRow.color} onChange={(e) => setNewRow(r => ({ ...r, color: e.target.value }))}
                className="h-8 rounded-xl border border-input bg-background px-3 text-sm">
                <option value="">Colour</option>
                {selectedPickerItem.colors.map((color) => <option key={color} value={color}>{color}</option>)}
              </select>
            ) : (
              <Input value={newRow.color} onChange={(/** @type {any} */ e) => setNewRow(r => ({ ...r, color: e.target.value }))}
                placeholder="Colour" className="h-8 text-sm rounded-xl" />
            )}
          </div>
          {selectedPickerItem?.print_options?.length > 0 && (
            <div className="rounded-2xl border border-border bg-background p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Print options</p>
              <div className="flex flex-wrap gap-2">
                {selectedPickerItem.print_options.map((option) => {
                  const selected = (newRow.selected_print_options || []).some((item) => optionKey(item) === optionKey(option));
                  return (
                    <button
                      key={optionKey(option)}
                      type="button"
                      onClick={() => toggleProductOption("print", option)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all ${
                        selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {option.image_url && <img src={option.image_url} alt="" loading="lazy" className="h-4 w-4 rounded-full object-cover" />}
                      {optionLabel(option)}
                      {option.price ? ` / ${formatMoney(option.price)}` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {selectedPickerItem?.addons?.length > 0 && (
            <div className="rounded-2xl border border-border bg-background p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Add-ons</p>
              <div className="flex flex-wrap gap-2">
                {selectedPickerItem.addons.map((option) => {
                  const selected = (newRow.selected_addons || []).some((item) => optionKey(item) === optionKey(option));
                  return (
                    <button
                      key={optionKey(option)}
                      type="button"
                      onClick={() => toggleProductOption("addon", option)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all ${
                        selected ? "border-amber-500 bg-amber-500 text-white" : "border-border bg-secondary/40 text-muted-foreground hover:border-amber-400"
                      }`}
                    >
                      {option.image_url && <img src={option.image_url} alt="" loading="lazy" className="h-4 w-4 rounded-full object-cover" />}
                      {optionLabel(option)}
                      {option.price ? ` / ${formatMoney(option.price)}` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <Input value={newRow.notes} onChange={(/** @type {any} */ e) => setNewRow(r => ({ ...r, notes: e.target.value }))}
            placeholder="Item notes / print placement" className="h-8 text-sm rounded-xl" />
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 h-8 rounded-xl text-xs" onClick={addRow} disabled={!newRow.name.trim()}>Add</Button>
            <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={() => { setAddMode(false); setPickerSearch(""); setPickerSource("all"); setPickerCategory("all"); setShowPicker(false); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
