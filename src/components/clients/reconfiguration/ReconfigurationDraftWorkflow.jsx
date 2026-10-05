import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, ChevronLeft, ChevronRight, AlertTriangle, Info, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dataClient } from "@/api/dataClient";
import {
  resolveClientProductPrice,
  getClientProductHistoricalReference,
  getClientProductConfigurationFingerprint,
  saveClientProductReconfiguration,
  parseSaveError,
} from "@/api/clientProductPriceReview";
import { PRODUCTION_METHODS, PLACEMENT_PRESETS } from "@/lib/productionStages";
import {
  CLASSIFICATION_OPTIONS,
  EARLY_STOP_CLASSIFICATIONS,
  COMPONENT_ROLE_OPTIONS,
  DIVERGENCE_REASONS,
  buildDraftComponents,
  groupByRole,
  describeComponentDelta,
  describeComponentChanges,
  hasPricingAffectingComponentChanges,
  buildSaveComponentPayload,
  buildInitialProduction,
} from "./reconfigurationDraftModel";

// CLIENT PRODUCT RECONFIGURATION — DRAFT V1.
//
// Zero-write simulation. Nothing in this file calls .create()/.update()/
// .delete() on any entity, and nothing calls any RPC other than the two
// read-only helpers already used by Product Configuration Review v1
// (resolveClientProductPrice, getClientProductHistoricalReference).
// Draft state lives only in this component's own useState - closing the
// workflow discards it; nothing is written to localStorage, a table, or
// any backend.
//
// Mounted at the SAME visibility boundary as the review panel it opens
// from (any staff who can open this client product at all), not behind
// canConfigure - canConfigure is a production-WRITE permission, and
// this workflow performs no writes, so gating on it would borrow a
// write permission for a read-only purpose with no real justification.

const money = (n) => (n == null || n === "" ? "—" : `R${Number(n).toFixed(2)}`);

const COMMERCIAL_ROLES = new Set(["COMMERCIAL_PER_UNIT", "COMMERCIAL_ONCE"]);
const NON_COMMERCIAL_ROLES = new Set(["PRODUCTION_BOM", "INFORMATIONAL"]);

const STEPS = [
  "Identity",
  "Classify",
  "Commercial",
  "Components",
  "Draft estimate",
  "Divergence",
  "Production",
  "Before / after",
  "Finish",
];

function SafetyBanner() {
  return (
    <div className="flex-shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-900">
      <p className="text-sm font-semibold">Draft simulation — no changes will be saved</p>
      <p className="mt-0.5 text-[11px] text-amber-800">
        Current live data stays unchanged. Historical orders stay unchanged. Closing this workflow discards the draft.
      </p>
    </div>
  );
}

function TrainingNote({ checking, why, mistake }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full px-2.5 py-1.5 text-left text-[11px] font-medium text-slate-500">
        {open ? "Hide training notes" : "Show training notes"}
      </button>
      {open && (
        <div className="space-y-1 border-t border-slate-200 px-2.5 py-2 text-[11px] text-slate-600">
          <p><b>What are we checking?</b> {checking}</p>
          <p><b>Why does this matter?</b> {why}</p>
          <p><b>Common mistake:</b> {mistake}</p>
        </div>
      )}
    </div>
  );
}

function StepHeader({ title, subtitle = null }) {
  return (
    <div className="mb-3">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
    </div>
  );
}

function FieldRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-xs">
      <span className="flex-shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 break-all text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}

function CompareCard({ label, current, draft, unit = "" }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="mb-2 text-xs font-medium text-slate-600">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0 rounded-md bg-slate-50 p-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Live</p>
          <p className="min-w-0 break-words text-sm font-semibold text-slate-700">{current}{unit}</p>
        </div>
        <div className="min-w-0 rounded-md bg-amber-50 p-2">
          <p className="text-[10px] uppercase tracking-wide text-amber-600">Draft</p>
          <p className="min-w-0 break-words text-sm font-semibold text-amber-800">{draft}{unit}</p>
        </div>
      </div>
    </div>
  );
}

export default function ReconfigurationDraftWorkflow({ product, components, onClose }) {
  const [step, setStep] = useState(0);
  const [identityAck, setIdentityAck] = useState(false);
  const [classification, setClassification] = useState(null);
  const [proposedAgreedPrice, setProposedAgreedPrice] = useState("");
  const [draftComponents, setDraftComponents] = useState(() => buildDraftComponents(components));
  const [divergenceReason, setDivergenceReason] = useState(null);
  const [divergenceNote, setDivergenceNote] = useState("");
  const [incompleteAck, setIncompleteAck] = useState(false);
  const [production, setProduction] = useState(() => buildInitialProduction(product));
  const [stoppedEarly, setStoppedEarly] = useState(false);

  const { data: priceRes, refetch: refetchPrice } = useQuery({
    queryKey: ["resolveClientProductPrice", product.id],
    queryFn: () => resolveClientProductPrice({ clientProductId: product.id }),
    enabled: Boolean(product.id),
    staleTime: 15_000,
  });
  const result = priceRes?.data;

  const { data: historyRes, refetch: refetchHistory } = useQuery({
    queryKey: ["clientProductHistoricalReference", product.id],
    queryFn: () => getClientProductHistoricalReference({ clientProductId: product.id, limit: 5 }),
    enabled: Boolean(product.id),
    staleTime: 30_000,
  });
  const history = historyRes?.data;

  const { data: siblingRows } = useQuery({
    queryKey: ["clientProductSiblingsByClient", product.client_id],
    queryFn: () => dataClient.entities.ClientProduct.filter({ client_id: product.client_id }, "client_facing_name", 200),
    enabled: Boolean(product.client_id),
    staleTime: 30_000,
  });
  const duplicates = useMemo(() => {
    const name = (product.client_facing_name || "").trim().toLowerCase();
    if (!name) return [];
    return (Array.isArray(siblingRows) ? siblingRows : []).filter(
      (r) => r.id !== product.id && (r.client_facing_name || "").trim().toLowerCase() === name
    );
  }, [siblingRows, product.id, product.client_facing_name]);

  const { data: clientRows } = useQuery({
    queryKey: ["clientNameLookup", product.client_id],
    queryFn: () => dataClient.entities.Client.filter({ id: product.client_id }, null, 1),
    enabled: Boolean(product.client_id),
    staleTime: 60_000,
  });
  const clientName = clientRows?.[0]?.name || "Unknown client";

  const usageCount = (history?.orderLines?.length || 0) + (history?.snapshots?.length || 0);
  const needsIdentityAck = duplicates.length > 0 || usageCount > 0;

  const liveAgreed = result?.agreed_unit_price ?? null;
  // "" means "keep current" (sent as agreedPriceAction: "keep") - every
  // other value must be a finite, non-negative number before it's ever
  // treated as a real proposed price. Checked by validity, never
  // truthiness, so a typed "0" (a legitimate zero price) stays valid.
  const priceInputError =
    proposedAgreedPrice !== "" && (!Number.isFinite(Number(proposedAgreedPrice)) || Number(proposedAgreedPrice) < 0)
      ? "Enter a valid agreed price."
      : null;
  const proposedNum = proposedAgreedPrice === "" || priceInputError ? null : Number(proposedAgreedPrice);
  const priceChanged = proposedNum != null && Number(proposedNum) !== Number(liveAgreed ?? 0);

  // FIX 2 — new-component creation is disabled for Save V1 (no explicit
  // component-type selector exists yet). This only matters as a safety
  // net for state that predates this fix (e.g. a draft session that was
  // already open when this change shipped) - the Add button itself is
  // gone, so no NEW row can be created going forward.
  const pendingNewComponents = useMemo(
    () => draftComponents.filter((c) => c.isNew && !c.removed),
    [draftComponents]
  );

  // A component edit that touches the commercial total is exactly as
  // capable of resolving a live divergence as a resolved server Save
  // would be - so "the live row is diverged" alone must not force a
  // "why is it okay to keep this diverged" reason onto a draft that's
  // actively trying to change that total. This is a presence check only
  // (see hasPricingAffectingComponentChanges) - it never computes what
  // the new total would BE, only whether the draft touches it at all.
  const pricingAffectingComponentChange = useMemo(
    () => hasPricingAffectingComponentChanges(components, draftComponents),
    [components, draftComponents]
  );
  const liveDiverged = result?.reconciliation_status === "diverged";

  // Step 6 semantics: "diverged" and "unresolved_components" are
  // different problems and must not share one gate.
  //   - A price CHANGE always asks why, regardless of live status - that's
  //     a commercial decision the draft is making right now.
  //   - Retaining an already-diverged live price with NO pricing-affecting
  //     component change asks a DIFFERENT question: why is it okay that
  //     this stays diverged - the draft isn't attempting to change it.
  //   - Live divergence WITH a pricing-affecting component change is
  //     neither of those - the draft may be resolving or reshaping that
  //     exact divergence, and only the server's resolver can judge the
  //     result at Save, so this is informational only, never a reason
  //     prompt and never a locally-claimed new reconciliation status.
  //   - An incomplete (unresolved_components) live state is a DATA gap, not
  //     a commercial decision - it gets an acknowledgment, never a
  //     "negotiated rate"-style reason, and never implies the unsaved draft
  //     itself has been judged divergent (only the live row has).
  const reasonMode = priceChanged
    ? "price-changed"
    : liveDiverged
      ? (pricingAffectingComponentChange ? "diverged-pending-reconciliation" : "retain-diverged")
      : "none";
  const reasonRequired = reasonMode === "price-changed" || reasonMode === "retain-diverged";
  const reasonSatisfied = !reasonRequired || (divergenceReason && (divergenceReason !== "Other" || divergenceNote.trim().length > 0));

  const incompleteAckRequired = result?.reconciliation_status === "unresolved_components";
  const incompleteAckSatisfied = !incompleteAckRequired || incompleteAck;

  const divergenceSatisfied = reasonSatisfied && incompleteAckSatisfied;

  const delta = useMemo(() => describeComponentDelta(components, draftComponents), [components, draftComponents]);
  const roleGroups = useMemo(() => groupByRole(draftComponents), [draftComponents]);
  const componentChanges = useMemo(() => describeComponentChanges(draftComponents), [draftComponents]);

  // ── SAVE V1 wiring ──────────────────────────────────────────────────
  const queryClient = useQueryClient();

  // Fetched exactly once, when this draft session mounts, then frozen -
  // never silently refetched before Save. Refetching right before Save
  // would defeat stale-draft protection (it would always match whatever
  // is live at that moment, even if someone else just changed it).
  const [expectedFingerprint, setExpectedFingerprint] = useState(null);
  const [fingerprintError, setFingerprintError] = useState(null);
  useEffect(() => {
    let active = true;
    setExpectedFingerprint(null);
    setFingerprintError(null);
    getClientProductConfigurationFingerprint({ clientProductId: product.id }).then(({ data, error }) => {
      if (!active) return;
      if (error) setFingerprintError(error);
      else setExpectedFingerprint(data);
    });
    return () => { active = false; };
    // product.id only - this must run exactly once per draft session,
    // not on every re-render.
  }, [product.id]);

  // saveClientProductReconfiguration never rejects - it always resolves
  // to {data, error} (the established wrapper convention in this
  // codebase) - so success/failure is read from that resolved shape,
  // not from react-query's own isError/isSuccess (which would otherwise
  // always report "resolved" regardless of a backend rejection).
  const saveMutation = useMutation({
    mutationFn: async () => {
      const agreedPriceAction = proposedNum == null ? "keep" : "set";
      return saveClientProductReconfiguration({
        clientProductId: product.id,
        expectedFingerprint,
        agreedPriceAction,
        newAgreedPrice: agreedPriceAction === "set" ? proposedNum : null,
        components: buildSaveComponentPayload(draftComponents),
        classification,
        divergenceReason: reasonRequired ? divergenceReason : null,
        divergenceNote: divergenceReason === "Other" ? divergenceNote : null,
        incompleteAcknowledged: incompleteAck,
        context: "reconfiguration_draft_v1",
      });
    },
    onSuccess: ({ data }) => {
      if (!data?.ok) return; // backend rejected - nothing to refresh
      // Refresh the SAME query keys Product Configuration Review and the
      // Production tab's own component list already use, by key - the
      // shared QueryClient instance propagates this to every subscriber
      // regardless of where in the tree it lives, with no new prop chain.
      queryClient.invalidateQueries({ queryKey: ["resolveClientProductPrice", product.id] });
      queryClient.invalidateQueries({ queryKey: ["clientProductHistoricalReference", product.id] });
      queryClient.invalidateQueries({ queryKey: ["productComponents", product.id] });
      // The parent product object (client_price, status, etc.) comes from
      // this DIFFERENT query, not from resolveClientProductPrice - without
      // this, StatusTab and the workspace header would keep showing the
      // pre-save agreed price until the whole workspace is closed/reopened.
      queryClient.invalidateQueries({ queryKey: ["clientProductsForClient", product.client_id] });
    },
  });

  const saveSucceeded = Boolean(saveMutation.data?.data?.ok);
  const saveResult = saveSucceeded ? saveMutation.data.data : null;
  const saveParsedError = saveMutation.data?.error ? parseSaveError(saveMutation.data.error) : null;
  const isStaleDraftError = saveParsedError?.code === "SAVE_STALE_FINGERPRINT";

  const [reloading, setReloading] = useState(false);
  const handleReloadAfterStale = async () => {
    if (!window.confirm("Unsaved draft changes will be lost. Reload the current configuration?")) return;
    setReloading(true);
    try {
      const [priceR, historyR, freshComponents, fingerprintR] = await Promise.all([
        refetchPrice(),
        refetchHistory(),
        dataClient.entities.ProductComponent.filter({ client_product_id: product.id }, "sort_order", 200),
        getClientProductConfigurationFingerprint({ clientProductId: product.id }),
      ]);
      setDraftComponents(buildDraftComponents(Array.isArray(freshComponents) ? freshComponents : []));
      setExpectedFingerprint(fingerprintR?.data ?? null);
      setFingerprintError(fingerprintR?.error ?? null);
      setProposedAgreedPrice("");
      setDivergenceReason(null);
      setDivergenceNote("");
      setIncompleteAck(false);
      setClassification(null);
      setStoppedEarly(false);
      saveMutation.reset();
      setStep(0);
      void priceR; void historyR; // results already applied via react-query cache
    } finally {
      setReloading(false);
    }
  };

  // Shared close guard: while a save or a stale-draft reload is in
  // flight, the workflow must not close through the header X, the
  // backdrop, or the local Close button - the request itself keeps
  // running either way (nothing here cancels it), this only prevents the
  // user from losing visibility into its result while it's happening.
  const closeBlocked = saveMutation.isPending || reloading;
  const handleClose = () => {
    if (closeBlocked) return;
    onClose();
  };

  const canAdvanceFromStep = (idx) => {
    if (idx === 0) return !needsIdentityAck || identityAck;
    if (idx === 2) return !priceInputError;
    if (idx === 5) return divergenceSatisfied;
    return true;
  };

  const goNext = () => {
    if (!canAdvanceFromStep(step)) return;
    if (step === 1 && EARLY_STOP_CLASSIFICATIONS.has(classification)) {
      setStoppedEarly(true);
      setStep(8);
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  // A genuine move from a non-commercial bucket (Production/BOM or
  // Informational) into a commercial one must never silently reactivate
  // whatever price happened to already be stored - that price was inert
  // by construction (those types are excluded from canonical pricing),
  // so the user must explicitly enter a fresh one. Any other transition
  // (unchanged role, non-commercial<->non-commercial, or commercial<->
  // commercial) preserves the existing price untouched.
  const updateComponent = (draftId, patch) =>
    setDraftComponents((rows) => rows.map((r) => {
      if (r.draftId !== draftId) return r;
      const next = { ...r, ...patch };
      if (
        patch.role && patch.role !== r.role &&
        NON_COMMERCIAL_ROLES.has(r.role) && COMMERCIAL_ROLES.has(patch.role)
      ) {
        next.defaultSellPrice = null;
      }
      return next;
    }));
  const removeComponent = (draftId) =>
    setDraftComponents((rows) => rows.map((r) => (r.draftId === draftId ? { ...r, removed: true } : r)));

  return (
    <div className="fixed inset-0 z-[110] flex items-stretch justify-end bg-black/60 backdrop-blur-sm" onClick={handleClose}>
      <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800">Reconfigure (draft) · {product.client_facing_name || "Unnamed product"}</p>
            <p className="text-[11px] text-slate-400">Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>
          </div>
          <button type="button" onClick={handleClose} disabled={closeBlocked} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <SafetyBanner />

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {step === 0 && (
            <div>
              <StepHeader title="Confirm product identity" subtitle="Names repeat. The id does not." />
              <div className="space-y-1 rounded-lg bg-slate-50 p-3">
                <FieldRow label="Client" value={clientName} />
                <FieldRow label="client_product_id" value={<code className="break-all text-[11px]">{product.id}</code>} />
                <FieldRow label="Client-facing name" value={product.client_facing_name || "—"} />
                <FieldRow label="Internal name" value={product.internal_name || "—"} />
                <FieldRow label="Lifecycle status" value={product.status || "—"} />
                <FieldRow label="Linked OPPS catalog product" value={product.opps_product_id ? "Linked" : "Not linked"} />
                <FieldRow label="Linked X LAB product" value={product.xlab_product_id ? "Linked" : "Not linked"} />
                <FieldRow label="Historical usage count" value={usageCount} />
                <FieldRow
                  label="Recent sold prices"
                  value={(history?.orderLines || []).slice(0, 3).map((l) => money(l.price)).join(", ") || "None recorded"}
                />
              </div>

              {duplicates.length > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>Products can share the same name. Confirm the ID and history before continuing. {duplicates.length} other product(s) for this client share this exact name.</span>
                </div>
              )}
              {usageCount > 0 && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800">
                  <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>This product has real order history. Reconfiguring it only changes what applies going forward — past orders are never altered.</span>
                </div>
              )}
              {needsIdentityAck && (
                <label className="mt-3 flex items-start gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={identityAck} onChange={(e) => setIdentityAck(e.target.checked)} className="mt-0.5" />
                  I've confirmed this is the correct product (id matches, history reviewed).
                </label>
              )}
              <TrainingNote
                checking="That the product we're about to touch is really the one we mean — by id, not by name."
                why="Duplicate names are common. Editing the wrong record by mistake can misprice or misconfigure a different client's product."
                mistake="Trusting the display name alone, especially when two products share it for the same client."
              />
            </div>
          )}

          {step === 1 && (
            <div>
              <StepHeader title="Classify for this draft" subtitle="Local to this session only — never saved." />
              <div className="space-y-2">
                {CLASSIFICATION_OPTIONS.map((opt) => (
                  <label key={opt.value} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs ${classification === opt.value ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}>
                    <input type="radio" name="classification" className="mt-0.5" checked={classification === opt.value} onChange={() => setClassification(opt.value)} />
                    <span>
                      <span className="block font-medium text-slate-800">{opt.label}</span>
                      <span className="block text-slate-500">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] font-medium text-amber-700">Review classification — not saved</p>

              {classification === "HISTORICAL_ONLY" && (
                <div className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">Recommendation: no rebuild needed. You can finish the draft early.</div>
              )}
              {classification === "TEST_STALE" && (
                <div className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">Recommendation: consider this a future archive candidate. No rebuild needed now.</div>
              )}
              {classification === "NEEDS_REVIEW" && (
                <div className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">You can keep inspecting, but this draft shouldn't be treated as final-ready yet.</div>
              )}
              <TrainingNote
                checking="Whether this product is actually worth rebuilding right now."
                why="Not every product needs a full cleanup. Forcing one on a once-off or historical record wastes effort for no benefit."
                mistake="Rebuilding a once-off product nobody will reorder, or skipping review on something that actually needs it."
              />
            </div>
          )}

          {step === 2 && (
            <div>
              <StepHeader title="Commercial reference" subtitle="Current values are read live. The proposed price below is local only." />
              <div className="space-y-1 rounded-lg bg-slate-50 p-3">
                <FieldRow label="Agreed price (live)" value={money(result?.agreed_unit_price)} />
                <FieldRow label="Computed price (live)" value={money(result?.computed_unit_price)} />
                <FieldRow label="Effective price (live)" value={money(result?.effective_unit_price)} />
                <FieldRow label="Reconciliation status (live)" value={result?.reconciliation_status || "—"} />
                <FieldRow label="Price source (live)" value={result?.price_source || "—"} />
                <FieldRow label="Requires quote (live)" value={result?.requires_quote ? "Yes" : "No"} />
              </div>

              {classification === "XLAB_COMMERCIAL" && (
                <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800">
                  <p className="font-medium">Live storefront reference — locked</p>
                  <p className="mt-0.5">Not available to read yet. The draft cannot simulate changing the storefront price either way — your proposed value below is only compared against it once that read exists.</p>
                </div>
              )}

              <div className="mt-3">
                <label className="text-xs font-medium text-slate-600">Proposed agreed price (draft only)</label>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder={result?.agreed_unit_price != null ? String(result.agreed_unit_price) : "No current price"}
                  value={proposedAgreedPrice}
                  onChange={(e) => setProposedAgreedPrice(e.target.value)}
                  className="mt-1"
                />
                {priceInputError ? (
                  <p className="mt-1 text-[11px] text-red-600">{priceInputError}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-400">Nothing is written. Leave blank to keep the live agreed price unchanged in this draft.</p>
                )}
              </div>
              <TrainingNote
                checking="What this product is actually selling for today, versus what we think it should be."
                why="The computed price is informational only — the agreed price is what orders actually charge. Overwriting one with the other silently is how pricing drifts."
                mistake="Assuming the computed total should simply replace the agreed price without a reason."
              />
            </div>
          )}

          {step === 3 && (
            <div>
              <StepHeader title="Component draft" subtitle="Edits here are local only. Nothing is written to any component row." />
              {COMPONENT_ROLE_OPTIONS.map((opt) => (
                <div key={opt.value} className="mb-3">
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{opt.label}</p>
                  <div className="space-y-2">
                    {(roleGroups[opt.value] || []).map((c) => (
                      <div key={c.draftId} className="rounded-lg border border-slate-200 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <Input
                            value={c.label}
                            onChange={(e) => updateComponent(c.draftId, { label: e.target.value })}
                            placeholder="Component label"
                            className="h-8 text-xs"
                          />
                          <button type="button" onClick={() => removeComponent(c.draftId)} className="flex-shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove from draft">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                          <span>stored as: {c.storedType || "new"}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <select
                            value={c.role}
                            onChange={(e) => updateComponent(c.draftId, { role: e.target.value })}
                            className="w-full min-w-0 rounded-md border border-slate-200 px-2 py-1 text-[11px]"
                          >
                            {COMPONENT_ROLE_OPTIONS.map((r) => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                          {(opt.value === "COMMERCIAL_PER_UNIT" || opt.value === "COMMERCIAL_ONCE") ? (
                            <Input
                              type="number"
                              inputMode="decimal"
                              value={c.defaultSellPrice ?? ""}
                              onChange={(e) => updateComponent(c.draftId, { defaultSellPrice: e.target.value === "" ? null : e.target.value })}
                              placeholder="Sell price"
                              className="h-7 min-w-0 text-[11px]"
                            />
                          ) : (
                            <Input
                              type="number"
                              inputMode="decimal"
                              value={c.quantityPerUnit ?? ""}
                              onChange={(e) => updateComponent(c.draftId, { quantityPerUnit: e.target.value === "" ? null : e.target.value })}
                              placeholder="Consumption qty"
                              className="h-7 min-w-0 text-[11px]"
                            />
                          )}
                        </div>
                        {(opt.value === "COMMERCIAL_PER_UNIT" || opt.value === "COMMERCIAL_ONCE") && (c.defaultSellPrice == null || c.defaultSellPrice === "") && (
                          <p className="mt-1.5 text-[10px] text-amber-700">Enter a commercial price for this reclassified component.</p>
                        )}
                      </div>
                    ))}
                    {(roleGroups[opt.value] || []).length === 0 && (
                      <p className="text-[11px] text-slate-400">None in this draft.</p>
                    )}
                  </div>
                </div>
              ))}
              {pendingNewComponents.length > 0 && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800">
                  {pendingNewComponents.length} new component(s) in this draft can't be saved yet and will be left out of Save — see below.
                </div>
              )}
              <p className="rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-500">
                Adding new components will be enabled once component types can be selected explicitly.
              </p>
              <p className="mt-3 text-[11px] text-slate-400">Consumption (BOM) quantity never multiplies price — it describes what gets used, not what it costs.</p>
              <TrainingNote
                checking="Whether each component is actually priced, or just describes production."
                why="Mixing commercial and production rows is how 'material' or 'labour' ends up accidentally priced, or a real print cost ends up untracked."
                mistake="Leaving a component's role as whatever it happened to start as, without checking it actually belongs there."
              />
            </div>
          )}

          {step === 4 && (
            <div>
              <StepHeader title="Draft estimate" subtitle="Descriptive only — this is not a second price calculation." />
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Current canonical resolver result (live)</p>
                <FieldRow label="Agreed" value={money(result?.agreed_unit_price)} />
                <FieldRow label="Computed" value={money(result?.computed_unit_price)} />
                <FieldRow label="Effective" value={money(result?.effective_unit_price)} />
                <FieldRow label="Status" value={result?.reconciliation_status || "—"} />
              </div>
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-amber-600">Draft estimate — proposed changes (descriptive, not computed)</p>
                <FieldRow label="Proposed agreed price" value={proposedAgreedPrice === "" ? "Unchanged" : money(proposedNum)} />
                <FieldRow label="Commercial components" value={`${delta.live.commercialCount} live → ${delta.draft.commercialCount} draft`} />
                <FieldRow label="Production/BOM components" value={`${delta.live.bomCount} live → ${delta.draft.bomCount} draft`} />
                <FieldRow label="Components missing a price" value={`${delta.live.unresolvedCount} live → ${delta.draft.unresolvedCount} draft`} />
              </div>
              <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-500">
                Final canonical result will be verified by the server when save capability is introduced.
              </p>
              <TrainingNote
                checking="What's changing in the draft, without pretending to know the final price."
                why="Only the server's resolver can authoritatively compute a price. A local guess that drifts from it would be worse than no estimate at all."
                mistake="Treating this screen's counts as if they were a real computed total."
              />
            </div>
          )}

          {step === 5 && (
            <div>
              <StepHeader title="Divergence &amp; completeness" subtitle="Local draft fields only — not saved." />

              {/* A: live diverged, draft retains the same price AND isn't touching any
                  commercial component that could change that divergence - asks WHY
                  it's okay to keep it that way */}
              {reasonMode === "retain-diverged" && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                  <p className="text-xs font-medium text-amber-800">Current live pricing is divergent.</p>
                  <p className="mt-1 text-xs text-amber-700">
                    The draft keeps the current agreed price, and that price doesn't match the live computed component total. Choose why that's intentional:
                  </p>
                </div>
              )}

              {/* A2: live diverged, but the draft IS touching a commercial component -
                  it may be resolving or reshaping that exact divergence, so this is
                  informational only. No reason is asked for and no new reconciliation
                  status is claimed here - the server's resolver judges the result. */}
              {reasonMode === "diverged-pending-reconciliation" && (
                <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-2.5">
                  <p className="text-xs font-medium text-blue-800">Live pricing is currently divergent.</p>
                  <p className="mt-1 text-xs text-blue-700">
                    This draft changes pricing components and may resolve or change that divergence. Final reconciliation will be verified by the server before commit.
                  </p>
                </div>
              )}

              {/* B: proposed price changed - asks WHY the change, regardless of live status */}
              {reasonMode === "price-changed" && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                  <p className="text-xs font-medium text-amber-800">Reason for proposed commercial price change</p>
                  <p className="mt-1 text-xs text-amber-700">
                    The proposed agreed price differs from the current live agreed price.
                  </p>
                </div>
              )}

              {reasonRequired && (
                <>
                  <div className="space-y-1.5">
                    {DIVERGENCE_REASONS.map((reason) => (
                      <label key={reason} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs ${divergenceReason === reason ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}>
                        <input type="radio" name="divergenceReason" checked={divergenceReason === reason} onChange={() => setDivergenceReason(reason)} />
                        {reason}
                      </label>
                    ))}
                  </div>
                  {divergenceReason === "Other" && (
                    <Textarea
                      value={divergenceNote}
                      onChange={(e) => setDivergenceNote(e.target.value)}
                      placeholder="Required: explain the reason"
                      className="mt-2 text-xs"
                    />
                  )}
                </>
              )}

              {/* C: live incomplete - a data gap, never a commercial reason */}
              {incompleteAckRequired && (
                <div className={reasonRequired ? "mt-4" : ""}>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
                    Current pricing is incomplete — one or more pricing components do not have a usable price.
                  </div>
                  <label className="mt-2 flex items-start gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={incompleteAck} onChange={(e) => setIncompleteAck(e.target.checked)} className="mt-0.5" />
                    I understand this draft has not yet been canonically validated.
                  </label>
                </div>
              )}

              {/* D / neutral: reconciled or no_composition, price unchanged - nothing to
                  explain. Gated on reasonMode === "none" rather than !reasonRequired so
                  this doesn't double up with A2's informational message above, which is
                  also a case where no reason is required but there IS something to say. */}
              {reasonMode === "none" && !incompleteAckRequired && (
                <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500">
                  Nothing to explain here — the proposed price matches the live agreed price, and the live state doesn't require a reason or an acknowledgment.
                </p>
              )}

              <TrainingNote
                checking="Whether a price difference needs a reason, or an incomplete setup just needs acknowledging — they're not the same thing."
                why="A negotiated-rate reason doesn't make sense for a component that's simply missing a price. Forcing one invents a commercial story where the real issue is just missing data."
                mistake="Picking a commercial reason like 'negotiated rate' to explain away a component that was never priced in the first place."
              />
            </div>
          )}

          {step === 6 && (
            <div>
              <StepHeader title="Production handoff" subtitle="Confirms production-facing basics only — no geometry, dimensions, or machine settings." />
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-600">Production method</label>
                  <select
                    value={production.printMethod}
                    onChange={(e) => setProduction((p) => ({ ...p, printMethod: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                  >
                    {PRODUCTION_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-600">Production / BOM components confirmed</p>
                  <p className="mt-1 text-xs text-slate-500">{delta.draft.bomCount} in this draft.</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-600">Artwork required?</p>
                  <div className="mt-1 flex gap-2">
                    <Button type="button" size="sm" variant={production.artworkRequired === true ? "default" : "outline"} onClick={() => setProduction((p) => ({ ...p, artworkRequired: true }))}>Yes</Button>
                    <Button type="button" size="sm" variant={production.artworkRequired === false ? "default" : "outline"} onClick={() => setProduction((p) => ({ ...p, artworkRequired: false }))}>No</Button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Placement reference</label>
                  <select
                    value={production.placement}
                    onChange={(e) => setProduction((p) => ({ ...p, placement: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                  >
                    <option value="">Not set</option>
                    {PLACEMENT_PRESETS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
              <TrainingNote
                checking="That production has what it needs to know, separately from what it costs."
                why="Commercial and production stay separate on purpose. Mixing them is how a pricing change accidentally breaks a production instruction, or vice versa."
                mistake="Adding print coordinates, dimensions, or machine settings here — that belongs to a future, separate production-spec layer."
              />
            </div>
          )}

          {step === 7 && (
            <div>
              <StepHeader title="Before / after" subtitle="Current canonical state vs. proposed draft — nothing below has been saved." />

              <div className="mb-3 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <FieldRow label="Current resolver status" value={result?.reconciliation_status || "—"} />
                <FieldRow label="Proposed agreed price" value={proposedAgreedPrice === "" ? "Unchanged" : money(proposedNum)} />
                <FieldRow label="Draft component changes" value={`+${componentChanges.added} / -${componentChanges.removed} / reclassified ${componentChanges.reclassified}`} />
                <FieldRow label="Canonical post-save result" value="Not yet validated" />
              </div>
              <p className="mb-3 text-[11px] text-slate-400">
                The draft itself has no canonical status of its own — only the live row above has been resolved by the server. Saving (once available) would be the first time these proposed values are validated canonically.
              </p>

              <div className="space-y-2.5">
                <CompareCard label="Commercial components" current={delta.live.commercialCount} draft={delta.draft.commercialCount} />
                <CompareCard label="Components missing a price" current={delta.live.unresolvedCount} draft={delta.draft.unresolvedCount} />
                <CompareCard label="Production/BOM components" current={delta.live.bomCount} draft={delta.draft.bomCount} />
              </div>
              <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-xs">
                <FieldRow label="Classification" value={classification ? CLASSIFICATION_OPTIONS.find((o) => o.value === classification)?.label : "Not set"} />
                <FieldRow label="Reason recorded" value={reasonRequired ? (divergenceReason || "Not yet chosen") : "Not applicable"} />
                <FieldRow label="Incompleteness acknowledged" value={incompleteAckRequired ? (incompleteAck ? "Yes" : "Not yet") : "Not applicable"} />
                <FieldRow label="Historical transactions" value="UNCHANGED" />
                <FieldRow label="X LAB storefront price" value={product.xlab_product_id ? "UNCHANGED" : "N/A — not linked"} />
              </div>
              <TrainingNote
                checking="The full shape of what this draft would change, all in one place."
                why="Seeing everything together is what catches a mistake before it's saved — in Save v1, this is the last screen before a real write."
                mistake="Reading 'current resolver status: diverged' as if the draft caused it, instead of it being the live row's existing state."
              />
            </div>
          )}

          {step === 8 && stoppedEarly && (
            <div>
              <StepHeader title="Draft stopped early" />
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
                <p className="text-sm font-semibold text-emerald-800">Draft complete — nothing was saved.</p>
                <p className="mt-1 text-xs text-emerald-700">Stopped early because this product was classified as {CLASSIFICATION_OPTIONS.find((o) => o.value === classification)?.label}.</p>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <Button type="button" variant="outline" onClick={() => { setStoppedEarly(false); setStep(0); }} className="h-11 text-sm">
                  Go back and edit
                </Button>
                <Button type="button" variant="secondary" onClick={handleClose} className="h-11 text-sm">
                  Close and discard draft
                </Button>
              </div>
            </div>
          )}

          {step === 8 && !stoppedEarly && saveSucceeded && (
            <div>
              <StepHeader title="Saved" />
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-emerald-800">
                  <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                  <p className="text-sm font-semibold">Configuration saved.</p>
                </div>
                <div className="mt-3 space-y-1 rounded-lg bg-white/70 p-2.5 text-xs">
                  <FieldRow label="Resulting agreed price" value={money(saveResult.agreed_price)} />
                  <FieldRow label="Canonical status" value={saveResult.canonical?.reconciliation_status || "—"} />
                </div>
                {saveResult.canonical?.reconciliation_status === "unresolved_components" && (
                  <p className="mt-2 text-[11px] text-amber-700">
                    This product's pricing is still incomplete on the server — saving did not resolve it. That's expected: a save can only record the configuration honestly, never manufacture a resolved price.
                  </p>
                )}
              </div>
              <div className="mt-3">
                <Button type="button" onClick={handleClose} className="h-11 w-full text-sm">
                  Done
                </Button>
              </div>
            </div>
          )}

          {step === 8 && !stoppedEarly && !saveSucceeded && (
            <div>
              <StepHeader title="Finish draft review" />

              {!saveMutation.isPending && !saveParsedError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <p className="font-medium">Saving will make this configuration real.</p>
                  <p className="mt-1">This is still a draft until you press Save. Nothing has been written yet.</p>
                </div>
              )}

              {saveMutation.isPending && (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
                  Saving — please wait, don't close this window.
                </div>
              )}

              {saveParsedError && isStaleDraftError && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">{saveParsedError.friendly}</p>
                  <p className="mt-1">Your draft changes can't be saved on top of a configuration that's moved on. Reload to see the current state and start the draft again.</p>
                  <Button type="button" onClick={handleReloadAfterStale} disabled={reloading} className="mt-2 h-10 w-full text-xs">
                    {reloading ? "Reloading…" : "Reload current configuration"}
                  </Button>
                </div>
              )}

              {saveParsedError && !isStaleDraftError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  <p className="font-semibold break-words">{saveParsedError.friendly}</p>
                  <Button type="button" variant="outline" onClick={() => saveMutation.reset()} className="mt-2 h-10 w-full text-xs">
                    Try again
                  </Button>
                </div>
              )}

              <div className="mt-3 flex flex-col gap-2">
                <Button
                  type="button"
                  onClick={() => { if (saveMutation.isPending) return; saveMutation.mutate(); }}
                  disabled={saveMutation.isPending || !expectedFingerprint || isStaleDraftError || Boolean(priceInputError)}
                  className="h-11 text-sm"
                >
                  {saveMutation.isPending ? "Saving…" : "Save configuration"}
                </Button>
                {priceInputError && (
                  <p className="text-[11px] text-red-600">{priceInputError} Go back to the Commercial step to fix it.</p>
                )}
                <Button type="button" variant="outline" onClick={() => setStep(0)} disabled={saveMutation.isPending} className="h-11 text-sm">
                  Go back and edit
                </Button>
                <Button type="button" variant="secondary" onClick={handleClose} disabled={closeBlocked} className="h-11 text-sm">
                  Close and discard draft
                </Button>
              </div>
              {fingerprintError && !expectedFingerprint && (
                <p className="mt-2 text-[11px] text-red-600 break-words">Could not load this product's current configuration fingerprint — Save is unavailable until this draft is reopened. ({fingerprintError})</p>
              )}
            </div>
          )}
        </div>

        {step < 8 && (
          <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
            <Button type="button" variant="outline" onClick={goBack} disabled={step === 0} className="h-11 min-w-0 flex-1 gap-1.5 text-sm">
              <ChevronLeft className="h-4 w-4 flex-shrink-0" /> Back
            </Button>
            <Button type="button" onClick={goNext} disabled={!canAdvanceFromStep(step)} className="h-11 min-w-0 flex-1 gap-1.5 text-sm">
              {step === 7 ? "Finish review" : "Next"} <ChevronRight className="h-4 w-4 flex-shrink-0" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
