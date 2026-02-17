import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, CheckCircle2, Clock, MapPin, Search, Filter,
  Palette, Scissors, Printer, Package, Truck } from
"lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TaskItem from "@/components/dashboard/TaskItem";
import TypeformTaskForm from "@/components/tasks/TypeformTaskForm";

const phaseConfig = {
  design: { label: "Design", icon: Palette, color: "bg-purple-100 text-purple-700" },
  mockup: { label: "Mockup", icon: Palette, color: "bg-indigo-100 text-indigo-700" },
  sourcing: { label: "Sourcing", icon: Package, color: "bg-amber-100 text-amber-700" },
  cutting: { label: "Cutting", icon: Scissors, color: "bg-blue-100 text-blue-700" },
  printing: { label: "Printing", icon: Printer, color: "bg-pink-100 text-pink-700" },
  pressing: { label: "Pressing", icon: Printer, color: "bg-orange-100 text-orange-700" },
  finishing: { label: "Finishing", icon: CheckCircle2, color: "bg-teal-100 text-teal-700" },
  packing: { label: "Packing", icon: Package, color: "bg-cyan-100 text-cyan-700" },
  delivery: { label: "Delivery", icon: Truck, color: "bg-emerald-100 text-emerald-700" }
};

const locationLabels = {
  jg_electronics_randburg: "JG Electronics, Randburg",
  dtf_randburg: "DTF Printer, Randburg",
  dtf_joburg: "DTF Printer, Joburg",
  blanks_joburg: "Blanks Supplier, Joburg",
  pep_paxi_riverside: "Pep Paxi, Riverside View",
  client_location: "Client Location",
  hq: "HQ",
  other: "Other"
};

export default function Tasks() {
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [activeTab, setActiveTab] = useState("pending");
  const [searchTerm, setSearchTerm] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [weekFilter, setWeekFilter] = useState("all");
  const queryClient = useQueryClient();

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => base44.entities.Task.list('-created_date', 200)
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 100)
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Task.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setShowForm(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Task.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setEditingTask(null);
    }
  });

  const handleSubmit = async (data) => {
    if (editingTask) {
      await updateMutation.mutateAsync({ id: editingTask.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  const handleStatusChange = (taskId, status) => {
    updateMutation.mutate({ id: taskId, data: { status } });
  };

  // Get current week number
  const getCurrentWeek = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const diff = now - start;
    const oneWeek = 1000 * 60 * 60 * 24 * 7;
    return Math.ceil(diff / oneWeek);
  };

  const currentWeek = getCurrentWeek();

  // Filter tasks
  const filterTasks = (taskList) => {
    return taskList.filter((task) => {
      const matchesSearch = !searchTerm ||
      task.title?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesPhase = phaseFilter === "all" || task.phase === phaseFilter;
      const matchesLocation = locationFilter === "all" || task.location === locationFilter;
      const matchesWeek = weekFilter === "all" ||
      weekFilter === "this_week" && task.due_week === currentWeek ||
      weekFilter === "next_week" && task.due_week === currentWeek + 1 ||
      weekFilter === "overdue" && task.due_week && task.due_week < currentWeek;
      return matchesSearch && matchesPhase && matchesLocation && matchesWeek;
    });
  };

  const pendingTasks = filterTasks(tasks.filter((t) => t.status === 'pending'));
  const inProgressTasks = filterTasks(tasks.filter((t) => t.status === 'in_progress'));
  const completedTasks = filterTasks(tasks.filter((t) => t.status === 'completed'));

  // Group by phase for production view
  const tasksByPhase = {};
  pendingTasks.concat(inProgressTasks).forEach((task) => {
    const phase = task.phase || 'other';
    if (!tasksByPhase[phase]) tasksByPhase[phase] = [];
    tasksByPhase[phase].push(task);
  });

  const tasksByLocation = {};
  pendingTasks.forEach((task) => {
    const loc = task.location || 'other';
    if (!tasksByLocation[loc]) tasksByLocation[loc] = [];
    tasksByLocation[loc].push(task);
  });

  if (showForm || editingTask) {
    return (
      <TypeformTaskForm
        task={editingTask}
        orders={orders}
        onSubmit={handleSubmit}
        onCancel={() => {
          setShowForm(false);
          setEditingTask(null);
        }} />);


  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Tasks</h1>
          <Button onClick={() => setShowForm(true)} className="bg-slate-900 hover:bg-slate-800">
            <Plus className="w-4 h-4 mr-2" /> New Task
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card className="p-4 bg-amber-50 border-0">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-amber-600" />
              <div>
                <p className="text-2xl font-bold text-amber-700">{pendingTasks.length}</p>
                <p className="text-sm text-amber-600">Pending</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 bg-blue-50 border-0">
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-blue-600" />
              <div>
                <p className="text-2xl font-bold text-blue-700">{inProgressTasks.length}</p>
                <p className="text-sm text-blue-600">In Progress</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 bg-emerald-50 border-0">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <div>
                <p className="text-2xl font-bold text-emerald-700">{completedTasks.length}</p>
                <p className="text-sm text-emerald-600">Completed</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Filters */}
        <Card className="p-4 mb-6 bg-white border-0 shadow-sm">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search tasks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10" />

            </div>
            <Select value={phaseFilter} onValueChange={setPhaseFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="Phase" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Phases</SelectItem>
                {Object.entries(phaseConfig).map(([key, config]) =>
                <SelectItem key={key} value={key}>{config.label}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-full md:w-44">
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {Object.entries(locationLabels).map(([key, label]) =>
                <SelectItem key={key} value={key}>{label}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Select value={weekFilter} onValueChange={setWeekFilter}>
              <SelectTrigger className="w-full md:w-36">
                <SelectValue placeholder="Week" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Weeks</SelectItem>
                <SelectItem value="this_week">This Week</SelectItem>
                <SelectItem value="next_week">Next Week</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* Production Phase Overview */}
        {Object.keys(tasksByPhase).length > 0 &&
        <Card className="bg-teal-50 text-white mb-6 p-4 rounded-xl shadow from-slate-800 to-slate-900 border-0">
            <h3 className="text-slate-700 mb-3 font-semibold flex items-center gap-2">Production Phases

          </h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(phaseConfig).map(([key, config]) => {
              const count = tasksByPhase[key]?.length || 0;
              if (count === 0) return null;
              const Icon = config.icon;
              return (
                <button
                  key={key}
                  onClick={() => setPhaseFilter(phaseFilter === key ? "all" : key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                  phaseFilter === key ?
                  'bg-white text-slate-900' :
                  'bg-slate-700 hover:bg-slate-600'}`
                  }>

                    <Icon className="w-4 h-4" />
                    <span>{config.label}</span>
                    <Badge className="bg-white/20 text-white border-0">{count}</Badge>
                  </button>);

            })}
            </div>
          </Card>
        }

        {/* Route Optimization Hint */}
        {Object.keys(tasksByLocation).length > 1 &&
        <Card className="p-4 mb-6 bg-gradient-to-r from-blue-50 to-purple-50 border-0">
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-800">Route Optimization</p>
                <p className="text-sm text-slate-600 mt-1">
                  You have tasks at {Object.keys(tasksByLocation).length} different locations. 
                  Consider grouping pickups.
                </p>
              </div>
            </div>
          </Card>
        }

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="pending">Pending ({pendingTasks.length})</TabsTrigger>
            <TabsTrigger value="in_progress">In Progress ({inProgressTasks.length})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({completedTasks.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            {pendingTasks.length === 0 ?
            <Card className="p-8 text-center bg-white border-0">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                <p className="text-slate-500">No pending tasks</p>
              </Card> :

            <div className="space-y-3">
                {pendingTasks.map((task) =>
              <EnhancedTaskItem
                key={task.id}
                task={task}
                onStatusChange={handleStatusChange} />

              )}
              </div>
            }
          </TabsContent>

          <TabsContent value="in_progress">
            {inProgressTasks.length === 0 ?
            <Card className="p-8 text-center bg-white border-0">
                <p className="text-slate-500">No tasks in progress</p>
              </Card> :

            <div className="space-y-3">
                {inProgressTasks.map((task) =>
              <EnhancedTaskItem
                key={task.id}
                task={task}
                onStatusChange={handleStatusChange} />

              )}
              </div>
            }
          </TabsContent>

          <TabsContent value="completed">
            {completedTasks.length === 0 ?
            <Card className="p-8 text-center bg-white border-0">
                <p className="text-slate-500">No completed tasks yet</p>
              </Card> :

            <div className="space-y-3">
                {completedTasks.slice(0, 20).map((task) =>
              <EnhancedTaskItem
                key={task.id}
                task={task}
                onStatusChange={handleStatusChange} />

              )}
              </div>
            }
          </TabsContent>
        </Tabs>
      </div>
    </div>);

}

function EnhancedTaskItem({ task, onStatusChange }) {
  const isCompleted = task.status === 'completed';
  const phase = phaseConfig[task.phase];
  const PhaseIcon = phase?.icon || Clock;

  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg border bg-white shadow-sm ${isCompleted ? 'opacity-60' : ''}`}>
      <input
        type="checkbox"
        checked={isCompleted}
        onChange={(e) => onStatusChange?.(task.id, e.target.checked ? "completed" : "pending")}
        className="mt-1 w-5 h-5 rounded" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <p className={`font-medium ${isCompleted ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
            {task.title}
          </p>
          {phase &&
          <Badge className={`${phase.color} border-0 text-xs`}>
              <PhaseIcon className="w-3 h-3 mr-1" />
              {phase.label}
            </Badge>
          }
        </div>
        
        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
          {task.location && locationLabels[task.location] &&
          <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {locationLabels[task.location]}
            </span>
          }
          {task.due_date &&
          <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {new Date(task.due_date).toLocaleDateString()}
            </span>
          }
          {task.estimated_time_hours &&
          <span>~{task.estimated_time_hours}h</span>
          }
        </div>
      </div>
    </div>);

}