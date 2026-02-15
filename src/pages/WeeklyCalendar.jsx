import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar, Plus, CheckCircle, Circle, Clock } from "lucide-react";
import { toast } from "sonner";

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const statusColors = {
  not_started: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  complete: "bg-green-100 text-green-700"
};

const priorityColors = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-red-100 text-red-700"
};

export default function WeeklyCalendar() {
  const [viewMode, setViewMode] = useState('weekly'); // 'weekly' or 'overview'
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const queryClient = useQueryClient();

  const { data: tasks = [] } = useQuery({
    queryKey: ['weeklyTasks'],
    queryFn: () => base44.entities.WeeklyTask.list('-created_date', 500)
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list('-created_date', 100)
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date', 100)
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 100)
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.WeeklyTask.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weeklyTasks'] });
      setShowTaskForm(false);
      setEditingTask(null);
      toast.success("Task added!");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.WeeklyTask.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weeklyTasks'] });
      setShowTaskForm(false);
      setEditingTask(null);
      toast.success("Task updated!");
    }
  });

  const weekTasks = viewMode === 'weekly' 
    ? tasks.filter(t => t.week_number === selectedWeek)
    : tasks;

  const completedTasks = weekTasks.filter(t => t.status === 'complete').length;
  const completionRate = weekTasks.length > 0 
    ? Math.round((completedTasks / weekTasks.length) * 100) 
    : 0;

  const handleStatusToggle = (task) => {
    const newStatus = task.status === 'complete' ? 'not_started' : 'complete';
    updateMutation.mutate({
      id: task.id,
      data: { ...task, status: newStatus }
    });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="w-6 h-6" />
              12-Week Calendar
            </h1>
            <p className="text-slate-500 mt-1">Plan and track your weekly goals</p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant={viewMode === 'weekly' ? 'default' : 'outline'}
              onClick={() => setViewMode('weekly')}
            >
              Weekly View
            </Button>
            <Button 
              variant={viewMode === 'overview' ? 'default' : 'outline'}
              onClick={() => setViewMode('overview')}
            >
              12-Week Overview
            </Button>
            <Button onClick={() => { setEditingTask(null); setShowTaskForm(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Add Task
            </Button>
          </div>
        </div>

        {/* Week Selector */}
        {viewMode === 'weekly' && (
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Current Week</p>
                  <p className="text-2xl font-bold text-slate-900">Week {selectedWeek}</p>
                  <p className="text-sm text-slate-600 mt-1">
                    {completedTasks} of {weekTasks.length} tasks complete • {completionRate}%
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => setSelectedWeek(Math.max(1, selectedWeek - 1))}
                    disabled={selectedWeek === 1}
                  >
                    Previous
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => setSelectedWeek(Math.min(12, selectedWeek + 1))}
                    disabled={selectedWeek === 12}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Weekly View */}
        {viewMode === 'weekly' && (
          <div className="space-y-4">
            {DAYS.map(day => {
              const dayTasks = weekTasks.filter(t => t.day_of_week === day);
              return (
                <Card key={day}>
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-slate-900 mb-3 capitalize">{day}</h3>
                    {dayTasks.length === 0 ? (
                      <p className="text-sm text-slate-400">No tasks for this day</p>
                    ) : (
                      <div className="space-y-2">
                        {dayTasks.map(task => (
                          <TaskRow 
                            key={task.id} 
                            task={task} 
                            users={users}
                            onStatusToggle={handleStatusToggle}
                            onEdit={() => {
                              setEditingTask(task);
                              setShowTaskForm(true);
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* 12-Week Overview */}
        {viewMode === 'overview' && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(12)].map((_, i) => {
              const weekNum = i + 1;
              const weekTasks = tasks.filter(t => t.week_number === weekNum);
              const weekComplete = weekTasks.filter(t => t.status === 'complete').length;
              const weekRate = weekTasks.length > 0 
                ? Math.round((weekComplete / weekTasks.length) * 100) 
                : 0;

              return (
                <Card 
                  key={weekNum}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => {
                    setSelectedWeek(weekNum);
                    setViewMode('weekly');
                  }}
                >
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-slate-900 mb-2">Week {weekNum}</h3>
                    <p className="text-sm text-slate-600 mb-2">
                      {weekTasks.length} tasks
                    </p>
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div 
                        className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${weekRate}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{weekRate}% complete</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Task Form Dialog */}
        {showTaskForm && (
          <TaskFormDialog 
            task={editingTask}
            users={users}
            projects={projects}
            orders={orders}
            onClose={() => {
              setShowTaskForm(false);
              setEditingTask(null);
            }}
            onSubmit={(data) => {
              if (editingTask) {
                updateMutation.mutate({ id: editingTask.id, data });
              } else {
                createMutation.mutate(data);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, users, onStatusToggle, onEdit }) {
  const user = users.find(u => u.email === task.assigned_to);
  
  return (
    <div className="flex items-center gap-3 p-3 bg-white rounded-lg border hover:shadow-sm transition-shadow">
      <button onClick={() => onStatusToggle(task)}>
        {task.status === 'complete' ? (
          <CheckCircle className="w-5 h-5 text-green-500" />
        ) : task.status === 'in_progress' ? (
          <Clock className="w-5 h-5 text-blue-500" />
        ) : (
          <Circle className="w-5 h-5 text-slate-300" />
        )}
      </button>
      
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${task.status === 'complete' ? 'line-through text-slate-400' : 'text-slate-900'}`}>
          {task.title}
        </p>
        {task.due_date && (
          <p className="text-xs text-slate-500">Due: {task.due_date}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {user && (
          <span className="text-xs text-slate-600 px-2 py-1 bg-slate-100 rounded">
            {user.full_name || user.email}
          </span>
        )}
        <Badge className={priorityColors[task.priority]}>
          {task.priority}
        </Badge>
        <Badge className={statusColors[task.status]}>
          {task.status.replace('_', ' ')}
        </Badge>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}

function TaskFormDialog({ task, users, projects, orders, onClose, onSubmit }) {
  const [formData, setFormData] = useState(task || {
    title: "",
    week_number: 1,
    day_of_week: "monday",
    status: "not_started",
    priority: "medium",
    assigned_to: "",
    due_date: "",
    project_id: "",
    order_id: "",
    notes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit Task' : 'New Task'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            placeholder="Task title"
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-600 mb-1 block">Week Number</label>
              <Select value={String(formData.week_number)} onValueChange={(v) => setFormData({...formData, week_number: parseInt(v)})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...Array(12)].map((_, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>Week {i + 1}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-600 mb-1 block">Day</label>
              <Select value={formData.day_of_week} onValueChange={(v) => setFormData({...formData, day_of_week: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map(day => (
                    <SelectItem key={day} value={day} className="capitalize">{day}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-slate-600 mb-1 block">Status</label>
              <Select value={formData.status} onValueChange={(v) => setFormData({...formData, status: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">Not Started</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-600 mb-1 block">Priority</label>
              <Select value={formData.priority} onValueChange={(v) => setFormData({...formData, priority: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-600 mb-1 block">Due Date</label>
              <Input
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({...formData, due_date: e.target.value})}
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-slate-600 mb-1 block">Assign To</label>
            <Select value={formData.assigned_to} onValueChange={(v) => setFormData({...formData, assigned_to: v})}>
              <SelectTrigger>
                <SelectValue placeholder="Select team member..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Unassigned</SelectItem>
                {users.map(user => (
                  <SelectItem key={user.id} value={user.email}>
                    {user.full_name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-600 mb-1 block">Link to Project</label>
              <Select value={formData.project_id} onValueChange={(v) => setFormData({...formData, project_id: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Optional..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None</SelectItem>
                  {projects.map(project => (
                    <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-600 mb-1 block">Link to Order</label>
              <Select value={formData.order_id} onValueChange={(v) => setFormData({...formData, order_id: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Optional..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None</SelectItem>
                  {orders.map(order => (
                    <SelectItem key={order.id} value={order.id}>{order.order_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{task ? 'Update' : 'Create'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}