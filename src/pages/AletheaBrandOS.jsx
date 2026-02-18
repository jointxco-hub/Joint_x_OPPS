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
  Lightbulb, Palette, ShoppingCart, Share2, Mail, Settings, 
  Wrench, Plus, Search, ChevronRight, Users, Calendar
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
    <div className="min-h-screen bg-[#0A0A0A] text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-1">Alethea Brand OS™</h1>
            <p className="text-slate-400 text-sm">Phase-based execution system</p>
          </div>
          <Link to={createPageUrl("AletheaProjectBuilder")}>
            <Button className="bg-indigo-600 hover:bg-indigo-700">
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          </Link>
        </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <Input
            placeholder="Search projects..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-12 h-12 bg-[#1A1A1A] border-[#2A2A2A] text-white placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* Projects List */}
      <Tabs defaultValue="active" className="space-y-4">
        <TabsList className="bg-[#1A1A1A] border border-[#2A2A2A]">
          <TabsTrigger value="active" className="data-[state=active]:bg-indigo-600">
            Active ({activeProjects.length})
          </TabsTrigger>
          <TabsTrigger value="draft" className="data-[state=active]:bg-indigo-600">
            Draft ({draftProjects.length})
          </TabsTrigger>
          <TabsTrigger value="completed" className="data-[state=active]:bg-indigo-600">
            Completed ({completedProjects.length})
          </TabsTrigger>
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
        
        {/* Bottom Navigation Tabs */}
        <div className="fixed bottom-0 left-0 right-0 bg-[#0A0A0A] border-t border-[#2A2A2A] lg:pl-64">
          <div className="max-w-4xl mx-auto flex items-center justify-around py-3">
            <Link to={createPageUrl("Dashboard")} className="flex flex-col items-center gap-1 text-slate-400 hover:text-white">
              <Users className="w-5 h-5" />
              <span className="text-xs">Dashboard</span>
            </Link>
            <button className="flex flex-col items-center gap-1 text-indigo-500">
              <Calendar className="w-5 h-5" />
              <span className="text-xs">Phases</span>
            </button>
            <Link to={createPageUrl("Projects")} className="flex flex-col items-center gap-1 text-slate-400 hover:text-white">
              <Settings className="w-5 h-5" />
              <span className="text-xs">Timeline</span>
            </Link>
            <Link to={createPageUrl("Clients")} className="flex flex-col items-center gap-1 text-slate-400 hover:text-white">
              <Users className="w-5 h-5" />
              <span className="text-xs">Team</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectGrid({ projects, clients }) {
  if (projects.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-500">No projects found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {projects.map(project => {
        const client = clients.find(c => c.id === project.client_id);
        
        return (
          <Link key={project.id} to={createPageUrl(`AletheaProjectView?id=${project.id}`)}>
            <Card className="bg-[#1A1A1A] border-[#2A2A2A] hover:bg-[#222] transition-all duration-200">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  {/* Icon */}
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
                    <Lightbulb className="w-6 h-6 text-white" />
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-white font-semibold truncate">{project.name}</h3>
                        <p className="text-slate-400 text-sm truncate">{client?.name || 'Client'}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-500 shrink-0" />
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="mt-3">
                      <div className="h-1.5 bg-[#2A2A2A] rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 transition-all"
                          style={{ width: `${project.progress_percentage || 0}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-500 mt-1 text-right">{project.progress_percentage || 0}%</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}