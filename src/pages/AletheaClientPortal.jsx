import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Lock, CheckCircle, Clock, FileText, DollarSign } from "lucide-react";

export default function AletheaClientPortal() {
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get('id');

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

  if (!project) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">{project.name}</h1>
          <p className="text-slate-600">Welcome, {client?.name}</p>
        </div>

        {/* Progress Overview */}
        <Card className="mb-6 border-0 shadow-lg">
          <CardHeader>
            <CardTitle>Project Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex justify-between text-sm">
              <span className="text-slate-600">Overall Completion</span>
              <span className="font-semibold">{project.progress_percentage || 0}%</span>
            </div>
            <Progress value={project.progress_percentage || 0} className="h-3" />
            
            {project.estimated_completion && (
              <p className="text-sm text-slate-500 mt-3">
                Estimated completion: {new Date(project.estimated_completion).toLocaleDateString()}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Phase Timeline */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">Project Phases</h2>
          
          {phases.map((phase, index) => {
            const isLocked = phase.status === 'locked';
            const isActive = phase.status === 'active';
            const isCompleted = phase.status === 'completed';
            const invoice = invoices.find(i => i.id === phase.linked_invoice_id);
            
            return (
              <Card 
                key={phase.id} 
                className={`border-0 shadow-md ${isLocked ? 'opacity-60' : ''}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    {/* Status Icon */}
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                      isCompleted ? 'bg-green-100' :
                      isActive ? 'bg-blue-100' :
                      'bg-slate-100'
                    }`}>
                      {isCompleted ? <CheckCircle className="w-6 h-6 text-green-600" /> :
                       isActive ? <Clock className="w-6 h-6 text-blue-600" /> :
                       <Lock className="w-6 h-6 text-slate-400" />}
                    </div>

                    {/* Content */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-lg">{phase.name}</h3>
                        <Badge className={
                          isCompleted ? 'bg-green-100 text-green-700' :
                          isActive ? 'bg-blue-100 text-blue-700' :
                          'bg-slate-100 text-slate-700'
                        }>
                          {isCompleted ? 'Completed' : isActive ? 'In Progress' : 'Locked'}
                        </Badge>
                      </div>

                      {/* Payment Status */}
                      {phase.payment_required && (
                        <div className="mt-3 p-3 bg-amber-50 rounded-lg flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-amber-600" />
                          <span className="text-sm text-amber-900">
                            {invoice?.payment_status === 'paid' ? 
                              'Payment received ✓' : 
                              'Payment required to unlock this phase'
                            }
                          </span>
                        </div>
                      )}

                      {/* Active Phase Info */}
                      {isActive && (
                        <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                          <p className="text-sm text-blue-900">
                            This phase is currently in progress. We'll notify you when it's complete.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}