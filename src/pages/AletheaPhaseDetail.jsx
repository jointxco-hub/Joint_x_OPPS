import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  ChevronLeft, ChevronDown, ChevronRight, 
  User, Users, Clock, FileText, Flag
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";

export default function AletheaPhaseDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const phaseId = urlParams.get('id');
  const projectId = urlParams.get('project');
  
  const [expandedSections, setExpandedSections] = useState({});

  const { data: phase } = useQuery({
    queryKey: ['aletheaPhase', phaseId],
    queryFn: () => base44.entities.AletheaPhase.filter({ id: phaseId }),
    select: (data) => data[0]
  });

  const { data: project } = useQuery({
    queryKey: ['aletheaProject', projectId],
    queryFn: () => base44.entities.AletheaProject.filter({ id: projectId }),
    select: (data) => data[0],
    enabled: !!projectId
  });

  const { data: steps = [] } = useQuery({
    queryKey: ['aletheaSteps', phaseId],
    queryFn: () => base44.entities.AletheaStep.filter({ phase_id: phaseId }, 'order'),
    enabled: !!phaseId
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['aletheaTasks', phaseId],
    queryFn: async () => {
      const allTasks = [];
      for (const step of steps) {
        const stepTasks = await base44.entities.AletheaTask.filter({ step_id: step.id });
        allTasks.push(...stepTasks);
      }
      return allTasks;
    },
    enabled: steps.length > 0
  });

  const queryClient = useQueryClient();

  const toggleTaskMutation = useMutation({
    mutationFn: async ({ taskId, currentStatus }) => {
      const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
      await base44.entities.AletheaTask.update(taskId, { status: newStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aletheaTasks'] });
      queryClient.invalidateQueries({ queryKey: ['aletheaSteps'] });
    }
  });

  const toggleSection = (stepId) => {
    setExpandedSections(prev => ({
      ...prev,
      [stepId]: !prev[stepId]
    }));
  };

  if (!phase) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  const phaseColors = {
    1: { bg: 'from-indigo-600 to-indigo-700', icon: 'bg-indigo-600/20', text: 'text-indigo-400' },
    2: { bg: 'from-pink-600 to-pink-700', icon: 'bg-pink-600/20', text: 'text-pink-400' },
    3: { bg: 'from-green-600 to-green-700', icon: 'bg-green-600/20', text: 'text-green-400' },
    4: { bg: 'from-orange-600 to-orange-700', icon: 'bg-orange-600/20', text: 'text-orange-400' },
    5: { bg: 'from-purple-600 to-purple-700', icon: 'bg-purple-600/20', text: 'text-purple-400' },
    6: { bg: 'from-teal-600 to-teal-700', icon: 'bg-teal-600/20', text: 'text-teal-400' },
    7: { bg: 'from-red-600 to-red-700', icon: 'bg-red-600/20', text: 'text-red-400' }
  };

  const colors = phaseColors[phase.order] || phaseColors[1];

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white pb-24">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[#0A0A0A] border-b border-[#2A2A2A] p-4 flex items-center justify-between z-10">
          <Link to={createPageUrl(`AletheaProjectView?id=${projectId}`)}>
            <Button variant="ghost" size="sm" className="text-white hover:bg-[#1A1A1A]">
              <ChevronLeft className="w-5 h-5 mr-1" />
            </Button>
          </Link>
          <div className="flex-1 text-center">
            <p className={`text-xs uppercase tracking-wide ${colors.text} mb-1`}>Phase {phase.order}</p>
            <h1 className="text-xl font-bold">{phase.name}</h1>
          </div>
          <div className="w-16 text-right">
            <p className={`text-2xl font-bold ${colors.text}`}>{phase.completion_percentage || 0}%</p>
          </div>
        </div>

        {/* Phase Info Card */}
        <div className="p-4">
          <Card className="bg-[#1A1A1A] border-[#2A2A2A]">
            <CardContent className="p-4">
              <div className="grid grid-cols-3 gap-4 text-center mb-4">
                <div>
                  <User className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                  <p className="text-xs text-slate-400 mb-1">Owner</p>
                  <p className="text-sm font-medium">Creative Director</p>
                </div>
                <div>
                  <Users className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                  <p className="text-xs text-slate-400 mb-1">Support</p>
                  <p className="text-sm font-medium">Graphic Designer</p>
                </div>
                <div>
                  <Clock className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                  <p className="text-xs text-slate-400 mb-1">Timeline</p>
                  <p className="text-sm font-medium">Week {phase.order}</p>
                </div>
              </div>
              
              <div className="pt-4 border-t border-[#2A2A2A] flex items-start gap-2">
                <FileText className="w-4 h-4 text-slate-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-slate-300">Brand Identity Kit Folder</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Objective */}
        <div className="px-4 mb-4">
          <div className="flex items-start gap-3 p-4 bg-[#1A1A1A] rounded-xl border border-[#2A2A2A]">
            <Flag className={`w-5 h-5 ${colors.text} mt-0.5 shrink-0`} />
            <div>
              <h3 className="font-semibold mb-1">Objective</h3>
              <p className="text-sm text-slate-400">
                Define who we sell to, what we sell, why it matters, what we stop doing
              </p>
            </div>
          </div>
        </div>

        {/* Progress Section */}
        <div className="px-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold">Progress</h2>
            <span className={`text-2xl font-bold ${colors.text}`}>{phase.completion_percentage || 0}%</span>
          </div>
          <div className="h-2 bg-[#2A2A2A] rounded-full overflow-hidden">
            <div 
              className={`h-full bg-gradient-to-r ${colors.bg} transition-all`}
              style={{ width: `${phase.completion_percentage || 0}%` }}
            />
          </div>
        </div>

        {/* Deliverables Checklist */}
        <div className="px-4">
          <h2 className="text-lg font-bold mb-3">Deliverables Checklist</h2>
          
          <div className="space-y-3">
            {steps.map((step) => {
              const stepTasks = tasks.filter(t => t.step_id === step.id);
              const completedCount = stepTasks.filter(t => t.status === 'completed').length;
              const isExpanded = expandedSections[step.id];

              return (
                <Card key={step.id} className="bg-[#1A1A1A] border-[#2A2A2A]">
                  <CardContent className="p-0">
                    <button
                      onClick={() => toggleSection(step.id)}
                      className="w-full p-4 flex items-center gap-4 hover:bg-[#222] transition-colors"
                    >
                      <div className={`w-12 h-12 rounded-xl ${colors.icon} flex items-center justify-center shrink-0`}>
                        <div className={`w-6 h-6 rounded-full ${colors.text} flex items-center justify-center text-xs font-bold`}>
                          {completedCount}/{stepTasks.length}
                        </div>
                      </div>
                      
                      <div className="flex-1 text-left">
                        <h3 className="font-semibold">{step.title}</h3>
                        <p className="text-xs text-slate-400">{completedCount}/{stepTasks.length} complete</p>
                      </div>
                      
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-slate-400" />
                      )}
                    </button>

                    {isExpanded && stepTasks.length > 0 && (
                      <div className="border-t border-[#2A2A2A] p-4 space-y-3">
                        <p className="text-sm text-slate-400 mb-3">{step.notes || 'Complete all tasks in this section.'}</p>
                        {stepTasks.map((task) => (
                          <div key={task.id} className="flex items-start gap-3">
                            <Checkbox
                              checked={task.status === 'completed'}
                              onCheckedChange={() => toggleTaskMutation.mutate({
                                taskId: task.id,
                                currentStatus: task.status
                              })}
                              className="mt-1 border-[#3A3A3A] data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                            />
                            <label className="text-sm text-slate-300 flex-1 cursor-pointer">
                              {task.title}
                            </label>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0A0A0A] border-t border-[#2A2A2A] lg:pl-64">
        <div className="max-w-4xl mx-auto flex items-center justify-around py-3">
          <Link to={createPageUrl("Dashboard")} className="flex flex-col items-center gap-1 text-slate-400 hover:text-white">
            <Users className="w-5 h-5" />
            <span className="text-xs">Dashboard</span>
          </Link>
          <Link to={createPageUrl(`AletheaProjectView?id=${projectId}`)} className="flex flex-col items-center gap-1 text-indigo-500">
            <FileText className="w-5 h-5" />
            <span className="text-xs">Phases</span>
          </Link>
          <Link to={createPageUrl("Projects")} className="flex flex-col items-center gap-1 text-slate-400 hover:text-white">
            <Clock className="w-5 h-5" />
            <span className="text-xs">Timeline</span>
          </Link>
          <Link to={createPageUrl("Clients")} className="flex flex-col items-center gap-1 text-slate-400 hover:text-white">
            <Users className="w-5 h-5" />
            <span className="text-xs">Team</span>
          </Link>
        </div>
      </div>
    </div>
  );
}