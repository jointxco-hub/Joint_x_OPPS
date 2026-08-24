import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  adminListManagedSiteTemplates,
  adminUpsertManagedSiteTemplate,
  adminArchiveManagedSiteTemplate,
} from "@/api/managedSiteBuilds";

// Internal app-admin registry for reusable managed-site templates (see
// supabase/migrations/20260825090000_managed_clients_phase3_site_builds.sql).
// Metadata only - repository/preview URLs and build instructions, never
// tokens/secrets/credentials. Reused across every managed brand's Site
// Build configuration (src/components/managedClients/SiteBuildSection.jsx)
// - a template lives here once, not duplicated per site build.
//
// Recovery note: no authoritative prior template registry could be
// recovered from repo history or the local Joint X workspace archive
// (see the migration's own header note), so this registry starts empty
// by design - no fabricated template rows are seeded.

const EMPTY_FORM = {
  template_key: "",
  name: "",
  description: "",
  supported_site_types: "",
  repository_url: "",
  preview_url: "",
  framework: "",
  build_instructions: "",
};

function templateToForm(t) {
  if (!t) return { ...EMPTY_FORM };
  return {
    template_key: t.template_key || "",
    name: t.name || "",
    description: t.description || "",
    supported_site_types: (t.supported_site_types || []).join(", "),
    repository_url: t.repository_url || "",
    preview_url: t.preview_url || "",
    framework: t.framework || "",
    build_instructions: t.build_instructions || "",
  };
}

function TemplateFormDialog({ open, onOpenChange, template }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => templateToForm(template));
  const [saving, setSaving] = useState(false);
  const setField = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function handleSave() {
    setSaving(true);
    try {
      const input = {
        template_key: form.template_key.trim(),
        name: form.name.trim(),
        description: form.description || null,
        supported_site_types: form.supported_site_types.split(",").map((s) => s.trim()).filter(Boolean),
        repository_url: form.repository_url || null,
        preview_url: form.preview_url || null,
        framework: form.framework || null,
        build_instructions: form.build_instructions || null,
      };
      const { error } = await adminUpsertManagedSiteTemplate({ templateId: template?.id || null, input });
      if (error) {
        toast.error(error);
        return;
      }
      toast.success(template ? "Template updated" : "Template created");
      queryClient.invalidateQueries({ queryKey: ["managedSiteTemplates"] });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? "Edit Template" : "Add Template"}</DialogTitle>
        </DialogHeader>
        <div>
          <Label className="text-xs text-slate-500">Template key</Label>
          <Input className="mt-1" value={form.template_key} onChange={(e) => setField("template_key")(e.target.value)} disabled={Boolean(template)} />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Name</Label>
          <Input className="mt-1" value={form.name} onChange={(e) => setField("name")(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Description</Label>
          <Textarea className="mt-1" rows={2} value={form.description} onChange={(e) => setField("description")(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Supported site types (comma-separated)</Label>
          <Input className="mt-1" value={form.supported_site_types} onChange={(e) => setField("supported_site_types")(e.target.value)} placeholder="Ecommerce, Catalog" />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Repository URL</Label>
          <Input className="mt-1" value={form.repository_url} onChange={(e) => setField("repository_url")(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Preview URL</Label>
          <Input className="mt-1" value={form.preview_url} onChange={(e) => setField("preview_url")(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Framework</Label>
          <Input className="mt-1" value={form.framework} onChange={(e) => setField("framework")(e.target.value)} placeholder="Next.js, Astro, etc." />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Build instructions</Label>
          <Textarea className="mt-1" rows={4} value={form.build_instructions} onChange={(e) => setField("build_instructions")(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.template_key.trim() || !form.name.trim()}>{saving ? "Saving..." : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ManagedSiteTemplates() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);

  const { data: templates = [], isLoading, error, refetch } = useQuery({
    queryKey: ["managedSiteTemplates"],
    queryFn: async () => {
      const { data, error: rpcError } = await adminListManagedSiteTemplates();
      if (rpcError) throw new Error(rpcError);
      return data;
    },
  });

  async function handleArchive(templateId) {
    const { error } = await adminArchiveManagedSiteTemplate({ templateId });
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Template archived");
    queryClient.invalidateQueries({ queryKey: ["managedSiteTemplates"] });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-4 md:p-8">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Manage Site Templates</h1>
            <p className="text-slate-500 mt-1">Reusable site templates for Managed Clients site builds</p>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => refetch()} variant="ghost" size="icon"><RefreshCw className="w-4 h-4" /></Button>
            <Button onClick={() => setAdding(true)}><Plus className="w-4 h-4 mr-2" /> Add template</Button>
          </div>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-xl p-12 text-center text-slate-500">Loading...</div>
        ) : error ? (
          <div className="bg-white rounded-xl p-12 text-center text-red-600">{error.message}</div>
        ) : templates.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center text-slate-500">No site templates configured yet.</div>
        ) : (
          <div className="space-y-3">
            {templates.map((t) => (
              <Card key={t.id} className="border-0 shadow-sm rounded-xl">
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{t.name}</h3>
                      <Badge variant="outline" className={t.status === "active" ? "text-emerald-700 border-emerald-300 bg-emerald-50" : "text-slate-400 border-slate-200"}>{t.status}</Badge>
                    </div>
                    <p className="text-xs text-slate-500">{t.template_key} · {(t.supported_site_types || []).join(", ") || "No site types set"}</p>
                    {t.repository_url && <p className="text-xs text-slate-400">{t.repository_url}</p>}
                    {t.preview_url && <p className="text-xs text-slate-400">Preview: {t.preview_url}</p>}
                    <p className="text-xs text-slate-400">Updated {new Date(t.updated_at).toLocaleDateString()}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => setEditing(t)}>Edit</Button>
                    {t.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => handleArchive(t.id)}>Archive</Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {adding && <TemplateFormDialog open={adding} onOpenChange={setAdding} template={null} />}
      {editing && <TemplateFormDialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)} template={editing} />}
    </div>
  );
}
