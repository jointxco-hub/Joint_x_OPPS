import { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Search, ClipboardList, CheckCircle2, Circle, Clock,
  AlertTriangle, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format, isPast } from "date-fns";
import TaskDrawer from "@/components/tasks/TaskDrawer";
import NewTaskForm from "@/components/tasks/NewTaskForm";
import RefreshButton from "@/components/common/RefreshButton";
import { getTaskCompletionPatch, getTaskEntityName, mergeTaskLists, toEntityTaskPayload } from "@/lib/taskAdapters";
import { toast } from "sonner";

const priorityBar = {
  urgent: "bg-red-500",
  high:   "bg-orange-400",
  medium: "bg-yellow-400",
  normal: "bg-slate-300",
  low:    "bg-slate-200",
};

const priorityBadge = {
  urgent: "bg-red-100 text-red-700",
  high:   "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700",
  normal: "bg-slate-100 text-slate-600",
  low:    "bg-slate-100 text-slate-500",
};

const statusBadge = {
  not_started: "bg-slate-100 text-slate-600",
  in_progress: "bg-primary/10 text-primary",
  on_hold:     "bg-orange-100 text-orange-700",
  complete:    "bg-green-100 text-green-700",
};

const typeBadge = {
  single:         "bg-purple-100 text-purple-700",
  bulk:           "bg-indigo-100 text-indigo-700",
  x1_sample_pack: "bg-pink-100 text-pink-700",
  alethea:        "bg-teal-100 text-teal-700",
};

const TYPE_LABELS = {
  single:         "Single",
  bulk:           "Bulk",
  x1_sample_pack: "X1 Sample Pack",
  alethea:        "Alethea",
  general:        "General",
};

export default function Tasks() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedTask, setSelectedTask] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const queryClient = useQueryClient();

  const { data: opsTasks = [], isLoading: opsLoading } = useQuery({
    queryKey: ["opsTasks"],
    queryFn: () => dataClient.entities.OpsTask.list("-created_date", 500),
  });
  const { data: legacyTasks = [], isLoading: legacyLoading } = useQuery({
    queryKey: ["legacyTasks"],
    queryFn: () => dataClient.entities.Task.filter({ is_archived: false }, "-created_date", 500),
  });
  const tasks = mergeTaskLists(opsTasks, legacyTasks);
  const isLoading = opsLoading || legacyLoading;

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => dataClient.entities.User.list("name", 200),
  });

  const updateMutation = useMutation({
    mutationFn: ({ task, data }) => {
      const entityName = getTaskEntityName(task);
      return dataClient.entities[entityName].update(task.id, toEntityTaskPayload(task, data));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opsTasks"] });
      queryClient.invalidateQueries({ queryKey: ["legacyTasks"] });
      queryClient.invalidateQueries({ queryKey: ["orderTasks"] });
      queryClient.invalidateQueries({ queryKey: ["orderOpsTasks"] });
    },
    onError: (error) => {
      toast.error(error?.message || "Could not update task");
    },
  });

  const toggleDone = (task) => {
    const patch = getTaskCompletionPatch(task);
    updateMutation.mutate({ task, data: patch });
    if (selectedTask?.id === task.id) setSelectedTask(prev => ({ ...prev, ...patch }));
  };

  const filtered = tasks.filter(t => {
    if (t.status === "archived") return false;
    if (statusFilter === "active" && t.status === "complete") return false;
    if (statusFilter === "done" && t.status !== "complete") return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (typeFilter !== "all" && (t.production_type || "general") !== typeFilter) return false;
    if (search && !t.title?.toLowerCase().includes(search.toLowerCase()) &&
        !t.client_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const grouped = filtered.reduce((acc, task) => {
    const key = task.production_type || "general";
    if (!acc[key]) acc[key] = [];
    acc[key].push(task);
    return acc;
  }, {});

  const counts = {
    active:  tasks.filter(t => t.status !== "complete" && t.status !== "archived").length,
    done:    tasks.filter(t => t.status === "complete").length,
    overdue: tasks.filter(t =>
      t.status !== "complete" && t.status !== "archived" &&
      t.due_date && isPast(new Date(t.due_date))
    ).length,
  };

  const toggleGroup = (key) => setCollapsedGroups(p => ({ ...p, [key]: !p[key] }));

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-3 py-4 md:px-6 md:py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Tasks</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {counts.active} active
              {counts.overdue > 0 && <span className="text-red-500"> · {counts.overdue} overdue</span>}
              {" · "}{counts.done} done
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RefreshButton
              isRefreshing={isLoading}
              onRefresh={() => queryClient.invalidateQueries({ queryKey: ["opsTasks"] })}
            />
            <Button onClick={() => setShowNew(true)} className="gap-2 rounded-xl shadow-sm h-9 px-3 text-sm">
              <Plus className="w-4 h-4" /> New Task
            </Button>
          </div>
        </div>

        {/* Search + filter bar */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search tasks…" value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-card rounded-xl h-9 text-sm" />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {[
              { key: "active", label: `Active (${counts.active})` },
              { key: "done",   label: `Done (${counts.done})` },
            ].map(s => (
              <button key={s.key} onClick={() => setStatusFilter(s.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                  statusFilter === s.key
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}>
                {s.label}
              </button>
            ))}
            <select
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border appearance-none cursor-pointer transition-all ${
                priorityFilter !== "all"
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card border-border text-muted-foreground"
              }`}
            >
              <option value="all">Priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border appearance-none cursor-pointer transition-all ${
                typeFilter !== "all"
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card border-border text-muted-foreground"
              }`}
            >
              <option value="all">Type</option>
              <option value="single">Single</option>
              <option value="bulk">Bulk</option>
              <option value="x1_sample_pack">X1 Sample Pack</option>
              <option value="alethea">Alethea</option>
              <option value="general">General</option>
            </select>
          </div>
        </div>

        {/* Task list */}
        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-card rounded-2xl animate-pulse" />)}</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="text-center py-16 bg-card rounded-2xl border border-border">
            <ClipboardList className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">
              {statusFilter === "done" ? "No completed tasks" : "All clear"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {statusFilter === "active" ? "Add a task to get started." : ""}
            </p>
            {statusFilter === "active" && (
              <Button size="sm" className="rounded-xl" onClick={() => setShowNew(true)}>
                <Plus className="w-4 h-4 mr-1" /> Add first task
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([type, groupTasks]) => {
              const collapsed = collapsedGroups[type];
              return (
                <div key={type} className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
                  <button
                    onClick={() => toggleGroup(type)}
                    className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border bg-secondary/30 hover:bg-secondary/50 transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${typeBadge[type]?.replace('text-', 'bg-').split(' ')[0] || 'bg-slate-400'}`} />
                      <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                        {TYPE_LABELS[type] || type}
                      </span>
                      <span className="text-xs text-muted-foreground">({groupTasks.length})</span>
                    </div>
                    {collapsed ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />}
                  </button>

                  {!collapsed && (
                    <div>
                      {groupTasks.map((task) => {
                        const isDone = task.status === "complete";
                        const isOverdue = task.due_date && isPast(new Date(task.due_date)) && !isDone;
                        const StatusIcon = isDone ? CheckCircle2 : isOverdue ? AlertTriangle : Circle;
                        const assignedUsers = users.filter(u =>
                          Array.isArray(task.assigned_to)
                            ? task.assigned_to.includes(u.email)
                            : u.email === task.assigned_to
                        );

                        return (
                          <div
                            key={task._viewId || task.id}
                            className={`flex items-start gap-3 px-4 py-3 border-b border-border last:border-0 group transition-all hover:bg-secondary/20 ${isDone ? "opacity-55" : ""}`}
                          >
                            <div className={`w-1 self-stretch rounded-full flex-shrink-0 mt-1 ${priorityBar[task.priority] || priorityBar.normal}`} />

                            <button
                              onClick={() => toggleDone(task)}
                              className="flex-shrink-0 mt-0.5"
                            >
                              <StatusIcon className={`w-5 h-5 ${
                                isDone ? "text-green-500" :
                                isOverdue ? "text-red-400" :
                                "text-muted-foreground group-hover:text-primary"
                              }`} />
                            </button>

                            <button
                              className="flex-1 text-left min-w-0"
                              onClick={() => setSelectedTask(task)}
                            >
                              <p className={`text-sm font-semibold text-foreground truncate pr-1 ${isDone ? "line-through" : ""}`}>
                                {task.title}
                              </p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                {task.production_type && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${typeBadge[task.production_type] || ''}`}>
                                    {TYPE_LABELS[task.production_type]}
                                  </span>
                                )}
                                {task.priority && task.priority !== "normal" && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${priorityBadge[task.priority]}`}>
                                    {task.priority}
                                  </span>
                                )}
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusBadge[task.status] || statusBadge.not_started}`}>
                                  {task.status?.replace(/_/g, ' ')}
                                </span>
                                {task.production_stage && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                                    {task.production_stage}
                                  </span>
                                )}
                                {task.due_date && (
                                  <span className={`text-[10px] flex items-center gap-0.5 font-medium ${isOverdue ? "text-red-500" : "text-muted-foreground"}`}>
                                    <Clock className="w-3 h-3" />
                                    {format(new Date(task.due_date), "d MMM")}
                                    {isOverdue && " · overdue"}
                                  </span>
                                )}
                                {assignedUsers.map(u => (
                                  <span key={u.id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium">
                                    {u.full_name?.split(' ')[0] || u.email}
                                  </span>
                                ))}
                                {task.client_name && (
                                  <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                                    {task.client_name}
                                  </span>
                                )}
                              </div>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          users={users}
          onClose={() => setSelectedTask(null)}
          onUpdate={(data) => {
            updateMutation.mutate({ task: selectedTask, data });
            setSelectedTask(prev => ({ ...prev, ...data }));
          }}
          onArchive={() => {
            updateMutation.mutate({ task: selectedTask, data: { status: "archived" } });
            setSelectedTask(null);
          }}
        />
      )}

      {showNew && (
        <NewTaskForm
          users={users}
          onClose={() => setShowNew(false)}
          onCreate={(createdTask) => {
            queryClient.invalidateQueries({ queryKey: ["opsTasks"] });
            queryClient.invalidateQueries({ queryKey: ["legacyTasks"] });
            setShowNew(false);
            if (createdTask) setSelectedTask(createdTask);
          }}
        />
      )}
    </div>
  );
}
