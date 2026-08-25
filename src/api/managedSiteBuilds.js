import { supabase } from "@/lib/supabaseClient";

// Thin RPC wrappers - every RPC (see supabase/migrations/
// 20260827090000_managed_clients_phase3_site_builds.sql) does all
// app-admin authorization and the actual work server-side; this file
// just calls them and normalizes the result/error shape for React
// callers, matching the pattern already used by src/api/managedClients.js.
//
// Every function here requires public.is_app_admin() on the RPC side -
// site templates and site builds are the same class of high-impact,
// admin-only surface as Phase 2's provisioning RPCs.

export async function adminListManagedSiteTemplates() {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  try {
    const { data, error } = await supabase.rpc("admin_list_managed_site_templates");
    if (error) return { data: null, error: error.message };
    return { data: data || [], error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not load site templates." };
  }
}

export async function adminUpsertManagedSiteTemplate({ templateId, input }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!input) return { data: null, error: "Missing template input" };
  try {
    const { data, error } = await supabase.rpc("admin_upsert_managed_site_template", {
      p_template_id: templateId || null,
      p_input: input,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not save site template." };
  }
}

export async function adminArchiveManagedSiteTemplate({ templateId }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!templateId) return { data: null, error: "Missing template id" };
  try {
    const { data, error } = await supabase.rpc("admin_archive_managed_site_template", {
      p_template_id: templateId,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not archive site template." };
  }
}

export async function adminGetManagedSiteBuild({ tenantId }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!tenantId) return { data: null, error: "Missing tenant id" };
  try {
    const { data, error } = await supabase.rpc("admin_get_managed_site_build", {
      p_tenant_id: tenantId,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not load site build." };
  }
}

export async function adminUpsertManagedSiteBuild({ tenantId, input }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!tenantId) return { data: null, error: "Missing tenant id" };
  try {
    const { data, error } = await supabase.rpc("admin_upsert_managed_site_build", {
      p_tenant_id: tenantId,
      p_input: input || {},
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not save site build configuration." };
  }
}

export async function adminGenerateManagedSiteBuildBrief({ siteBuildId }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!siteBuildId) return { data: null, error: "Missing site build id" };
  try {
    const { data, error } = await supabase.rpc("admin_generate_managed_site_build_brief", {
      p_site_build_id: siteBuildId,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not generate build brief." };
  }
}

export async function adminGetManagedSiteBuildBriefs({ siteBuildId }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!siteBuildId) return { data: null, error: "Missing site build id" };
  try {
    const { data, error } = await supabase.rpc("admin_get_managed_site_build_briefs", {
      p_site_build_id: siteBuildId,
    });
    if (error) return { data: null, error: error.message };
    return { data: data || [], error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not load build brief history." };
  }
}
