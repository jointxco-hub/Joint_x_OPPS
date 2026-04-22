import React, { useState, useEffect } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, Save, AlertCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "../utils";
import { toast } from "sonner";

export default function SOPEditor() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const sopId = urlParams.get('id');

  const [formData, setFormData] = useState({
    title: "",
    role_id: "",
    owner_email: "",
    purpose: "",
    when_to_use: "",
    steps: [{ step_number: 1, instruction: "", tips: "" }],
    time_expectation: "",
    common_mistakes: "",
    tools: [],
    supports_qbr: true,
    criticality: "support",
    is_active: true
  });

  const [toolInput, setToolInput] = useState("");

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => dataClient.entities.Role.list('-created_date', 100)
  });

  const { data: existingSop } = useQuery({
    queryKey: ['sop', sopId],
    queryFn: () => sopId ? dataClient.entities.SOP.filter({ id: sopId }).then(r => r[0]) : null,
    enabled: !!sopId
  });

  useEffect(() => {
    if (existingSop) {
      setFormData({
        ...existingSop,
        steps: existingSop.steps?.length > 0 ? existingSop.steps : [{ step_number: 1, instruction: "", tips: "" }]
      });
    }
  }, [existingSop]);

  const createMutation = useMutation({
    mutationFn: (data) => dataClient.entities.SOP.create(data),
    onSuccess: (newSop) => {
      queryClient.invalidateQueries({ queryKey: ['sops'] });
      toast.success("SOP created!");
      navigate(createPageUrl(`SOPView?id=${newSop.id}`));
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.SOP.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sops'] });
      queryClient.invalidateQueries({ queryKey: ['sop', sopId] });
      toast.success("SOP updated!");
      if (sopId) navigate(createPageUrl(`SOPView?id=${sopId}`));
    }
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const submitData = {
      ...formData,
      steps: formData.steps.map((step, i) => ({
        ...step,
        step_number: i + 1
      }))
    };

    if (sopId) {
      updateMutation.mutate({ id: sopId, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const addStep = () => {
    setFormData({
      ...formData,
      steps: [...formData.steps, { step_number: formData.steps.length + 1, instruction: "", tips: "" }]
    });
  };

  const removeStep = (index) => {
    if (formData.steps.length > 1) {
      setFormData({
        ...formData,
        steps: formData.steps.filter((_, i) => i !== index)
      });
    }
  };

  const updateStep = (index, field, value) => {
    const newSteps = [...formData.steps];
    newSteps[index][field] = value;
    setFormData({ ...formData, steps: newSteps });
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
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link to={createPageUrl("SOPLibrary")}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-slate-900">
              {sopId ? 'Edit SOP' : 'New SOP'}
            </h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Why This Matters */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-blue-900 mb-2">Why SOPs Matter</h3>
                  <ul className="text-sm text-blue-800 space-y-1">
                    <li>• Helps collaborators execute consistently</li>
                    <li>• Reduces mistakes and rework</li>
                    <li>• Makes onboarding faster</li>
                    <li>• Protects the business if someone leaves</li>
                    <li>• Increases business value and transferability</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Basic Info */}
          <Card>
            <CardContent className="p-6 space-y-4">
              <div>
                <Label>SOP Title *</Label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData({...formData, title: e.target.value})}
                  placeholder="e.g. Print DTF Transfer on Garment"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Role Owner *</Label>
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
                  <Label>Task Owner Email *</Label>
                  <Input
                    type="email"
                    value={formData.owner_email}
                    onChange={(e) => setFormData({...formData, owner_email: e.target.value})}
                    placeholder="person@jointx.co.za"
                    required
                  />
                  <p className="text-xs text-slate-500 mt-1">Person executing this task</p>
                </div>
              </div>

              <div>
                <Label>Purpose (Why this exists) *</Label>
                <Textarea
                  value={formData.purpose}
                  onChange={(e) => setFormData({...formData, purpose: e.target.value})}
                  placeholder="Describe why this process is important..."
                  required
                  rows={3}
                />
              </div>

              <div>
                <Label>When to Use This</Label>
                <Textarea
                  value={formData.when_to_use}
                  onChange={(e) => setFormData({...formData, when_to_use: e.target.value})}
                  placeholder="When should someone follow this SOP?"
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          {/* Steps */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <Label className="text-base">Step-by-Step Instructions</Label>
                <Button type="button" size="sm" onClick={addStep}>
                  <Plus className="w-4 h-4 mr-1" /> Add Step
                </Button>
              </div>

              <div className="space-y-4">
                {formData.steps.map((step, index) => (
                  <div key={index} className="border border-slate-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#0F9B8E] text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
                        {index + 1}
                      </div>
                      <div className="flex-1 space-y-3">
                        <div>
                          <Label className="text-sm">Instruction</Label>
                          <Textarea
                            value={step.instruction}
                            onChange={(e) => updateStep(index, 'instruction', e.target.value)}
                            placeholder="What needs to be done in this step?"
                            rows={2}
                          />
                        </div>
                        <div>
                          <Label className="text-sm">Tips (optional)</Label>
                          <Input
                            value={step.tips}
                            onChange={(e) => updateStep(index, 'tips', e.target.value)}
                            placeholder="Pro tips, common mistakes to avoid..."
                          />
                        </div>
                      </div>
                      {formData.steps.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeStep(index)}
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Additional Details */}
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Time Expectation</Label>
                  <Input
                    value={formData.time_expectation}
                    onChange={(e) => setFormData({...formData, time_expectation: e.target.value})}
                    placeholder="e.g. 15 minutes, 2 hours"
                  />
                </div>
                <div>
                  <Label>Criticality</Label>
                  <Select 
                    value={formData.criticality} 
                    onValueChange={(v) => setFormData({...formData, criticality: v})}
                  >
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
              </div>

              <div>
                <Label>Common Mistakes</Label>
                <Textarea
                  value={formData.common_mistakes}
                  onChange={(e) => setFormData({...formData, common_mistakes: e.target.value})}
                  placeholder="What mistakes should people avoid?"
                  rows={3}
                />
              </div>

              <div>
                <Label>Tools & Templates</Label>
                <div className="flex gap-2 mb-2">
                  <Input
                    value={toolInput}
                    onChange={(e) => setToolInput(e.target.value)}
                    placeholder="e.g. Heat press, Adobe Illustrator"
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTool())}
                  />
                  <Button type="button" onClick={addTool}>Add</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(formData.tools || []).map((tool, i) => (
                    <Badge 
                      key={i} 
                      variant="outline" 
                      className="cursor-pointer"
                      onClick={() => removeTool(i)}
                    >
                      {tool} ×
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.supports_qbr}
                  onChange={(e) => setFormData({...formData, supports_qbr: e.target.checked})}
                  className="w-4 h-4"
                />
                <Label className="mb-0">Supports Queen Bee Role</Label>
              </div>
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex justify-end gap-3">
            <Link to={createPageUrl("SOPLibrary")}>
              <Button type="button" variant="outline">Cancel</Button>
            </Link>
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {sopId ? 'Update SOP' : 'Create SOP'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
