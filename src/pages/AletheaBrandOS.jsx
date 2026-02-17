import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Rocket, Plus, Search, Play, CheckCircle, Clock,
  Sparkles, TrendingUp, Target, Box
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";

export default function AletheaBrandOS() {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: projects = [] } = useQuery({
    queryKey: ['aletheaProjects'],
    queryFn: () => base44.entities.AletheaProject.list('-created_date', 100)
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list('name', 200)
  });

  const filteredProjects = projects.filter(p => 
    !searchTerm || p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    clients.find(c => c.id === p.client_id)?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeProjects = filteredProjects.filter(p => p.status === 'active');
  const draftProjects = filteredProjects.filter(p => p.status === 'draft');
  const completedProjects = filteredProjects.filter(p => p.status === 'completed');

  const packageStats = {
    strategy: projects.filter(p => p.package_type === 'strategy').length,
    content_week: projects.filter(p => p.package_type === 'content_week').length,
    website: projects.filter(p => p.package_type === 'website').length,
    full_os: projects.filter(p => p.package_type === 'full_os').length
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 bg-gradient-to-br from-purple-600 via-pink-600 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
              Alethea Brand OS™
            </h1>
            <p className="text-slate-600">Strategy Engine • Execution Tracker • Intelligence Hub</p>
          </div>
        </div>
        <Link to={createPageUrl("AletheaProjectBuilder")}>
          <Button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 shadow-lg">
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Button>
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="border-0 bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm mb-1">Active Projects</p>
                <p className="text-3xl font-bold">{activeProjects.length}</p>
              </div>
              <Play className="w-10 h-10 opacity-20" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-0 bg-gradient-to-br from-green-500 to-green-600 text-white shadow-lg">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm mb-1">Completed</p>
                <p className="text-3xl font-bold">{completedProjects.length}</p>
              </div>
              <CheckCircle className="w-10 h-10 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-100 text-sm mb-1">Draft</p>
                <p className="text-3xl font-bold">{draftProjects.length}</p>
              </div>
              <Clock className="w-10 h-10 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-lg">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm mb-1">Full OS</p>
                <p className="text-3xl font-bold">{packageStats.full_os}</p>
              </div>
              <Rocket className="w-10 h-10 opacity-20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Package Type Breakdown */}
      <Card className="mb-6 border-0 shadow-md">
        <CardHeader>
          <CardTitle className="text-lg">Package Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-purple-50 rounded-lg">
              <Target className="w-5 h-5 text-purple-600 mb-1" />
              <p className="text-xs text-slate-600">Strategy</p>
              <p className="text-xl font-bold text-purple-600">{packageStats.strategy}</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <TrendingUp className="w-5 h-5 text-blue-600 mb-1" />
              <p className="text-xs text-slate-600">Content Week</p>
              <p className="text-xl font-bold text-blue-600">{packageStats.content_week}</p>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <Box className="w-5 h-5 text-green-600 mb-1" />
              <p className="text-xs text-slate-600">Website</p>
              <p className="text-xl font-bold text-green-600">{packageStats.website}</p>
            </div>
            <div className="p-3 bg-gradient-to-br from-purple-100 to-pink-100 rounded-lg">
              <Sparkles className="w-5 h-5 text-purple-600 mb-1" />
              <p className="text-xs text-slate-600">Full OS</p>
              <p className="text-xl font-bold text-purple-600">{packageStats.full_os}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <Card className="mb-6 border-0 shadow-md">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search by project or client name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-11 h-11"
            />
          </div>
        </CardContent>
      </Card>

      {/* Projects Tabs */}
      <Tabs defaultValue="active">
        <TabsList className="mb-4">
          <TabsTrigger value="active">Active ({activeProjects.length})</TabsTrigger>
          <TabsTrigger value="draft">Draft ({draftProjects.length})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completedProjects.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <ProjectGrid projects={activeProjects} clients={clients} />
        </TabsContent>

        <TabsContent value="draft">
          <ProjectGrid projects={draftProjects} clients={clients} />
        </TabsContent>

        <TabsContent value="completed">
          <ProjectGrid projects={completedProjects} clients={clients} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProjectGrid({ projects, clients }) {
  if (projects.length === 0) {
    return (
      <Card className="p-16 text-center border-dashed border-2">
        <Rocket className="w-16 h-16 text-slate-300 mx-auto mb-4" />
        <p className="text-slate-500 text-lg">No projects found</p>
      </Card>
    );
  }

  const packageIcons = {
    strategy: Target,
    content_week: TrendingUp,
    website: Box,
    full_os: Sparkles,
    custom: Rocket
  };

  const packageColors = {
    strategy: 'bg-purple-100 text-purple-700',
    content_week: 'bg-blue-100 text-blue-700',
    website: 'bg-green-100 text-green-700',
    full_os: 'bg-gradient-to-r from-purple-100 to-pink-100 text-purple-700',
    custom: 'bg-slate-100 text-slate-700'
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {projects.map(project => {
        const client = clients.find(c => c.id === project.client_id);
        const PackageIcon = packageIcons[project.package_type] || Rocket;
        
        return (
          <Link key={project.id} to={createPageUrl(`AletheaProjectView?id=${project.id}`)}>
            <Card className="hover:shadow-2xl transition-all duration-300 border-0 bg-white overflow-hidden group">
              <div className={`h-2 ${project.package_type === 'full_os' ? 'bg-gradient-to-r from-purple-500 to-pink-500' : 'bg-gradient-to-r from-blue-500 to-purple-500'}`} />
              
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg mb-2 truncate">{project.name}</CardTitle>
                    <p className="text-sm text-slate-500 truncate">{client?.name || 'Unknown Client'}</p>
                  </div>
                  <Badge className={`${packageColors[project.package_type]} border-0 shrink-0`}>
                    <PackageIcon className="w-3 h-3 mr-1" />
                    {project.package_type?.replace('_', ' ')}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Progress */}
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                    <span>Progress</span>
                    <span className="font-semibold">{project.progress_percentage || 0}%</span>
                  </div>
                  <Progress value={project.progress_percentage || 0} className="h-2" />
                </div>

                {/* Meta Info */}
                <div className="flex flex-wrap gap-2">
                  {project.business_model && (
                    <Badge variant="outline" className="text-xs">
                      {project.business_model}
                    </Badge>
                  )}
                  {project.selected_platform !== 'not_selected' && project.selected_platform && (
                    <Badge variant="outline" className="text-xs">
                      {project.selected_platform}
                    </Badge>
                  )}
                </div>

                {/* Completion Status */}
                {project.strategy_intake_completed && (
                  <div className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle className="w-3 h-3" />
                    Strategy Complete
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}