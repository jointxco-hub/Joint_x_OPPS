import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Plus, Search, Folder, AlertCircle, CheckCircle2,
  Clock, TrendingUp, Users, Package, RefreshCw, Trash2
} from "lucide-react";
import { createPageUrl } from "../utils";
import { Link } from "react-router-dom";

const statusConfig = {
  planning: { label: "Planning", color: "bg-slate-100 text-slate-700", icon: Clock },
  active: { label: "Active", color: "bg-blue-100 text-blue-700", icon: TrendingUp },
  on_hold: { label: "On Hold", color: "bg-amber-100 text-amber-700", icon: AlertCircle },
  completed: { label: "Completed", color: "bg-green-100 text-green-700", icon: CheckCircle2 },
  archived: { label: "Archived", color: "bg-slate-100 text-slate-500", icon: Folder }
};

const priorityColors = {
  low: "bg-slate-100 text-slate-600",
  normal: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700"
};

export default function Projects() {
  const [search, setSearch] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);
  const queryClient = useQueryClient();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => dataClient.entities.Project.list('-created_date', 200)
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => dataClient.entities.Order.list('-created_date', 200)
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => dataClient.entities.Project.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success("Project deleted");
    }
  });

  const handleDelete = (e, projectId) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this project? This cannot be undone.")) {
      deleteMutation.mutate(projectId);
    }
  };

  const filteredProjects = projects.filter(p => 
    p.status !== 'archived' && 
    (!search || 
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.client_name?.toLowerCase().includes(search.toLowerCase()))
  );

  const activeProjects = filteredProjects.filter(p => p.status === 'active');
  const planningProjects = filteredProjects.filter(p => p.status === 'planning');
  const onHoldProjects = filteredProjects.filter(p => p.status === 'on_hold');

  const getProjectOrders = (projectId) => {
    return orders.filter(o => o.project_id === projectId);
  };

  const getProjectHealth = (project) => {
    const projectOrders = getProjectOrders(project.id);
    const blockedOrders = projectOrders.filter(o => o.stuck_reason && o.stuck_reason !== 'none');
    
    if (blockedOrders.length > 0) return 'blocked';
    if (project.blockers) return 'blocked';
    if (projectOrders.some(o => o.status === 'in_production')) return 'healthy';
    return 'normal';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Projects</h1>
            <p className="text-slate-500 mt-1">Manage client projects and deliverables</p>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={() => {
                queryClient.invalidateQueries();
                toast.success("Refreshed!");
              }} 
              variant="ghost"
              size="icon"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button onClick={() => setShowNewProject(true)} className="bg-slate-900 hover:bg-slate-800 rounded-xl h-11 px-6">
              <Plus className="w-4 h-4 mr-2" /> New Project
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="border-0 bg-white/80 backdrop-blur shadow-sm rounded-2xl">
            <CardContent className="p-5">
              <p className="text-sm text-slate-500">Active</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">{activeProjects.length}</p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-white/80 backdrop-blur shadow-sm rounded-2xl">
            <CardContent className="p-5">
              <p className="text-sm text-slate-500">Planning</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">{planningProjects.length}</p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-white/80 backdrop-blur shadow-sm rounded-2xl">
            <CardContent className="p-5">
              <p className="text-sm text-slate-500">On Hold</p>
              <p className="text-3xl font-bold text-amber-600 mt-1">{onHoldProjects.length}</p>
            </CardContent>
          </Card>
          <Card className="border-0 bg-white/80 backdrop-blur shadow-sm rounded-2xl">
            <CardContent className="p-5">
              <p className="text-sm text-slate-500">Total Projects</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">{projects.length}</p>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <Card className="mb-6 border-0 bg-white/80 backdrop-blur shadow-sm rounded-2xl">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                placeholder="Search projects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-11 h-11 rounded-xl border-slate-200 bg-slate-50"
              />
            </div>
          </CardContent>
        </Card>

        {/* Projects Grid */}
        {isLoading ? (
          <div className="text-center py-12 text-slate-500">Loading projects...</div>
        ) : filteredProjects.length === 0 ? (
          <Card className="p-16 text-center border-0 bg-white/80 backdrop-blur rounded-3xl">
            <Folder className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-700 mb-2">No projects found</h3>
            <p className="text-slate-500 mb-6">Create your first project to get started</p>
            <Button onClick={() => setShowNewProject(true)} className="rounded-xl">
              <Plus className="w-4 h-4 mr-2" /> New Project
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map(project => {
              const config = statusConfig[project.status];
              const StatusIcon = config.icon;
              const projectOrders = getProjectOrders(project.id);
              const health = getProjectHealth(project);
              
              return (
                <Link key={project.id} to={createPageUrl(`ProjectHub?id=${project.id}`)}>
                  <Card className="border-0 bg-white/90 backdrop-blur shadow-sm hover:shadow-lg transition-all cursor-pointer rounded-2xl overflow-hidden h-full">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h3 className="font-semibold text-slate-900 mb-1">{project.name}</h3>
                          <p className="text-sm text-slate-500">{project.client_name}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {health === 'blocked' && (
                            <AlertCircle className="w-5 h-5 text-red-500" />
                          )}
                          <button
                            onClick={(e) => handleDelete(e, project.id)}
                            className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                            title="Delete project"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 mb-4">
                        <Badge className={`${config.color} border-0 rounded-full flex items-center gap-1`}>
                          <StatusIcon className="w-3 h-3" />
                          {config.label}
                        </Badge>
                        <Badge className={`${priorityColors[project.priority]} border-0 rounded-full`}>
                          {project.priority}
                        </Badge>
                      </div>

                      {project.goal && (
                        <p className="text-sm text-slate-600 mb-3 line-clamp-2">{project.goal}</p>
                      )}

                      {project.blockers && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-2 mb-3">
                          <p className="text-xs text-red-700 font-medium">⚠️ {project.blockers}</p>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-sm">
                        <div className="flex items-center gap-1 text-slate-500">
                          <Package className="w-4 h-4" />
                          <span>{projectOrders.length} orders</span>
                        </div>
                        {project.target_date && (
                          <span className="text-slate-400">{new Date(project.target_date).toLocaleDateString()}</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* New Project Modal - Simplified */}
      {showNewProject && (
        <NewProjectModal onClose={() => setShowNewProject(false)} />
      )}
    </div>
  );
}

function NewProjectModal({ onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    client_name: "",
    goal: "",
    status: "planning",
    priority: "normal"
  });

  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data) => dataClient.entities.Project.create({
      ...data,
      project_code: `PRJ-${Date.now().toString(36).toUpperCase()}`
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <CardContent className="p-6">
          <h2 className="text-xl font-bold mb-4">New Project</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Project Name *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                placeholder="e.g., Spring Collection 2026"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Client *</label>
              <Input
                value={formData.client_name}
                onChange={(e) => setFormData({...formData, client_name: e.target.value})}
                placeholder="Client or brand name"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Goal</label>
              <Input
                value={formData.goal}
                onChange={(e) => setFormData({...formData, goal: e.target.value})}
                placeholder="What does success look like?"
              />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending} className="flex-1 bg-slate-900">
                Create Project
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
