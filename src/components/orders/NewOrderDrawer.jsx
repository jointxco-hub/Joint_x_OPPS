import React, { useState, useMemo } from "react";
import { X, Plus, Trash2, Search, ShoppingCart, AlertCircle, Package, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dataClient } from "@/api/dataClient";
import { getInternalClientFileLibrary } from "@/api/clientRequests";
import FileLightbox from "@/components/files/FileLightbox";
import { toast } from "sonner";

/**
 * Fuzzy score between query and target string.
 * Returns 1.0 for exact match down to ~0 for no relation.
 * @param {string} query
 * @param {string} target
 */
function fuzzyScore(query, target) {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (t === q) return 1;
  if (t.includes(q)) return 0.9;
  const words = q.split(/\s+/);
  if (words.every(w => t.includes(w))) return 0.75;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return (qi / q.length) * 0.5;
}

function isImageUrl(url = "") {
  return /\.(png|jpe?g|webp|gif|avif|svg)(\?.*)?$/i.test(String(url));
}

function fileNameFromUrl(url = "") {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split("/").pop() || "File");
  } catch {
    return String(url).split("/").pop() || "File";
  }
}

function normalizeRepeatProduct(product = {}) {
  return {
    name: product.name || product.product_name || product.title || "Repeat item",
    quantity: product.quantity || 1,
    price: product.price || product.unit_price || product.line_total || "",
    size: product.size || product.variant_size || "",
    color: product.color || product.colour || product.variant_color || "",
    notes: product.notes || product.production_notes || product.description || "",
    catalog_item_id: product.catalog_item_id || product.product_id || "",
    inventory_item_id: product.inventory_item_id || "",
    image_url: product.image_url || product.thumbnail_url || product.cover_image_url || "",
    category: product.category || product.product_category || "",
    source: product.source || "repeat",
    selected_print_options: Array.isArray(product.selected_print_options) ? product.selected_print_options : [],
    selected_addons: Array.isArray(product.selected_addons) ? product.selected_addons : [],
  };
}

function productSummary(products = []) {
  const lines = products
    .filter((product) => product?.name || product?.product_name || product?.title)
    .map((product) => `${product.quantity || 1} x ${product.name || product.product_name || product.title}`);
  return lines.join(", ");
}

export default function NewOrderDrawer({ onClose, onCreate }) {
  const [form, setForm] = useState({
    client_id: '',
    client_name: '',
    client_email: '',
    client_phone: '',
    whatsapp_name: '',
    saved_contact_name: '',
    pep_code: '',
    delivery_note: '',
    order_number: `ORD-${Date.now().toString(36).toUpperCase()}`,
    status: 'confirmed',
    priority: 'normal',
    print_type: 'none',
    notes: '',
    total_amount: '',
    due_date: '',
    linked_po_id: '',
    file_urls: [],
    portal_visible_file_urls: [],
    products: [{ name: '', quantity: 1, price: '', size: '', color: '', notes: '', catalog_item_id: '', inventory_item_id: '', image_url: '', category: '', source: '', selected_print_options: [], selected_addons: [] }]
  });

  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const queryClient = useQueryClient();

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => dataClient.entities.Client.list('-created_date', 200)
  });

  const { data: existingOrders = [] } = useQuery({
    queryKey: ['orders-names'],
    queryFn: () => dataClient.entities.Order.list('-created_date', 300),
    select: (data) => {
      const seen = new Set(clients.map((/** @type {any} */ c) => c.name?.toLowerCase()));
      return [...new Set(
        data
          .map((/** @type {any} */ o) => o.client_name)
          .filter((/** @type {any} */ n) => n && !seen.has(n?.toLowerCase()))
      )];
    },
    staleTime: 60_000,
  });

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['purchaseOrders'],
    queryFn: () => dataClient.entities.PurchaseOrder.list('-created_date', 100)
  });

  const selectedClient = useMemo(() => {
    if (form.client_id) return clients.find((client) => client.id === form.client_id) || null;
    const email = String(form.client_email || "").trim().toLowerCase();
    if (email) return clients.find((client) => String(client.email || client.client_email || "").trim().toLowerCase() === email) || null;
    return null;
  }, [clients, form.client_email, form.client_id]);

  const clientContextEmail = form.client_email || selectedClient?.email || selectedClient?.client_email || "";

  const { data: clientContextOrders = [] } = useQuery({
    queryKey: ["newOrderClientContextOrders", selectedClient?.id || clientContextEmail],
    queryFn: async () => dataClient.entities.Order.list("-created_date", 500),
    enabled: Boolean(selectedClient?.id || clientContextEmail || form.client_name),
    staleTime: 60_000,
    select: (orders) => {
      const email = String(clientContextEmail || "").trim().toLowerCase();
      const name = String(form.client_name || selectedClient?.name || "").trim().toLowerCase();
      return (orders || [])
        .filter((order) => {
          if (selectedClient?.id && order.client_id === selectedClient.id) return true;
          if (email && String(order.client_email || "").trim().toLowerCase() === email) return true;
          if (name && String(order.client_name || "").trim().toLowerCase() === name) return true;
          return false;
        })
        .slice(0, 4);
    },
  });

  const { data: clientFileLibrary = { folders: [], files: [] }, isLoading: clientFilesLoading } = useQuery({
    queryKey: ["newOrderClientFileLibrary", clientContextEmail],
    queryFn: async () => {
      const result = await getInternalClientFileLibrary({ clientEmail: clientContextEmail, limit: 24 });
      return result.data || { folders: [], files: [] };
    },
    enabled: Boolean(clientContextEmail),
    staleTime: 60_000,
  });

  const clientContextFiles = Array.isArray(clientFileLibrary?.files) ? clientFileLibrary.files.slice(0, 6) : [];

  // Scored client suggestions — includes fuzzy matches from Client entity + order history names
  const { clientSuggestions, didYouMean } = useMemo(() => {
    const q = (clientSearch || form.client_name || "").trim();
    if (!q) {
      return {
        clientSuggestions: clients.slice(0, 6).map((/** @type {any} */ c) => ({ type: "client", item: c, score: 0 })),
        didYouMean: /** @type {string|null} */ (null),
      };
    }

    const scored = clients
      .map((/** @type {any} */ c) => ({ type: "client", item: c, score: fuzzyScore(q, c.name || "") }))
      .filter((/** @type {any} */ x) => x.score > 0.3)
      .sort((/** @type {any} */ a, /** @type {any} */ b) => b.score - a.score)
      .slice(0, 5);

    const historyMatches = existingOrders
      .map((/** @type {string} */ name) => ({ type: "history", item: { name }, score: fuzzyScore(q, name) }))
      .filter((/** @type {any} */ x) => x.score > 0.3)
      .sort((/** @type {any} */ a, /** @type {any} */ b) => b.score - a.score)
      .slice(0, 3);

    const combined = [...scored, ...historyMatches]
      .sort((/** @type {any} */ a, /** @type {any} */ b) => b.score - a.score)
      .slice(0, 6);

    const hasExact = combined.some((/** @type {any} */ x) => x.score >= 0.9);
    const fuzzyOnly = !hasExact && combined.length > 0 && combined[0].score >= 0.55
      ? combined[0].item.name
      : null;

    return { clientSuggestions: combined, didYouMean: /** @type {string|null} */ (fuzzyOnly) };
  }, [clients, existingOrders, clientSearch, form.client_name]);

  const selectClient = (client) => {
    setForm(f => ({
      ...f,
      client_id: client.id,
      client_name: client.name,
      client_email: client.email || client.client_email || f.client_email,
      client_phone: client.phone || client.client_phone || client.whatsapp || f.client_phone,
      whatsapp_name: client.whatsapp_name || f.whatsapp_name,
      saved_contact_name: client.saved_contact_name || f.saved_contact_name,
      pep_code: client.pep_code || f.pep_code,
      delivery_note: client.delivery_note || client.delivery_address || f.delivery_note,
      total_amount: '',
    }));
    setClientSearch(client.name);
    setShowClientDropdown(false);
  };

  const [pickerOpenIdx, setPickerOpenIdx] = useState(/** @type {number|null} */ (null));

  const { data: catalogItems = [] } = useQuery({
    queryKey: ["catalogItems"],
    queryFn: () => dataClient.entities.CatalogItem.list("name", 500),
    staleTime: 300_000,
  });
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => dataClient.entities.InventoryItem.list("name", 200),
    staleTime: 300_000,
  });

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
  const optionKey = (option) => String(option?.id || option?.name || option);
  const optionLabel = (option) => typeof option === "string" ? option : [option?.name, option?.locations?.length ? option.locations.join("/") : ""].filter(Boolean).join(" - ");

  const allPickerItems = [
    ...(/** @type {any[]} */ (catalogItems))
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
    ...(/** @type {any[]} */ (inventoryItems))
      .filter((/** @type {any} */ i) => !i.is_archived && !(/** @type {any[]} */ (catalogItems)).some((/** @type {any} */ c) => c.name?.toLowerCase() === i.name?.toLowerCase()))
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

  const pickerFiltered = (/** @type {string} */ q) =>
    q ? allPickerItems.filter(p => p.name?.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
      : allPickerItems.slice(0, 8);
  const selectedProductItem = (product) => allPickerItems.find((item) => item.id && item.id === (product.catalog_item_id || product.inventory_item_id));

  const addProduct = () => setForm(f => ({ ...f, products: [...f.products, { name: '', quantity: 1, price: '', size: '', color: '', notes: '', catalog_item_id: '', inventory_item_id: '', image_url: '', category: '', source: '', selected_print_options: [], selected_addons: [] }] }));
  const removeProduct = (i) => setForm(f => ({ ...f, products: f.products.filter((_, idx) => idx !== i) }));
  const updateProduct = (i, field, val) => setForm(f => ({
    ...f,
    products: f.products.map((p, idx) => idx === i ? { ...p, [field]: val } : p)
  }));
  const updateProductFields = (i, patch) => setForm(f => ({
    ...f,
    products: f.products.map((p, idx) => idx === i ? { ...p, ...patch } : p)
  }));
  const toggleProductOption = (i, kind, option) => {
    const key = kind === "print" ? "selected_print_options" : "selected_addons";
    setForm(f => ({
      ...f,
      products: f.products.map((product, idx) => {
        if (idx !== i) return product;
        const selected = Array.isArray(product[key]) ? product[key] : [];
        const exists = selected.some((item) => optionKey(item) === optionKey(option));
        return { ...product, [key]: exists ? selected.filter((item) => optionKey(item) !== optionKey(option)) : [...selected, option] };
      })
    }));
  };

  const calcTotal = () => form.products.reduce((s, p) => s + (parseFloat(p.price || 0) * (parseInt(p.quantity) || 1)), 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.client_name.trim()) {
      toast.error("Client name is required");
      return;
    }
    setIsSubmitting(true);

    try {
      const total = form.total_amount ? parseFloat(form.total_amount) : calcTotal();
      let clientId = form.client_id;

      if (!clientId) {
        const existing = clients.find(
          c => c.name?.toLowerCase() === form.client_name.trim().toLowerCase()
        );
        if (existing) {
          clientId = existing.id;
        } else {
          const newClient = await dataClient.entities.Client.create({
            name: form.client_name.trim(),
            email: form.client_email || undefined,
            phone: form.client_phone || undefined,
            whatsapp_name: form.whatsapp_name || undefined,
            saved_contact_name: form.saved_contact_name || undefined,
            pep_code: form.pep_code || undefined,
            delivery_note: form.delivery_note || undefined,
            delivery_address: form.delivery_note || undefined,
            status: 'active',
            total_orders: 0,
            total_revenue: 0,
          });
          clientId = newClient?.id;
          toast.success(`New client "${form.client_name}" created`);
          queryClient.invalidateQueries({ queryKey: ['clients'] });
        }
      }

      if (clientId) {
        try {
          const client = clients.find(c => c.id === clientId);
          await dataClient.entities.Client.update(clientId, {
            total_orders: (client?.total_orders || 0) + 1,
            total_revenue: (client?.total_revenue || 0) + total,
            last_activity_date: new Date().toISOString().split('T')[0],
            status: 'active',
            whatsapp_name: form.whatsapp_name || client?.whatsapp_name || undefined,
            saved_contact_name: form.saved_contact_name || client?.saved_contact_name || undefined,
            pep_code: form.pep_code || client?.pep_code || undefined,
            delivery_note: form.delivery_note || client?.delivery_note || undefined,
            delivery_address: form.delivery_note || client?.delivery_address || undefined,
          });
        } catch {
          // stats update is non-critical — order creation continues
        }
      }

      const orderData = {
        ...form,
        client_id: clientId || undefined,
        total_amount: total,
        source: 'opps',
        products: form.products.filter(p => p.name.trim()),
        file_urls: Array.isArray(form.file_urls) ? form.file_urls.filter(Boolean) : [],
        portal_visible_file_urls: Array.isArray(form.portal_visible_file_urls) ? form.portal_visible_file_urls.filter(Boolean) : [],
      };

      if (!orderData.linked_po_id) delete orderData.linked_po_id;
      if (!orderData.due_date) delete orderData.due_date;
      if (!orderData.file_urls.length) delete orderData.file_urls;
      if (!orderData.portal_visible_file_urls.length) delete orderData.portal_visible_file_urls;

      await onCreate(orderData);

    } catch (err) {
      console.error('Order create error:', err);
      toast.error('Failed to create order. Check console for details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const activePOs = purchaseOrders.filter(po =>
    ['draft', 'pending', 'approved', 'ordered'].includes(po.status)
  );

  return (
    <>
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-card shadow-apple-xl z-50 flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold text-foreground">New Order</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-border transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Client autocomplete */}
          <div className="relative">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Client *
              {form.client_id && <span className="ml-2 text-primary font-medium">✓ linked</span>}
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={clientSearch || form.client_name}
                onChange={e => {
                  setClientSearch(e.target.value);
                  setForm(f => ({ ...f, client_name: e.target.value, client_id: '' }));
                  setShowClientDropdown(true);
                }}
                onFocus={() => setShowClientDropdown(true)}
                onBlur={() => setTimeout(() => setShowClientDropdown(false), 150)}
                placeholder="Search existing or type new client..."
                className="rounded-xl pl-9"
                required
              />
            </div>
            {showClientDropdown && (clientSuggestions.length > 0 || didYouMean) && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-apple-lg z-20 max-h-56 overflow-y-auto">
                {didYouMean && (
                  <button
                    type="button"
                    onClick={() => {
                      setForm(f => ({ ...f, client_name: didYouMean, client_id: '' }));
                      setClientSearch(didYouMean);
                      setShowClientDropdown(true);
                    }}
                    className="w-full text-left px-3 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2 first:rounded-t-xl hover:bg-amber-100 transition-all"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                    <span className="text-xs text-amber-800">Did you mean <span className="font-semibold">{didYouMean}</span>?</span>
                  </button>
                )}
                {clientSuggestions.map((/** @type {any} */ s, /** @type {number} */ i) => (
                  <button
                    key={s.type === "client" ? s.item.id : `hist-${i}`}
                    type="button"
                    onClick={() => s.type === "client" ? selectClient(s.item) : (() => {
                      setForm(f => ({ ...f, client_name: s.item.name, client_id: '' }));
                      setClientSearch(s.item.name);
                      setShowClientDropdown(false);
                    })()}
                    className="w-full text-left px-3 py-2.5 hover:bg-secondary transition-all flex items-center justify-between last:rounded-b-xl"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{s.item.name}</p>
                      {s.item.email && <p className="text-xs text-muted-foreground">{s.item.email}</p>}
                      {s.type === "history" && <p className="text-xs text-muted-foreground/60">from order history</p>}
                    </div>
                    {s.item.status && s.type === "client" && (
                      <span className="text-xs text-muted-foreground capitalize">{s.item.status}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {!form.client_id && form.client_name.trim() && (
              <p className="text-xs text-muted-foreground mt-1">
                New client — will be created automatically on save
              </p>
            )}
          </div>

          {/* Client contact */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email</label>
              <Input value={form.client_email} onChange={e => setForm({ ...form, client_email: e.target.value })}
                placeholder="client@email.com" className="rounded-xl h-9 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Phone</label>
              <Input value={form.client_phone} onChange={e => setForm({ ...form, client_phone: e.target.value })}
                placeholder="Phone number" className="rounded-xl h-9 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">WhatsApp Name</label>
              <Input value={form.whatsapp_name} onChange={e => setForm({ ...form, whatsapp_name: e.target.value })}
                placeholder="Name shown in WhatsApp" className="rounded-xl h-9 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Saved Contact Name</label>
              <Input value={form.saved_contact_name} onChange={e => setForm({ ...form, saved_contact_name: e.target.value })}
                placeholder="How you saved them" className="rounded-xl h-9 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">PEP / Courier Pickup Code</label>
              <Input value={form.pep_code} onChange={e => setForm({ ...form, pep_code: e.target.value })}
                placeholder="Client code, PAXI, locker, branch" className="rounded-xl h-9 text-sm" />
              <p className="mt-1 text-[11px] text-muted-foreground">Client-provided code before dispatch. Not the courier tracking link.</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Pickup / Delivery Note</label>
              <Input value={form.delivery_note} onChange={e => setForm({ ...form, delivery_note: e.target.value })}
                placeholder="Store, courier note, address hint" className="rounded-xl h-9 text-sm" />
              <p className="mt-1 text-[11px] text-muted-foreground">Store name, delivery instruction, pickup point, or address hint.</p>
            </div>
          </div>

          {(form.client_id || clientContextEmail) && (
            <div className="rounded-2xl border border-border bg-secondary/25 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Client context</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{selectedClient?.name || form.client_name || "Selected client"}</p>
                </div>
                {selectedClient?.status && (
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
                    {selectedClient.status}
                  </span>
                )}
              </div>

              <div className="mt-3 grid gap-3">
                {(selectedClient?.pep_code || selectedClient?.preferred_courier || selectedClient?.delivery_note) && (
                  <div className="rounded-xl border border-border bg-background p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Saved delivery defaults</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {[selectedClient?.preferred_courier, selectedClient?.pep_code, selectedClient?.delivery_note].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-border bg-background p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent orders</p>
                    <span className="text-[11px] text-muted-foreground">{clientContextOrders.length}</span>
                  </div>
                  {clientContextOrders.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No recent OPPS orders found for this client yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {clientContextOrders.map((order) => (
                        <button
                          key={order.id || order.order_number}
                          type="button"
                          onClick={() => {
                            const repeatProducts = Array.isArray(order.products)
                              ? order.products.filter(Boolean).map(normalizeRepeatProduct)
                              : [];
                            if (!repeatProducts.length) {
                              toast.info("That order has no structured product lines yet.");
                              return;
                            }
                            const orderFiles = Array.isArray(order.file_urls) ? order.file_urls.filter(Boolean) : [];
                            setForm((current) => ({
                              ...current,
                              products: repeatProducts,
                              total_amount: order.total_amount || current.total_amount,
                              print_type: order.print_type || current.print_type,
                              pep_code: current.pep_code || order.pep_code || "",
                              delivery_note: current.delivery_note || order.delivery_note || "",
                              notes: current.notes || [
                                `Repeat/reference from ${order.order_number}`,
                                order.special_instructions ? `Previous production notes: ${order.special_instructions}` : null,
                                order.notes ? `Previous notes: ${order.notes}` : null,
                                productSummary(repeatProducts) ? `Previous products: ${productSummary(repeatProducts)}` : null,
                              ].filter(Boolean).join("\n"),
                              file_urls: Array.isArray(current.file_urls)
                                ? Array.from(new Set([...current.file_urls, ...orderFiles]))
                                : orderFiles,
                            }));
                            toast.success(`Loaded ${repeatProducts.length} item${repeatProducts.length === 1 ? "" : "s"} from ${order.order_number}`);
                          }}
                          className="flex w-full items-center gap-2 rounded-xl border border-border bg-secondary/30 p-2 text-left transition-colors hover:border-primary/40"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background">
                            {Array.isArray(order.products) && order.products[0]?.image_url ? (
                              <img src={order.products[0].image_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <Package className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-foreground">{order.order_number}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {Array.isArray(order.products) && order.products.length ? `${order.products.length} item${order.products.length === 1 ? "" : "s"} · ${productSummary(order.products) || order.status || "Order"}` : order.status || "Order"}
                            </p>
                          </div>
                          <span className="text-[11px] font-semibold text-primary">Reuse</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border bg-background p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Client files</p>
                    <span className="text-[11px] text-muted-foreground">{clientFilesLoading ? "Loading" : clientContextFiles.length}</span>
                  </div>
                  {clientContextFiles.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Saved client files will appear here after account uploads are linked.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {clientContextFiles.map((file) => {
                        const url = file.file_url || file.url || "";
                        const name = file.file_name || file.name || fileNameFromUrl(url);
                        return (
                          <button
                            key={file.id || url}
                            type="button"
                            onClick={() => setPreviewFile({
                              ...file,
                              file_url: url,
                              title: name,
                              name,
                              file_name: name,
                              file_type: file.file_type || file.type || "",
                            })}
                            className="group overflow-hidden rounded-xl border border-border bg-secondary/30 text-left"
                            title={name}
                          >
                            <span className="flex aspect-square items-center justify-center bg-secondary">
                              {isImageUrl(url) ? (
                                <img src={url} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                              ) : (
                                <FileText className="h-5 w-5 text-muted-foreground" />
                              )}
                            </span>
                            <span className="block truncate px-2 py-1 text-[10px] text-muted-foreground">
                              {name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Order number + due date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Order Number</label>
              <Input value={form.order_number} onChange={e => setForm({ ...form, order_number: e.target.value })}
                placeholder="ORD-..." className="rounded-xl h-9 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Due Date</label>
              <Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
                className="rounded-xl h-9 text-sm" />
            </div>
          </div>

          {/* Status + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Status</label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger className="rounded-xl h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['confirmed', 'in_production', 'ready', 'shipped', 'delivered'].map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Priority</label>
              <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                <SelectTrigger className="rounded-xl h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['low', 'normal', 'high', 'urgent'].map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Print Type */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Print Type</label>
            <Select value={form.print_type} onValueChange={v => setForm({ ...form, print_type: v })}>
              <SelectTrigger className="rounded-xl h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[['none','None'],['dtf','DTF'],['vinyl','Vinyl'],['embroidery','Embroidery'],['screen','Screen Print']].map(([v,l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Link PO */}
          {activePOs.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block flex items-center gap-1">
                <ShoppingCart className="w-3 h-3" /> Link Purchase Order
                <span className="font-normal">(optional)</span>
              </label>
              <Select value={form.linked_po_id || '__none'} onValueChange={v => setForm({ ...form, linked_po_id: v === '__none' ? '' : v })}>
                <SelectTrigger className="rounded-xl h-9 text-sm"><SelectValue placeholder="Select a PO..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No PO linked</SelectItem>
                  {activePOs.map(po => (
                    <SelectItem key={po.id} value={po.id}>{po.po_number} — {po.status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Products */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">Products</label>
              <button type="button" onClick={addProduct} className="text-xs text-primary font-medium flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            <div className="space-y-2">
              {form.products.map((p, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 overflow-hidden rounded-xl border border-border bg-secondary/60 flex-shrink-0">
                      {p.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" /> : <Package className="m-2.5 h-4 w-4 text-muted-foreground/50" />}
                    </div>
                    {/* Name with catalog/inventory picker */}
                    <div className="relative flex-1">
                      <Input
                        value={p.name}
                        onChange={(/** @type {any} */ e) => {
                          updateProductFields(i, {
                            name: e.target.value,
                            catalog_item_id: '',
                            inventory_item_id: '',
                            image_url: '',
                            category: '',
                            source: 'custom',
                          });
                          setPickerOpenIdx(i);
                        }}
                        onFocus={() => setPickerOpenIdx(i)}
                        onBlur={() => setTimeout(() => setPickerOpenIdx(null), 150)}
                        placeholder="Search inventory or type name…"
                        className="rounded-xl h-9 text-sm w-full"
                      />
                      {pickerOpenIdx === i && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-apple-lg z-30 max-h-56 overflow-y-auto">
                          {pickerFiltered(pickerOpenIdx === i ? p.name : "").map((item, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onMouseDown={() => {
                                updateProductFields(i, {
                                  name: item.name,
                                  price: item.price ? String(item.price) : p.price,
                                  catalog_item_id: item.source === 'catalog' ? item.id : '',
                                  inventory_item_id: item.source === 'stock' ? item.id : '',
                                  image_url: item.image_url || '',
                                  category: item.category || '',
                                  source: item.source,
                                  size: '',
                                  color: '',
                                  selected_print_options: [],
                                  selected_addons: [],
                                });
                                setPickerOpenIdx(null);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-secondary transition-all flex items-center gap-3"
                            >
                              <div className="h-10 w-10 overflow-hidden rounded-lg border border-border bg-secondary/60 flex-shrink-0">
                                {item.image_url ? <img src={item.image_url} alt="" className="h-full w-full object-cover" /> : <Package className="m-2.5 h-5 w-5 text-muted-foreground/50" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-foreground">{item.name}</p>
                                <p className="truncate text-[10px] text-muted-foreground">{[item.category, item.source].filter(Boolean).join(" / ")}</p>
                              </div>
                              <span className="flex items-center gap-2 flex-shrink-0">
                                {item.price ? <span className="text-xs font-semibold text-primary ml-2 flex-shrink-0">R{Number(item.price).toLocaleString()}</span> : null}
                              </span>
                            </button>
                          ))}
                          {/* Always-visible custom item option */}
                          {p.name.trim() && (
                            <button
                              type="button"
                              onMouseDown={() => {
                                updateProductFields(i, { catalog_item_id: '', inventory_item_id: '', image_url: '', category: '', source: 'custom' });
                                setPickerOpenIdx(null);
                              }}
                              className="w-full text-left px-3 py-2.5 border-t border-border hover:bg-primary/5 transition-all rounded-b-xl flex items-center gap-2"
                            >
                              <Plus className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                              <span className="text-sm text-primary font-medium">
                                Add &ldquo;{p.name.trim()}&rdquo; as custom item
                              </span>
                            </button>
                          )}
                          {!p.name.trim() && pickerFiltered("").length === 0 && (
                            <p className="text-xs text-muted-foreground px-3 py-2">Type a product name above</p>
                          )}
                        </div>
                      )}
                    </div>
                    <Input value={p.quantity} onChange={(/** @type {any} */ e) => updateProduct(i, 'quantity', e.target.value)}
                      placeholder="Qty" type="number" className="rounded-xl w-14 h-9 text-sm" />
                    <Input value={p.price} onChange={(/** @type {any} */ e) => updateProduct(i, 'price', e.target.value)}
                      placeholder="R" type="number" className="rounded-xl w-16 h-9 text-sm" />
                    {form.products.length > 1 && (
                      <button type="button" onClick={() => removeProduct(i)} className="text-muted-foreground hover:text-destructive transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {selectedProductItem(p)?.sizes?.length ? (
                      <select value={p.size || ''} onChange={(e) => updateProduct(i, 'size', e.target.value)}
                        className="h-8 rounded-xl border border-input bg-background px-2 text-xs">
                        <option value="">Size</option>
                        {selectedProductItem(p).sizes.map((size) => <option key={size} value={size}>{size}</option>)}
                      </select>
                    ) : (
                      <Input value={p.size || ''} onChange={(/** @type {any} */ e) => updateProduct(i, 'size', e.target.value)}
                        placeholder="Size" className="rounded-xl h-8 text-xs" />
                    )}
                    {selectedProductItem(p)?.colors?.length ? (
                      <select value={p.color || ''} onChange={(e) => updateProduct(i, 'color', e.target.value)}
                        className="h-8 rounded-xl border border-input bg-background px-2 text-xs">
                        <option value="">Colour</option>
                        {selectedProductItem(p).colors.map((color) => <option key={color} value={color}>{color}</option>)}
                      </select>
                    ) : (
                      <Input value={p.color || ''} onChange={(/** @type {any} */ e) => updateProduct(i, 'color', e.target.value)}
                        placeholder="Colour" className="rounded-xl h-8 text-xs" />
                    )}
                    <Input value={p.notes || ''} onChange={(/** @type {any} */ e) => updateProduct(i, 'notes', e.target.value)}
                      placeholder="Item notes" className="rounded-xl h-8 text-xs" />
                  </div>
                  {selectedProductItem(p)?.print_options?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedProductItem(p).print_options.map((option) => {
                        const selected = (p.selected_print_options || []).some((item) => optionKey(item) === optionKey(option));
                        return (
                          <button
                            key={optionKey(option)}
                            type="button"
                            onClick={() => toggleProductOption(i, "print", option)}
                            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                              selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary/40 text-muted-foreground"
                            }`}
                          >
                            {optionLabel(option)}{option.price ? ` · R${Number(option.price).toLocaleString()}` : ""}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {selectedProductItem(p)?.addons?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedProductItem(p).addons.map((option) => {
                        const selected = (p.selected_addons || []).some((item) => optionKey(item) === optionKey(option));
                        return (
                          <button
                            key={optionKey(option)}
                            type="button"
                            onClick={() => toggleProductOption(i, "addon", option)}
                            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                              selected ? "border-amber-500 bg-amber-500 text-white" : "border-border bg-secondary/40 text-muted-foreground"
                            }`}
                          >
                            {optionLabel(option)}{option.price ? ` · R${Number(option.price).toLocaleString()}` : ""}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Total */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Total Amount{calcTotal() > 0 && <span className="text-primary ml-1">(auto: R{calcTotal().toLocaleString()})</span>}
            </label>
            <Input value={form.total_amount} onChange={e => setForm({ ...form, total_amount: e.target.value })}
              placeholder={`R${calcTotal() || '0'}`} type="number" className="rounded-xl" />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Notes</label>
            <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Any special instructions..." className="rounded-xl resize-none h-20" />
          </div>
        </form>

        <div className="p-5 border-t border-border">
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full rounded-xl"
          >
            {isSubmitting ? 'Creating...' : 'Create Order'}
          </Button>
        </div>
      </div>
      {previewFile && (
        <FileLightbox
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </>
  );
}
