import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, Plus, ArrowLeft, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import { toast } from "sonner";
import { format } from "date-fns";

export default function OnboardingManagement() {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data: onboardings = [] } = useQuery({
    queryKey: ['onboardings'],
    queryFn: () => dataClient.entities.OnboardingFlow.list('-created_date', 100)
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => dataClient.entities.Role.list('-created_date', 100)
  });

  const { data: sops = [] } = useQuery({
    queryKey: ['sops'],
    queryFn: () => dataClient.entities.SOP.list('-created_date', 500)
  });

  const activeOnboardings = onboardings.filter(o => o.status === 'in_progress');
  const completedOnboardings = onboardings.filter(o => o.status === 'completed');

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
            <h1 className="text-2xl font-bold text-slate-900">Onboarding</h1>
            <p className="text-slate-500 mt-1">
              {activeOnboardings.length} in progress • {completedOnboardings.length} completed
            </p>
          </div>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" /> Start Onboarding
          </Button>
        </div>

        {/* Active Onboardings */}
        {activeOnboardings.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">In Progress</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeOnboardings.map(onboarding => (
                <OnboardingCard 
                  key={onboarding.id} 
                  onboarding={onboarding} 
                  roles={roles}
                  sops={sops}
                />
              ))}
            </div>
          </div>
        )}

        {/* Completed Onboardings */}
        {completedOnboardings.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Completed</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {completedOnboardings.map(onboarding => (
                <OnboardingCard 
                  key={onboarding.id} 
                  onboarding={onboarding} 
                  roles={roles}
                  sops={sops}
                />
              ))}
            </div>
          </div>
        )}

        {onboardings.length === 0 && (
          <Card className="p-12 text-center">
            <Users className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-500 mb-4">No onboarding flows yet</p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 mr-2" /> Start First Onboarding
            </Button>
          </Card>
        )}

        {showForm && (
          <OnboardingFormDialog 
            roles={roles}
            sops={sops}
            onClose={() => setShowForm(false)}
          />
        )}
      </div>
    </div>
  );
}

function OnboardingCard({ onboarding, roles, sops }) {
  const queryClient = useQueryClient();
  const role = roles.find(r => r.id === onboarding.role_id);

  const updateMutation = useMutation({
    mutationFn: ({ data }) => dataClient.entities.OnboardingFlow.update(onboarding.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboardings'] });
    }
  });

  const toggleItem = (itemIndex) => {
    const newChecklist = [...(onboarding.checklist_items || [])];
    newChecklist[itemIndex].completed = !newChecklist[itemIndex].completed;
    newChecklist[itemIndex].completed_date = newChecklist[itemIndex].completed 
      ? new Date().toISOString() 
      : null;

    const completedCount = newChecklist.filter(i => i.completed).length;
    const completion = Math.round((completedCount / newChecklist.length) * 100);

    updateMutation.mutate({
      data: {
        checklist_items: newChecklist,
        completion_percentage: completion,
        status: completion === 100 ? 'completed' : 'in_progress'
      }
    });
  };

  return (
    <Card className={onboarding.status === 'completed' ? 'opacity-75' : ''}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{onboarding.team_member_name}</CardTitle>
            <p className="text-sm text-slate-500 mt-1">
              {onboarding.team_member_email}
            </p>
          </div>
          <Badge variant={onboarding.status === 'completed' ? 'default' : 'outline'}>
            {onboarding.status === 'completed' ? 'Completed' : 'In Progress'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {role && (
          <div className="flex items-center gap-2 text-sm">
            <Users className="w-4 h-4 text-slate-400" />
            <span className="text-slate-600">{role.name}</span>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-slate-600">Progress</span>
            <span className="font-semibold">{onboarding.completion_percentage || 0}%</span>
          </div>
          <Progress value={onboarding.completion_percentage || 0} />
        </div>

        <div className="space-y-2">
          {(onboarding.checklist_items || []).slice(0, 3).map((item, i) => {
            const sop = sops.find(s => s.id === item.sop_id);
            return (
              <div 
                key={i}
                className="flex items-start gap-2 cursor-pointer hover:bg-slate-50 p-2 rounded"
                onClick={() => toggleItem(i)}
              >
                {item.completed ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <Circle className="w-5 h-5 text-slate-300 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <p className={`text-sm ${item.completed ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                    {item.title || sop?.title}
                  </p>
                </div>
              </div>
            );
          })}
          {(onboarding.checklist_items || []).length > 3 && (
            <p className="text-xs text-slate-500 pl-7">
              +{(onboarding.checklist_items || []).length - 3} more items
            </p>
          )}
        </div>

        {onboarding.start_date && (
          <p className="text-xs text-slate-500">
            Started {format(new Date(onboarding.start_date), 'MMM d, yyyy')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function OnboardingFormDialog({ roles, sops, onClose }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    team_member_name: "",
    team_member_email: "",
    role_id: "",
    start_date: new Date().toISOString().split('T')[0]
  });

  const createMutation = useMutation({
    mutationFn: (data) => dataClient.entities.OnboardingFlow.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboardings'] });
      toast.success("Onboarding started!");
      onClose();
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    const roleSops = sops.filter(s => s.role_id === formData.role_id && s.is_active);
    const checklist = roleSops.map((sop, i) => ({
      title: sop.title,
      sop_id: sop.id,
      completed: false,
      completed_date: null,
      order: i + 1
    }));

    createMutation.mutate({
      ...formData,
      checklist_items: checklist,
      completion_percentage: 0,
      status: 'in_progress'
    });
  };

  const selectedRole = roles.find(r => r.id === formData.role_id);
  const roleSops = sops.filter(s => s.role_id === formData.role_id && s.is_active);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start Onboarding</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Team Member Name *</Label>
              <Input
                value={formData.team_member_name}
                onChange={(e) => setFormData({...formData, team_member_name: e.target.value})}
                required
              />
            </div>
            <div>
              <Label>Email *</Label>
              <Input
                type="email"
                value={formData.team_member_email}
                onChange={(e) => setFormData({...formData, team_member_email: e.target.value})}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Role *</Label>
              <Select 
                value={formData.role_id} 
                onValueChange={(v) => setFormData({...formData, role_id: v})}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role..." />
                </SelectTrigger>
                <SelectContent>
                  {roles.map(role => (
                    <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Start Date</Label>
              <Input
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData({...formData, start_date: e.target.value})}
              />
            </div>
          </div>

          {selectedRole && (
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-4">
                <h4 className="font-semibold text-blue-900 mb-2">{selectedRole.name}</h4>
                <p className="text-sm text-blue-800 mb-3">{selectedRole.purpose}</p>
                <p className="text-xs text-blue-700">
                  This will create a checklist with {roleSops.length} SOPs for {formData.team_member_name} to complete.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!formData.role_id}>
              Start Onboarding
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
