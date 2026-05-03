import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { supabase } from "@/lib/supabaseClient";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Crown, Users, BookOpen, TrendingUp, AlertCircle,
  CheckCircle2, Clock, Target, RefreshCw, UserMinus
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import { toast } from "sonner";

export default function Operations() {
  const { data: qbrs = [] } = useQuery({
    queryKey: ['qbrs'],
    queryFn: () => dataClient.entities.QBR.list('-created_date', 100)
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => dataClient.entities.Role.list('-created_date', 100)
  });

  const { data: sops = [] } = useQuery({
    queryKey: ['sops'],
    queryFn: () => dataClient.entities.SOP.list('-created_date', 500)
  });

  const { data: onboardings = [] } = useQuery({
    queryKey: ['onboardings'],
    queryFn: () => dataClient.entities.OnboardingFlow.list('-created_date', 100)
  });

  const activeQBR = qbrs.find(q => q.is_active);
  const activeRoles = roles.filter(r => r.is_active);
  const activeSops = sops.filter(s => s.is_active);
  const activeOnboardings = onboardings.filter(o => o.status === 'in_progress');

  // Calculate metrics
  const totalProcesses = activeSops.length;
  const criticalSops = activeSops.filter(s => s.criticality === 'critical').length;
  const sopsWithOwners = activeSops.filter(s => s.owner_email).length;
  const ownershipRate = totalProcesses > 0 ? Math.round((sopsWithOwners / totalProcesses) * 100) : 0;

  const last30Days = new Date();
  last30Days.setDate(last30Days.getDate() - 30);
  const recentlyUpdated = activeSops.filter(s => 
    s.last_verified_date && new Date(s.last_verified_date) > last30Days
  ).length;
  const updateRate = totalProcesses > 0 ? Math.round((recentlyUpdated / totalProcesses) * 100) : 0;

  const avgOnboardingCompletion = activeOnboardings.length > 0
    ? Math.round(activeOnboardings.reduce((sum, o) => sum + (o.completion_percentage || 0), 0) / activeOnboardings.length)
    : 0;

  const operabilityScore = Math.round((ownershipRate + updateRate + avgOnboardingCompletion) / 3);

  const riskSops = activeSops.filter(s => !s.owner_email || !s.last_verified_date);

  const { data: founderDep } = useQuery({
    queryKey: ["founderDependency"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_founder_dependency_score")
        .select("score_pct, founder_tags, total_tags")
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Operations System</h1>
            <p className="text-slate-500 mt-1">Build a business that runs itself</p>
          </div>
          <Button 
            onClick={() => {
              toast.success("Refreshed!");
            }} 
            variant="ghost"
            size="icon"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Operability Score */}
        <Card className="mb-6 bg-gradient-to-br from-[#0F9B8E] to-[#0d8073] text-white border-none">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm mb-1">Business Operability Score</p>
                <h2 className="text-4xl font-bold">{operabilityScore}%</h2>
                <p className="text-white/70 text-sm mt-2">
                  {operabilityScore >= 80 ? "Excellent - Ready to scale" :
                   operabilityScore >= 60 ? "Good - Keep improving" :
                   operabilityScore >= 40 ? "Fair - Needs attention" :
                   "Critical - High owner dependency"}
                </p>
              </div>
              <Target className="w-16 h-16 text-white/30" />
            </div>
          </CardContent>
        </Card>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">Processes Documented</p>
                  <p className="text-2xl font-bold mt-1">{totalProcesses}</p>
                  <p className="text-xs text-slate-500 mt-1">{criticalSops} critical</p>
                </div>
                <BookOpen className="w-8 h-8 text-[#0F9B8E]" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">Ownership Rate</p>
                  <p className="text-2xl font-bold mt-1">{ownershipRate}%</p>
                  <p className="text-xs text-slate-500 mt-1">{sopsWithOwners}/{totalProcesses} owned</p>
                </div>
                <Users className="w-8 h-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">Updated (30d)</p>
                  <p className="text-2xl font-bold mt-1">{updateRate}%</p>
                  <p className="text-xs text-slate-500 mt-1">{recentlyUpdated} updated</p>
                </div>
                <TrendingUp className="w-8 h-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">Avg Onboarding</p>
                  <p className="text-2xl font-bold mt-1">{avgOnboardingCompletion}%</p>
                  <p className="text-xs text-slate-500 mt-1">{activeOnboardings.length} active</p>
                </div>
                <Clock className="w-8 h-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Founder Dependency Score */}
        {founderDep != null && (
          <Card className="mb-6">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <UserMinus className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-semibold text-foreground">Founder Dependency Score</p>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    % of order tags assigned to founder in last 30 days — lower is better
                  </p>
                  <div className="flex items-end gap-3">
                    <span className={`text-3xl font-bold ${
                      founderDep.score_pct <= 20 ? "text-green-600" :
                      founderDep.score_pct <= 40 ? "text-amber-600" : "text-red-600"
                    }`}>
                      {founderDep.score_pct}%
                    </span>
                    <span className="text-xs text-muted-foreground mb-1">
                      {founderDep.founder_tags} / {founderDep.total_tags} tags
                    </span>
                  </div>
                </div>
                <div className="w-16 h-16 relative flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="15.9" fill="none"
                      stroke={founderDep.score_pct <= 20 ? "#16a34a" : founderDep.score_pct <= 40 ? "#d97706" : "#dc2626"}
                      strokeWidth="3"
                      strokeDasharray={`${founderDep.score_pct} ${100 - founderDep.score_pct}`}
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {founderDep.score_pct <= 20 ? "Great — business runs without you." :
                 founderDep.score_pct <= 40 ? "Moderate — delegate more founder tasks." :
                 "High — you're a bottleneck. Document and delegate."}
              </p>
            </CardContent>
          </Card>
        )}

        {/* QBR Section */}
        {activeQBR && (
          <Card className="mb-6 border-2 border-yellow-200 bg-yellow-50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-yellow-600" />
                <CardTitle className="text-lg">Queen Bee Role</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <h3 className="font-semibold text-slate-900 mb-1">{activeQBR.title}</h3>
              <p className="text-sm text-slate-600">{activeQBR.description}</p>
            </CardContent>
          </Card>
        )}

        {/* Risk Alerts */}
        {riskSops.length > 0 && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <CardTitle className="text-lg">Process Risks</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 mb-3">
                {riskSops.length} SOPs need attention (missing owner or not verified)
              </p>
              <div className="space-y-2">
                {riskSops.slice(0, 5).map(sop => (
                  <div key={sop.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{sop.title}</span>
                    <Badge variant="outline" className="text-red-600 border-red-600">
                      {!sop.owner_email ? 'No owner' : 'Not verified'}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Links */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link to={createPageUrl("SOPLibrary")}>
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <BookOpen className="w-10 h-10 text-[#0F9B8E] mb-3" />
                <h3 className="font-semibold mb-1">SOP Library</h3>
                <p className="text-sm text-slate-500">{activeSops.length} procedures</p>
              </CardContent>
            </Card>
          </Link>

          <Link to={createPageUrl("RolesManagement")}>
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <Users className="w-10 h-10 text-blue-500 mb-3" />
                <h3 className="font-semibold mb-1">Roles</h3>
                <p className="text-sm text-slate-500">{activeRoles.length} defined roles</p>
              </CardContent>
            </Card>
          </Link>

          <Link to={createPageUrl("OnboardingManagement")}>
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <CheckCircle2 className="w-10 h-10 text-green-500 mb-3" />
                <h3 className="font-semibold mb-1">Onboarding</h3>
                <p className="text-sm text-slate-500">{activeOnboardings.length} in progress</p>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Transferability Readiness */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Business Transferability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ReadinessItem 
              label="Can owner step away for 30 days?"
              status={operabilityScore >= 70}
            />
            <ReadinessItem 
              label="SOPs are role-based (not person-based)"
              status={ownershipRate >= 80}
            />
            <ReadinessItem 
              label="Processes updated regularly"
              status={updateRate >= 60}
            />
            <ReadinessItem 
              label="Onboarding is documented"
              status={activeRoles.length > 0}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ReadinessItem({ label, status }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-600">{label}</span>
      {status ? (
        <CheckCircle2 className="w-5 h-5 text-green-500" />
      ) : (
        <AlertCircle className="w-5 h-5 text-orange-500" />
      )}
    </div>
  );
}
