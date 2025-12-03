import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus, CheckCircle2, Clock, MapPin } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TaskItem from "@/components/dashboard/TaskItem";
import TypeformTaskForm from "@/components/tasks/TypeformTaskForm";

export default function Tasks() {
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [activeTab, setActiveTab] = useState("pending");
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

  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  const tasksByLocation = {};
  pendingTasks.forEach(task => {
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
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-4 md:p-8">
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

        {/* Route Optimization Hint */}
        {Object.keys(tasksByLocation).length > 1 && (
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
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="pending">Pending ({pendingTasks.length})</TabsTrigger>
            <TabsTrigger value="in_progress">In Progress ({inProgressTasks.length})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({completedTasks.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            {pendingTasks.length === 0 ? (
              <Card className="p-8 text-center bg-white border-0">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                <p className="text-slate-500">No pending tasks</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {pendingTasks.map(task => (
                  <TaskItem 
                    key={task.id} 
                    task={task} 
                    onStatusChange={handleStatusChange}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="in_progress">
            {inProgressTasks.length === 0 ? (
              <Card className="p-8 text-center bg-white border-0">
                <p className="text-slate-500">No tasks in progress</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {inProgressTasks.map(task => (
                  <TaskItem 
                    key={task.id} 
                    task={task} 
                    onStatusChange={handleStatusChange}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="completed">
            {completedTasks.length === 0 ? (
              <Card className="p-8 text-center bg-white border-0">
                <p className="text-slate-500">No completed tasks yet</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {completedTasks.slice(0, 20).map(task => (
                  <TaskItem 
                    key={task.id} 
                    task={task} 
                    onStatusChange={handleStatusChange}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}