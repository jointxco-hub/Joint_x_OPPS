import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Plus, Crown, ArrowLeft, Shield, UserCheck, Archive } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";

const criticalityColors = {
  critical: "bg-red-100 text-red-700",
  support: "bg-blue-100 text-blue-700",
  optional: "bg-slate-100 text-slate-700"
};

export default function RolesManagement() {
  const [showForm, setShowForm] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
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

  const { data: authUsers = [], isError: authUsersError } = useQuery({
    queryKey: ['auth-users'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('list-auth-users');
      if (error) throw error;
      return data?.users ?? [];
    },
    staleTime: 60_000,
    retry: 1,
  });

  const { data: userRoles = [] } = useQuery({
    queryKey: ['userRoles'],
    queryFn: () => dataClient.entities.UserRole.list('-assigned_at', 500)
  });

  const activeRoles = roles.filter(r => r.is_active);

  const createMutation = useMutation({
    mutationFn: (data) => dataClient.entities.Role.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setShowForm(false);
      setEditingRole(null);
      toast.success("Role created!");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.Role.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setShowForm(false);
      setEditingRole(null);
      toast.success("Role updated!");
    }
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.User.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success("User updated");
    }
  });

  const createUserMutation = useMutation({
    mutationFn: (data) => dataClient.entities.User.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success("Person added");
    }
  });

  const assignRoleMutation = useMutation({
    mutationFn: (data) => dataClient.entities.UserRole.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userRoles'] });
      toast.success("Role assigned");
    },
    onError: (err) => toast.error(err?.message || "Could not assign role")
  });

  const removeRoleMutation = useMutation({
    mutationFn: (id) => dataClient.entities.UserRole.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userRoles'] });
      toast.success("Role removed");
    }
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async ({ userEmail, assignment }) => {
      const existing = userRoles.filter(r => r.user_email === userEmail);
      await Promise.all(existing.map(r => dataClient.entities.UserRole.update(r.id, { is_primary: r.id === assignment.id })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userRoles'] });
      toast.success("Primary role updated");
    }
  });

  const handleEdit = (role) => {
    setEditingRole(role);
    setShowForm(true);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link to={createPageUrl("Operations")}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-slate-900">Roles & Responsibilities</h1>
            <p className="text-slate-500 mt-1">{activeRoles.length} defined roles</p>
          </div>
          <Button onClick={() => { setEditingRole(null); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-2" /> New Role
          </Button>
        </div>

        <UserRoleAssignments
          users={users}
          authUsers={authUsers}
          authUsersError={authUsersError}
          roles={activeRoles}
          userRoles={userRoles}
          onSystemRoleChange={(user, role) => updateUserMutation.mutate({ id: user.id, data: { role } })}
          onDeactivate={(user) => updateUserMutation.mutate({ id: user.id, data: { is_active: false } })}
          onInvite={(data) => createUserMutation.mutate(data)}
          onAssign={(userEmail, roleKey) => assignRoleMutation.mutate({ user_email: userEmail, role_key: roleKey, is_primary: !userRoles.some(r => r.user_email === userEmail) })}
          onRemove={(assignment) => removeRoleMutation.mutate(assignment.id)}
          onPrimary={(userEmail, assignment) => setPrimaryMutation.mutate({ userEmail, assignment })}
        />

        {/* Roles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeRoles.map(role => {
            const roleSops = sops.filter(s => s.role_id === role.id && s.is_active);
            return (
              <Card key={role.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="w-5 h-5 text-[#0F9B8E]" />
                      <CardTitle className="text-lg">{role.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      {role.supports_qbr && (
                        <Crown className="w-4 h-4 text-yellow-500" />
                      )}
                      <Badge className={criticalityColors[role.criticality]}>
                        {role.criticality}
                      </Badge>
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
                          <Badge key={i} variant="outline" className="text-xs">
                            {tool}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-3 border-t flex items-center justify-between">
                    <span className="text-xs text-slate-500">
                      {roleSops.length} SOPs
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(role)}>
                      Edit
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Role Form Dialog */}
        {showForm && (
          <RoleFormDialog 
            role={editingRole}
            onClose={() => { setShowForm(false); setEditingRole(null); }}
            onSubmit={(data) => {
              const payload = {
                ...data,
                key: data.key || data.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
              };
              if (editingRole) {
                updateMutation.mutate({ id: editingRole.id, data: payload });
              } else {
                createMutation.mutate(payload);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function UserRoleAssignments({ users, authUsers = [], authUsersError, roles, userRoles, onSystemRoleChange, onDeactivate, onInvite, onAssign, onRemove, onPrimary }) {
  const [selectedRoles, setSelectedRoles] = useState({});
  const [invite, setInvite] = useState({ email: "", name: "", role: "user" });
  const profileByEmail = new Map(users.filter(u => u.email || u.user_email).map(u => [String(u.email || u.user_email).toLowerCase(), u]));
  const activeUsers = [
    ...users.filter(u => u.is_active !== false).map(u => ({ ...u, hasProfile: true })),
    ...authUsers
      .filter(auth => auth.email && !profileByEmail.has(String(auth.email).toLowerCase()))
      .map(auth => ({
        id: `auth_${auth.id}`,
        auth_id: auth.id,
        email: auth.email,
        full_name: auth.full_name || auth.user_metadata?.full_name || auth.email,
        role: "user",
        hasProfile: false,
        created_at: auth.created_at,
        last_sign_in_at: auth.last_sign_in_at,
      })),
  ];
  const roleByKey = Object.fromEntries(roles.map(r => [r.key, r]));

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Shield className="w-5 h-5 text-[#0F9B8E]" />
          Admin User Access
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">Add person by email</p>
            {authUsersError ? (
              <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">Deploy list-auth-users to see Supabase Auth accounts</span>
            ) : (
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">{authUsers.length} signed-in accounts found</span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_1fr_140px_auto]">
            <Input placeholder="Full name" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
            <Input placeholder="email@example.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            <Select value={invite.role} onValueChange={(role) => setInvite({ ...invite, role })}>
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
        {activeUsers.length === 0 ? (
          <p className="text-sm text-slate-500">No users found yet.</p>
        ) : activeUsers.map(user => {
          const email = user.email || user.user_email;
          const assignments = userRoles.filter(r => r.user_email === email);
          const selected = selectedRoles[email] || "";
          return (
            <div key={user.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900 truncate">{user.full_name || user.name || email}</p>
                    {!user.hasProfile && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Signed in</span>}
                  </div>
                  <p className="text-xs text-slate-500 truncate">{email}</p>
                </div>
                <Select value={user.role || "user"} disabled={!user.hasProfile} onValueChange={(value) => onSystemRoleChange(user, value)}>
                  <SelectTrigger className="w-full lg:w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Select value={selected} onValueChange={(value) => setSelectedRoles(s => ({ ...s, [email]: value }))}>
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
                    disabled={!user.hasProfile || !selected || assignments.some(r => r.role_key === selected)}
                    onClick={() => {
                      onAssign(email, selected);
                      setSelectedRoles(s => ({ ...s, [email]: "" }));
                    }}
                  >
                    <UserCheck className="w-4 h-4" />
                  </Button>
                  {user.hasProfile ? (
                    <Button type="button" variant="ghost" size="icon" onClick={() => onDeactivate(user)} title="Deactivate user">
                      <Archive className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" onClick={() => onInvite({ email, full_name: user.full_name || email, role: "user", is_active: true })}>
                      Create profile
                    </Button>
                  )}
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
                      <button type="button" onClick={() => onRemove(assignment)} className="text-slate-400 hover:text-red-600">x</button>
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

function RoleFormDialog({ role, onClose, onSubmit }) {
  const [formData, setFormData] = useState(role || {
    name: "",
    purpose: "",
    success_definition: "",
    inputs: "",
    outputs: "",
    tools: [],
    supports_qbr: true,
    criticality: "support",
    is_active: true
  });

  const [toolInput, setToolInput] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const addTool = () => {
    if (toolInput.trim()) {
      setFormData({
        ...formData,
        tools: [...(formData.tools || []), toolInput.trim()]
      });
      setToolInput("");
    }
  };

  const removeTool = (index) => {
    setFormData({
      ...formData,
      tools: formData.tools.filter((_, i) => i !== index)
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? 'Edit Role' : 'New Role'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Role Name *</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              required
            />
          </div>

          <div>
            <Label>Purpose (1 sentence) *</Label>
            <Textarea
              value={formData.purpose}
              onChange={(e) => setFormData({...formData, purpose: e.target.value})}
              required
              rows={2}
            />
          </div>

          <div>
            <Label>Success Definition</Label>
            <Textarea
              value={formData.success_definition}
              onChange={(e) => setFormData({...formData, success_definition: e.target.value})}
              placeholder="What does success look like in this role?"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Inputs (what they receive)</Label>
              <Textarea
                value={formData.inputs}
                onChange={(e) => setFormData({...formData, inputs: e.target.value})}
                rows={2}
              />
            </div>
            <div>
              <Label>Outputs (what they deliver)</Label>
              <Textarea
                value={formData.outputs}
                onChange={(e) => setFormData({...formData, outputs: e.target.value})}
                rows={2}
              />
            </div>
          </div>

          <div>
            <Label>Tools Used</Label>
            <div className="flex gap-2 mb-2">
              <Input
                value={toolInput}
                onChange={(e) => setToolInput(e.target.value)}
                placeholder="e.g. Adobe Illustrator, Shopify"
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTool())}
              />
              <Button type="button" onClick={addTool}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(formData.tools || []).map((tool, i) => (
                <Badge key={i} variant="outline" className="cursor-pointer" onClick={() => removeTool(i)}>
                  {tool} ×
                </Badge>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Criticality</Label>
              <Select value={formData.criticality} onValueChange={(v) => setFormData({...formData, criticality: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="support">Support</SelectItem>
                  <SelectItem value="optional">Optional</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input
                type="checkbox"
                checked={formData.supports_qbr}
                onChange={(e) => setFormData({...formData, supports_qbr: e.target.checked})}
                className="w-4 h-4"
              />
              <Label className="mb-0">Supports QBR</Label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{role ? 'Update' : 'Create'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
