import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Sparkles, Rocket } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "../utils";
import { toast } from "sonner";

export default function AletheaProjectBuilder() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    name: "",
    client_id: "",
    business_model: "ecommerce",
    package_type: "full_os",
    total_project_value: "",
    start_date: "",
    estimated_completion: ""
  });

  const [useTemplate, setUseTemplate] = useState(true);

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => dataClient.entities.Client.list('name', 200)
  });

  const createProjectMutation = useMutation({
    mutationFn: async (data) => {
      const project = await dataClient.entities.AletheaProject.create({
        ...data,
        status: 'draft',
        client_portal_enabled: true,
        selected_platform: 'not_selected'
      });
      
      // Auto-create default phases if using template
      if (useTemplate) {
        const defaultPhases = [
          { name: "Strategy Deep Dive", order: 1, status: 'active' },
          { name: "Identity & Branding", order: 2, status: 'locked', payment_required: true, payment_type: 'deposit' },
          { name: "Sample Production", order: 3, status: 'locked' },
          { name: "Content Creation", order: 4, status: 'locked', payment_required: true, payment_type: 'percentage', payment_percentage: 50 },
          { name: "Website Build", order: 5, status: 'locked' },
          { name: "Platform Testing", order: 6, status: 'locked' },
          { name: "Launch & Scale", order: 7, status: 'locked', payment_required: true, payment_type: 'full' }
        ];

        for (const phase of defaultPhases) {
          await dataClient.entities.AletheaPhase.create({
            ...phase,
            alethea_project_id: project.id,
            unlock_condition: phase.payment_required ? 'payment' : 'auto'
          });
        }
      }
      
      return project;
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['aletheaProjects'] });
      toast.success('Project created! Now complete the strategy intake.');
      navigate(createPageUrl(`AletheaProjectView?id=${project.id}`));
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createProjectMutation.mutate(formData);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link to={createPageUrl("AletheaBrandOS")}>
        <Button variant="ghost" size="sm" className="mb-6">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      </Link>

      <div className="mb-8 text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-pink-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Create Alethea Project</h1>
        <p className="text-slate-600">Set up a new brand execution project</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Template Option */}
        <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-50 to-pink-50">
          <CardContent className="p-6">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={useTemplate}
                onChange={(e) => setUseTemplate(e.target.checked)}
                className="w-5 h-5 mt-0.5"
              />
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Rocket className="w-5 h-5 text-purple-600" />
                  <p className="font-semibold text-purple-900">Activate Alethea OS™ Template</p>
                </div>
                <p className="text-sm text-purple-700">
                  Auto-load default phases, forms, and team roles. Recommended for full brand projects.
                </p>
              </div>
            </label>
          </CardContent>
        </Card>

        {/* Project Details */}
        <Card>
          <CardHeader>
            <CardTitle>Project Details</CardTitle>
            <CardDescription>Basic information about the project</CardDescription>
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
                <Label>Business Model *</Label>
                <Select 
                  value={formData.business_model} 
                  onValueChange={(v) => setFormData({ ...formData, business_model: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ecommerce">Ecommerce</SelectItem>
                    <SelectItem value="non_ecommerce">Non-Ecommerce</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Package Type *</Label>
                <Select 
                  value={formData.package_type} 
                  onValueChange={(v) => setFormData({ ...formData, package_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strategy">Strategy Only</SelectItem>
                    <SelectItem value="content_week">Content Week</SelectItem>
                    <SelectItem value="website">Website Build</SelectItem>
                    <SelectItem value="full_os">Full OS</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Total Project Value (R)</Label>
              <Input
                type="number"
                value={formData.total_project_value}
                onChange={(e) => setFormData({ ...formData, total_project_value: e.target.value })}
                placeholder="e.g., 50000"
              />
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
          </CardContent>
        </Card>

        <Button 
          type="submit" 
          className="w-full h-12 text-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700" 
          disabled={createProjectMutation.isPending}
        >
          {createProjectMutation.isPending ? 'Creating...' : 'Create Project'}
        </Button>
      </form>
    </div>
  );
}
