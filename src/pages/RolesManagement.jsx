import React, { useMemo, useState } from "react";
import { dataClient } from "@/api/dataClient";
import { supabase } from "@/lib/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users, Plus, Crown, Shield, UserCheck, Archive, BookOpen,
  Pencil, Trash2, MessageSquare, ArrowUpCircle, Clock, Wrench,
  CheckCircle2, ChevronDown, ChevronUp, AlertCircle, RefreshCw, Printer
} from "lucide-react";
import { createPageUrl } from "../utils";
import { toast } from "sonner";
import { detectIminPrinter, printIminReceipt } from "@/lib/pos/iminPrinter";

const criticalityColors = {
  critical: "bg-red-100 text-red-700",
  support: "bg-blue-100 text-blue-700",
  optional: "bg-slate-100 text-slate-700"
};

async function listAuthUsersForAdmin() {
  if (!supabase) return [];
  const { data, error } = await supabase.functions.invoke("list-auth-users");
  if (error || data?.error) {
    throw new Error(error?.message || data?.error || "Could not load auth users");
  }
  return Array.isArray(data?.users) ? data.users : [];
}

function mergeDirectoryAndAuthUsers(directoryUsers = [], authUsers = []) {
  const byEmail = new Map();

  directoryUsers.forEach((user) => {
    const email = String(user.email || user.user_email || "").trim().toLowerCase();
    if (!email) return;
    byEmail.set(email, {
      ...user,
      email: user.email || user.user_email,
      name: user.name || user.full_name || user.email || user.user_email,
      source: "directory",
    });
  });

  authUsers.forEach((authUser) => {
    const email = String(authUser.email || "").trim().toLowerCase();
    if (!email) return;
    const existing = byEmail.get(email);
    const authName = authUser.full_name || authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email;

    if (existing) {
      byEmail.set(email, {
        ...existing,
        auth_user_id: existing.auth_user_id || authUser.id,
        last_sign_in_at: authUser.last_sign_in_at,
        confirmed_at: authUser.confirmed_at,
      });
      return;
    }

    byEmail.set(email, {
      id: `auth:${authUser.id}`,
      auth_user_id: authUser.id,
      email: authUser.email,
      user_email: authUser.email,
      full_name: authName,
      name: authName,
      role: authUser.user_metadata?.role || "user",
      is_active: true,
      is_auth_only: true,
      source: "auth",
      created_at: authUser.created_at,
      created_date: authUser.created_at,
      last_sign_in_at: authUser.last_sign_in_at,
      confirmed_at: authUser.confirmed_at,
    });
  });

  return Array.from(byEmail.values()).sort((a, b) =>
    String(a.name || a.email).localeCompare(String(b.name || b.email))
  );
}

function directoryPayloadForUser(user, overrides = {}) {
  return {
    auth_user_id: user.auth_user_id,
    email: user.email || user.user_email,
    full_name: user.full_name || user.name || user.email || user.user_email,
    role: user.role || "user",
    is_active: user.is_active !== false,
    ...overrides,
  };
}

function formatTeamAccessDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function RolesManagement() {
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [settingsTab, setSettingsTab] = useState("team");
  const queryClient = useQueryClient();

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => dataClient.entities.Role.list('-created_date', 100)
  });

  const { data: sops = [] } = useQuery({
    queryKey: ['sops'],
    queryFn: () => dataClient.entities.SOP.list('-created_date', 500)
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => dataClient.entities.User.list('name', 200)
  });

  const { data: authUsers = [], isError: authUsersError, isFetching: authUsersFetching, refetch: refetchAuthUsers } = useQuery({
    queryKey: ['authUsers'],
    queryFn: listAuthUsersForAdmin,
    staleTime: 60_000,
    retry: 1,
  });

  const visibleUsers = useMemo(
    () => mergeDirectoryAndAuthUsers(users, authUsers),
    [users, authUsers]
  );

  const { data: userRoles = [] } = useQuery({
    queryKey: ['userRoles'],
    queryFn: () => dataClient.entities.UserRole.list('-assigned_at', 500)
  });

  const activeRoles = roles.filter(r => r.is_active);

  // Role mutations
  const createRoleMutation = useMutation({
    mutationFn: (data) => dataClient.entities.Role.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setShowRoleForm(false); setEditingRole(null);
      toast.success("Role created!");
    }
  });
  const updateRoleMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.Role.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setShowRoleForm(false); setEditingRole(null);
      toast.success("Role updated!");
    }
  });

  // User mutations
  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.User.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['users'] }); toast.success("User updated"); }
  });
  const createUserMutation = useMutation({
    mutationFn: (data) => dataClient.entities.User.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['authUsers'] });
      toast.success("Person added");
    }
  });

  // UserRole mutations
  const assignRoleMutation = useMutation({
    mutationFn: (data) => dataClient.entities.UserRole.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['userRoles'] }); toast.success("Role assigned"); },
    onError: (err) => toast.error(err?.message || "Could not assign role")
  });
  const removeRoleMutation = useMutation({
    mutationFn: (id) => dataClient.entities.UserRole.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['userRoles'] }); toast.success("Role removed"); }
  });
  const setPrimaryMutation = useMutation({
    mutationFn: async ({ userEmail, assignment }) => {
      const existing = userRoles.filter(r => r.user_email === userEmail);
      await Promise.all(existing.map(r => dataClient.entities.UserRole.update(r.id, { is_primary: r.id === assignment.id })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['userRoles'] }); toast.success("Primary role updated"); }
  });

  // SOP mutations
  const createSOPMutation = useMutation({
    mutationFn: (data) => dataClient.entities.SOP.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sops'] }); toast.success("SOP created!"); }
  });
  const updateSOPMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.SOP.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sops'] }); toast.success("SOP updated!"); }
  });
  const deleteSOPMutation = useMutation({
    mutationFn: (id) => dataClient.entities.SOP.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sops'] }); toast.success("SOP removed"); }
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-2">
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
            <p className="text-slate-500 mt-0.5 text-sm">Team access, roles & standard operating procedures</p>
          </div>
          {settingsTab === "roles" && (
            <Button onClick={() => { setEditingRole(null); setShowRoleForm(true); }}>
              <Plus className="w-4 h-4 mr-2" /> New Role
            </Button>
          )}
          {settingsTab === "sops" && (
            <SOPFormButton roles={activeRoles} onCreate={(data) => createSOPMutation.mutate(data)} />
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200 mb-6">
          {[
            { key: "team", label: "Team Access", icon: Shield },
            { key: "roles", label: "Roles", icon: Users },
            { key: "sops", label: "SOPs", icon: BookOpen },
            { key: "tools", label: "System Tools", icon: Wrench },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setSettingsTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px ${
                settingsTab === t.key ? "border-[#0F9B8E] text-[#0F9B8E]" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Team Access tab */}
        {settingsTab === "team" && (
          <UserRoleAssignments
            users={visibleUsers}
            roles={activeRoles}
            userRoles={userRoles}
            authUsersError={authUsersError}
            authUsersFetching={authUsersFetching}
            onRefreshAuthUsers={() => refetchAuthUsers()}
            onSystemRoleChange={(user, role) => {
              if (user.is_auth_only) {
                createUserMutation.mutate(directoryPayloadForUser(user, { role }));
                return;
              }
              updateUserMutation.mutate({ id: user.id, data: { role } });
            }}
            onRestore={async (user) => {
              if (!window.confirm("Restore OPPS access for " + (user.full_name || user.name || user.email) + "?")) return;
              const authUserId = user.auth_user_id || (String(user.id || "").startsWith("auth:") ? String(user.id).slice(5) : "");
              if (authUserId) {
                const result = await supabase.functions.invoke("manage-user-access", { body: { action: "restore", user_id: authUserId } });
                if (result.error) { toast.error(result.error.message || "Could not restore login access"); return; }
              }
              if (user.is_auth_only) createUserMutation.mutate(directoryPayloadForUser(user, { is_active: true }));
              else updateUserMutation.mutate({ id: user.id, data: { is_active: true } });
              toast.success("OPPS access restored");
            }}
            onDeactivate={async (user) => {
              if (!window.confirm("Revoke OPPS access for " + (user.full_name || user.name || user.email) + "? They will be signed out and unable to sign in until restored.")) return;
              const authUserId = user.auth_user_id || (String(user.id || "").startsWith("auth:") ? String(user.id).slice(5) : "");
              if (authUserId) {
                const result = await supabase.functions.invoke("manage-user-access", { body: { action: "revoke", user_id: authUserId } });
                if (result.error) {
                  toast.error(result.error.message || "Could not revoke login access");
                  return;
                }
              } else if (user.is_auth_only) {
                toast.error("This login has no usable auth ID.");
                return;
              }
              if (user.is_auth_only) createUserMutation.mutate(directoryPayloadForUser(user, { is_active: false }));
              else updateUserMutation.mutate({ id: user.id, data: { is_active: false } });
              toast.success("OPPS access revoked");
            }}
            onInvite={(data) => createUserMutation.mutate(data)}
            onAddToDirectory={(user) => createUserMutation.mutate(directoryPayloadForUser(user))}
            onAssign={async (userEmail, roleKey, user) => {
              if (user?.is_auth_only) {
                await createUserMutation.mutateAsync(directoryPayloadForUser(user));
              }
              assignRoleMutation.mutate({ user_email: userEmail, role_key: roleKey, is_primary: !userRoles.some(r => r.user_email === userEmail) });
            }}
            onRemove={(assignment) => removeRoleMutation.mutate(assignment.id)}
            onPrimary={(userEmail, assignment) => setPrimaryMutation.mutate({ userEmail, assignment })}
          />
        )}

        {/* Roles tab */}
        {settingsTab === "roles" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeRoles.length === 0 && (
              <div className="col-span-2 text-center py-16 text-slate-400">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No roles yet. Click "New Role" to create the first one.</p>
              </div>
            )}
            {activeRoles.map(role => {
              const roleSops = sops.filter(s => s.role_key === role.key && s.is_active !== false);
              return (
                <Card key={role.id} className="hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-[#0F9B8E]" />
                        <CardTitle className="text-lg">{role.name}</CardTitle>
                      </div>
                      <div className="flex items-center gap-2">
                        {role.supports_qbr && <Crown className="w-4 h-4 text-yellow-500" />}
                        <Badge className={criticalityColors[role.criticality]}>{role.criticality}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-xs text-slate-500 font-semibold mb-1">Purpose</p>
                      <p className="text-sm text-slate-700">{role.purpose}</p>
                    </div>
                    {role.success_definition && (
                      <div>
                        <p className="text-xs text-slate-500 font-semibold mb-1">Success Looks Like</p>
                        <p className="text-sm text-slate-700">{role.success_definition}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {role.inputs && (
                        <div>
                          <p className="text-xs text-slate-500 font-semibold mb-1">Inputs</p>
                          <p className="text-xs text-slate-600">{role.inputs}</p>
                        </div>
                      )}
                      {role.outputs && (
                        <div>
                          <p className="text-xs text-slate-500 font-semibold mb-1">Outputs</p>
                          <p className="text-xs text-slate-600">{role.outputs}</p>
                        </div>
                      )}
                    </div>
                    {role.tools && role.tools.length > 0 && (
                      <div>
                        <p className="text-xs text-slate-500 font-semibold mb-1">Tools Used</p>
                        <div className="flex flex-wrap gap-1">
                          {role.tools.map((tool, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{tool}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="pt-3 border-t flex items-center justify-between">
                      <span className="text-xs text-slate-500">{roleSops.length} SOP{roleSops.length !== 1 ? "s" : ""}</span>
                      <Button variant="ghost" size="sm" onClick={() => { setEditingRole(role); setShowRoleForm(true); }}>
                        <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* SOPs tab */}
        {settingsTab === "sops" && (
          <SOPsTab
            roles={activeRoles}
            sops={sops}
            onUpdate={(id, data) => updateSOPMutation.mutate({ id, data })}
            onDelete={(id) => deleteSOPMutation.mutate(id)}
          />
        )}

        {settingsTab === "tools" && (
          <SystemToolsTab />
        )}

        {/* Role form dialog */}
        {showRoleForm && (
          <RoleFormDialog
            role={editingRole}
            onClose={() => { setShowRoleForm(false); setEditingRole(null); }}
            onSubmit={(data) => {
              const payload = {
                ...data,
                key: data.key || data.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
              };
              if (editingRole) {
                updateRoleMutation.mutate({ id: editingRole.id, data: payload });
              } else {
                createRoleMutation.mutate(payload);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── SOPs tab ──────────────────────────────────────────────────────────────────


function SystemToolsTab() {
  const handleTestPosPrinter = async () => {
    const detection = detectIminPrinter();
    const paperWidth = getConfiguredPaperWidth();
    const result = await printIminReceipt({
      type: "test",
      storeName: "OPPS POS PRINTER TEST",
      dateTime: new Date().toLocaleString(),
      status: detection.bridgeName ? `Bridge: ${detection.bridgeName}` : "Bridge: not detected",
      stage: `Paper width: ${paperWidth}mm`,
      lineItems: [
        {
          qty: 1,
          itemName: "If you can read this, iMin printing is working.",
        },
      ],
      footer: "Printed from OPPS",
    }, { paperWidth });

    if (result.ok) {
      toast.success(`Test receipt printed via ${result.bridgeName || detection.bridgeName || "iMin printer"}`);
      return;
    }

    toast.info("iMin printer not detected. No POS test receipt was sent.");
  };

  const detection = detectIminPrinter();
  const paperWidth = getConfiguredPaperWidth();

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Printer className="h-5 w-5 text-[#0F9B8E]" />
          POS Printer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p>Bridge: <span className="font-semibold text-slate-900">{detection.bridgeName || "Not detected"}</span></p>
          <p>Paper width: <span className="font-semibold text-slate-900">{paperWidth}mm</span></p>
        </div>
        <Button type="button" onClick={handleTestPosPrinter} className="rounded-xl">
          <Printer className="h-4 w-4" /> Test POS Printer
        </Button>
      </CardContent>
    </Card>
  );
}

function getConfiguredPaperWidth() {
  if (typeof window === "undefined") return 58;
  return window.localStorage?.getItem("opps:imin-paper-width") === "80" ? 80 : 58;
}
function SOPFormButton({ roles, onCreate }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="w-4 h-4 mr-2" /> New SOP
      </Button>
      {open && (
        <SOPFormDialog
          roles={roles}
          onClose={() => setOpen(false)}
          onSubmit={(data) => { onCreate({ ...data, is_active: true }); setOpen(false); }}
        />
      )}
    </>
  );
}

function SOPsTab({ roles, sops, onUpdate, onDelete }) {
  const [roleFilter, setRoleFilter] = useState("all");
  const [editingSOP, setEditingSOP] = useState(null);

  const activeSops = sops.filter(s => s.is_active !== false);
  const filtered = roleFilter === "all" ? activeSops : activeSops.filter(s => s.role_key === roleFilter);

  // Group by role_key
  const byRole = {};
  filtered.forEach(sop => {
    const key = sop.role_key || "__unassigned__";
    if (!byRole[key]) byRole[key] = [];
    byRole[key].push(sop);
  });

  const roleByKey = Object.fromEntries(roles.map(r => [r.key, r]));

  return (
    <div>
      {/* Role filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setRoleFilter("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
            roleFilter === "all" ? "bg-[#0F9B8E] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          All Roles
        </button>
        {roles.map(r => (
          <button
            key={r.key}
            onClick={() => setRoleFilter(r.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              roleFilter === r.key ? "bg-[#0F9B8E] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {r.name}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No SOPs yet</p>
          <p className="text-xs mt-1">Click "New SOP" to write your first standard operating procedure.</p>
        </div>
      )}

      {/* SOPs grouped by role */}
      {Object.entries(byRole).map(([roleKey, roleSops]) => {
        const role = roleByKey[roleKey];
        return (
          <div key={roleKey} className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-[#0F9B8E]" />
              <h2 className="text-base font-bold text-slate-800">{role?.name || "Unassigned"}</h2>
              <span className="text-xs text-slate-400 ml-1">{roleSops.length} SOP{roleSops.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="space-y-4">
              {roleSops.map(sop => (
                <SOPCard
                  key={sop.id}
                  sop={sop}
                  roleName={role?.name}
                  onEdit={() => setEditingSOP(sop)}
                  onDelete={() => {
                    if (window.confirm(`Remove "${sop.title}"?`)) onDelete(sop.id);
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}

      {editingSOP && (
        <SOPFormDialog
          sop={editingSOP}
          roles={roles}
          onClose={() => setEditingSOP(null)}
          onSubmit={(data) => { onUpdate(editingSOP.id, data); setEditingSOP(null); }}
        />
      )}
    </div>
  );
}

function SOPCard({ sop, roleName, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-start justify-between p-5 pb-3">
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-base font-bold text-slate-900">{sop.title}</h3>
            {sop.criticality && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${criticalityColors[sop.criticality] || "bg-slate-100 text-slate-600"}`}>
                {sop.criticality}
              </span>
            )}
          </div>
          {sop.description && (
            <p className="text-sm text-slate-500 mt-0.5">{sop.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg text-slate-400 hover:text-[#0F9B8E] hover:bg-slate-100 transition-colors"
            title="Edit SOP"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Remove SOP"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Body */}
      {expanded && sop.body && (
        <div className="px-5 pb-5">
          <div className="border-t border-slate-100 pt-4">
            <SOPBody body={sop.body} />
          </div>
        </div>
      )}

      {expanded && !sop.body && (
        <div className="px-5 pb-5">
          <p className="text-sm text-slate-400 italic">No content yet — click Edit to add procedures.</p>
        </div>
      )}

      {sop.video_url && expanded && (
        <div className="px-5 pb-4">
          <a
            href={sop.video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-[#0F9B8E] font-medium hover:underline"
          >
            Watch training video →
          </a>
        </div>
      )}
    </div>
  );
}

const SECTION_ICONS = {
  "role overview": <Users className="w-4 h-4 text-[#0F9B8E]" />,
  "daily duties": <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
  "communication": <MessageSquare className="w-4 h-4 text-blue-500" />,
  "communication rules": <MessageSquare className="w-4 h-4 text-blue-500" />,
  "escalation": <ArrowUpCircle className="w-4 h-4 text-orange-500" />,
  "escalation path": <ArrowUpCircle className="w-4 h-4 text-orange-500" />,
  "tools": <Wrench className="w-4 h-4 text-violet-500" />,
  "tools you'll use": <Wrench className="w-4 h-4 text-violet-500" />,
  "response times": <Clock className="w-4 h-4 text-blue-500" />,
  "rules": <AlertCircle className="w-4 h-4 text-amber-500" />,
};

function SOPBody({ body }) {
  const lines = body.split("\n");
  const sections = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      if (!sections.length) sections.push({ heading: null, lines: [] });
      sections[sections.length - 1].lines.push(line);
    }
  }
  if (current) sections.push(current);

  return (
    <div className="space-y-5">
      {sections.map((section, si) => {
        const icon = section.heading ? SECTION_ICONS[section.heading.toLowerCase()] : null;
        const bodyText = section.lines.join("\n").trim();
        if (!section.heading && !bodyText) return null;
        return (
          <div key={si}>
            {section.heading && (
              <div className="flex items-center gap-2 mb-2">
                {icon || <BookOpen className="w-4 h-4 text-slate-400" />}
                <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide">{section.heading}</h4>
              </div>
            )}
            {bodyText && (
              <div className="space-y-1 pl-1">
                {bodyText.split("\n").map((line, li) => {
                  if (!line.trim()) return <div key={li} className="h-1" />;
                  const isListItem = line.trim().match(/^[-*•]\s+(.+)/) || line.trim().match(/^\d+\.\s+(.+)/);
                  const isHighlight = line.trim().match(/^⚠️|^🔴|^✅|^📌/);
                  if (isListItem) {
                    const text = line.trim().replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "");
                    return (
                      <div key={li} className="flex items-start gap-2 text-sm text-slate-700">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#0F9B8E] flex-shrink-0" />
                        <span>{text}</span>
                      </div>
                    );
                  }
                  if (isHighlight) {
                    return (
                      <div key={li} className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2 font-medium border border-amber-200">
                        {line.trim()}
                      </div>
                    );
                  }
                  return <p key={li} className="text-sm text-slate-700 leading-relaxed">{line.trim()}</p>;
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SOPFormDialog({ sop, roles, onClose, onSubmit }) {
  const [form, setForm] = useState({
    title: sop?.title || "",
    description: sop?.description || "",
    role_key: sop?.role_key || (roles[0]?.key || ""),
    criticality: sop?.criticality || "support",
    body: sop?.body || DEFAULT_SOP_TEMPLATE,
    video_url: sop?.video_url || "",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    onSubmit({ ...form, is_active: true });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{sop ? "Edit SOP" : "New Standard Operating Procedure"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>SOP Title *</Label>
              <Input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. WhatsApp Response Protocol"
                required
              />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={form.role_key} onValueChange={v => setForm({ ...form, role_key: v })}>
                <SelectTrigger><SelectValue placeholder="Select role..." /></SelectTrigger>
                <SelectContent>
                  {roles.map(r => <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Criticality</Label>
              <Select value={form.criticality} onValueChange={v => setForm({ ...form, criticality: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="support">Support</SelectItem>
                  <SelectItem value="optional">Optional</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Short Description</Label>
              <Input
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="One sentence explaining what this SOP covers"
              />
            </div>
          </div>

          <div>
            <Label>SOP Content</Label>
            <p className="text-xs text-slate-500 mb-1.5">
              Use <code className="bg-slate-100 px-1 rounded">## Section Name</code> to create sections. Use <code className="bg-slate-100 px-1 rounded">- item</code> for bullet points.
            </p>
            <Textarea
              value={form.body}
              onChange={e => setForm({ ...form, body: e.target.value })}
              rows={18}
              className="font-mono text-sm"
              placeholder={DEFAULT_SOP_TEMPLATE}
            />
          </div>

          <div>
            <Label>Training Video URL (optional)</Label>
            <Input
              value={form.video_url}
              onChange={e => setForm({ ...form, video_url: e.target.value })}
              placeholder="https://..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{sop ? "Save Changes" : "Create SOP"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const DEFAULT_SOP_TEMPLATE = `## Role Overview
Briefly describe what this role is responsible for and why it matters to the business.

## Daily Duties
- Start each day by checking messages and open orders
- Update order statuses in the system by 12:00pm
- Report any blockers to your manager by end of day

## Communication Rules
- WhatsApp: Reply within 2 hours. Maximum 4 hours. No exceptions during work hours.
- If you are unsure about something — DO NOT guess. Ask your manager or ops admin first.
- Mark messages as "read" only after you have actually acted on them.

## Escalation
If you cannot resolve something within 30 minutes, escalate:
1. First — message the Ops Manager on WhatsApp
2. Still stuck? — Message the Admin directly
Never leave a client waiting more than 4 hours without an update.

## Tools You'll Use
- Joint X OPPS (this app) — for orders, tasks, and updates
- WhatsApp Business — for all client communication
- Google Drive — for files and documents`;

// ── Team Access tab ───────────────────────────────────────────────────────────

function UserRoleAssignments({ users, roles, userRoles, authUsersError, authUsersFetching, onRefreshAuthUsers, onSystemRoleChange, onDeactivate, onRestore, onInvite, onAddToDirectory, onAssign, onRemove, onPrimary }) {
  const [selectedRoles, setSelectedRoles] = useState({});
  const [invite, setInvite] = useState({ email: "", name: "", role: "user" });
  const [showInactive, setShowInactive] = useState(false);

  const activeUsers = users.filter(u => u.is_active !== false);
  const authOnlyCount = activeUsers.filter(u => u.is_auth_only).length;
  const directoryCount = activeUsers.length - authOnlyCount;
  const listedUsers = showInactive ? users : activeUsers;
  const roleByKey = Object.fromEntries(roles.map(r => [r.key, r]));

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-[#0F9B8E]" />
              Team Members
            </CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              {directoryCount} in OPPS directory
              {authOnlyCount ? ` · ${authOnlyCount} auth login${authOnlyCount === 1 ? "" : "s"} not added yet` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setShowInactive(value => !value)}>{showInactive ? "Hide inactive" : "Show inactive"}</Button>
          <Button type="button" variant="outline" size="sm" onClick={onRefreshAuthUsers} disabled={authUsersFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${authUsersFetching ? "animate-spin" : ""}`} />
            Refresh logins
          </Button>
        </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Add person form */}
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">Add person by email</p>
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
              {users.length} team member{users.length !== 1 ? "s" : ""}
            </span>
          </div>
          {authUsersError && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Auth users could not be loaded. Directory users are still shown.
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_1fr_140px_auto]">
            <Input placeholder="Full name" value={invite.name} onChange={e => setInvite({ ...invite, name: e.target.value })} />
            <Input placeholder="email@example.com" value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })} />
            <Select value={invite.role} onValueChange={role => setInvite({ ...invite, role })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="investor">Investor</SelectItem>
                <SelectItem value="onboarding">Onboarding</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              disabled={!invite.email.trim()}
              onClick={() => {
                onInvite({ email: invite.email.trim(), full_name: invite.name.trim() || invite.email.trim(), role: invite.role, is_active: true });
                setInvite({ email: "", name: "", role: "user" });
              }}
            >
              Add
            </Button>
          </div>
        </div>

        {listedUsers.length === 0 ? (
          <p className="text-sm text-slate-500">No users found yet.</p>
        ) : listedUsers.map(user => {
          const email = user.email || user.user_email;
          const assignments = userRoles.filter(r => r.user_email === email);
          const selected = selectedRoles[email] || "";
          const lastSignIn = formatTeamAccessDate(user.last_sign_in_at);
          const confirmedAt = formatTeamAccessDate(user.confirmed_at);
          return (
            <div key={user.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900 truncate">{user.full_name || user.name || email}</p>
                    {user.is_auth_only && (
                      <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                        Auth login
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate">{email}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    {lastSignIn ? (
                      <span>Last signed in {lastSignIn}</span>
                    ) : (
                      <span>No sign-in recorded</span>
                    )}
                    {confirmedAt && <span>Confirmed {confirmedAt}</span>}
                  </div>
                  {user.is_auth_only && (
                    <p className="mt-1 text-xs text-slate-400">Not added to OPPS directory yet. Changing role or archiving will add them.</p>
                  )}
                </div>
                <Select value={user.role || "user"} onValueChange={value => onSystemRoleChange(user, value)}>
                  <SelectTrigger className="w-full lg:w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  {user.is_auth_only && (
                    <Button type="button" variant="outline" size="sm" onClick={() => onAddToDirectory(user)}>
                      Add to directory
                    </Button>
                  )}
                  <Select value={selected} onValueChange={value => setSelectedRoles(s => ({ ...s, [email]: value }))}>
                    <SelectTrigger className="w-full lg:w-52">
                      <SelectValue placeholder="Assign role..." />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map(role => (
                        <SelectItem key={role.id} value={role.key}>{role.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!selected || assignments.some(r => r.role_key === selected)}
                    onClick={() => {
                      onAssign(email, selected, user);
                      setSelectedRoles(s => ({ ...s, [email]: "" }));
                    }}
                  >
                    <UserCheck className="w-4 h-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" onClick={() => onDeactivate(user)} title="Deactivate user">
                    <Archive className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {assignments.length === 0 ? (
                  <span className="text-xs text-slate-400">No operational roles assigned</span>
                ) : assignments.map(assignment => {
                  const role = roleByKey[assignment.role_key];
                  return (
                    <span key={assignment.id} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs">
                      <button type="button" onClick={() => onPrimary(email, assignment)} className={assignment.is_primary ? "text-yellow-600" : "text-slate-400"}>
                        <Crown className="w-3.5 h-3.5" />
                      </button>
                      {role?.name || assignment.role_key}
                      <button type="button" onClick={() => onRemove(assignment)} className="text-slate-400 hover:text-red-600">×</button>
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Role form dialog ──────────────────────────────────────────────────────────

function RoleFormDialog({ role, onClose, onSubmit }) {
  const [formData, setFormData] = useState(role || {
    name: "", purpose: "", success_definition: "",
    inputs: "", outputs: "", tools: [],
    supports_qbr: true, criticality: "support", is_active: true
  });
  const [toolInput, setToolInput] = useState("");

  const addTool = () => {
    if (toolInput.trim()) {
      setFormData({ ...formData, tools: [...(formData.tools || []), toolInput.trim()] });
      setToolInput("");
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? "Edit Role" : "New Role"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); onSubmit(formData); }} className="space-y-4">
          <div>
            <Label>Role Name *</Label>
            <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required />
          </div>
          <div>
            <Label>Purpose (1 sentence) *</Label>
            <Textarea value={formData.purpose} onChange={e => setFormData({ ...formData, purpose: e.target.value })} required rows={2} />
          </div>
          <div>
            <Label>Success Definition</Label>
            <Textarea value={formData.success_definition} onChange={e => setFormData({ ...formData, success_definition: e.target.value })} placeholder="What does success look like in this role?" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Inputs (what they receive)</Label>
              <Textarea value={formData.inputs} onChange={e => setFormData({ ...formData, inputs: e.target.value })} rows={2} />
            </div>
            <div>
              <Label>Outputs (what they deliver)</Label>
              <Textarea value={formData.outputs} onChange={e => setFormData({ ...formData, outputs: e.target.value })} rows={2} />
            </div>
          </div>
          <div>
            <Label>Tools Used</Label>
            <div className="flex gap-2 mb-2">
              <Input value={toolInput} onChange={e => setToolInput(e.target.value)} placeholder="e.g. Adobe Illustrator, Shopify" onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addTool())} />
              <Button type="button" onClick={addTool}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(formData.tools || []).map((tool, i) => (
                <Badge key={i} variant="outline" className="cursor-pointer" onClick={() => setFormData({ ...formData, tools: formData.tools.filter((_, j) => j !== i) })}>
                  {tool} ×
                </Badge>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Criticality</Label>
              <Select value={formData.criticality} onValueChange={v => setFormData({ ...formData, criticality: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="support">Support</SelectItem>
                  <SelectItem value="optional">Optional</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" checked={formData.supports_qbr} onChange={e => setFormData({ ...formData, supports_qbr: e.target.checked })} className="w-4 h-4" />
              <Label className="mb-0">Supports QBR</Label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{role ? "Update" : "Create"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
