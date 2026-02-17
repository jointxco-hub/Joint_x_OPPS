import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Rocket, Plus, Search, Lock, CheckCircle, Clock, 
  DollarSign, FileText, Users, ChevronRight, Play
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";

export default function AletheaBrandOS() {
  const [searchTerm, setSearchTerm] = useState("");
  const queryClient = useQueryClient();

  const { data: projects = [] } = useQuery({
    queryKey: ['aletheaProjects'],
    queryFn: () => base44.entities.AletheaProject.list('-created_date', 100)
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list('name', 200)
  });

  const filteredProjects = projects.filter(p => 
    !searchTerm || p.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeProjects = filteredProjects.filter(p => p.status === 'active');
  const completedProjects = filteredProjects.filter(p => p.status === 'completed');
  const pausedProjects = filteredProjects.filter(p => p.status === 'paused');

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
            <Rocket className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Alethea Brand OS</h1>
            <p className="text-slate-500">Phase-based project execution</p>
          </div>
        </div>
        <Link to={createPageUrl("AletheaProjectBuilder")}>
          <Button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="border-0 bg-gradient-to-br from-blue-50 to-blue-100">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-600 mb-1">Active</p>
                <p className="text-2xl font-bold text-blue-900">{activeProjects.length}</p>
              </div>
              <Play className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-0 bg-gradient-to-br from-green-50 to-green-100">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-green-600 mb-1">Completed</p>
                <p className="text-2xl font-bold text-green-900">{completedProjects.length}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 bg-gradient-to-br from-orange-50 to-orange-100">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-orange-600 mb-1">Paused</p>
                <p className="text-2xl font-bold text-orange-900">{pausedProjects.length}</p>
              </div>
              <Clock className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 bg-gradient-to-br from-purple-50 to-purple-100">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-purple-600 mb-1">Total</p>
                <p className="text-2xl font-bold text-purple-900">{projects.length}</p>
              </div>
              <FileText className="w-8 h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search projects..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Projects */}
      <Tabs defaultValue="active">
        <TabsList className="mb-4">
          <TabsTrigger value="active">Active ({activeProjects.length})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completedProjects.length})</TabsTrigger>
          <TabsTrigger value="paused">Paused ({pausedProjects.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <ProjectGrid projects={activeProjects} clients={clients} />
        </TabsContent>

        <TabsContent value="completed">
          <ProjectGrid projects={completedProjects} clients={clients} />
        </TabsContent>

        <TabsContent value="paused">
          <ProjectGrid projects={pausedProjects} clients={clients} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProjectGrid({ projects, clients }) {
  if (projects.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <Rocket className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500">No projects found</p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {projects.map(project => {
        const client = clients.find(c => c.id === project.client_id);
        return (
          <Link key={project.id} to={createPageUrl(`AletheaProjectView?id=${project.id}`)}>
            <Card className="hover:shadow-lg transition-all border-0 bg-gradient-to-br from-white to-slate-50">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg mb-1">{project.name}</CardTitle>
                    <p className="text-sm text-slate-500">{client?.name || 'Unknown Client'}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span>Progress</span>
                      <span>{project.progress_percentage || 0}%</span>
                    </div>
                    <Progress value={project.progress_percentage || 0} className="h-2" />
                  </div>
                  
                  {project.selected_platform && (
                    <Badge variant="outline" className="text-xs">
                      {project.selected_platform}
                    </Badge>
                  )}

                  {project.estimated_completion && (
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <Clock className="w-3 h-3" />
                      Due {new Date(project.estimated_completion).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}