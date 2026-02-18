import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Lightbulb, Palette, ShoppingCart, Share2, Mail, Settings, 
  Wrench, ChevronLeft, ChevronRight, User, Users, Clock, FileText
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";

export default function AletheaProjectView() {
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get('id');
  const queryClient = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ['aletheaProject', projectId],
    queryFn: () => base44.entities.AletheaProject.filter({ id: projectId }).then(r => r[0]),
    enabled: !!projectId
  });

  const { data: phases = [] } = useQuery({
    queryKey: ['aletheaPhases', projectId],
    queryFn: () => base44.entities.AletheaPhase.filter({ alethea_project_id: projectId }, 'order'),
    enabled: !!projectId
  });

  const { data: client } = useQuery({
    queryKey: ['client', project?.client_id],
    queryFn: () => base44.entities.Client.filter({ id: project.client_id }).then(r => r[0]),
    enabled: !!project?.client_id
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => base44.entities.Invoice.list('-invoice_date', 200)
  });

  const unlockPhaseMutation = useMutation({
    mutationFn: ({ phaseId }) => 
      base44.entities.AletheaPhase.update(phaseId, { status: 'active' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aletheaPhases'] });
    }
  });

  const phaseColors = [
    { bg: 'from-indigo-600 to-indigo-700', iconBg: 'bg-indigo-600', text: 'text-indigo-400', label: 'text-indigo-400' },
    { bg: 'from-pink-600 to-pink-700', iconBg: 'bg-pink-600', text: 'text-pink-400', label: 'text-pink-400' },
    { bg: 'from-green-600 to-green-700', iconBg: 'bg-green-600', text: 'text-green-400', label: 'text-green-400' },
    { bg: 'from-orange-600 to-orange-700', iconBg: 'bg-orange-600', text: 'text-orange-400', label: 'text-orange-400' },
    { bg: 'from-purple-600 to-purple-700', iconBg: 'bg-purple-600', text: 'text-purple-400', label: 'text-purple-400' },
    { bg: 'from-teal-600 to-teal-700', iconBg: 'bg-teal-600', text: 'text-teal-400', label: 'text-teal-400' },
    { bg: 'from-red-600 to-red-700', iconBg: 'bg-red-600', text: 'text-red-400', label: 'text-red-400' }
  ];

  const phaseIcons = [Lightbulb, Palette, ShoppingCart, Share2, Mail, Settings, Wrench];

  if (!project) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white p-6 flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <div className="max-w-4xl mx-auto pb-24">
        {/* Header */}
        <div className="p-6">
          <Link to={createPageUrl("AletheaBrandOS")}>
            <Button variant="ghost" size="sm" className="text-white hover:bg-[#1A1A1A] mb-4">
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>

        {/* Phases List */}
        <div className="px-6 space-y-3">
          {phases.map((phase, index) => {
            const colors = phaseColors[index % phaseColors.length];
            const Icon = phaseIcons[index % phaseIcons.length];
            
            return (
              <Link key={phase.id} to={createPageUrl(`AletheaProjectView?id=${project.id}&phase=${phase.id}`)}>
                <Card className="bg-[#1A1A1A] border-[#2A2A2A] hover:bg-[#222] transition-all">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      {/* Icon */}
                      <div className={`w-14 h-14 rounded-xl ${colors.iconBg} flex items-center justify-center shrink-0`}>
                        <Icon className="w-7 h-7 text-white" />
                      </div>
                      
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-medium mb-1 ${colors.label}`}>Phase {phase.order}</p>
                            <h3 className="text-white font-semibold text-lg leading-tight">{phase.name}</h3>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-slate-500 mb-1">Week {phase.order}</p>
                            <ChevronRight className="w-5 h-5 text-slate-500 ml-auto" />
                          </div>
                        </div>
                        
                        {/* Progress Bar */}
                        <div className="mt-3">
                          <div className="h-1.5 bg-[#2A2A2A] rounded-full overflow-hidden">
                            <div 
                              className={`h-full bg-gradient-to-r ${colors.bg} transition-all`}
                              style={{ width: `${phase.completion_percentage || 0}%` }}
                            />
                          </div>
                          <p className="text-xs text-slate-500 mt-1 text-right">{phase.completion_percentage || 0}%</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
      
      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0A0A0A] border-t border-[#2A2A2A] lg:pl-64">
        <div className="max-w-4xl mx-auto flex items-center justify-around py-3">
          <Link to={createPageUrl("Dashboard")} className="flex flex-col items-center gap-1 text-slate-400 hover:text-white">
            <Users className="w-5 h-5" />
            <span className="text-xs">Dashboard</span>
          </Link>
          <button className="flex flex-col items-center gap-1 text-indigo-500">
            <FileText className="w-5 h-5" />
            <span className="text-xs">Phases</span>
          </button>
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