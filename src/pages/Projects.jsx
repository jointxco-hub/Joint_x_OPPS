import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Search,
  Folder,
  AlertCircle,
  CheckCircle2,
  Clock,
  TrendingUp,
  Package,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { createPageUrl } from "../utils";
import { Link } from "react-router-dom";

const statusConfig = {
  planning: { label: "Planning", color: "bg-slate-100 text-slate-700", icon: Clock },
  active: { label: "Active", color: "bg-blue-100 text-blue-700", icon: TrendingUp },
  on_hold: { label: "On Hold", color: "bg-amber-100 text-amber-700", icon: AlertCircle },
  completed: { label: "Completed", color: "bg-green-100 text-green-700", icon: CheckCircle2 },
};

export default function Projects() {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);

  const queryClient = useQueryClient();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => dataClient.entities.Project.list("-created_date", 200),
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: () => dataClient.entities.Order.list("-created_date", 200),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => dataClient.entities.Project.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project deleted");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id) =>
      dataClient.entities.Project.update(id, {
        is_archived: true,
        archived_at: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project archived");
    },
  });

  const filteredProjects = projects
    .filter((p) => (showArchived ? p.is_archived : !p.is_archived))
    .filter(
      (p) =>
        !search ||
        p.name?.toLowerCase().includes(search.toLowerCase()) ||
        p.client_name?.toLowerCase().includes(search.toLowerCase())
    );

  const getProjectOrders = (projectId) =>
    orders.filter((o) => o.project_id === projectId);

  const getProjectHealth = (project) => {
    const projectOrders = getProjectOrders(project.id);
    const blockedOrders = projectOrders.filter(
      (o) => o.stuck_reason && o.stuck_reason !== "none"
    );

    if (blockedOrders.length > 0) return "blocked";
    if (project.blockers) return "blocked";
    if (projectOrders.some((o) => o.status === "in_production")) return "healthy";
    return "normal";
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6">

        {/* HEADER */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold">Projects</h1>
            <p className="text-slate-500 text-sm">
              Manage client projects
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowArchived(!showArchived)}
            >
              {showArchived ? "Show Active" : "Show Archived"}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                queryClient.invalidateQueries();
                toast.success("Refreshed");
              }}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>

            <Button onClick={() => setShowNewProject(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          </div>
        </div>

        {/* SEARCH */}
        <div className="mb-4">
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* GRID */}
        {isLoading ? (
          <div className="text-center py-10">Loading...</div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            No projects found
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-4">
            {filteredProjects.map((project) => {
              const config = statusConfig[project.status] || statusConfig.planning;
              const StatusIcon = config.icon;
              const health = getProjectHealth(project);
              const projectOrders = getProjectOrders(project.id);

              return (
                <Link
                  key={project.id}
                  to={createPageUrl(`ProjectHub?id=${project.id}`)}
                >
                  <Card className="hover:shadow-md cursor-pointer">
                    <CardContent className="p-4">

                      <div className="flex justify-between mb-2">
                        <div>
                          <h3 className="font-semibold">{project.name}</h3>
                          <p className="text-xs text-slate-500">
                            {project.client_name}
                          </p>
                        </div>

                        <div className="flex gap-2">

                          {/* ARCHIVE */}
                          {!project.is_archived && (
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                archiveMutation.mutate(project.id);
                              }}
                              className="text-slate-400 hover:text-amber-600"
                              title="Archive"
                            >
                              📦
                            </button>
                          )}

                          {/* DELETE */}
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              deleteMutation.mutate(project.id);
                            }}
                            className="text-slate-400 hover:text-red-500"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="flex gap-2 mb-2">
                        <Badge className={config.color}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {config.label}
                        </Badge>
                      </div>

                      {health === "blocked" && (
                        <div className="text-red-500 text-xs mb-2">
                          ⚠️ Blocked
                        </div>
                      )}

                      <div className="text-xs text-slate-500">
                        {projectOrders.length} orders
                      </div>

                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}