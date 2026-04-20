import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  CalendarDays, Plus, ChevronLeft, ChevronRight, Search,
  LayoutGrid, List, Users, RefreshCw, Archive, Calendar
} from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, addMonths, subMonths } from "date-fns";
import OpsTaskCard from "@/components/ops/OpsTaskCard";
import OpsTaskFormDialog from "@/components/ops/OpsTaskFormDialog";
import ConfirmDialog from "@/components/common/ConfirmDialog";

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const statusColors = {
  not_started: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  complete: "bg-green-100 text-green-700",
  on_hold: "bg-orange-100 text-orange-700",
  archived: "bg-slate-100 text-slate-400"
};

function getCurrentWeek() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
}

export default function OpsCalendar() {
  const [viewMode, setViewMode] = useState('calendar');
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeek());
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [search, setSearch] = useState("");
  const [filterUser, setFilterUser] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const queryClient = useQueryClient();

  const { data: tasks = [] } = useQuery({
    queryKey: ['opsTasks'],
    queryFn: () => base44.entities.OpsTask.list('-created_date', 500)
  });
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list('-created_date', 100)
  });
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list('-created_date', 200)
  });
  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 200)
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date', 100)
  });
  const { data: aletheaProjects = [] } = useQuery({
    queryKey: ['aletheaProjects'],
    queryFn: () => base44.entities.AletheaProject.list('-created_date', 100)
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.OpsTask.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['opsTasks'] }); setShowForm(false); toast.success("Task created!"); }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.OpsTask.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['opsTasks'] }); setShowForm(false); setEditingTask(null); toast.success("Task updated!"); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.OpsTask.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['opsTasks'] }); setDeleteConfirm(null); toast.success("Task deleted!"); }
  });
  const archiveMutation = useMutation({
    mutationFn: (task) => base44.entities.OpsTask.update(task.id, { ...task, status: 'archived' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['opsTasks'] }); toast.success("Task archived!"); }
  });

  const handleStatusToggle = (task) => {
    const next = task.status === 'complete' ? 'not_started' : task.status === 'not_started' ? 'in_progress' : 'complete';
    updateMutation.mutate({ id: task.id, data: { ...task, status: next } });
  };

  const handleSubmit = (data) => {
    if (editingTask) {
      updateMutation.mutate({ id: editingTask.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const applyFilters = (list) => {
    return list.filter(t => {
      if (t.status === 'archived' && filterStatus !== 'archived') return false;
      if (search && !t.title?.toLowerCase().includes(search.toLowerCase()) &&
          !t.client_name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterUser !== 'all' && !(t.assigned_to || []).includes(filterUser)) return false;
      if (filterStatus !== 'all' && t.status !== filterStatus) return false;
      if (filterType !== 'all' && t.production_type !== filterType) return false;
      return true;
    });
  };

  const weekTasks = applyFilters(
    viewMode === 'weekly' ? tasks.filter(t => t.week_number === selectedWeek) : tasks
  );

  // Calendar helpers — tasks with a deadline get shown on their date day
  const calendarDays = useMemo(() => {
    const start = startOfMonth(calendarDate);
    const end = endOfMonth(calendarDate);
    const days = eachDayOfInterval({ start, end });
    // pad to start from Sunday
    const startPad = start.getDay(); // 0=Sun
    const padDays = Array.from({ length: startPad }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() - (startPad - i));
      return d;
    });
    return [...padDays, ...days];
  }, [calendarDate]);

  const getTasksForDay = (day) => applyFilters(
    tasks.filter(t => t.deadline && isSameDay(new Date(t.deadline), day))
  );

  const selectedDayTasks = selectedDay ? getTasksForDay(selectedDay) : [];

  // Stats
  const activeTasks = tasks.filter(t => t.status !== 'archived');
  const inProgress = activeTasks.filter(t => t.status === 'in_progress').length;
  const complete = activeTasks.filter(t => t.status === 'complete').length;
  const urgent = activeTasks.filter(t => t.priority === 'urgent').length;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <CalendarDays className="w-6 h-6 text-[#0F9B8E]" />
              Ops Calendar
            </h1>
            <p className="text-sm text-slate-500 mt-1">Day-to-day operations — team tasks, production & communication</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="ghost" size="icon" onClick={() => queryClient.invalidateQueries()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'calendar' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('calendar')}
            >
              <Calendar className="w-3.5 h-3.5 mr-1" /> Calendar
            </Button>
            <Button
              variant={viewMode === 'weekly' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('weekly')}
            >
              Weekly
            </Button>
            <Button
              variant={viewMode === 'overview' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('overview')}
            >
              Overview
            </Button>
            <Button
              size="sm"
              className="bg-[#0F9B8E] hover:bg-[#0d8a7e]"
              onClick={() => { setEditingTask(null); setShowForm(true); }}
            >
              <Plus className="w-4 h-4 mr-1" /> New Task
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Total Active', value: activeTasks.length, color: 'text-slate-800' },
            { label: 'In Progress', value: inProgress, color: 'text-blue-600' },
            { label: 'Completed', value: complete, color: 'text-green-600' },
            { label: 'Urgent', value: urgent, color: 'text-red-600' },
          ].map(s => (
            <Card key={s.label} className="border-0 shadow-sm rounded-xl">
              <CardContent className="p-4">
                <p className="text-xs text-slate-500">{s.label}</p>
                <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card className="mb-5 border-0 shadow-sm rounded-xl">
          <CardContent className="p-3 flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search tasks or clients..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 rounded-lg"
              />
            </div>
            <Select value={filterUser} onValueChange={setFilterUser}>
              <SelectTrigger className="w-36 h-9 rounded-lg"><SelectValue placeholder="All Members" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Members</SelectItem>
                {users.map(u => <SelectItem key={u.id} value={u.email}>{u.full_name || u.email}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-32 h-9 rounded-lg"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="not_started">Not Started</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-36 h-9 rounded-lg"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="single">Single</SelectItem>
                <SelectItem value="bulk">Bulk</SelectItem>
                <SelectItem value="x1_sample_pack">X1 Sample Pack</SelectItem>
                <SelectItem value="alethea">Alethea</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Calendar View */}
        {viewMode === 'calendar' && (
          <div className="space-y-4">
            {/* Month Navigator */}
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => setCalendarDate(d => subMonths(d, 1))}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Prev
              </Button>
              <h2 className="font-bold text-slate-900 text-lg">{format(calendarDate, 'MMMM yyyy')}</h2>
              <Button variant="outline" size="sm" onClick={() => setCalendarDate(d => addMonths(d, 1))}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>

            <div className="flex gap-4">
              {/* Month grid */}
              <div className="flex-1">
                <Card className="border-0 shadow-sm rounded-xl overflow-hidden">
                  {/* Day headers */}
                  <div className="grid grid-cols-7 bg-slate-800">
                    {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                      <div key={d} className="text-center text-xs font-semibold text-slate-300 py-2">{d}</div>
                    ))}
                  </div>
                  {/* Day cells */}
                  <div className="grid grid-cols-7">
                    {calendarDays.map((day, idx) => {
                      const dayTasks = getTasksForDay(day);
                      const isCurrentMonth = isSameMonth(day, calendarDate);
                      const today = isToday(day);
                      const isSelected = selectedDay && isSameDay(day, selectedDay);
                      const hasUrgent = dayTasks.some(t => t.priority === 'urgent');
                      return (
                        <button
                          key={idx}
                          onClick={() => setSelectedDay(isSelected ? null : day)}
                          className={`relative min-h-[70px] p-1.5 border-b border-r border-slate-100 text-left transition-all
                            ${isCurrentMonth ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/50'}
                            ${isSelected ? 'bg-blue-50 ring-2 ring-inset ring-[#0F9B8E]' : ''}
                          `}
                        >
                          <span className={`text-xs font-semibold inline-flex w-6 h-6 items-center justify-center rounded-full
                            ${today ? 'bg-[#0F9B8E] text-white' : isCurrentMonth ? 'text-slate-700' : 'text-slate-300'}
                          `}>
                            {format(day, 'd')}
                          </span>
                          <div className="mt-1 space-y-0.5">
                            {dayTasks.slice(0, 2).map(t => (
                              <div key={t.id} className={`text-xs px-1 py-0.5 rounded truncate
                                ${t.status === 'complete' ? 'bg-green-100 text-green-700' :
                                  t.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                                  t.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                                  'bg-slate-100 text-slate-600'}`}>
                                {t.title}
                              </div>
                            ))}
                            {dayTasks.length > 2 && (
                              <div className="text-xs text-slate-400 px-1">+{dayTasks.length - 2} more</div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              </div>

              {/* Day detail panel */}
              {selectedDay && (
                <div className="w-72 flex-shrink-0">
                  <Card className="border-0 shadow-sm rounded-xl overflow-hidden sticky top-4">
                    <div className="bg-slate-800 px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-white font-semibold">{format(selectedDay, 'EEEE')}</p>
                        <p className="text-slate-300 text-xs">{format(selectedDay, 'dd MMMM yyyy')}</p>
                      </div>
                      <button onClick={() => setSelectedDay(null)} className="text-slate-400 hover:text-white">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                    <CardContent className="p-3 max-h-[400px] overflow-y-auto">
                      {selectedDayTasks.length === 0 ? (
                        <div className="text-center py-6">
                          <p className="text-xs text-slate-400">No tasks due this day</p>
                          <button
                            onClick={() => { setEditingTask(null); setShowForm(true); }}
                            className="mt-2 text-xs text-[#0F9B8E] font-medium"
                          >
                            + Add task
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {selectedDayTasks.map(task => (
                            <OpsTaskCard
                              key={task.id}
                              task={task}
                              users={users}
                              onStatusToggle={handleStatusToggle}
                              onUpdate={(data) => updateMutation.mutate({ id: task.id, data })}
                              onEdit={() => { setEditingTask(task); setShowForm(true); }}
                              onDelete={() => setDeleteConfirm(task)}
                            />
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Week Navigator */}
        {viewMode === 'weekly' && (
          <div className="flex items-center justify-between mb-4">
            <Button variant="outline" size="sm" onClick={() => setSelectedWeek(Math.max(1, selectedWeek - 1))}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Prev
            </Button>
            <div className="text-center">
              <p className="font-bold text-slate-900 text-lg">Week {selectedWeek}</p>
              <p className="text-xs text-slate-500">{weekTasks.length} tasks</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setSelectedWeek(Math.min(52, selectedWeek + 1))}>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Weekly View */}
        {viewMode === 'weekly' && (
          <div className="space-y-4">
            {DAYS.map(day => {
              const dayTasks = weekTasks.filter(t => t.day_of_week === day);
              return (
                <Card key={day} className="border-0 shadow-sm rounded-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white capitalize">{day}</h3>
                    <span className="text-xs text-slate-300">{dayTasks.length} task{dayTasks.length !== 1 ? 's' : ''}</span>
                  </div>
                  <CardContent className="p-3">
                    {dayTasks.length === 0 ? (
                      <p className="text-xs text-slate-400 py-2">No tasks — free day!</p>
                    ) : (
                      <div className="space-y-2">
                        {dayTasks.map(task => (
                          <OpsTaskCard
                            key={task.id}
                            task={task}
                            users={users}
                            onStatusToggle={handleStatusToggle}
                            onUpdate={(data) => updateMutation.mutate({ id: task.id, data })}
                            onEdit={() => { setEditingTask(task); setShowForm(true); }}
                            onDelete={() => setDeleteConfirm(task)}
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

        {/* Overview — week grid */}
        {viewMode === 'overview' && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[...Array(52)].map((_, i) => {
              const wNum = i + 1;
              const wTasks = applyFilters(tasks.filter(t => t.week_number === wNum));
              const done = wTasks.filter(t => t.status === 'complete').length;
              const pct = wTasks.length > 0 ? Math.round((done / wTasks.length) * 100) : 0;
              return (
                <Card
                  key={wNum}
                  className={`cursor-pointer hover:shadow-md transition-all rounded-xl border-0 shadow-sm ${wNum === getCurrentWeek() ? 'ring-2 ring-[#0F9B8E]' : ''}`}
                  onClick={() => { setSelectedWeek(wNum); setViewMode('weekly'); }}
                >
                  <CardContent className="p-3">
                    <p className="text-xs font-bold text-slate-700">Wk {wNum}</p>
                    <p className="text-xs text-slate-500">{wTasks.length} tasks</p>
                    <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2">
                      <div className="bg-[#0F9B8E] h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{pct}%</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Dialogs */}
        {showForm && (
          <OpsTaskFormDialog
            task={editingTask}
            users={users}
            clients={clients}
            orders={orders}
            projects={projects}
            aletheaProjects={aletheaProjects}
            onClose={() => { setShowForm(false); setEditingTask(null); }}
            onSubmit={handleSubmit}
          />
        )}

        <ConfirmDialog
          open={!!deleteConfirm}
          onOpenChange={() => setDeleteConfirm(null)}
          title="Delete Task?"
          description={`Delete "${deleteConfirm?.title}"? This cannot be undone.`}
          confirmText="Delete"
          onConfirm={() => deleteMutation.mutate(deleteConfirm.id)}
          variant="destructive"
        />
      </div>
    </div>
  );
}