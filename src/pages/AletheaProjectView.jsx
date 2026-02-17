import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Lock, CheckCircle, Clock, DollarSign, FileText, 
  AlertCircle, ChevronDown, ChevronRight, ArrowLeft
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

  if (!project) {
    return (
      <div className="p-6">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link to={createPageUrl("AletheaBrandOS")}>
          <Button variant="ghost" size="sm" className="mb-3">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Projects
          </Button>
        </Link>
        
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">{project.name}</h1>
            <p className="text-slate-500">{client?.name || 'Client'}</p>
          </div>
          <Badge className={
            project.status === 'active' ? 'bg-green-100 text-green-700' :
            project.status === 'completed' ? 'bg-blue-100 text-blue-700' :
            'bg-orange-100 text-orange-700'
          }>
            {project.status}
          </Badge>
        </div>

        {/* Progress */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
            <span>Overall Progress</span>
            <span>{project.progress_percentage || 0}%</span>
          </div>
          <Progress value={project.progress_percentage || 0} className="h-3" />
        </div>
      </div>

      {/* Phases */}
      <div className="space-y-4">
        {phases.map((phase, index) => {
          const invoice = invoices.find(i => i.id === phase.linked_invoice_id);
          const isLocked = phase.status === 'locked';
          const isActive = phase.status === 'active';
          const isCompleted = phase.status === 'completed';

          return (
            <PhaseCard 
              key={phase.id}
              phase={phase}
              invoice={invoice}
              isLocked={isLocked}
              isActive={isActive}
              isCompleted={isCompleted}
              onUnlock={() => unlockPhaseMutation.mutate({ phaseId: phase.id })}
            />
          );
        })}
      </div>
    </div>
  );
}

function PhaseCard({ phase, invoice, isLocked, isActive, isCompleted, onUnlock }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = isCompleted ? (
    <CheckCircle className="w-5 h-5 text-green-600" />
  ) : isLocked ? (
    <Lock className="w-5 h-5 text-slate-400" />
  ) : (
    <Clock className="w-5 h-5 text-blue-600" />
  );

  const canUnlock = isLocked && phase.payment_required && invoice?.payment_status === 'paid';

  return (
    <Card className={`${isLocked ? 'opacity-60' : ''}`}>
      <CardHeader 
        className="cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {statusIcon}
            <div>
              <CardTitle className="text-lg">{phase.name}</CardTitle>
              <p className="text-sm text-slate-500">Phase {phase.order}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {phase.payment_required && (
              <Badge variant="outline" className="gap-1">
                <DollarSign className="w-3 h-3" />
                Payment Required
              </Badge>
            )}
            {expanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent>
          <div className="space-y-4">
            {/* Payment Info */}
            {phase.payment_required && (
              <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                <div className="flex items-start gap-3">
                  <DollarSign className="w-5 h-5 text-amber-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-amber-900 mb-1">Payment Required</p>
                    <p className="text-sm text-amber-700">
                      Type: {phase.payment_type || 'Full'}
                      {phase.payment_percentage && ` (${phase.payment_percentage}%)`}
                    </p>
                    {invoice && (
                      <div className="mt-2">
                        <Badge className={
                          invoice.payment_status === 'paid' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-red-100 text-red-700'
                        }>
                          {invoice.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Unlock Button */}
            {canUnlock && (
              <Button onClick={onUnlock} className="w-full">
                <Lock className="w-4 h-4 mr-2" />
                Unlock Phase
              </Button>
            )}

            {/* Phase Details */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-slate-500">Unlock Condition:</span>
                <p className="font-medium">{phase.unlock_condition}</p>
              </div>
              {phase.phase_owner_id && (
                <div>
                  <span className="text-slate-500">Phase Owner:</span>
                  <p className="font-medium">Role ID: {phase.phase_owner_id}</p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}