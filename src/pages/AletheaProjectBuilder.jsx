import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "../utils";
import { toast } from "sonner";

export default function AletheaProjectBuilder() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    name: "",
    client_id: "",
    project_owner_email: "",
    selected_platform: "",
    start_date: "",
    estimated_completion: ""
  });

  const [phases, setPhases] = useState([
    { name: "Discovery & Planning", payment_required: false, payment_type: "deposit" },
    { name: "Design & Strategy", payment_required: true, payment_type: "deposit" },
    { name: "Development", payment_required: true, payment_type: "percentage" },
    { name: "Testing & Launch", payment_required: false, payment_type: "full" }
  ]);

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list('name', 200)
  });

  const createProjectMutation = useMutation({
    mutationFn: async (data) => {
      const project = await base44.entities.AletheaProject.create(data.projectData);
      
      for (let i = 0; i < data.phases.length; i++) {
        await base44.entities.AletheaPhase.create({
          ...data.phases[i],
          alethea_project_id: project.id,
          order: i + 1,
          status: i === 0 ? 'active' : 'locked'
        });
      }
      
      return project;
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['aletheaProjects'] });
      toast.success('Project created successfully');
      navigate(createPageUrl(`AletheaProjectView?id=${project.id}`));
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createProjectMutation.mutate({ projectData: formData, phases });
  };

  const addPhase = () => {
    setPhases([...phases, { 
      name: "", 
      payment_required: false, 
      payment_type: "full" 
    }]);
  };

  const removePhase = (index) => {
    setPhases(phases.filter((_, i) => i !== index));
  };

  const updatePhase = (index, field, value) => {
    const updated = [...phases];
    updated[index][field] = value;
    setPhases(updated);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link to={createPageUrl("AletheaBrandOS")}>
        <Button variant="ghost" size="sm" className="mb-6">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      </Link>

      <h1 className="text-3xl font-bold mb-6">Create Alethea Project</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Project Details */}
        <Card>
          <CardHeader>
            <CardTitle>Project Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Project Name *</Label>
              <Input
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Brand Launch 2024"
              />
            </div>

            <div>
              <Label>Client *</Label>
              <Select 
                required
                value={formData.client_id} 
                onValueChange={(v) => setFormData({ ...formData, client_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                />
              </div>
              <div>
                <Label>Estimated Completion</Label>
                <Input
                  type="date"
                  value={formData.estimated_completion}
                  onChange={(e) => setFormData({ ...formData, estimated_completion: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>Platform/Service</Label>
              <Input
                value={formData.selected_platform}
                onChange={(e) => setFormData({ ...formData, selected_platform: e.target.value })}
                placeholder="e.g., Full Branding, Social Media, Website"
              />
            </div>
          </CardContent>
        </Card>

        {/* Phases */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Project Phases</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addPhase}>
                <Plus className="w-4 h-4 mr-2" />
                Add Phase
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {phases.map((phase, index) => (
              <div key={index} className="p-4 border rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Phase {index + 1}</Label>
                  {phases.length > 1 && (
                    <Button 
                      type="button"
                      variant="ghost" 
                      size="sm" 
                      onClick={() => removePhase(index)}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  )}
                </div>

                <Input
                  required
                  placeholder="Phase name"
                  value={phase.name}
                  onChange={(e) => updatePhase(index, 'name', e.target.value)}
                />

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={phase.payment_required}
                      onChange={(e) => updatePhase(index, 'payment_required', e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Payment Required</span>
                  </label>

                  {phase.payment_required && (
                    <Select 
                      value={phase.payment_type}
                      onValueChange={(v) => updatePhase(index, 'payment_type', v)}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full">Full Payment</SelectItem>
                        <SelectItem value="deposit">Deposit</SelectItem>
                        <SelectItem value="percentage">Percentage</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Button type="submit" className="w-full" disabled={createProjectMutation.isPending}>
          {createProjectMutation.isPending ? 'Creating...' : 'Create Project'}
        </Button>
      </form>
    </div>
  );
}