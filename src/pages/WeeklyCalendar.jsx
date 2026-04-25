import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  Calendar, Plus, CheckCircle, Circle, Clock, ChevronDown, ChevronRight,
  Trash2, StickyNote, Target, X, Users
} from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const statusColors = {
  not_started: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  complete: "bg-green-100 text-green-700",
  on_hold: "bg-orange-100 text-orange-700",
  completed: "bg-green-100 text-green-700"
};

const priorityColors = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-red-100 text-red-700"
};

export default function WeeklyCalendar() {
  const [viewMode, setViewMode] = useState('weekly');
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [editingGoal, setEditingGoal] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const queryClient = useQueryClient();

  const { data: tasks = [] } = useQuery({
    queryKey: ['weeklyTasks'],
    queryFn: () => dataClient.entities.WeeklyTask.list('-created_date', 500)
  });

  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: () => dataClient.entities.Goal.list('-created_date', 200)
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => dataClient.entities.User.list('-created_date', 100)
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => dataClient.entities.Project.list('-created_date', 100)
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => dataClient.entities.Order.list('-created_date', 100)
  });

  const createTaskMutation = useMutation({
    mutationFn: (data) => dataClient.entities.WeeklyTask.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weeklyTasks'] });
      setShowTaskForm(false);
      setEditingTask(null);
      toast.success("Task added!");
    }
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.WeeklyTask.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weeklyTasks'] });
      setShowTaskForm(false);
      setEditingTask(null);
      toast.success("Task updated!");
    }
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (id) => dataClient.entities.WeeklyTask.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weeklyTasks'] });
      setDeleteConfirm(null);
      toast.success("Task deleted!");
    }
  });

  const createGoalMutation = useMutation({
    mutationFn: (data) => dataClient.entities.Goal.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      setShowGoalForm(false);
      setEditingGoal(null);
      toast.success("Goal added!");
    }
  });

  const updateGoalMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.Goal.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      toast.success("Goal updated!");
    }
  });

  const deleteGoalMutation = useMutation({
    mutationFn: (id) => dataClient.entities.Goal.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      setDeleteConfirm(null);
      toast.success("Goal deleted!");
    }
  });

  const weekTasks = viewMode === 'weekly' 
    ? tasks.filter(t => t.week_number === selectedWeek)
    : tasks;

  const completedTasks = weekTasks.filter(t => t.status === 'complete').length;
  const totalSubtasks = weekTasks.reduce((acc, t) => acc + (t.subtasks?.length || 0), 0);
  const completedSubtasks = weekTasks.reduce((acc, t) => 
    acc + (t.subtasks?.filter(s => s.completed).length || 0), 0
  );
  const completionRate = weekTasks.length > 0 
    ? Math.round((completedTasks / weekTasks.length) * 100) 
    : 0;

  const handleStatusToggle = (task) => {
    const newStatus = task.status === 'complete' ? 'not_started' : 'complete';
    updateTaskMutation.mutate({
      id: task.id,
      data: { ...task, status: newStatus }
    });
  };

  // Calculate goal progress based on linked tasks
  const activeGoals = goals.filter(g => g.status !== 'completed');
  
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-3 md:p-8">
        {/* Header */}
        <div className="flex flex-col gap-3 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="w-5 h-5 md:w-6 md:h-6" />
              12-Week Calendar
            </h1>
            <p className="text-sm text-slate-500 mt-1">Plan and track your weekly goals</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button 
              size="sm"
              variant={viewMode === 'weekly' ? 'default' : 'outline'}
              onClick={() => setViewMode('weekly')}
            >
              Weekly
            </Button>
            <Button 
              size="sm"
              variant={viewMode === 'overview' ? 'default' : 'outline'}
              onClick={() => setViewMode('overview')}
            >
              Overview
            </Button>
            <Button size="sm" onClick={() => { setEditingTask(null); setShowTaskForm(true); }}>
              <Plus className="w-3 h-3 md:w-4 md:h-4 mr-1" /> Task
            </Button>
          </div>
        </div>

        {/* Goals Section */}
        {viewMode === 'weekly' && (
          <Card className="mb-6">
            <CardContent className="p-3 md:p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base md:text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <Target className="w-4 h-4 md:w-5 md:h-5" />
                  12-Week Goals
                </h2>
                <Button size="sm" onClick={() => { setEditingGoal(null); setShowGoalForm(true); }}>
                  <Plus className="w-3 h-3 md:w-4 md:h-4 mr-1" /> Goal
                </Button>
              </div>
              {activeGoals.length === 0 ? (
                <p className="text-sm text-slate-400">No active goals</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {activeGoals.map(goal => {
                    const linkedTasks = tasks.filter(t => t.goal_id === goal.id);
                    const completedLinked = linkedTasks.filter(t => t.status === 'complete').length;
                    const autoProgress = linkedTasks.length > 0 
                      ? Math.round((completedLinked / linkedTasks.length) * 100)
                      : goal.progress_percentage || 0;
                    
                    return (
                      <Card key={goal.id} className="bg-slate-50">
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <h3 className="font-medium text-sm text-slate-900">{goal.name}</h3>
                              <p className="text-xs text-slate-600 line-clamp-1">{goal.description}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setDeleteConfirm({ type: 'goal', item: goal })}
                            >
                              <Trash2 className="w-3 h-3 text-red-400" />
                            </Button>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-slate-600">Progress</span>
                                <span className="font-medium">{autoProgress}%</span>
                              </div>
                              <div className="w-full bg-slate-200 rounded-full h-2">
                                <div 
                                  className="bg-green-500 h-2 rounded-full transition-all"
                                  style={{ width: `${autoProgress}%` }}
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <Badge className={statusColors[goal.status]}>
                                {goal.status.replace('_', ' ')}
                              </Badge>
                              {goal.deadline && (
                                <span className="text-slate-500">Due: {goal.deadline}</span>
                              )}
                              {linkedTasks.length > 0 && (
                                <span className="text-slate-500">{linkedTasks.length} tasks</span>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Week Selector & Scorecard */}
        {viewMode === 'weekly' && (
          <Card className="mb-6">
            <CardContent className="p-3 md:p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-xs md:text-sm text-slate-500">Current Week</p>
                  <p className="text-xl md:text-2xl font-bold text-slate-900">Week {selectedWeek}</p>
                  <p className="text-xs md:text-sm text-slate-600 mt-1">
                    {completedTasks}/{weekTasks.length} tasks • {completedSubtasks}/{totalSubtasks} subtasks
                  </p>
                  <div className="mt-2">
                    <div className="w-full max-w-xs bg-slate-200 rounded-full h-2">
                      <div 
                        className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${completionRate}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Weekly Score: {completionRate}%</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button 
                    size="sm"
                    variant="outline" 
                    onClick={() => setSelectedWeek(Math.max(1, selectedWeek - 1))}
                    disabled={selectedWeek === 1}
                  >
                    Previous
                  </Button>
                  <Button 
                    size="sm"
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
          <div className="space-y-3 md:space-y-4">
            {DAYS.map(day => {
              const dayTasks = weekTasks.filter(t => t.day_of_week === day);
              return (
                <Card key={day}>
                  <CardContent className="p-3 md:p-4">
                    <h3 className="font-semibold text-sm md:text-base text-slate-900 mb-3 capitalize">{day}</h3>
                    {dayTasks.length === 0 ? (
                      <p className="text-xs md:text-sm text-slate-400">No tasks for this day</p>
                    ) : (
                      <div className="space-y-2">
                        {dayTasks.map(task => (
                          <TaskRow 
                            key={task.id} 
                            task={task} 
                            users={users}
                            goals={goals}
                            onStatusToggle={handleStatusToggle}
                            onUpdate={(data) => updateTaskMutation.mutate({ id: task.id, data })}
                            onEdit={() => {
                              setEditingTask(task);
                              setShowTaskForm(true);
                            }}
                            onDelete={() => setDeleteConfirm({ type: 'task', item: task })}
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
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
                  <CardContent className="p-3 md:p-4">
                    <h3 className="font-semibold text-sm md:text-base text-slate-900 mb-2">Week {weekNum}</h3>
                    <p className="text-xs md:text-sm text-slate-600 mb-2">
                      {weekTasks.length} tasks
                    </p>
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div 
                        className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${weekRate}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{weekRate}%</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Dialogs */}
        {showTaskForm && (
          <TaskFormDialog 
            task={editingTask}
            users={users}
            projects={projects}
            orders={orders}
            goals={goals}
            onClose={() => {
              setShowTaskForm(false);
              setEditingTask(null);
            }}
            onSubmit={(data) => {
              if (editingTask) {
                updateTaskMutation.mutate({ id: editingTask.id, data });
              } else {
                createTaskMutation.mutate(data);
              }
            }}
          />
        )}

        {showGoalForm && (
          <GoalFormDialog 
            goal={editingGoal}
            onClose={() => {
              setShowGoalForm(false);
              setEditingGoal(null);
            }}
            onSubmit={(data) => {
              if (editingGoal) {
                updateGoalMutation.mutate({ id: editingGoal.id, data });
              } else {
                createGoalMutation.mutate(data);
              }
            }}
          />
        )}

        <ConfirmDialog 
          open={!!deleteConfirm}
          onOpenChange={() => setDeleteConfirm(null)}
          title={`Delete ${deleteConfirm?.type === 'goal' ? 'Goal' : 'Task'}?`}
          description={`Are you sure you want to delete "${deleteConfirm?.item?.name || deleteConfirm?.item?.title}"? This action cannot be undone.`}
          confirmText="Delete"
          onConfirm={() => {
            if (deleteConfirm?.type === 'goal') {
              deleteGoalMutation.mutate(deleteConfirm.item.id);
            } else {
              deleteTaskMutation.mutate(deleteConfirm.item.id);
            }
          }}
          variant="destructive"
        />
      </div>
    </div>
  );
}

function TaskRow({ task, users, goals, onStatusToggle, onUpdate, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [subtaskName, setSubtaskName] = useState("");
  
  const assignedUsers = Array.isArray(task.assigned_to) 
    ? users.filter(u => task.assigned_to.includes(u.email))
    : task.assigned_to ? users.filter(u => u.email === task.assigned_to) : [];

  const linkedGoal = goals?.find(g => g.id === task.goal_id);

  const handleSubtaskToggle = (subtaskId) => {
    const updatedSubtasks = (task.subtasks || []).map(s =>
      s.id === subtaskId ? { ...s, completed: !s.completed } : s
    );
    onUpdate({ ...task, subtasks: updatedSubtasks });
  };

  const handleAddSubtask = () => {
    if (!subtaskName.trim()) return;
    const newSubtask = {
      id: Date.now().toString(),
      name: subtaskName,
      completed: false,
      assigned_to: [],
      due_date: undefined
    };
    const updatedSubtasks = [...(task.subtasks || []), newSubtask];
    onUpdate({ ...task, subtasks: updatedSubtasks });
    setSubtaskName("");
    setShowSubtaskForm(false);
  };

  const handleDeleteSubtask = (subtaskId) => {
    const updatedSubtasks = (task.subtasks || []).filter(s => s.id !== subtaskId);
    onUpdate({ ...task, subtasks: updatedSubtasks });
  };

  const completedSubtasks = (task.subtasks || []).filter(s => s.completed).length;
  const totalSubtasks = task.subtasks?.length || 0;

  return (
    <div className="bg-white rounded-lg border">
      <div className="flex items-start gap-2 md:gap-3 p-2 md:p-3">
        <button onClick={() => onStatusToggle(task)} className="mt-1">
          {task.status === 'complete' ? (
            <CheckCircle className="w-4 h-4 md:w-5 md:h-5 text-green-500" />
          ) : task.status === 'in_progress' ? (
            <Clock className="w-4 h-4 md:w-5 md:h-5 text-blue-500" />
          ) : (
            <Circle className="w-4 h-4 md:w-5 md:h-5 text-slate-300" />
          )}
        </button>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className={`text-xs md:text-sm font-medium break-words ${task.status === 'complete' ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                {task.title}
              </p>
              {task.due_date && (
                <p className="text-xs text-slate-500">Due: {task.due_date}</p>
              )}
              {linkedGoal && (
                <p className="text-xs text-blue-600 mt-1">Goal: {linkedGoal.name}</p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {totalSubtasks > 0 && (
                <span className="text-xs px-2 py-0.5 bg-slate-100 rounded">{completedSubtasks}/{totalSubtasks}</span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 md:gap-2 mt-2">
            {assignedUsers.map(user => (
              <span key={user.id} className="text-xs px-2 py-0.5 bg-slate-100 rounded truncate max-w-[100px]">
                {user.full_name || user.email}
              </span>
            ))}
            <Badge className={`text-xs ${priorityColors[task.priority]}`}>
              {task.priority}
            </Badge>
            <Badge className={`text-xs ${statusColors[task.status]}`}>
              {task.status.replace('_', ' ')}
            </Badge>
            {task.notes && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => setShowNotes(!showNotes)}
              >
                <StickyNote className="w-3 h-3 text-blue-500" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex gap-1 flex-shrink-0">
          <Button variant="ghost" size="icon" className="h-6 w-6 md:h-7 md:w-7" onClick={onEdit}>
            <ChevronRight className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 md:h-7 md:w-7" onClick={onDelete}>
            <Trash2 className="w-3 h-3 text-red-400" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t pt-2">
          {/* Subtasks */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-slate-700">Subtasks</p>
              <Button size="sm" variant="ghost" onClick={() => setShowSubtaskForm(!showSubtaskForm)} className="h-6 text-xs">
                <Plus className="w-3 h-3 mr-1" /> Add
              </Button>
            </div>
            
            {showSubtaskForm && (
              <div className="flex gap-2 mb-2">
                <Input
                  placeholder="Subtask name"
                  value={subtaskName}
                  onChange={(e) => setSubtaskName(e.target.value)}
                  className="h-7 text-xs"
                />
                <Button size="sm" onClick={handleAddSubtask} className="h-7 text-xs">Add</Button>
                <Button size="sm" variant="outline" onClick={() => setShowSubtaskForm(false)} className="h-7 text-xs">Cancel</Button>
              </div>
            )}

            {(task.subtasks || []).map(subtask => (
              <div key={subtask.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded mb-1">
                <Checkbox 
                  checked={subtask.completed}
                  onCheckedChange={() => handleSubtaskToggle(subtask.id)}
                />
                <span className={`text-xs flex-1 ${subtask.completed ? 'line-through text-slate-400' : ''}`}>
                  {subtask.name}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => handleDeleteSubtask(subtask.id)}
                >
                  <Trash2 className="w-3 h-3 text-red-400" />
                </Button>
              </div>
            ))}
          </div>

          {/* Notes */}
          {showNotes && task.notes && (
            <div className="p-2 bg-amber-50 rounded">
              <p className="text-xs text-slate-700">{task.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskFormDialog({ task, users, projects, orders, goals, onClose, onSubmit }) {
  const [formData, setFormData] = useState(task || {
    title: "",
    week_number: 1,
    day_of_week: "monday",
    status: "not_started",
    priority: "medium",
    assigned_to: [],
    due_date: undefined,
    project_id: "",
    order_id: "",
    goal_id: "",
    notes: "",
    subtasks: []
  });

  const [selectedUsers, setSelectedUsers] = useState(
    Array.isArray(task?.assigned_to) ? task.assigned_to : task?.assigned_to ? [task.assigned_to] : []
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ ...formData, assigned_to: selectedUsers });
  };

  const toggleUser = (email) => {
    setSelectedUsers(prev =>
      prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]
    );
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
              <label className="text-sm text-slate-600 mb-1 block">Week</label>
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
            <label className="text-sm text-slate-600 mb-1 block flex items-center gap-2">
              <Users className="w-4 h-4" />
              Assign To (Multi-select)
            </label>
            <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
              {users.map(user => (
                <label key={user.id} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={selectedUsers.includes(user.email)}
                    onCheckedChange={() => toggleUser(user.email)}
                  />
                  <span className="text-sm">{user.full_name || user.email}</span>
                </label>
              ))}
            </div>
            {selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {selectedUsers.map(email => {
                  const user = users.find(u => u.email === email);
                  return (
                    <Badge key={email} variant="outline" className="text-xs">
                      {user?.full_name || email}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="text-sm text-slate-600 mb-1 block">Link to Goal</label>
            <Select value={formData.goal_id} onValueChange={(v) => setFormData({...formData, goal_id: v})}>
              <SelectTrigger>
                <SelectValue placeholder="Optional..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>None</SelectItem>
                {goals?.map(goal => (
                  <SelectItem key={goal.id} value={goal.id}>{goal.name}</SelectItem>
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

          <div>
            <label className="text-sm text-slate-600 mb-1 block">Notes</label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              placeholder="Add notes..."
              rows={3}
            />
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

function GoalFormDialog({ goal, onClose, onSubmit }) {
  const [formData, setFormData] = useState(goal || {
    name: "",
    description: "",
    status: "not_started",
    deadline: "",
    week_number: 12,
    progress_percentage: 0
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{goal ? 'Edit Goal' : 'New Goal'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            placeholder="Goal name"
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            required
          />

          <Textarea
            placeholder="Description"
            value={formData.description}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
            rows={3}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-600 mb-1 block">Status</label>
              <Select value={formData.status} onValueChange={(v) => setFormData({...formData, status: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">Not Started</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="on_hold">On Hold</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-600 mb-1 block">Target Week</label>
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
          </div>

          <div>
            <label className="text-sm text-slate-600 mb-1 block">Deadline</label>
            <Input
              type="date"
              value={formData.deadline}
              onChange={(e) => setFormData({...formData, deadline: e.target.value})}
            />
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{goal ? 'Update' : 'Create'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
