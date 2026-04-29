import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, ClipboardList, Circle, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, isPast } from "date-fns";
import TaskDrawer from "@/components/tasks/TaskDrawer";
import NewTaskForm from "@/components/tasks/NewTaskForm";
import { useArchive } from "@/hooks/useArchive";
const priorityColors = {
  urgent: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  normal: "bg-slate-100 text-slate-600 border-slate-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
};

const statusIcons = {
  pending: Circle,
  in_progress: Clock,
  done: CheckCircle2,
  overdue: AlertTriangle,
};

export default function Tasks() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [selectedTask, setSelectedTask] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const queryClient = useQueryClient();

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => dataClient.entities.Task.list("-created_date", 200),
  });

  const opsEntity = /** @type {any} */ (dataClient.entities).OpsTask;
  const { data: opsTasks = [] } = useQuery({
    queryKey: ["opsTasks"],
    queryFn: () => opsEntity.list("-created_date", 200),
    enabled: !!opsEntity,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.Task.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const { archive: archiveTask, isPending: isArchiving } = useArchive("Task", {
  onSuccess: () => setSelectedTask(null),
});

  const filtered = tasks.filter((t) => {
    if (t.is_archived) return false;
    if (statusFilter === "active" && t.status === "done") return false;
    if (statusFilter === "done" && t.status !== "done") return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
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
    active: tasks.filter((t) => !t.is_archived && t.status !== "done").length,
    done: tasks.filter((t) => !t.is_archived && t.status === "done").length,
    overdue: tasks.filter(
      (t) =>
        !t.is_archived &&
        t.deadline &&
        isPast(new Date(t.deadline)) &&
        t.status !== "done"
    ).length,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">

        {/* HEADER */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Tasks</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {counts.active} active ·{" "}
              {counts.overdue > 0 && (
                <span className="text-red-500">{counts.overdue} overdue · </span>
              )}
              {counts.done} done
            </p>
          </div>
          <Button onClick={() => setShowNew(true)} className="gap-2">
            <Plus className="w-4 h-4" /> New Task
          </Button>
        </div>

        {/* FILTERS */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex gap-2">
            {["active", "done"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-xl text-sm ${
                  statusFilter === s
                    ? "bg-primary text-white"
                    : "bg-card border"
                }`}
              >
                {s === "active"
                  ? `Active (${counts.active})`
                  : `Done (${counts.done})`}
              </button>
            ))}
          </div>

          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* TASK LIST */}
        {isLoading ? (
          <p>Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-muted-foreground">No tasks</p>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([dept, deptTasks]) => (
              <div key={dept}>
                <p className="text-xs mb-2">
                  {dept} ({deptTasks.length})
                </p>

                {deptTasks.map((task) => {
                  const StatusIcon = statusIcons[task.status] || Circle;

                  return (
                    <button
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className="w-full flex justify-between p-3 border rounded-lg mb-2"
                    >
                      <div className="flex gap-3 items-center">
                        <StatusIcon className="w-4 h-4" />
                        <span>{task.title}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* OPS TASKS */}
      {(() => {
        const filteredOps = opsTasks.filter((t) => {
          if (t.status === 'archived') return false;
          if (search && !t.title?.toLowerCase().includes(search.toLowerCase())) return false;
          return true;
        });
        if (filteredOps.length === 0) return null;
        const opsStatusColors = {
          not_started: "bg-slate-100 text-slate-600",
          in_progress: "bg-blue-100 text-blue-700",
          on_hold: "bg-orange-100 text-orange-700",
          complete: "bg-green-100 text-green-700",
        };
        return (
          <div className="mt-8 border-t pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Ops Tasks ({filteredOps.length})
            </p>
            <div className="space-y-2">
              {filteredOps.map((task) => (
                <div key={task.id} className="w-full flex items-center justify-between p-3 border rounded-lg bg-card gap-3">
                  <div className="flex gap-3 items-center min-w-0">
                    <Clock className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm">{task.title}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${opsStatusColors[task.status] || "bg-slate-100 text-slate-600"}`}>
                    {task.status?.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* TASK DRAWER */}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={(data) => {
            updateMutation.mutate({ id: selectedTask.id, data });
          }}
          onArchive={() => { if (selectedTask) archiveTask(selectedTask.id); }}
        />
      )}

      {/* NEW TASK FORM */}
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