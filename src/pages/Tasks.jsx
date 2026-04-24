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

const priorityColors = {
  urgent: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
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

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.Task.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
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

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Tasks</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {counts.active} active · {counts.overdue > 0 && `${counts.overdue} overdue · `}{counts.done} done
            </p>
          </div>

          <Button onClick={() => setShowNew(true)} className="gap-2">
            <Plus className="w-4 h-4" /> New Task
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="flex-1 min-w-[200px]">
            <Input
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-card"
            />
          </div>

          <div className="flex gap-2">
            {["active", "done"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-xl text-sm ${
                  statusFilter === s
                    ? "bg-primary text-white"
                    : "bg-card text-muted-foreground"
                }`}
              >
                {s}
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

        {/* Task List */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-card rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <ClipboardList className="w-10 h-10 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground mt-2">No tasks found</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([dept, deptTasks]) => (
              <div key={dept}>
                <p className="text-xs uppercase text-muted-foreground mb-2">
                  {dept} ({deptTasks.length})
                </p>

                <div className="bg-card rounded-xl overflow-hidden">
                  {deptTasks.map((task) => {
                    const StatusIcon = statusIcons[task.status] || Circle;
                    const isOverdue =
                      task.deadline &&
                      isPast(new Date(task.deadline)) &&
                      task.status !== "done";

                    return (
                      <button
                        key={task.id}
                        onClick={() => setSelectedTask(task)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/40"
                      >
                        <StatusIcon
                          className={`w-4 h-4 ${
                            task.status === "done"
                              ? "text-green-500"
                              : isOverdue
                              ? "text-red-500"
                              : "text-muted-foreground"
                          }`}
                        />

                        <div className="flex-1 text-left">
                          <p
                            className={`text-sm ${
                              task.status === "done"
                                ? "line-through text-muted-foreground"
                                : ""
                            }`}
                          >
                            {task.title}
                          </p>
                          {task.deadline && (
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(task.deadline), "d MMM yyyy")}
                            </p>
                          )}
                        </div>

                        {task.priority && (
                          <span
                            className={`text-xs px-2 py-1 rounded ${priorityColors[task.priority]}`}
                          >
                            {task.priority}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DRAWER */}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={(data) => {
            updateMutation.mutate({ id: selectedTask.id, data });
            setSelectedTask((prev) => ({ ...prev, ...data }));
          }}
          onArchive={async () => {
            await updateMutation.mutateAsync({
              id: selectedTask.id,
              data: {
                is_archived: true,
                archived_at: new Date().toISOString(),
                archived_by: "",
              },
            });

            setSelectedTask(null);
          }}
        />
      )}

      {/* NEW TASK */}
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