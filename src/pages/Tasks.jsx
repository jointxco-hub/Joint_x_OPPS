import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, ClipboardList, CheckCircle2, Circle, Clock, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format, isPast } from "date-fns";
import TaskDrawer from "@/components/tasks/TaskDrawer";
import NewTaskForm from "@/components/tasks/NewTaskForm";
import { useArchive } from "@/hooks/useArchive";

const priorityBar = {
  urgent: "bg-red-500",
  high:   "bg-orange-400",
  medium: "bg-yellow-400",
  normal: "bg-slate-300",
  low:    "bg-slate-200",
};

const priorityLabel = {
  urgent: "bg-red-100 text-red-700",
  high:   "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700",
  normal: "bg-slate-100 text-slate-600",
  low:    "bg-slate-100 text-slate-500",
};

const deptEmoji = {
  operations: "⚙️",
  design:     "🎨",
  production: "🏭",
  sales:      "💬",
  finance:    "💰",
  admin:      "📋",
  general:    "📌",
};

export default function Tasks() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [selectedTask, setSelectedTask] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [collapsedDepts, setCollapsedDepts] = useState({});

  const queryClient = useQueryClient();
  const ents = /** @type {any} */ (dataClient.entities);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => ents.Task.list("-created_date", 200),
  });

  const updateMutation = useMutation({
    mutationFn: (/** @type {{id:string,data:any}} */ { id, data }) => ents.Task.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const { archive: archiveTask } = useArchive("Task", {
    onSuccess: () => setSelectedTask(null),
  });

  const toggleDone = (/** @type {any} */ task) => {
    const newStatus = task.status === "done" ? "pending" : "done";
    updateMutation.mutate({ id: task.id, data: { status: newStatus } });
  };

  const filtered = tasks.filter((t) => {
    if (t.is_archived) return false;
    if (statusFilter === "active" && t.status === "done") return false;
    if (statusFilter === "done" && t.status !== "done") return false;
    if (search && !t.title?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const grouped = filtered.reduce((acc, task) => {
    const key = task.department || "general";
    if (!acc[key]) acc[key] = [];
    acc[key].push(task);
    return acc;
  }, {});

  const counts = {
    active:  tasks.filter(t => !t.is_archived && t.status !== "done").length,
    done:    tasks.filter(t => !t.is_archived && t.status === "done").length,
    overdue: tasks.filter(t => !t.is_archived && t.deadline && isPast(new Date(t.deadline)) && t.status !== "done").length,
  };

  const toggleDept = (dept) => setCollapsedDepts(p => ({ ...p, [dept]: !p[dept] }));

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 md:py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Tasks</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {counts.active} active
              {counts.overdue > 0 && <span className="text-red-500"> · {counts.overdue} overdue</span>}
              {" · "}{counts.done} done
            </p>
          </div>
          <Button onClick={() => setShowNew(true)} className="gap-2 rounded-xl shadow-apple-sm">
            <Plus className="w-4 h-4" /> New Task
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-5 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search tasks…" value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-card rounded-xl h-9" />
          </div>
          <div className="flex gap-2">
            {[
              { key: "active", label: `Active (${counts.active})` },
              { key: "done",   label: `Done (${counts.done})` },
            ].map(s => (
              <button key={s.key} onClick={() => setStatusFilter(s.key)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
                  statusFilter === s.key
                    ? "bg-primary text-primary-foreground shadow-apple-sm"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Task list */}
        {isLoading ? (
          <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-14 bg-card rounded-2xl animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 bg-card rounded-2xl border border-border">
            <ClipboardList className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">
              {statusFilter === "done" ? "No completed tasks" : "All clear"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {statusFilter === "active" ? "Add a task to get started." : ""}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([dept, deptTasks]) => {
              const collapsed = collapsedDepts[dept];
              return (
                <div key={dept} className="bg-card rounded-2xl border border-border overflow-hidden shadow-apple-sm">
                  <button
                    onClick={() => toggleDept(dept)}
                    className="w-full flex items-center justify-between px-5 py-3 border-b border-border bg-secondary/30 hover:bg-secondary/50 transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <span>{deptEmoji[dept] || "📌"}</span>
                      <span className="text-xs font-semibold text-foreground uppercase tracking-wide capitalize">{dept}</span>
                      <span className="text-xs text-muted-foreground">({deptTasks.length})</span>
                    </div>
                    {collapsed
                      ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                      : <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                    }
                  </button>

                  {!collapsed && (
                    <div>
                      {deptTasks.map((task, idx) => {
                        const isDone = task.status === "done";
                        const isOverdue = task.deadline && isPast(new Date(task.deadline)) && !isDone;
                        const StatusIcon = isDone ? CheckCircle2 : isOverdue ? AlertTriangle : Circle;

                        return (
                          <div
                            key={task.id}
                            className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 group transition-all hover:bg-secondary/20 ${isDone ? "opacity-50" : ""}`}
                          >
                            {/* Priority bar */}
                            <div className={`w-1 h-8 rounded-full flex-shrink-0 ${priorityBar[task.priority] || priorityBar.normal}`} />

                            {/* Complete toggle */}
                            <button
                              onClick={() => toggleDone(task)}
                              className="flex-shrink-0 transition-all"
                            >
                              <StatusIcon className={`w-5 h-5 ${
                                isDone ? "text-green-500" :
                                isOverdue ? "text-red-400" :
                                "text-muted-foreground group-hover:text-primary"
                              }`} />
                            </button>

                            {/* Title + meta */}
                            <button
                              className="flex-1 text-left min-w-0"
                              onClick={() => setSelectedTask(task)}
                            >
                              <p className={`text-sm font-medium text-foreground truncate ${isDone ? "line-through" : ""}`}>
                                {task.title}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                {task.priority && task.priority !== "normal" && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${priorityLabel[task.priority]}`}>
                                    {task.priority}
                                  </span>
                                )}
                                {task.deadline && (
                                  <span className={`text-[10px] flex items-center gap-0.5 ${isOverdue ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                                    <Clock className="w-3 h-3" />
                                    {format(new Date(task.deadline), "d MMM")}
                                    {isOverdue && " · overdue"}
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
          onClose={() => setSelectedTask(null)}
          onUpdate={(data) => {
            updateMutation.mutate({ id: selectedTask.id, data });
            setSelectedTask(prev => ({ ...prev, ...data }));
          }}
          onArchive={() => archiveTask(selectedTask.id)}
        />
      )}

      {showNew && (
        <NewTaskForm
          onClose={() => setShowNew(false)}
          onCreate={() => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}
