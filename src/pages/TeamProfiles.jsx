import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Users, Plus, Pencil, Trash2, CheckCircle, Clock, AlertTriangle, Circle, X
} from "lucide-react";

const deptColors = {
  production: "bg-orange-100 text-orange-700",
  design: "bg-purple-100 text-purple-700",
  sales: "bg-blue-100 text-blue-700",
  operations: "bg-teal-100 text-teal-700",
  management: "bg-slate-100 text-slate-700",
  other: "bg-slate-100 text-slate-500"
};

const statusColors = {
  not_started: "text-slate-400",
  in_progress: "text-blue-500",
  on_hold: "text-orange-400",
  complete: "text-green-500",
  archived: "text-slate-300"
};

const StatusIcon = ({ status }) => {
  if (status === 'complete') return <CheckCircle className={`w-3.5 h-3.5 ${statusColors[status]}`} />;
  if (status === 'in_progress') return <Clock className={`w-3.5 h-3.5 ${statusColors[status]}`} />;
  if (status === 'on_hold') return <AlertTriangle className={`w-3.5 h-3.5 ${statusColors[status]}`} />;
  return <Circle className={`w-3.5 h-3.5 ${statusColors[status]}`} />;
};

export default function TeamProfiles() {
  const [showForm, setShowForm] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const queryClient = useQueryClient();

  const { data: members = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list('-created_date', 100)
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list('-created_date', 100)
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['opsTasks'],
    queryFn: () => base44.entities.OpsTask.list('-created_date', 500)
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 200)
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TeamMember.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['teamMembers'] }); setShowForm(false); toast.success("Team member added!"); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TeamMember.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['teamMembers'] }); setShowForm(false); setEditingMember(null); toast.success("Updated!"); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TeamMember.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['teamMembers'] }); toast.success("Removed!"); }
  });

  const getMemberTasks = (member) => {
    return tasks.filter(t =>
      Array.isArray(t.assigned_to)
        ? t.assigned_to.includes(member.user_email)
        : t.assigned_to === member.user_email
    ).filter(t => t.status !== 'archived');
  };

  const getMemberOrders = (member) => {
    return orders.filter(o =>
      o.client_email === member.user_email ||
      tasks.some(t => t.order_id === o.id && (t.assigned_to || []).includes(member.user_email))
    );
  };

  const viewMember = selectedMember;
  const viewTasks = viewMember ? getMemberTasks(viewMember) : [];
  const pendingTasks = viewTasks.filter(t => t.status !== 'complete');
  const doneTasks = viewTasks.filter(t => t.status === 'complete');

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-6 h-6 text-[#0F9B8E]" />
              Team Profiles
            </h1>
            <p className="text-sm text-slate-500 mt-1">See who's doing what across all operations</p>
          </div>
          <Button
            className="bg-[#0F9B8E] hover:bg-[#0d8a7e]"
            onClick={() => { setEditingMember(null); setShowForm(true); }}
          >
            <Plus className="w-4 h-4 mr-2" /> Add Member
          </Button>
        </div>

        <div className="flex flex-col lg:flex-row gap-5">
          {/* Members Grid */}
          <div className="flex-1">
            {members.length === 0 ? (
              <Card className="border-0 shadow-sm rounded-xl">
                <CardContent className="p-12 text-center">
                  <Users className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-500">No team members yet. Add your first member.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {members.map(member => {
                  const memberTasks = getMemberTasks(member);
                  const pending = memberTasks.filter(t => t.status !== 'complete').length;
                  const done = memberTasks.filter(t => t.status === 'complete').length;
                  const isSelected = selectedMember?.id === member.id;

                  return (
                    <Card
                      key={member.id}
                      className={`border-0 shadow-sm rounded-xl cursor-pointer transition-all hover:shadow-md ${isSelected ? 'ring-2 ring-[#0F9B8E]' : ''}`}
                      onClick={() => setSelectedMember(isSelected ? null : member)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#0F9B8E] to-slate-700 flex items-center justify-center text-white font-bold text-base overflow-hidden flex-shrink-0">
                              {member.avatar_url
                                ? <img src={member.avatar_url} alt={member.full_name} className="w-full h-full object-cover" />
                                : member.full_name?.[0]?.toUpperCase()
                              }
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900">{member.full_name}</p>
                              <p className="text-xs text-slate-500">{member.role}</p>
                              <p className="text-xs text-slate-400">{member.user_email}</p>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={(e) => { e.stopPropagation(); setEditingMember(member); setShowForm(true); }}>
                              <Pencil className="w-3.5 h-3.5 text-slate-400" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(member.id); }}>
                              <Trash2 className="w-3.5 h-3.5 text-red-400" />
                            </Button>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap mb-3">
                          <Badge className={`text-xs border-0 ${deptColors[member.department]}`}>
                            {member.department}
                          </Badge>
                          {!member.is_active && (
                            <Badge className="text-xs bg-slate-100 text-slate-400 border-0">Inactive</Badge>
                          )}
                        </div>

                        {member.skills?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-3">
                            {member.skills.slice(0, 4).map((s, i) => (
                              <span key={i} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">{s}</span>
                            ))}
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100">
                          <div className="text-center">
                            <p className="text-lg font-bold text-orange-600">{pending}</p>
                            <p className="text-xs text-slate-500">Pending</p>
                          </div>
                          <div className="text-center">
                            <p className="text-lg font-bold text-green-600">{done}</p>
                            <p className="text-xs text-slate-500">Done</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Member Detail Panel */}
          {selectedMember && (
            <div className="lg:w-96">
              <Card className="border-0 shadow-sm rounded-xl sticky top-4">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-900">{selectedMember.full_name}'s Tasks</h3>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedMember(null)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Pending Tasks */}
                  {pendingTasks.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">
                        Active ({pendingTasks.length})
                      </p>
                      <div className="space-y-2 max-h-72 overflow-y-auto">
                        {pendingTasks.map(task => (
                          <div key={task.id} className="flex items-start gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                            <StatusIcon status={task.status} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-800 truncate">{task.title}</p>
                              {task.client_name && <p className="text-xs text-slate-500">{task.client_name}</p>}
                              {task.due_date && <p className="text-xs text-slate-400">Due: {task.due_date}</p>}
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {task.production_type && (
                                  <span className="text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">{task.production_type}</span>
                                )}
                                {task.production_stage && (
                                  <span className="text-xs px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded">{task.production_stage}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Done Tasks */}
                  {doneTasks.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">
                        Completed ({doneTasks.length})
                      </p>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {doneTasks.map(task => (
                          <div key={task.id} className="flex items-center gap-2 p-2 bg-green-50 rounded-lg">
                            <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                            <p className="text-xs text-slate-600 line-through truncate">{task.title}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {viewTasks.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-6">No tasks assigned</p>
                  )}

                  {selectedMember.bio && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <p className="text-xs font-semibold text-slate-600 mb-1">Bio</p>
                      <p className="text-xs text-slate-500">{selectedMember.bio}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Form Dialog */}
      {showForm && (
        <MemberFormDialog
          member={editingMember}
          users={users}
          onClose={() => { setShowForm(false); setEditingMember(null); }}
          onSubmit={(data) => {
            if (editingMember) updateMutation.mutate({ id: editingMember.id, data });
            else createMutation.mutate(data);
          }}
        />
      )}
    </div>
  );
}

function MemberFormDialog({ member, users, onClose, onSubmit }) {
  const [formData, setFormData] = useState(member || {
    full_name: "",
    user_email: "",
    role: "",
    department: "production",
    phone: "",
    bio: "",
    avatar_url: "",
    skills: [],
    is_active: true
  });
  const [skillInput, setSkillInput] = useState("");

  const set = (k, v) => setFormData(prev => ({ ...prev, [k]: v }));

  const addSkill = () => {
    if (!skillInput.trim()) return;
    set('skills', [...(formData.skills || []), skillInput.trim()]);
    setSkillInput("");
  };
  const removeSkill = (i) => set('skills', formData.skills.filter((_, idx) => idx !== i));

  const handleSubmit = (e) => { e.preventDefault(); onSubmit(formData); };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{member ? 'Edit Member' : 'Add Team Member'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Full Name *</label>
              <Input value={formData.full_name} onChange={(e) => set('full_name', e.target.value)} required />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Link User Account</label>
              <Select value={formData.user_email} onValueChange={(v) => set('user_email', v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {users.map(u => <SelectItem key={u.id} value={u.email}>{u.full_name || u.email}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                className="mt-1 h-8 text-xs"
                placeholder="Or enter email..."
                value={formData.user_email}
                onChange={(e) => set('user_email', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Role / Title</label>
              <Input value={formData.role} onChange={(e) => set('role', e.target.value)} placeholder="e.g. Print Operator" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Department</label>
              <Select value={formData.department} onValueChange={(v) => set('department', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['production', 'design', 'sales', 'operations', 'management', 'other'].map(d => (
                    <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Phone</label>
            <Input value={formData.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+27..." />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Profile Photo URL</label>
            <Input value={formData.avatar_url} onChange={(e) => set('avatar_url', e.target.value)} placeholder="https://..." />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Bio</label>
            <Textarea value={formData.bio} onChange={(e) => set('bio', e.target.value)} placeholder="Short bio..." rows={2} />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Skills</label>
            <div className="flex gap-2 mb-2">
              <Input
                className="h-8 text-xs"
                placeholder="Add skill..."
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSkill())}
              />
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={addSkill}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {(formData.skills || []).map((s, i) => (
                <Badge key={i} variant="outline" className="text-xs gap-1">
                  {s}
                  <button type="button" onClick={() => removeSkill(i)} className="hover:text-red-500">×</button>
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_active" checked={formData.is_active}
              onChange={(e) => set('is_active', e.target.checked)} />
            <label htmlFor="is_active" className="text-sm text-slate-700">Active team member</label>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{member ? 'Update' : 'Add Member'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}