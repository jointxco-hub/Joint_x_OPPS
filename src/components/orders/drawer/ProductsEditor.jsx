import { useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Factory, ImagePlus, Lock, Minus, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/api/dataClient";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import ClientAssetPickerModal from "@/components/files/ClientAssetPickerModal";
import SecureImage from "@/components/common/SecureImage";
import QuickImagePreview from "@/components/common/QuickImagePreview";
import { isImageReference } from "@/lib/imageReference";
import { PRODUCTION_METHODS, PRODUCTION_DETAIL_STAGES, PRINT_COMPONENT_METHODS } from "@/lib/productionStages";
import { computeCompositionPricing, toMoney } from "@/lib/compositionPricing";
import { computeStockDryRun } from "@/lib/stockDryRun";
import { buildArtworkByPlacement, resolveArtworkRevisionIds } from "@/lib/artworkFreeze";
import { buildComponentPayload, buildSetupFeeCompanionPayload, resolveOrderPrice } from "@/lib/productComposition";
import ComponentFieldsForm, { emptyPrintOptionForm } from "@/components/composition/ComponentFieldsForm";
import { computeOrderTotal } from "@/lib/orderTotal";
import { needsConfiguration, needsConfigurationBannerText, applyMatchExistingProduct, applyKeepCommercialOnly, resolveLineThumbnail, isProductionCapableLine } from "@/features/orders/lineConfiguration";

function toMoneyDisplay(value) {
  const n = toMoney(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function newLineId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function ProductsEditor({ order = {}, onUpdate, locked = false, lockReason = "" }) {
  const [editingIdx, setEditingIdx] = useState(/** @type {number|null} */ (null));
  const emptyRow = { name: "", quantity: 1, price: "", size: "", color: "", notes: "", catalog_item_id: "", inventory_item_id: "", image_url: "", category: "", source: "", selected_print_options: [], selected_addons: [] };
  const [editRow, setEditRow] = useState(emptyRow);
  const [addMode, setAddMode] = useState(false);
  const [newRow, setNewRow] = useState(emptyRow);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSource, setPickerSource] = useState("all");
  const [pickerCategory, setPickerCategory] = useState("all");
  const [showPicker, setShowPicker] = useState(false);
  const [sizeRun, setSizeRun] = useState({});
  const [expandedProductionLineId, setExpandedProductionLineId] = useState("");

  // Configure Product (Phase 4-6): dialog offering exactly three explicit,
  // confirm-gated actions for an invoice-added line with no production
  // identity yet. No option ever auto-runs.
  const [configureLineId, setConfigureLineId] = useState("");
  const [configureStep, setConfigureStep] = useState("menu"); // "menu" | "match" | "create" | "commercial"
  const [configurePickedItem, setConfigurePickedItem] = useState(null);
  const [configureCreateName, setConfigureCreateName] = useState("");
  const [configureCreatePickedItem, setConfigureCreatePickedItem] = useState(null);

  // "Set/Change thumbnail" (Phase 4-6): line_id currently choosing an
  // explicit thumbnail via ClientAssetPickerModal - this is the one and
  // only path allowed to overwrite a non-empty image_url.
  const [thumbnailPickerLineId, setThumbnailPickerLineId] = useState("");
  // Quick image preview (view-only, Phase 5-12) - { value, title, subtitle }
  // or null. Opening/closing this never touches the order, client_assets,
  // client_product, activity events, or snapshots - purely a read/display
  // action, entirely separate from "Set/Change thumbnail" above.
  const [quickPreview, setQuickPreview] = useState(null);

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

  // Product Composition & Production Components (Phase 1). Composition
  // lives on client_products (client-specific), not the global catalog
  // product, so a line's composition is found via the client product
  // linked to this order's client whose opps_product_id matches the
  // line's catalog_item_id. Production tracking operates against a
  // frozen order_line_component_snapshots row (never the live
  // product_components row), so a line with no snapshot taken yet shows
  // an explicit "attach composition" action instead of live tracking
  // controls - lines with no matching client product render exactly as
  // before.
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => dataClient.auth.me(),
    staleTime: 300_000,
  });
  const { data: clientProductsForOrder = [] } = useQuery({
    queryKey: ["clientProductsForOrder", order.client_id],
    queryFn: () => dataClient.entities.ClientProduct.filter({ client_id: order.client_id }, "client_facing_name", 200),
    enabled: Boolean(order.client_id),
    staleTime: 60_000,
  });
  // Snapshot Lifecycle Foundation - live UI only ever renders is_current
  // rows; superseded historical revisions stay queryable (for audit) but
  // must never leak into the normal working view.
  const { data: lineSnapshots = [] } = useQuery({
    queryKey: ["orderLineComponentSnapshots", order.id],
    queryFn: () => dataClient.entities.OrderLineComponentSnapshot.filter({ order_id: order.id, is_current: true }, "sort_order", 300),
    enabled: Boolean(order.id),
    staleTime: 30_000,
  });
  const { data: productionTracking = [] } = useQuery({
    queryKey: ["orderLineProductionTracking", order.id],
    queryFn: () => dataClient.entities.OrderLineProductionTracking.filter({ order_id: order.id }, "created_at", 300),
    enabled: Boolean(order.id),
    staleTime: 30_000,
  });

  const clientProductByCatalogItemId = new Map(
    (Array.isArray(clientProductsForOrder) ? clientProductsForOrder : [])
      .filter((cp) => cp.opps_product_id)
      .map((cp) => [cp.opps_product_id, cp])
  );
  // Stock/inventory-sourced counterpart to the map above - a
  // client_product can be backed by a raw `inventory` row instead of a
  // `products` catalog row (client_products.inventory_item_id, added
  // alongside this fix - opps_product_id's FK only ever pointed at
  // products, so a stock item genuinely had no column to attach to
  // before now). Never both on the same client_product row (DB check
  // constraint), but a line only ever carries one of catalog_item_id/
  // inventory_item_id anyway, so this map and the one above are always
  // queried mutually exclusively per line.
  const clientProductByInventoryItemId = new Map(
    (Array.isArray(clientProductsForOrder) ? clientProductsForOrder : [])
      .filter((cp) => cp.inventory_item_id)
      .map((cp) => [cp.inventory_item_id, cp])
  );
  // Third lookup path (Phase 4-6, Configure Product): some order lines
  // now point directly at a client_product with no catalog/inventory
  // parent at all (e.g. custom labels created via "Create client
  // product" with no item linked). Wherever "the client_product for this
  // line" is resolved, prefer the line's own client_product_id when set,
  // then catalog_item_id, then inventory_item_id.
  const clientProductsById = new Map(
    (Array.isArray(clientProductsForOrder) ? clientProductsForOrder : []).map((cp) => [cp.id, cp])
  );
  const clientProductForLine = (line) => (
    (line?.client_product_id ? clientProductsById.get(line.client_product_id) : null)
    || clientProductByCatalogItemId.get(line?.catalog_item_id)
    || clientProductByInventoryItemId.get(line?.inventory_item_id)
    || null
  );
  const clientProductIdsForOrder = Array.from(new Set(
    (Array.isArray(clientProductsForOrder) ? clientProductsForOrder : []).map((cp) => cp.id)
  ));
  const { data: currentArtworkRows = [] } = useQuery({
    queryKey: ["clientProductArtworkForOrder", clientProductIdsForOrder.join(",")],
    queryFn: async () => {
      const rows = await Promise.all(
        clientProductIdsForOrder.map((id) => dataClient.entities.ClientProductArtwork.filter(
          { client_product_id: id, is_current: true }, undefined, 50
        ))
      );
      return rows.flatMap((r) => (Array.isArray(r) ? r : []));
    },
    enabled: clientProductIdsForOrder.length > 0,
    staleTime: 30_000,
  });
  const artworkByClientProductId = new Map();
  for (const row of (Array.isArray(currentArtworkRows) ? currentArtworkRows : [])) {
    const list = artworkByClientProductId.get(row.client_product_id) || [];
    list.push(row);
    artworkByClientProductId.set(row.client_product_id, list);
  }
  const snapshotsByLineId = new Map();
  for (const snapshot of (Array.isArray(lineSnapshots) ? lineSnapshots : [])) {
    const list = snapshotsByLineId.get(snapshot.line_id) || [];
    list.push(snapshot);
    snapshotsByLineId.set(snapshot.line_id, list);
  }
  const trackingBySnapshotId = new Map(
    (Array.isArray(productionTracking) ? productionTracking : []).map((t) => [t.order_line_component_snapshot_id, t])
  );

  // Inventory Phase 2A, Stage A - read-only dry-run only. This never
  // writes a reservation or movement; it only surfaces what a reservation
  // WOULD look like (on_hand/reserved/available, all derived, from
  // inventory_variant_availability_v) so staff can see shortage/unverified
  // status before any reservation capability is wired up.
  const resolvedVariantIds = Array.from(new Set(
    (Array.isArray(lineSnapshots) ? lineSnapshots : [])
      .map((s) => s.resolved_inventory_variant_id)
      .filter(Boolean)
  ));
  const { data: availabilityRows = [] } = useQuery({
    queryKey: ["inventoryVariantAvailability", order.id, resolvedVariantIds.join(",")],
    queryFn: async () => {
      const rows = await Promise.all(
        resolvedVariantIds.map((id) => dataClient.entities.InventoryVariantAvailability.filter({ inventory_variant_id: id }, undefined, 1))
      );
      return rows.flatMap((r) => (Array.isArray(r) ? r : []));
    },
    enabled: resolvedVariantIds.length > 0,
    staleTime: 15_000,
  });
  const availabilityByVariantId = new Map(
    (Array.isArray(availabilityRows) ? availabilityRows : []).map((a) => [a.inventory_variant_id, a])
  );

  // inventory_variant_availability_v's reserved_qty is a per-variant GLOBAL
  // total across every order - it does not say how much of that belongs to
  // THIS order. Fetched separately, scoped by order_line_component_snapshot_id,
  // so the dry-run display (src/lib/stockDryRun.js) can tell "reserved for
  // this order" apart from "reserved elsewhere" instead of double-counting
  // this order's own reservation as a competing claim against itself.
  const resolvedSnapshotIds = Array.from(new Set(
    (Array.isArray(lineSnapshots) ? lineSnapshots : [])
      .filter((s) => s.resolved_inventory_variant_id)
      .map((s) => s.id)
  ));
  const { data: thisOrderReservationRows = [] } = useQuery({
    queryKey: ["inventoryVariantReservationsForOrder", order.id, resolvedSnapshotIds.join(",")],
    queryFn: async () => {
      const rows = await Promise.all(
        resolvedSnapshotIds.map((id) => dataClient.entities.InventoryVariantReservation.filter(
          { order_line_component_snapshot_id: id, status: "active" }, undefined, 50
        ))
      );
      return rows.flatMap((r) => (Array.isArray(r) ? r : []));
    },
    enabled: resolvedSnapshotIds.length > 0,
    staleTime: 15_000,
  });
  const thisOrderReservedBySnapshotId = new Map();
  for (const reservation of (Array.isArray(thisOrderReservationRows) ? thisOrderReservationRows : [])) {
    const key = reservation.order_line_component_snapshot_id;
    thisOrderReservedBySnapshotId.set(key, (thisOrderReservedBySnapshotId.get(key) || 0) + (Number(reservation.quantity) || 0));
  }

  const logProductionActivity = async (snapshot, field, fromValue, toValue) => {
    if (!currentUser?.email) return;
    try {
      await supabase.from("opps_activity_events").insert({
        tenant_id: order.tenant_id,
        actor_email: currentUser.email,
        actor_name: currentUser.full_name || currentUser.email,
        event_type: field === "production_stage" ? "production_stage_changed" : "production_method_changed",
        entity_type: "order_line_production_tracking",
        entity_id: snapshot.id,
        summary: `${snapshot.label || snapshot.component_type} on order line ${snapshot.line_id}: ${field} ${fromValue || "(none)"} -> ${toValue || "(none)"}`,
        metadata: { order_id: order.id, line_id: snapshot.line_id, field, from: fromValue, to: toValue },
      });
    } catch {
      // Best-effort audit trail - never block the actual stage/method save on this.
    }
  };

  // --- Exact internal inventory variant resolution -----------------------
  // For a blank/base component, resolve the order line's free-text
  // size/colour to the exact inventory_variants row for that component's
  // inventory_product_id (never a supplier variant - that's downstream,
  // handled separately on order_line_production_tracking). Both
  // inventory_variants.size_name and colour_name are NOT NULL in the
  // live schema, so an empty order-line size/colour can never
  // auto-match - it always requires a staff pick rather than guessing.
  const normalizeVariantField = (value) => (value || "").trim().toLowerCase();

  const resolveBlankComponentVariant = async (component, orderLine) => {
    if (component.fixed_inventory_variant_id) {
      return { status: "fixed", resolvedVariantId: component.fixed_inventory_variant_id, options: [] };
    }
    if (!component.inventory_product_id) {
      return { status: "not_applicable", resolvedVariantId: null, options: [] };
    }
    const variants = await dataClient.entities.InventoryVariant.filter(
      { inventory_product_id: component.inventory_product_id, is_active: true }, "size_name", 200
    );
    const options = Array.isArray(variants) ? variants : [];
    const size = normalizeVariantField(orderLine.size);
    const colour = normalizeVariantField(orderLine.color);
    const matches = size && colour
      ? options.filter((v) => normalizeVariantField(v.size_name) === size && normalizeVariantField(v.colour_name) === colour)
      : [];
    if (matches.length === 1) {
      return { status: "resolved", resolvedVariantId: matches[0].id, options };
    }
    // Zero or multiple matches: never guess. Zero shows an explicit
    // unresolved state (attach may still proceed - see the production
    // gate below); multiple requires an explicit staff pick before this
    // component can be attached at all.
    return { status: matches.length === 0 ? "unresolved_zero" : "unresolved_multiple", resolvedVariantId: null, options };
  };

  // { lineId, clientProductId, orderLine, resolutions: [{ component, status, resolvedVariantId, options, staffPickedVariantId }] }
  const [pendingResolution, setPendingResolution] = useState(null);
  const [resolvingLineId, setResolvingLineId] = useState("");

  const beginAttach = async (lineId, clientProductId, orderLine) => {
    // Structural guard, not just render-conditional: the "Attach
    // composition" button that calls this is only ever rendered when
    // clientProductForLine(p) is truthy, so this is unreachable today -
    // but beginAttach must stay safe on its own terms rather than
    // depending on every future caller re-deriving that invariant.
    if (!clientProductId) {
      toast.error("This line has no client product yet - add a print option first.");
      return;
    }
    setResolvingLineId(lineId);
    try {
      const components = await dataClient.entities.ProductComponent.filter({ client_product_id: clientProductId, is_active: true }, "sort_order", 100);
      const active = (Array.isArray(components) ? components : []).filter((c) => c.is_active !== false);
      if (active.length === 0) {
        toast.error("This client product has no active components yet");
        return;
      }
      // Current artwork revisions for this client product, keyed by
      // placement - frozen into each snapshot's artwork_revision_ids at
      // confirm time below. Fetched once per attach, not per component.
      const currentArtwork = await dataClient.entities.ClientProductArtwork.filter(
        { client_product_id: clientProductId, is_current: true }, undefined, 50
      );
      const artworkByPlacement = buildArtworkByPlacement(currentArtwork);

      const resolutions = [];
      for (const component of active) {
        const resolution = await resolveBlankComponentVariant(component, orderLine);
        // staffPrice is the order-specific override tier - prefilled from
        // the client-product default but editable per line, per attach.
        // Changing it here only ever affects the snapshot about to be
        // created; it never writes back to product_components.
        resolutions.push({
          component,
          ...resolution,
          staffPickedVariantId: "",
          staffPrice: component.default_sell_price != null ? String(component.default_sell_price) : "",
          artwork: component.placement ? artworkByPlacement.get(component.placement) || null : null,
        });
      }
      setPendingResolution({ lineId, clientProductId, orderLine, resolutions });
    } catch (err) {
      toast.error(err?.message || "Could not resolve composition for this line");
    } finally {
      setResolvingLineId("");
    }
  };

  const pickVariantForComponent = (componentId, variantId) => {
    setPendingResolution((current) => current && {
      ...current,
      resolutions: current.resolutions.map((r) => r.component.id === componentId ? { ...r, staffPickedVariantId: variantId } : r),
    });
  };

  const setComponentPrice = (componentId, value) => {
    setPendingResolution((current) => current && {
      ...current,
      resolutions: current.resolutions.map((r) => r.component.id === componentId ? { ...r, staffPrice: value } : r),
    });
  };

  const needsStaffPick = (r) => (r.status === "unresolved_zero" || r.status === "unresolved_multiple") && !r.staffPickedVariantId;
  const attachIsBlocked = pendingResolution
    ? pendingResolution.resolutions.some((r) => r.status === "unresolved_multiple" && !r.staffPickedVariantId)
    : true;

  // Writes the immutable snapshot rows only once every "must choose"
  // (multiple-match) component has an explicit staff pick. A component
  // left at "zero matches, no pick" still attaches - with
  // resolved_inventory_variant_id left null and visibly flagged, never
  // silently treated as known - per the production gate below.
  const confirmAttach = useMutation({
    mutationFn: async () => {
      const { lineId, clientProductId, resolutions } = pendingResolution;
      const created = [];
      for (const r of resolutions) {
        const c = r.component;
        const finalVariantId = r.status === "resolved" || r.status === "fixed"
          ? r.resolvedVariantId
          : (r.staffPickedVariantId || null);
        // Order-specific override tier: staffPrice was prefilled from
        // c.default_sell_price and is editable per attach - it is the
        // ONLY value ever written to the snapshot's sell_price, and it
        // is written only here, never back onto product_components.
        const overridePrice = r.staffPrice === "" || r.staffPrice == null ? null : Number(r.staffPrice);
        const finalPrice = Number.isFinite(overridePrice) ? overridePrice : c.default_sell_price;
        created.push(await dataClient.entities.OrderLineComponentSnapshot.create({
          order_id: order.id,
          line_id: lineId,
          client_product_id: clientProductId,
          source_product_component_id: c.id,
          component_type: c.component_type,
          label: c.label,
          production_method: c.production_method,
          placement: c.placement,
          production_colour: c.production_colour,
          specification: c.specification,
          production_instructions: c.production_instructions,
          sell_price: finalPrice,
          billing_mode: c.billing_mode || "per_unit",
          quantity_per_unit: c.quantity_per_unit,
          sort_order: c.sort_order,
          inventory_product_id: c.inventory_product_id,
          resolved_inventory_variant_id: finalVariantId,
          // Frozen at attach time from whatever client_product_artwork
          // revision was current for this component's placement when
          // beginAttach ran - later revisions (new uploads, approvals)
          // never retroactively change an already-created snapshot.
          artwork_revision_ids: resolveArtworkRevisionIds(r.artwork),
        }));
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orderLineComponentSnapshots", order.id] });
      setPendingResolution(null);
      toast.success("Composition attached to this line");
    },
    onError: (err) => toast.error(err?.message || "Could not attach composition"),
  });

  const [addingPrintOptionLineId, setAddingPrintOptionLineId] = useState("");
  const [printOptionForm, setPrintOptionForm] = useState(emptyPrintOptionForm());

  const { data: internalProductsForLabels = [] } = useQuery({
    queryKey: ["inventoryProductsForVariantLabels"],
    queryFn: () => dataClient.entities.InventoryProduct.list("internal_name", 200),
    enabled: Boolean(pendingResolution) || Boolean(addingPrintOptionLineId),
    staleTime: 300_000,
  });
  const internalProductLabelFor = (id) => (Array.isArray(internalProductsForLabels) ? internalProductsForLabels : [])
    .find((p) => p.id === id)?.internal_name || "";
  const variantLabel = (variant) => [internalProductLabelFor(variant.inventory_product_id), variant.colour_name, variant.size_name]
    .filter(Boolean).join(" · ");

  // Master/default pricing tier - staff-editable, tenant-scoped,
  // production_pricing_defaults - used only to prefill new components,
  // same as CatalogManagement's identical query.
  const { data: pricingDefaults = [] } = useQuery({
    queryKey: ["productionPricingDefaults"],
    queryFn: () => dataClient.entities.ProductionPricingDefault.filter({ is_active: true }, "production_method", 100),
    enabled: Boolean(addingPrintOptionLineId),
    staleTime: 60_000,
  });
  const pricingDefaultFor = (method) => (Array.isArray(pricingDefaults) ? pricingDefaults : []).find((d) => d.production_method === method);

  // Shared resolve-or-create: the client_products row for this line's
  // identity - an already-existing link (client_product_id / catalog /
  // inventory, via clientProductForLine) is always reused; otherwise one
  // is created on demand from whichever identity the line actually has.
  // Never fabricates a catalog_item_id for an inventory-backed line or
  // vice versa - each is keyed by its own real column. Used by both
  // "+ Add print option" and "Review for My Products" so there is
  // exactly one place this decision is made, not two that could drift.
  const resolveOrCreateClientProductForLine = async (orderLine) => {
    let clientProduct = clientProductForLine(orderLine);
    let clientProductCreated = false;
    if (!clientProduct && orderLine.catalog_item_id) {
      clientProduct = await dataClient.entities.ClientProduct.create({
        client_id: order.client_id,
        opps_product_id: orderLine.catalog_item_id,
        client_facing_name: orderLine.name || "Untitled product",
        // Set only on genuine creation - reusing an already-existing
        // client_product (the branch above) never touches this, so an
        // already-set source order is never overwritten.
        created_from_order_id: order.id,
      });
      clientProductCreated = true;
    } else if (!clientProduct && orderLine.inventory_item_id) {
      // Preserves the exact inventory identity rather than fabricating
      // a catalog_item_id - inventory_item_id is the column this
      // client_product is keyed by, never products.id.
      clientProduct = await dataClient.entities.ClientProduct.create({
        client_id: order.client_id,
        inventory_item_id: orderLine.inventory_item_id,
        client_facing_name: orderLine.name || "Untitled product",
        created_from_order_id: order.id,
      });
      clientProductCreated = true;
    }
    return { clientProduct, clientProductCreated };
  };

  // Unified "+ Add print option": the pill picker's replacement for NEW
  // work (legacy products.print_options stays readable, untouched, for
  // existing lines that already used it). One action creates/reuses the
  // client_products row for this line's identity (via
  // resolveOrCreateClientProductForLine, never requiring a prior Catalog
  // Management visit), the reusable product_components row (+ optional
  // once_per_order setup-fee companion), and an immutable
  // order_line_component_snapshots row using the same pricing hierarchy
  // as the existing attach flow - orderPrice overrides only ever affect
  // the snapshot, never default_sell_price.
  const addPrintOptionMutation = useMutation({
    mutationFn: async ({ lineId, orderLine, form }) => {
      const { clientProduct, clientProductCreated } = await resolveOrCreateClientProductForLine(orderLine);
      if (!clientProduct) {
        throw new Error("This line has no catalog or inventory product to compose against");
      }

      const existingCount = (Array.isArray(lineSnapshots) ? lineSnapshots : []).filter((s) => s.line_id === lineId).length;
      const component = await dataClient.entities.ProductComponent.create(
        buildComponentPayload(form, { clientProductId: clientProduct.id, sortOrder: existingCount })
      );

      let setupComponent = null;
      if (form.component_type === "print_service" && form.setupRequired && form.production_method) {
        const methodLabel = PRINT_COMPONENT_METHODS.find((m) => m.value === form.production_method)?.label || form.production_method;
        setupComponent = await dataClient.entities.ProductComponent.create(buildSetupFeeCompanionPayload(form, {
          clientProductId: clientProduct.id,
          sortOrder: existingCount + 1,
          methodLabel,
          productionDefault: pricingDefaultFor(form.production_method),
        }));
      }

      const currentArtwork = component.placement
        ? await dataClient.entities.ClientProductArtwork.filter({ client_product_id: clientProduct.id, is_current: true }, undefined, 50)
        : [];
      const artworkByPlacement = buildArtworkByPlacement(currentArtwork);

      const created = [];
      created.push(await dataClient.entities.OrderLineComponentSnapshot.create({
        order_id: order.id,
        line_id: lineId,
        client_product_id: clientProduct.id,
        source_product_component_id: component.id,
        component_type: component.component_type,
        label: component.label,
        production_method: component.production_method,
        placement: component.placement,
        production_colour: component.production_colour,
        specification: component.specification,
        production_instructions: component.production_instructions,
        sell_price: resolveOrderPrice(form.orderPrice, component.default_sell_price),
        billing_mode: component.billing_mode || "per_unit",
        quantity_per_unit: component.quantity_per_unit,
        sort_order: component.sort_order,
        inventory_product_id: component.inventory_product_id,
        artwork_revision_ids: resolveArtworkRevisionIds(component.placement ? artworkByPlacement.get(component.placement) : null),
      }));

      if (setupComponent) {
        created.push(await dataClient.entities.OrderLineComponentSnapshot.create({
          order_id: order.id,
          line_id: lineId,
          client_product_id: clientProduct.id,
          source_product_component_id: setupComponent.id,
          component_type: setupComponent.component_type,
          label: setupComponent.label,
          production_method: setupComponent.production_method,
          sell_price: setupComponent.default_sell_price,
          billing_mode: setupComponent.billing_mode,
          quantity_per_unit: setupComponent.quantity_per_unit,
          sort_order: setupComponent.sort_order,
        }));
      }

      return { clientProductCreated, created };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orderLineComponentSnapshots", order.id] });
      queryClient.invalidateQueries({ queryKey: ["clientProductsForOrder", order.client_id] });
      setAddingPrintOptionLineId("");
      setPrintOptionForm(emptyPrintOptionForm());
      toast.success("Print option added");
    },
    onError: (err) => toast.error(err?.message || "Could not add print option"),
  });

  // "Review for My Products" (Phase 5): resolves/creates the client_product
  // for this line via the exact same shared path as "+ Add print option" -
  // never a second identity model. Persists client_product_id back onto
  // the order line only if it isn't already set (never touches price/
  // quantity/any other commercial field). The client_product itself stays
  // on its column defaults (status: draft, visible_in_account: false) -
  // this action never publishes anything. X LAB Admin
  // (AdminClientProductDetail.jsx) is the one authoritative review/
  // publish surface - this deep-links to it rather than rebuilding any
  // part of that UI inside OPPS.
  const reviewForMyProductsMutation = useMutation({
    mutationFn: async ({ lineId, orderLine }) => {
      const { clientProduct } = await resolveOrCreateClientProductForLine(orderLine);
      if (!clientProduct) {
        throw new Error("This line has no catalog or inventory product to compose against");
      }
      return { clientProduct, lineId, orderLine };
    },
    onSuccess: ({ clientProduct, lineId, orderLine }) => {
      if (!orderLine.client_product_id) {
        applyToLine(lineId, (item) => ({ ...item, client_product_id: clientProduct.id }));
      }
      queryClient.invalidateQueries({ queryKey: ["clientProductsForOrder", order.client_id] });
      window.open(`https://xlab.jointx.co.za/admin/client-products/${clientProduct.id}`, "_blank", "noopener,noreferrer");
      toast.success("Opening in X LAB Admin for review");
    },
    onError: (err) => toast.error(err?.message || "Could not prepare this product for review"),
  });

  const saveLineProduction = useMutation({
    mutationFn: async ({ snapshot, field, value }) => {
      const existing = trackingBySnapshotId.get(snapshot.id);
      const fromValue = existing?.[field] ?? null;
      const row = existing
        ? await dataClient.entities.OrderLineProductionTracking.update(existing.id, { [field]: value })
        : await dataClient.entities.OrderLineProductionTracking.create({
            order_id: order.id, line_id: snapshot.line_id, order_line_component_snapshot_id: snapshot.id, [field]: value,
          });
      if (field === "production_stage" || field === "production_method") {
        await logProductionActivity(snapshot, field, fromValue, value);
      }
      return row;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orderLineProductionTracking", order.id] }),
    onError: () => toast.error("Could not save production tracking for this line"),
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
  const toggleEditOption = (kind, option) => {
    const key = kind === "print" ? "selected_print_options" : "selected_addons";
    const selected = Array.isArray(editRow[key]) ? editRow[key] : [];
    const exists = selected.some((item) => optionKey(item) === optionKey(option));
    setEditRow((row) => ({
      ...row,
      [key]: exists ? selected.filter((item) => optionKey(item) !== optionKey(option)) : [...selected, option],
    }));
  };
  const formatMoney = (value) => {
    const amount = Number(value || 0);
    return amount > 0 ? `R${amount.toLocaleString()}` : "";
  };

  const saveRow = () => {
    if (locked || !editRow.name.trim()) return;
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
    if (locked) return;
    const updated = products.filter((_, i) => i !== idx);
    onUpdate(order.id, { products: updated });
  };

  const addRow = () => {
    if (locked || !newRow.name.trim()) return;
    const updated = [...products, { ...newRow, quantity: Number(newRow.quantity) || 1, line_id: newLineId() }];
    onUpdate(order.id, { products: updated });
    setNewRow(emptyRow);
    setSizeRun({});
    setAddMode(false);
    setPickerSearch("");
    setPickerSource("all");
    setPickerCategory("all");
    setShowPicker(false);
  };

  const addSizeRun = () => {
    if (locked || !newRow.name.trim()) return;
    const selectedSizes = Object.entries(sizeRun)
      .map(([size, quantity]) => ({ size, quantity: Number(quantity || 0) }))
      .filter((item) => item.quantity > 0);

    if (!selectedSizes.length) {
      toast.info("Add quantity for at least one size");
      return;
    }

    const updated = [
      ...products,
      ...selectedSizes.map(({ size, quantity }) => ({
        ...newRow,
        size,
        quantity,
        line_id: newLineId(),
      })),
    ];
    onUpdate(order.id, { products: updated });
    setNewRow(emptyRow);
    setSizeRun({});
    setAddMode(false);
    setPickerSearch("");
    setPickerSource("all");
    setPickerCategory("all");
    setShowPicker(false);
    toast.success(`${selectedSizes.length} size lines added`);
  };

  // Snapshot Lifecycle Foundation - duplication is entirely RPC-backed
  // (duplicate_order_line_with_snapshots): commercial line append AND
  // frozen production snapshot clone happen atomically, server-side, in
  // one transaction. There is deliberately no client-side construction of
  // the new commercial line's fields anymore.
  //
  // The target line_id is the RPC's idempotency key, so ONE duplication
  // attempt must own a stable target id for its entire retry lifecycle -
  // minting a fresh id per mutate() call would defeat the RPC's own
  // provenance replay protection (a lost response + a manual retry would
  // mint a second target id and create a second real duplicate). The
  // target id is therefore generated in duplicateRow (not inside
  // mutationFn) and kept in this ref, keyed by source line id, until the
  // attempt against that source line actually succeeds - so a retry of a
  // still-pending or failed (including ambiguously failed, e.g. a lost
  // response after the RPC actually committed) attempt reuses the same
  // target id and safely replays via the RPC's own conflict/replay logic,
  // rather than silently minting a new one. Only a genuine success clears
  // the entry, so a later, deliberate "duplicate this line again" click
  // mints a fresh id and creates a genuinely new, separate duplicate.
  const pendingDuplicateTargetIdsRef = useRef(new Map());

  const duplicateLineMutation = useMutation({
    mutationFn: async ({ sourceLineId, targetLineId }) => {
      const { data, error } = await supabase.rpc("duplicate_order_line_with_snapshots", {
        p_order_id: order.id,
        p_source_line_id: sourceLineId,
        p_new_line_id: targetLineId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async (data, variables) => {
      // The RPC reporting success is not itself proof the drawer can move
      // on - the pending target id must survive until a fresh server read
      // independently confirms the duplicate actually landed. If this
      // fetch fails, or the fetched order unexpectedly doesn't contain
      // variables.targetLineId, the pending id is deliberately RETAINED
      // (never cleared, no success toast) so the next retry calls the RPC
      // with the exact same target id - the RPC's own replay logic then
      // safely returns the existing duplicate rather than creating a
      // second one.
      let freshOrder = null;
      try {
        const fresh = await dataClient.entities.Order.filter({ id: order.id }, undefined, 1);
        freshOrder = Array.isArray(fresh) ? fresh[0] : null;
      } catch {
        freshOrder = null;
      }

      const targetLinePresent =
        Array.isArray(freshOrder?.products) &&
        freshOrder.products.some((p) => p?.line_id === variables.targetLineId);

      if (!targetLinePresent) {
        toast.error("Could not confirm the duplicate was saved - please try again.");
        return;
      }

      // Re-sync the drawer's locally-held order from what the RPC actually
      // persisted (never a client-side reconstruction of the new line) -
      // onUpdate's own follow-up write is then a true no-op (identical
      // value), reusing the existing sync path without inventing a new one.
      onUpdate(order.id, { products: freshOrder.products });
      queryClient.invalidateQueries({ queryKey: ["orderLineComponentSnapshots", order.id] });
      pendingDuplicateTargetIdsRef.current.delete(variables.sourceLineId);

      const count = data?.cloned_component_count;
      toast.success(
        data?.replayed
          ? "Product already duplicated"
          : `Product duplicated${count ? ` — ${count} production component${count === 1 ? "" : "s"} copied` : ""}`
      );
    },
    // The pending target id is deliberately NOT cleared here - the outcome
    // of the failed attempt is ambiguous (it may have committed server-side
    // before the error surfaced), so the next retry against this source
    // line must reuse the same target id, not mint a new one.
    onError: (error) => toast.error(error?.message || "Could not duplicate this line"),
  });

  const duplicateRow = (/** @type {any} */ rawProduct) => {
    if (locked || duplicateLineMutation.isPending) return;
    const p = cleanProduct(rawProduct);
    if (!p.line_id) {
      toast.error("This line has no line id yet - save the order once before duplicating it.");
      return;
    }
    let targetLineId = pendingDuplicateTargetIdsRef.current.get(p.line_id);
    if (!targetLineId) {
      targetLineId = newLineId();
      pendingDuplicateTargetIdsRef.current.set(p.line_id, targetLineId);
    }
    duplicateLineMutation.mutate({ sourceLineId: p.line_id, targetLineId });
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
  const selectedEditItem = allPickerItems.find((item) => item.id && item.id === (editRow.catalog_item_id || editRow.inventory_item_id));
  const productLineTotal = products.reduce((sum, raw) => {
    const product = cleanProduct(raw);
    return sum + (Number(product.price || 0) * Number(product.quantity || 1));
  }, 0);
  const productQuantityTotal = products.reduce((sum, raw) => {
    const product = cleanProduct(raw);
    return sum + Number(product.quantity || 0);
  }, 0);
  const orderTotal = Number(order.total_amount || 0);
  const orderTotalWithShipping = computeOrderTotal({
    itemsSubtotal: productLineTotal,
    applyShippingFee: order.apply_shipping_fee,
    shippingFee: order.shipping_fee,
  });
  const canApplyProductTotal = orderTotalWithShipping.total > 0 && Math.abs(orderTotalWithShipping.total - orderTotal) > 0.009;

  const updateQuantity = (idx, delta) => {
    if (locked) return;
    const updated = products.map((item, i) => {
      const clean = cleanProduct(item);
      return i === idx
        ? { ...clean, quantity: Math.max(1, Number(clean.quantity || 1) + delta) }
        : clean;
    });
    onUpdate(order.id, { products: updated });
  };

  // --- Configure Product (Phase 4-6) --------------------------------
  const configureLine = products.map(cleanProduct).find((item) => item.line_id === configureLineId) || null;

  const closeConfigureDialog = () => {
    setConfigureLineId("");
    setConfigureStep("menu");
    setConfigurePickedItem(null);
    setConfigureCreateName("");
    setConfigureCreatePickedItem(null);
  };

  const openConfigureDialog = (lineId, defaultName) => {
    if (locked) return;
    setConfigureLineId(lineId);
    setConfigureStep("menu");
    setConfigurePickedItem(null);
    setConfigureCreateName(defaultName || "");
    setConfigureCreatePickedItem(null);
  };

  const applyToLine = (lineId, updater) => {
    const updated = products.map((raw) => {
      const item = cleanProduct(raw);
      return item.line_id === lineId ? updater(item) : item;
    });
    onUpdate(order.id, { products: updated });
  };

  const handleMatchExisting = (pickedItem) => {
    if (locked || !configureLineId) return;
    applyToLine(configureLineId, (item) => applyMatchExistingProduct(item, pickedItem));
    toast.success("Product matched");
    closeConfigureDialog();
  };

  const handleKeepCommercialOnly = () => {
    if (locked || !configureLineId) return;
    applyToLine(configureLineId, applyKeepCommercialOnly);
    toast.success("Marked as commercial-only");
    closeConfigureDialog();
  };

  // Optionally links a catalog OR stock/inventory product (behaves like
  // Match Existing for whichever source was picked, plus eagerly
  // creates/reuses the client_product the same way addPrintOptionMutation
  // already does on first "+ Add print option" - this just saves staff a
  // click). With no item picked, creates a standalone client_product
  // (opps_product_id: null, inventory_item_id: null) and points the line
  // at it via the client_product_id field. All three cases are
  // production-capable via isProductionCapableLine (catalog_item_id /
  // inventory_item_id / client_product_id respectively) - Production is
  // never force-hidden here; "Keep commercial only" is the actual,
  // separate opt-out for lines that genuinely shouldn't compose anything.
  const createClientProductMutation = useMutation({
    mutationFn: async ({ lineId, name, pickedItem }) => {
      const lineNow = products.map(cleanProduct).find((item) => item.line_id === lineId);
      if (!lineNow) throw new Error("Order line not found");
      const finalName = (name || lineNow.name || "Untitled product").trim() || "Untitled product";
      if (pickedItem && pickedItem.source === "catalog") {
        let clientProduct = clientProductByCatalogItemId.get(pickedItem.id);
        if (!clientProduct) {
          clientProduct = await dataClient.entities.ClientProduct.create({
            client_id: order.client_id,
            opps_product_id: pickedItem.id,
            client_facing_name: finalName,
            created_from_order_id: order.id,
          });
        }
        return { clientProduct, matchedItem: pickedItem };
      }
      if (pickedItem && pickedItem.source === "stock") {
        // Preserves the exact inventory identity - never coerced into
        // catalog_item_id, which points at a different table entirely.
        let clientProduct = clientProductByInventoryItemId.get(pickedItem.id);
        if (!clientProduct) {
          clientProduct = await dataClient.entities.ClientProduct.create({
            client_id: order.client_id,
            inventory_item_id: pickedItem.id,
            client_facing_name: finalName,
            created_from_order_id: order.id,
          });
        }
        return { clientProduct, matchedItem: pickedItem };
      }
      const clientProduct = await dataClient.entities.ClientProduct.create({
        client_id: order.client_id,
        opps_product_id: null,
        client_facing_name: finalName,
        created_from_order_id: order.id,
      });
      return { clientProduct, matchedItem: null };
    },
    onSuccess: ({ clientProduct, matchedItem }, variables) => {
      applyToLine(variables.lineId, (item) => (
        matchedItem
          ? applyMatchExistingProduct(item, matchedItem)
          : { ...item, client_product_id: clientProduct.id }
      ));
      queryClient.invalidateQueries({ queryKey: ["clientProductsForOrder", order.client_id] });
      toast.success("Client product created");
      closeConfigureDialog();
    },
    onError: (err) => toast.error(err?.message || "Could not create client product"),
  });

  // --- Set/Change thumbnail (Phase 4-6) ------------------------------
  const applyThumbnail = (pickedAssets) => {
    const asset = Array.isArray(pickedAssets) ? pickedAssets[0] : null;
    if (locked || !thumbnailPickerLineId || !asset?.file_url) {
      setThumbnailPickerLineId("");
      return;
    }
    applyToLine(thumbnailPickerLineId, (item) => ({ ...item, image_url: asset.file_url }));
    setThumbnailPickerLineId("");
  };

  return (
    <div className="bg-secondary/30 rounded-xl p-4">
      {locked && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          <Lock className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{lockReason || "Products are locked and can no longer be edited."}</span>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Products</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground">
              {products.length} line{products.length === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground">
              {productQuantityTotal || 0} unit{productQuantityTotal === 1 ? "" : "s"}
            </span>
            {productLineTotal > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
                Product total {formatMoney(productLineTotal)}
              </span>
            )}
          </div>
        </div>
        {!locked && (
        <div className="flex flex-wrap gap-2">
          {canApplyProductTotal && (
            <button
              type="button"
              onClick={() => onUpdate(order.id, { total_amount: Number(orderTotalWithShipping.total.toFixed(2)) })}
              className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
              title={orderTotalWithShipping.chargedShipping > 0
                ? `Items ${formatMoney(orderTotalWithShipping.itemsSubtotal)} + shipping ${formatMoney(orderTotalWithShipping.chargedShipping)}`
                : undefined}
            >
              Apply total
            </button>
          )}
          {!addMode && (
            <button type="button" onClick={() => setAddMode(true)} className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>
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
              {selectedEditItem?.sizes?.length ? (
                <select value={editRow.size} onChange={(e) => setEditRow(r => ({ ...r, size: e.target.value }))}
                  className="h-7 rounded-lg border border-input bg-background px-2 text-xs">
                  <option value="">Size</option>
                  {selectedEditItem.sizes.map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              ) : (
                <Input value={editRow.size} onChange={(/** @type {any} */ e) => setEditRow(r => ({ ...r, size: e.target.value }))}
                  className="h-7 text-xs rounded-lg" placeholder="Size" />
              )}
              {selectedEditItem?.colors?.length ? (
                <select value={editRow.color} onChange={(e) => setEditRow(r => ({ ...r, color: e.target.value }))}
                  className="h-7 rounded-lg border border-input bg-background px-2 text-xs">
                  <option value="">Colour</option>
                  {selectedEditItem.colors.map((color) => <option key={color} value={color}>{color}</option>)}
                </select>
              ) : (
                <Input value={editRow.color} onChange={(/** @type {any} */ e) => setEditRow(r => ({ ...r, color: e.target.value }))}
                  className="h-7 text-xs rounded-lg" placeholder="Colour" />
              )}
              <Input value={editRow.notes} onChange={(/** @type {any} */ e) => setEditRow(r => ({ ...r, notes: e.target.value }))}
                className="h-7 text-xs rounded-lg sm:col-span-3" placeholder="Item notes / print placement" />
              {selectedEditItem?.print_options?.length > 0 && (
                <OptionChipGroup
                  title="Print options"
                  options={selectedEditItem.print_options}
                  selected={editRow.selected_print_options || []}
                  onToggle={(option) => toggleEditOption("print", option)}
                  tone="primary"
                  optionKey={optionKey}
                  optionLabel={optionLabel}
                  formatMoney={formatMoney}
                />
              )}
              {selectedEditItem?.addons?.length > 0 && (
                <OptionChipGroup
                  title="Add-ons"
                  options={selectedEditItem.addons}
                  selected={editRow.selected_addons || []}
                  onToggle={(option) => toggleEditOption("addon", option)}
                  tone="amber"
                  optionKey={optionKey}
                  optionLabel={optionLabel}
                  formatMoney={formatMoney}
                />
              )}
              <div className="flex gap-2 sm:col-span-3">
                <button type="button" onClick={saveRow} className="text-xs text-primary font-medium whitespace-nowrap">Save</button>
                <button type="button" onClick={() => setEditingIdx(null)} className="text-xs text-muted-foreground">Cancel</button>
              </div>
            </div>
          ) : (
            <div key={i} className="flex flex-col gap-3 group px-2 py-2 rounded-xl hover:bg-card/70 transition-all sm:flex-row sm:items-center">
              {(() => {
                const resolvedThumb = resolveLineThumbnail(p, {
                  clientProduct: clientProductForLine(p),
                  catalogItem: allPickerItems.find((item) => item.id === (p.catalog_item_id || p.inventory_item_id)),
                });
                const isRealImage = Boolean(resolvedThumb) && isImageReference(resolvedThumb);
                return (
                  <div className="flex-shrink-0">
                    {isRealImage ? (
                      <button
                        type="button"
                        onClick={() => setQuickPreview({ value: resolvedThumb, title: p.name, subtitle: "Product image" })}
                        className="block h-12 w-12 overflow-hidden rounded-xl border border-border bg-secondary/50 transition-opacity hover:opacity-80"
                        title="View image"
                      >
                        <SecureImage value={resolvedThumb} alt="" className="h-full w-full object-cover" fallback={null} />
                      </button>
                    ) : (
                      <div className="h-12 w-12 overflow-hidden rounded-xl border border-border bg-secondary/50">
                        <Package className="m-3 h-6 w-6 text-muted-foreground/50" />
                      </div>
                    )}
                    {!locked && (
                      <button
                        type="button"
                        onClick={() => setThumbnailPickerLineId(p.line_id)}
                        className="mt-1 flex w-12 items-center justify-center gap-0.5 text-[9px] font-medium text-primary hover:underline"
                        title={resolvedThumb ? "Change thumbnail" : "Set thumbnail"}
                      >
                        <ImagePlus className="h-2.5 w-2.5" />
                        {resolvedThumb ? "Change" : "Set"}
                      </button>
                    )}
                  </div>
                );
              })()}
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
              {needsConfiguration(p) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-900">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                  <span>{needsConfigurationBannerText(p)}</span>
                  {!locked && (
                    <button
                      type="button"
                      onClick={() => openConfigureDialog(p.line_id, p.name)}
                      className="rounded-full bg-amber-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-700"
                    >
                      Configure product
                    </button>
                  )}
                </div>
              )}
              {isProductionCapableLine(p) && (
                <LineProduction
                  clientProduct={clientProductForLine(p)}
                  snapshots={snapshotsByLineId.get(p.line_id) || []}
                  trackingBySnapshotId={trackingBySnapshotId}
                  lineQuantity={Number(p.quantity) || 0}
                  availabilityByVariantId={availabilityByVariantId}
                  thisOrderReservedBySnapshotId={thisOrderReservedBySnapshotId}
                  expanded={expandedProductionLineId === p.line_id}
                  onToggle={() => setExpandedProductionLineId((current) => current === p.line_id ? "" : p.line_id)}
                  onChange={(snapshot, field, value) => saveLineProduction.mutate({ snapshot, field, value })}
                  onBeginAttach={() => beginAttach(p.line_id, clientProductForLine(p)?.id, p)}
                  resolving={resolvingLineId === p.line_id}
                  pendingResolution={pendingResolution && pendingResolution.lineId === p.line_id ? pendingResolution : null}
                  onPickVariant={pickVariantForComponent}
                  onSetComponentPrice={setComponentPrice}
                  onConfirmAttach={() => confirmAttach.mutate()}
                  onCancelAttach={() => setPendingResolution(null)}
                  attachIsBlocked={attachIsBlocked}
                  needsStaffPick={needsStaffPick}
                  variantLabel={variantLabel}
                  confirming={confirmAttach.isPending}
                  saving={saveLineProduction.isPending}
                  isAddingPrintOption={addingPrintOptionLineId === p.line_id}
                  printOptionForm={printOptionForm}
                  setPrintOptionForm={setPrintOptionForm}
                  internalProducts={internalProductsForLabels}
                  pricingDefaultFor={pricingDefaultFor}
                  currentArtworkForClientProduct={
                    clientProductForLine(p)
                      ? artworkByClientProductId.get(clientProductForLine(p).id) || []
                      : []
                  }
                  onStartAddPrintOption={() => { setAddingPrintOptionLineId(p.line_id); setPrintOptionForm(emptyPrintOptionForm()); }}
                  onCancelAddPrintOption={() => setAddingPrintOptionLineId("")}
                  onConfirmAddPrintOption={() => addPrintOptionMutation.mutate({ lineId: p.line_id, orderLine: p, form: printOptionForm })}
                  addingPrintOption={addPrintOptionMutation.isPending}
                  onArtworkLinked={() => queryClient.invalidateQueries({ queryKey: ["clientProductArtworkForOrder"] })}
                  onReviewForMyProducts={() => reviewForMyProductsMutation.mutate({ lineId: p.line_id, orderLine: p })}
                  reviewingForMyProducts={reviewForMyProductsMutation.isPending}
                />
              )}
              </div>
              <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                {locked ? (
                  <span className="min-w-5 text-center text-xs font-semibold">{p.quantity || 1}</span>
                ) : (
                  <>
                    <button type="button" onClick={() => updateQuantity(i, -1)} className="grid h-6 w-6 place-items-center rounded-full border border-border bg-background hover:bg-secondary">
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="min-w-5 text-center text-xs font-semibold">{p.quantity || 1}</span>
                    <button type="button" onClick={() => updateQuantity(i, 1)} className="grid h-6 w-6 place-items-center rounded-full border border-border bg-background hover:bg-secondary">
                      <Plus className="h-3 w-3" />
                    </button>
                  </>
                )}
                {p.price && (
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                    {formatMoney(Number(p.price) * Number(p.quantity || 1))}
                  </span>
                )}
                {!locked && (
                <button type="button" onClick={() => duplicateRow(p)}
                  disabled={duplicateLineMutation.isPending}
                  className="opacity-100 text-muted-foreground hover:text-primary transition-all disabled:cursor-not-allowed disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100"
                  title="Copy product (production components copy with it)">
                  <Copy className="w-3 h-3" />
                </button>
                )}
                {!locked && (
                <button type="button" onClick={() => { setEditingIdx(i); setEditRow({ name: p.name, quantity: p.quantity || 1, price: p.price || "", size: p.size || "", color: p.color || "", notes: p.notes || "", catalog_item_id: p.catalog_item_id || "", inventory_item_id: p.inventory_item_id || "", image_url: p.image_url || "", category: p.category || "", source: p.source || "", selected_print_options: p.selected_print_options || [], selected_addons: p.selected_addons || [] }); }}
                  className="opacity-100 text-muted-foreground hover:text-foreground transition-all sm:opacity-0 sm:group-hover:opacity-100">
                  <Pencil className="w-3 h-3" />
                </button>
                )}
                {!locked && (
                <button type="button" onClick={() => removeRow(i)}
                  className="opacity-100 text-muted-foreground hover:text-destructive transition-all sm:opacity-0 sm:group-hover:opacity-100">
                  <Trash2 className="w-3 h-3" />
                </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add new row */}
      {addMode && !locked && (
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
                      setSizeRun({});
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
          {selectedPickerItem?.sizes?.length > 0 && (
            <div className="rounded-2xl border border-border bg-background p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Size run</p>
                  <p className="text-[11px] text-muted-foreground">Add quantities per size when the order has multiple sizes.</p>
                </div>
                {Object.values(sizeRun).some((qty) => Number(qty || 0) > 0) && (
                  <button type="button" onClick={addSizeRun} className="rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground">
                    Add size run
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {selectedPickerItem.sizes.map((size) => (
                  <label key={size} className="rounded-xl border border-border bg-secondary/30 px-2 py-2">
                    <span className="block text-center text-[11px] font-semibold text-foreground">{size}</span>
                    <Input
                      value={sizeRun[size] || ""}
                      onChange={(e) => setSizeRun((current) => ({ ...current, [size]: e.target.value }))}
                      type="number"
                      min="0"
                      placeholder="0"
                      className="mt-1 h-7 rounded-lg text-center text-xs"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
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

      {/* Configure Product (Phase 4-6) - exactly three explicit,
          confirm-gated actions for an invoice-added line with no
          production identity yet. Entirely blocked when locked, same as
          every other product edit in this file. */}
      {!locked && configureLineId && (
        <Dialog open={Boolean(configureLineId)} onOpenChange={(open) => { if (!open) closeConfigureDialog(); }}>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Configure product</DialogTitle>
              <DialogDescription>
                {configureLine?.name || "This order line"} has no production identity yet{configureLine?.added_from_invoice ? " (added from an invoice)" : ""}. Choose one action below.
              </DialogDescription>
            </DialogHeader>

            {configureStep === "menu" && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setConfigureStep("match")}
                  className="w-full rounded-xl border border-border bg-card px-3 py-3 text-left hover:border-primary/40 hover:bg-secondary/40"
                >
                  <p className="text-sm font-semibold text-foreground">Match existing product</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Link this line to a catalog or stock product already in the system.</p>
                </button>
                <button
                  type="button"
                  onClick={() => setConfigureStep("create")}
                  className="w-full rounded-xl border border-border bg-card px-3 py-3 text-left hover:border-primary/40 hover:bg-secondary/40"
                >
                  <p className="text-sm font-semibold text-foreground">Create client product</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Set up a new client product for this line, optionally linked to a catalog product.</p>
                </button>
                <button
                  type="button"
                  onClick={() => setConfigureStep("commercial")}
                  className="w-full rounded-xl border border-border bg-card px-3 py-3 text-left hover:border-primary/40 hover:bg-secondary/40"
                >
                  <p className="text-sm font-semibold text-foreground">Keep commercial only</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">This line is a fee or service with nothing to map (e.g. custom labels, a setup fee).</p>
                </button>
              </div>
            )}

            {configureStep === "match" && (
              <div className="space-y-3">
                {!configurePickedItem ? (
                  <CatalogPicker items={allPickerItems} onPick={setConfigurePickedItem} />
                ) : (
                  <div className="space-y-3">
                    <PickedItemPreview item={configurePickedItem} onClear={() => setConfigurePickedItem(null)} />
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => setConfigurePickedItem(null)}>Choose different item</Button>
                      <Button className="flex-1" onClick={() => handleMatchExisting(configurePickedItem)}>Confirm match</Button>
                    </div>
                  </div>
                )}
                <Button variant="ghost" size="sm" onClick={() => setConfigureStep("menu")}>Back</Button>
              </div>
            )}

            {configureStep === "create" && (
              <div className="space-y-3">
                <Input
                  value={configureCreateName}
                  onChange={(e) => setConfigureCreateName(e.target.value)}
                  placeholder="Client-facing product name"
                  className="h-9 text-sm rounded-xl"
                  autoFocus
                />
                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">
                    Link to an existing catalog or stock product (optional) - leave blank for a custom item with no catalog/stock parent, e.g. custom labels.
                  </p>
                  {configureCreatePickedItem ? (
                    <PickedItemPreview item={configureCreatePickedItem} onClear={() => setConfigureCreatePickedItem(null)} />
                  ) : (
                    <CatalogPicker items={allPickerItems} onPick={setConfigureCreatePickedItem} placeholder="Search catalog/stock to link (optional)..." />
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setConfigureStep("menu")}>Back</Button>
                  <Button
                    className="flex-1"
                    disabled={!configureCreateName.trim() || createClientProductMutation.isPending}
                    onClick={() => createClientProductMutation.mutate({ lineId: configureLineId, name: configureCreateName, pickedItem: configureCreatePickedItem })}
                  >
                    {createClientProductMutation.isPending ? "Creating…" : "Confirm & create client product"}
                  </Button>
                </div>
              </div>
            )}

            {configureStep === "commercial" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  This line will be marked as commercial-only. No catalog or composition mapping is applied - use this for fees and services (e.g. &quot;X1 - Satin Labels&quot;).
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setConfigureStep("menu")}>Back</Button>
                  <Button className="flex-1" onClick={handleKeepCommercialOnly}>Confirm - keep commercial only</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Set/Change thumbnail (Phase 4-6) - single-select, client-scoped,
          explicit overwrite path per resolveLineThumbnail's design. Mockups
          is this picker's intended context - the same canonical category
          the order-primary-image precedence chain treats as authoritative. */}
      {!locked && thumbnailPickerLineId && (
        <ClientAssetPickerModal
          clientId={order.client_id}
          selectionMode="single"
          defaultCategory="Mockups"
          uploadCategory="Mockups"
          title="Set line thumbnail"
          description="Pick a file from this client's library, or upload a new one, to use as this line's thumbnail. This replaces any current thumbnail."
          confirmVerb="Use"
          onClose={() => setThumbnailPickerLineId("")}
          onConfirm={applyThumbnail}
        />
      )}

      {/* Quick image preview (Phase 5-12) - view-only, no order/asset
          writes of any kind. Available regardless of locked, since
          viewing is never a mutation. */}
      <QuickImagePreview
        open={Boolean(quickPreview)}
        onClose={() => setQuickPreview(null)}
        value={quickPreview?.value}
        title={quickPreview?.title}
        subtitle={quickPreview?.subtitle}
      />
    </div>
  );
}

// Small search/filter picker reused by Configure Product's "Match
// existing product" and "Create client product" flows - same
// filter/list pattern as the Add Product picker above, packaged
// standalone (with its own local search state) so it can be embedded
// inside the dialog without touching addMode/newRow state.
function CatalogPicker({ items, onPick, placeholder = "Search catalog or stock..." }) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].slice(0, 14);
  const sourceFiltered = items.filter((item) => {
    const sourceMatch = source === "all" || item.source === source;
    const categoryMatch = category === "all" || item.category === category;
    return sourceMatch && categoryMatch;
  });
  const filtered = search
    ? sourceFiltered.filter((item) => item.name?.toLowerCase().includes(search.toLowerCase()))
    : sourceFiltered.slice(0, 20);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {[["all", "All"], ["catalog", "Catalog"], ["stock", "Stock"]].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSource(value)}
            className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all ${
              source === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/40"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {categories.length > 0 && (
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 w-full rounded-xl border border-input bg-background px-3 text-xs text-foreground">
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={placeholder} className="h-8 text-sm rounded-xl" autoFocus />
      <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
        {filtered.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">No matching products.</p>}
        {filtered.map((item) => (
          <button
            key={`${item.source}-${item.id}`}
            type="button"
            onClick={() => onPick(item)}
            className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-secondary transition-all"
          >
            <div className="h-10 w-10 overflow-hidden rounded-lg border border-border bg-secondary/60 flex-shrink-0">
              {item.image_url ? <img src={item.image_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Package className="m-2.5 h-5 w-5 text-muted-foreground/50" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{item.name}</p>
              <p className="truncate text-[10px] text-muted-foreground">{[item.category, item.source].filter(Boolean).join(" / ")}</p>
            </div>
            {item.price ? <span className="flex-shrink-0 text-xs font-semibold text-primary">R{Number(item.price).toLocaleString()}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function PickedItemPreview({ item, onClear }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-secondary/30 p-3">
      <div className="h-12 w-12 overflow-hidden rounded-xl border border-border bg-background flex-shrink-0">
        {item.image_url ? <img src={item.image_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Package className="m-3 h-6 w-6 text-muted-foreground/50" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
        <p className="truncate text-xs text-muted-foreground">{[item.category, item.source].filter(Boolean).join(" / ")}</p>
      </div>
      {onClear && (
        <button type="button" onClick={onClear} className="flex-shrink-0 text-xs text-muted-foreground hover:text-destructive">
          Remove
        </button>
      )}
    </div>
  );
}

// Compact per-line production tracking - only rendered for lines whose
// order client has a client product based on this catalog item
// (product_components exist somewhere upstream). Until this line's
// composition is explicitly snapshotted (order_line_component_snapshots),
// this shows only an "attach composition" action - no tracking control
// operates against the live, mutable product_components row. Writes go
// to order_line_production_tracking, never the order's own
// production_method/production_detail_stage columns, so orders/lines
// without composition data keep behaving exactly as before.
function LineProduction({
  clientProduct, snapshots, trackingBySnapshotId, expanded, onToggle, onChange,
  onBeginAttach, resolving, pendingResolution, onPickVariant, onSetComponentPrice, onConfirmAttach, onCancelAttach,
  attachIsBlocked, needsStaffPick, variantLabel, confirming, saving,
  lineQuantity, availabilityByVariantId, thisOrderReservedBySnapshotId,
  isAddingPrintOption, printOptionForm, setPrintOptionForm, internalProducts, pricingDefaultFor,
  onStartAddPrintOption, onCancelAddPrintOption, onConfirmAddPrintOption, addingPrintOption,
  currentArtworkForClientProduct, onArtworkLinked,
  onReviewForMyProducts, reviewingForMyProducts,
}) {
  const hasSnapshots = snapshots.length > 0;
  return (
    <div className="mt-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2 py-1.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 text-left text-[11px] font-semibold text-primary"
      >
        {expanded ? <ChevronDown className="h-3 w-3 flex-shrink-0" /> : <ChevronRight className="h-3 w-3 flex-shrink-0" />}
        <Factory className="h-3 w-3 flex-shrink-0" />
        Production
        {!hasSnapshots && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            composition not attached
          </span>
        )}
        {hasSnapshots && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {snapshots.length} component{snapshots.length === 1 ? "" : "s"}
          </span>
        )}
        {hasSnapshots && snapshots.some((s) => s.inventory_product_id && !s.resolved_inventory_variant_id) && (
          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
            unresolved variant
          </span>
        )}
      </button>

      {expanded && !pendingResolution && !isAddingPrintOption && (
        <div className="mt-1.5 space-y-1">
          {!hasSnapshots && (
            clientProduct ? (
              <>
                <p className="text-[11px] text-muted-foreground">
                  {clientProduct.client_facing_name || "This client product"} has a composition defined, but this order line hasn't captured a frozen snapshot of it yet.
                </p>
                <Button size="sm" variant="outline" className="h-7 w-full rounded-lg text-[11px]" onClick={onBeginAttach} disabled={resolving}>
                  {resolving ? "Resolving…" : "Attach composition to this line"}
                </Button>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">No composition yet for this product.</p>
            )
          )}
          <Button size="sm" variant="outline" className="h-7 w-full rounded-lg text-[11px]" onClick={onStartAddPrintOption}>
            <Plus className="mr-1 h-3 w-3" /> Add print option
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full rounded-lg text-[11px]"
            onClick={onReviewForMyProducts}
            disabled={reviewingForMyProducts}
          >
            {reviewingForMyProducts ? "Preparing…" : (clientProduct ? "Open in X LAB Admin" : "Review for My Products")}
          </Button>
        </div>
      )}

      {expanded && isAddingPrintOption && (
        <div className="mt-1.5 space-y-2">
          <ComponentFieldsForm
            form={printOptionForm}
            setForm={setPrintOptionForm}
            internalProducts={internalProducts}
            pricingDefaultFor={pricingDefaultFor}
            clientProduct={clientProduct}
            currentArtwork={currentArtworkForClientProduct}
            onArtworkLinked={onArtworkLinked}
            showOrderPrice
            excludeComponentTypes={["blank_garment"]}
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 flex-1 rounded-lg text-[11px]" onClick={onCancelAddPrintOption}>Cancel</Button>
            <Button
              size="sm"
              className="h-7 flex-1 rounded-lg text-[11px]"
              disabled={addingPrintOption || (printOptionForm.component_type === "blank_garment" && !printOptionForm.inventory_product_id)}
              onClick={onConfirmAddPrintOption}
            >
              {addingPrintOption ? "Adding…" : "Add to order"}
            </Button>
          </div>
        </div>
      )}

      {expanded && pendingResolution && (
        <div className="mt-1.5 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Resolving exact inventory variant per component. Line size &quot;{pendingResolution.orderLine.size || "(none)"}&quot; · colour &quot;{pendingResolution.orderLine.color || "(none)"}&quot;.
          </p>
          {pendingResolution.resolutions.map((r) => (
            <div key={r.component.id} className={`rounded-lg border bg-background/60 p-1.5 ${needsStaffPick(r) && r.status === "unresolved_multiple" ? "border-red-300" : "border-primary/10"}`}>
              <p className="mb-1 text-[10px] font-semibold text-slate-700">
                {r.component.label || r.component.component_type}
                {r.component.placement && <span className="text-slate-400"> · {r.component.placement}</span>}
              </p>
              {r.component.placement && (
                <p className="mb-1 text-[10px] text-slate-500">
                  Artwork: {r.artwork ? (r.artwork.file_name || "linked file") : "none linked yet - set in Catalog Management"}
                </p>
              )}
              {r.status === "resolved" && (
                <p className="text-[10px] text-emerald-700">✓ resolved automatically: {variantLabel(r.options.find((o) => o.id === r.resolvedVariantId) || {})}</p>
              )}
              {r.status === "fixed" && (
                <p className="text-[10px] text-emerald-700">✓ fixed variant configured on this component</p>
              )}
              {r.status === "not_applicable" && (
                <p className="text-[10px] text-slate-400">no inventory identity on this component - nothing to resolve</p>
              )}
              {r.status === "unresolved_zero" && (
                <p className="text-[10px] text-amber-700">no variant matches this line&apos;s size/colour - pick manually, or attach unresolved and flag production later</p>
              )}
              {r.status === "unresolved_multiple" && (
                <p className="text-[10px] text-red-700">multiple variants match - staff must choose before this component can be attached</p>
              )}
              {(r.status === "unresolved_zero" || r.status === "unresolved_multiple") && (
                <select
                  value={r.staffPickedVariantId}
                  onChange={(e) => onPickVariant(r.component.id, e.target.value)}
                  className="mt-1 h-7 w-full rounded-lg border border-input bg-background px-2 text-[11px]"
                >
                  <option value="">Select internal variant…</option>
                  {r.options.map((v) => <option key={v.id} value={v.id}>{variantLabel(v)}</option>)}
                </select>
              )}
              <div className="mt-1 flex items-center gap-1.5">
                <span className="text-[10px] text-slate-500">
                  Default {r.component.default_sell_price != null ? `R${r.component.default_sell_price}` : "—"}
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={r.staffPrice}
                  onChange={(e) => onSetComponentPrice(r.component.id, e.target.value)}
                  className="h-6 flex-1 rounded-lg px-2 text-[11px]"
                  placeholder="Order price"
                />
                {r.component.default_sell_price != null && r.staffPrice !== "" && Number(r.staffPrice) !== Number(r.component.default_sell_price) && (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">Order override</span>
                )}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 flex-1 rounded-lg text-[11px]" onClick={onCancelAttach}>Cancel</Button>
            <Button size="sm" className="h-7 flex-1 rounded-lg text-[11px]" onClick={onConfirmAttach} disabled={confirming || attachIsBlocked}>
              {confirming ? "Attaching…" : "Confirm & attach"}
            </Button>
          </div>
        </div>
      )}

      {expanded && hasSnapshots && (
        <div className="mt-1.5 space-y-2">
          {(() => {
            const pricing = computeCompositionPricing(snapshots, lineQuantity);
            if (pricing.perUnit.length === 0 && pricing.onceOff.length === 0) return null;
            return (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] text-slate-700">
                {pricing.perUnit.length > 0 && (
                  <>
                    <p className="font-semibold text-slate-800">Per unit</p>
                    {pricing.perUnit.map((s) => (
                      <p key={s.id} className="flex justify-between text-slate-600">
                        <span>{s.label || s.component_type}</span>
                        <span>R{toMoneyDisplay(s.sell_price)}</span>
                      </p>
                    ))}
                    <p className="flex justify-between font-semibold text-slate-800">
                      <span>Unit total</span>
                      <span>R{toMoneyDisplay(pricing.perUnitSubtotal)}</span>
                    </p>
                  </>
                )}
                {pricing.onceOff.length > 0 && (
                  <>
                    <p className="mt-1 font-semibold text-slate-800">Once-off</p>
                    {pricing.onceOff.map((s) => (
                      <p key={s.id} className="flex justify-between text-slate-600">
                        <span>{s.label || s.component_type}</span>
                        <span>R{toMoneyDisplay(s.sell_price)}</span>
                      </p>
                    ))}
                  </>
                )}
                <p className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
                  <span>Line total (qty {pricing.quantity})</span>
                  <span>R{toMoneyDisplay(pricing.lineTotal)}</span>
                </p>
                <p className="mt-0.5 text-[9px] text-slate-400">
                  Composition reference only - does not automatically change the order line price above.
                </p>
              </div>
            );
          })()}
          {snapshots.map((snapshot) => {
            const tracking = trackingBySnapshotId.get(snapshot.id);
            const stageBlocked = Boolean(snapshot.inventory_product_id && !snapshot.resolved_inventory_variant_id);
            return (
              <div key={snapshot.id} className="rounded-lg border border-primary/10 bg-background/60 p-1.5">
                <p className="mb-1 text-[10px] font-semibold text-slate-700">
                  {snapshot.label || snapshot.component_type}
                  {snapshot.placement && <span className="text-slate-400"> · {snapshot.placement}</span>}
                </p>
                {stageBlocked && (
                  <p className="mb-1 text-[10px] text-red-700">
                    unresolved inventory variant - stock-related production stage is blocked until this is resolved
                  </p>
                )}
                {snapshot.resolved_inventory_variant_id && (() => {
                  const availability = availabilityByVariantId.get(snapshot.resolved_inventory_variant_id);
                  const required = (Number(snapshot.quantity_per_unit) || 0) * (Number(lineQuantity) || 0);
                  const verified = Boolean(availability?.balance_verified_at);
                  const dryRun = computeStockDryRun({
                    required,
                    onHandQty: availability?.on_hand_qty,
                    totalActiveReserved: availability?.reserved_qty,
                    thisOrderReserved: thisOrderReservedBySnapshotId?.get(snapshot.id),
                    verified,
                  });
                  return (
                    <div className="mb-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                      <span className="font-semibold text-slate-700">Stock (dry-run)</span>
                      {" — "}Required {dryRun.required} · Reserved for this order {dryRun.thisOrderReserved} · Reserved elsewhere {dryRun.reservedElsewhere}
                      {" · "}{verified ? `On hand ${dryRun.onHandQty}` : "On hand: Not verified"}
                      {verified && <> · Available {dryRun.availableToThisOrder}</>}
                      {verified && dryRun.short > 0 && <span className="font-semibold text-red-700"> · Short {dryRun.short}</span>}
                      <br />
                      <span className={verified ? (dryRun.short > 0 ? "text-red-700" : "text-emerald-700") : (dryRun.fullyReservedForThisOrder ? "text-emerald-700" : "text-amber-700")}>
                        {dryRun.status}
                      </span>
                    </div>
                  );
                })()}
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    key={`${snapshot.id}-method`}
                    value={tracking?.production_method || snapshot.production_method || "__none"}
                    onChange={(e) => onChange(snapshot, "production_method", e.target.value === "__none" ? null : e.target.value)}
                    disabled={saving}
                    className="h-7 rounded-lg border border-input bg-background px-2 text-[11px]"
                  >
                    {PRODUCTION_METHODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <select
                    key={`${snapshot.id}-stage`}
                    value={tracking?.production_stage || "__none"}
                    onChange={(e) => onChange(snapshot, "production_stage", e.target.value === "__none" ? null : e.target.value)}
                    disabled={saving || stageBlocked}
                    title={stageBlocked ? "Resolve the internal inventory variant before progressing this component's production stage" : undefined}
                    className="h-7 rounded-lg border border-input bg-background px-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {PRODUCTION_DETAIL_STAGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OptionChipGroup({ title, options, selected, onToggle, tone, optionKey, optionLabel, formatMoney }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-3 sm:col-span-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = (selected || []).some((item) => optionKey(item) === optionKey(option));
          const selectedClass = tone === "amber"
            ? "border-amber-500 bg-amber-500 text-white"
            : "border-primary bg-primary text-primary-foreground";
          const idleClass = tone === "amber"
            ? "border-border bg-secondary/40 text-muted-foreground hover:border-amber-400"
            : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40";
          return (
            <button
              key={optionKey(option)}
              type="button"
              onClick={() => onToggle(option)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all ${
                isSelected ? selectedClass : idleClass
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
  );
}
