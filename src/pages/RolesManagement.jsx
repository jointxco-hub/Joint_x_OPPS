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
import { Users, Plus, Crown, ArrowLeft, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import { toast } from "sonner";

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
              if (editingRole) {
                updateMutation.mutate({ id: editingRole.id, data });
              } else {
                createMutation.mutate(data);
              }
            }}
          />
        )}
      </div>
    </div>
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
