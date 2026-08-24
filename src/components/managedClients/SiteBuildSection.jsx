import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  adminListManagedSiteTemplates,
  adminGetManagedSiteBuild,
  adminUpsertManagedSiteBuild,
  adminGenerateManagedSiteBuildBrief,
  adminGetManagedSiteBuildBriefs,
} from "@/api/managedSiteBuilds";

// Phase 3 - "Site Build" section inside a modern Managed Client's detail
// view (see supabase/migrations/20260825090000_managed_clients_phase3_site_builds.sql).
// Deliberately model-agnostic: admin_generate_managed_site_build_brief is
// pure deterministic SQL string composition over structured Joint X
// data - there is no "Claude-specific" logic here or in the database.
// The generated brief is plain text meant to be pasted into whichever
// coding agent the operator is using. No deploy/Vercel/DNS action exists
// in this phase - only the reviewed build package/brief that will make
// those later actions deterministic.

const REQUIRED_PAGE_SUGGESTIONS = ["Home", "Shop", "About", "Contact", "FAQ", "Quote Request"];
const REQUIRED_FEATURE_SUGGESTIONS = ["Cart", "Checkout", "Size guide", "Wishlist", "Search", "Reviews"];
const INTEGRATION_SUGGESTIONS = ["Commerce catalog", "Quote request", "Contact / WhatsApp", "XOS"];

function TagListEditor({ label, values, onChange, suggestions = [], placeholder }) {
  const [draft, setDraft] = useState("");
  const list = Array.isArray(values) ? values : [];

  function addValue(raw) {
    const v = String(raw || "").trim();
    if (!v || list.includes(v)) return;
    onChange([...list, v]);
    setDraft("");
  }

  return (
    <div>
      <Label className="text-xs text-slate-500">{label}</Label>
      <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
        {list.map((v) => (
          <Badge key={v} variant="outline" className="gap-1 pr-1">
            {v}
            <button type="button" onClick={() => onChange(list.filter((x) => x !== v))} className="ml-1 hover:text-red-600">
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
        {list.length === 0 && <span className="text-xs text-slate-400">None added yet</span>}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addValue(draft);
            }
          }}
        />
        <Button type="button" variant="outline" size="icon" onClick={() => addValue(draft)}><Plus className="w-4 h-4" /></Button>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {suggestions.filter((s) => !list.includes(s)).map((s) => (
            <button key={s} type="button" onClick={() => addValue(s)} className="text-xs text-slate-500 border border-dashed border-slate-300 rounded-full px-2 py-0.5 hover:border-slate-400">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const EMPTY_BUILD_FORM = {
  template_id: "",
  primary_goal: "",
  brand_summary: "",
  target_audience: "",
  visual_direction: "",
  tone_of_voice: "",
  required_pages: [],
  required_features: [],
  integrations: [],
  reference_urls: [],
  content_notes: "",
  product_notes: "",
  technical_notes: "",
  deployment_notes: "",
};

function buildToForm(build) {
  if (!build) return { ...EMPTY_BUILD_FORM };
  return {
    template_id: build.template_id || "",
    primary_goal: build.primary_goal || "",
    brand_summary: build.brand_summary || "",
    target_audience: build.target_audience || "",
    visual_direction: build.visual_direction || "",
    tone_of_voice: build.tone_of_voice || "",
    required_pages: Array.isArray(build.required_pages) ? build.required_pages : [],
    required_features: Array.isArray(build.required_features) ? build.required_features : [],
    integrations: Array.isArray(build.integrations) ? build.integrations : [],
    reference_urls: Array.isArray(build.reference_urls) ? build.reference_urls : [],
    content_notes: build.content_notes || "",
    product_notes: build.product_notes || "",
    technical_notes: build.technical_notes || "",
    deployment_notes: build.deployment_notes || "",
  };
}

// Patch-style: only fields that differ from the loaded original are
// sent, matching the WorkspaceFormDialog convention (src/lib/managedClientForms.js)
// - avoids silently rewriting an untouched field.
function diffBuildForm(current, original) {
  const updates = {};
  Object.keys(current).forEach((key) => {
    const curVal = JSON.stringify(current[key]);
    const origVal = JSON.stringify(original ? original[key] : undefined);
    if (curVal !== origVal) {
      updates[key] = current[key] === "" ? null : current[key];
    }
  });
  return updates;
}

function BuildConfigDialog({ open, onOpenChange, tenantId, build, templates }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => buildToForm(build));
  const [originalForm] = useState(() => buildToForm(build));
  const [saving, setSaving] = useState(false);

  const activeTemplates = templates.filter((t) => t.status === "active");
  const setField = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function handleSave() {
    setSaving(true);
    try {
      const updates = build ? diffBuildForm(form, originalForm) : { ...form, template_id: form.template_id || null };
      const { error } = await adminUpsertManagedSiteBuild({ tenantId, input: updates });
      if (error) {
        toast.error(error);
        return;
      }
      toast.success(build ? "Site build configuration updated" : "Site build created");
      queryClient.invalidateQueries({ queryKey: ["managedSiteBuild", tenantId] });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{build ? "Edit Build Configuration" : "Configure Site Build"}</DialogTitle>
        </DialogHeader>

        <div>
          <Label className="text-xs text-slate-500">Site template</Label>
          <Select value={form.template_id || "__none__"} onValueChange={(v) => setField("template_id")(v === "__none__" ? "" : v)}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="No template selected (custom build)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No template (custom build)</SelectItem>
              {activeTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeTemplates.length === 0 && (
            <p className="text-xs text-slate-400 mt-1">No site templates configured yet.</p>
          )}
        </div>

        <div>
          <Label className="text-xs text-slate-500">Primary goal</Label>
          <Textarea className="mt-1" rows={2} value={form.primary_goal} onChange={(e) => setField("primary_goal")(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Brand summary</Label>
          <Textarea className="mt-1" rows={3} value={form.brand_summary} onChange={(e) => setField("brand_summary")(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Target audience</Label>
          <Textarea className="mt-1" rows={2} value={form.target_audience} onChange={(e) => setField("target_audience")(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Visual direction</Label>
          <Textarea className="mt-1" rows={2} value={form.visual_direction} onChange={(e) => setField("visual_direction")(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Tone of voice</Label>
          <Textarea className="mt-1" rows={2} value={form.tone_of_voice} onChange={(e) => setField("tone_of_voice")(e.target.value)} />
        </div>

        <TagListEditor label="Required pages" values={form.required_pages} onChange={setField("required_pages")} suggestions={REQUIRED_PAGE_SUGGESTIONS} placeholder="Add a page and press Enter" />
        <TagListEditor label="Required features" values={form.required_features} onChange={setField("required_features")} suggestions={REQUIRED_FEATURE_SUGGESTIONS} placeholder="Add a feature and press Enter" />
        <TagListEditor label="Integrations" values={form.integrations} onChange={setField("integrations")} suggestions={INTEGRATION_SUGGESTIONS} placeholder="Add an integration and press Enter" />
        <TagListEditor label="Reference URLs" values={form.reference_urls} onChange={setField("reference_urls")} placeholder="https://example.com and press Enter" />

        <div>
          <Label className="text-xs text-slate-500">Content notes</Label>
          <Textarea className="mt-1" rows={2} value={form.content_notes} onChange={(e) => setField("content_notes")(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Product / service notes</Label>
          <Textarea className="mt-1" rows={2} value={form.product_notes} onChange={(e) => setField("product_notes")(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Technical notes</Label>
          <Textarea className="mt-1" rows={2} value={form.technical_notes} onChange={(e) => setField("technical_notes")(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Deployment notes</Label>
          <Textarea className="mt-1" rows={2} value={form.deployment_notes} onChange={(e) => setField("deployment_notes")(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BriefViewDialog({ open, onOpenChange, siteBuildId }) {
  const { data: briefs = [], isLoading } = useQuery({
    queryKey: ["managedSiteBuildBriefs", siteBuildId],
    queryFn: async () => {
      const { data, error } = await adminGetManagedSiteBuildBriefs({ siteBuildId });
      if (error) throw new Error(error);
      return data;
    },
    enabled: open && Boolean(siteBuildId),
  });
  const [selectedVersion, setSelectedVersion] = useState(null);

  const selected = useMemo(() => {
    if (briefs.length === 0) return null;
    if (selectedVersion == null) return briefs[0];
    return briefs.find((b) => b.version === selectedVersion) || briefs[0];
  }, [briefs, selectedVersion]);

  async function handleCopy() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.brief_text);
      toast.success("Build brief copied");
    } catch {
      toast.error("Could not copy - select and copy the text manually");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Build Brief</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : briefs.length === 0 ? (
          <p className="text-sm text-slate-500">No brief has been generated yet.</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <Select value={String(selected?.version)} onValueChange={(v) => setSelectedVersion(Number(v))}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {briefs.map((b) => (
                    <SelectItem key={b.id} value={String(b.version)}>
                      Version {b.version}{b.version === briefs[0].version ? " (latest)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={handleCopy}><Copy className="w-3.5 h-3.5 mr-1.5" /> Copy Build Brief</Button>
            </div>
            <p className="text-xs text-slate-500">Generated {selected?.generated_at ? new Date(selected.generated_at).toLocaleString() : ""} by {selected?.generated_by}</p>
            <pre className="whitespace-pre-wrap text-sm bg-slate-50 rounded-md p-4 border border-slate-200 max-h-[50vh] overflow-y-auto">{selected?.brief_text}</pre>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SiteBuildSection({ row }) {
  const queryClient = useQueryClient();
  const [configOpen, setConfigOpen] = useState(false);
  const [briefViewOpen, setBriefViewOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const isModern = row.source === "modern" || row.source === "both";
  const hasWorkspace = Boolean(row.workspace_id);

  const { data: siteBuildData, isLoading } = useQuery({
    queryKey: ["managedSiteBuild", row.tenant_id],
    queryFn: async () => {
      const { data, error } = await adminGetManagedSiteBuild({ tenantId: row.tenant_id });
      if (error) throw new Error(error);
      return data;
    },
    enabled: isModern && hasWorkspace,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["managedSiteTemplates"],
    queryFn: async () => {
      const { data, error } = await adminListManagedSiteTemplates();
      if (error) throw new Error(error);
      return data;
    },
    enabled: isModern && hasWorkspace,
  });

  if (!isModern) return null;

  const build = siteBuildData?.build || null;

  async function handleGenerate() {
    if (!build) return;
    setGenerating(true);
    try {
      const { error } = await adminGenerateManagedSiteBuildBrief({ siteBuildId: build.id });
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Build brief generated");
      queryClient.invalidateQueries({ queryKey: ["managedSiteBuild", row.tenant_id] });
      queryClient.invalidateQueries({ queryKey: ["managedSiteBuildBriefs", build.id] });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <h3 className="font-semibold mb-3">Site Build</h3>

      {!hasWorkspace ? (
        <p className="text-sm text-slate-500">Set up workspace before configuring the managed site build.</p>
      ) : isLoading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : !build ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">No site build configured yet.</p>
          <Button size="sm" onClick={() => setConfigOpen(true)}>Configure site build</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {build.brief_stale === true && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Build brief out of date - configuration or catalog data has changed since the latest version was generated.
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-500">Template</p>
              <p className="text-slate-800">{build.template?.name || "None (custom build)"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Build status</p>
              <p className="text-slate-800 capitalize">{build.status?.replace(/_/g, " ")}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Brief status</p>
              <p className="text-slate-800">
                {!build.latest_brief ? "Not generated yet" : build.brief_stale ? "Out of date" : "Current"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Brief version</p>
              <p className="text-slate-800">{build.latest_brief?.version || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Last generated</p>
              <p className="text-slate-800">{build.latest_brief?.generated_at ? new Date(build.latest_brief.generated_at).toLocaleString() : "Never"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Readiness</p>
              <p className="text-slate-800 capitalize">{build.readiness?.state?.replace(/_/g, " ")}</p>
            </div>
          </div>

          {Array.isArray(build.readiness?.missing_inputs) && build.readiness.missing_inputs.length > 0 && (
            <div className="text-xs text-slate-500">
              <p className="mb-1">Missing inputs:</p>
              <ul className="list-disc list-inside">
                {build.readiness.missing_inputs.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setConfigOpen(true)}>Edit Build Configuration</Button>
            <Button
              size="sm"
              disabled={generating || build.readiness?.state === "blocked"}
              onClick={handleGenerate}
            >
              {generating ? "Generating..." : build.latest_brief ? "Regenerate Build Brief" : "Generate Build Brief"}
            </Button>
            {build.latest_brief && (
              <Button size="sm" variant="outline" onClick={() => setBriefViewOpen(true)}>View Build Brief</Button>
            )}
          </div>
          {/* No Deploy action exists in this phase - the reviewed build
              brief is the output; deployment/Vercel/DNS are future work. */}
        </div>
      )}

      {configOpen && (
        <BuildConfigDialog open={configOpen} onOpenChange={setConfigOpen} tenantId={row.tenant_id} build={build} templates={templates} />
      )}
      {briefViewOpen && build && (
        <BriefViewDialog open={briefViewOpen} onOpenChange={setBriefViewOpen} siteBuildId={build.id} />
      )}
    </section>
  );
}
