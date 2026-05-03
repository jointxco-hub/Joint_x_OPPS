import { useState, useMemo } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  CalendarDays, ChevronLeft, ChevronRight, Search,
  List, RefreshCw, Calendar, LayoutGrid
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth,
  isSameDay, isToday, addMonths, subMonths, addDays, startOfWeek, endOfWeek, addWeeks
} from "date-fns";
import OpsTaskCard from "@/components/ops/OpsTaskCard";
import OpsTaskFormDialog from "@/components/ops/OpsTaskFormDialog";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CalendarToolbar from "@/components/calendar/CalendarToolbar";
import TwelveWeekView from "@/components/calendar/TwelveWeekView";
import EventModal from "@/components/calendar/EventModal";
import { useActiveCompanyCycle } from "@/hooks/useActiveCompanyCycle";
import { eventColors } from "@/components/calendar/eventColors";

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
  const [viewMode, setViewMode] = useState('twelveWeek');
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeek());
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [defaultDate, setDefaultDate] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [search, setSearch] = useState("");
  const [filterUser, setFilterUser] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [showEventModal, setShowEventModal] = useState(false);
  const [visibleCategories, setVisibleCategories] = useState(Object.keys(eventColors));
  const queryClient = useQueryClient();

  const { data: activeCycle } = useActiveCompanyCycle();

  const { data: tasks = [] } = useQuery({
    queryKey: ['opsTasks'],
    queryFn: () => dataClient.entities.OpsTask.list('-created_date', 500)
  });
  const { data: events = [] } = useQuery({
    queryKey: ['calendarEvents'],
    queryFn: () => dataClient.entities.CalendarEvent.list('-created_date', 500)
  });
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => dataClient.entities.User.list('-created_date', 100)
  });
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => dataClient.entities.Client.list('-created_date', 200)
  });
  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => dataClient.entities.Order.list('-created_date', 200)
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => dataClient.entities.Project.list('-created_date', 100)
  });
  const { data: aletheaProjects = [] } = useQuery({
    queryKey: ['aletheaProjects'],
    queryFn: () => dataClient.entities.AletheaProject.list('-created_date', 100)
  });

  const createMutation = useMutation({
    mutationFn: (data) => dataClient.entities.OpsTask.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['opsTasks'] }); setShowForm(false); toast.success("Task created!"); },
    onError: (err) => toast.error(err?.message || 'Failed to create task'),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.OpsTask.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['opsTasks'] }); setShowForm(false); setEditingTask(null); toast.success("Task updated!"); },
    onError: (err) => toast.error(err?.message || 'Failed to update task'),
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => dataClient.entities.OpsTask.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['opsTasks'] }); setDeleteConfirm(null); toast.success("Task deleted!"); },
    onError: (err) => toast.error(err?.message || 'Failed to delete task'),
  });
  const archiveMutation = useMutation({
    mutationFn: (task) => dataClient.entities.OpsTask.update(task.id, { ...task, status: 'archived' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['opsTasks'] }); toast.success("Task archived!"); },
    onError: (err) => toast.error(err?.message || 'Failed to archive task'),
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

  const toggleCategory = (cat) => {
    setVisibleCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
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

  const calendarDays = useMemo(() => {
    const start = startOfMonth(calendarDate);
    const end = endOfMonth(calendarDate);
    const days = eachDayOfInterval({ start, end });
    const startPad = start.getDay();
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

  const activeTasks = tasks.filter(t => t.status !== 'archived');
  const inProgress = activeTasks.filter(t => t.status === 'in_progress').length;
  const complete = activeTasks.filter(t => t.status === 'complete').length;
  const urgent = activeTasks.filter(t => t.priority === 'urgent').length;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <CalendarDays className="w-6 h-6 text-primary" />
              Ops Calendar
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {activeCycle ? `Cycle: ${activeCycle.name}` : 'Day-to-day operations — team tasks, production & communication'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { queryClient.invalidateQueries({ queryKey: ['opsTasks'] }); queryClient.invalidateQueries({ queryKey: ['calendarEvents'] }); }}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Total Active', value: activeTasks.length, color: 'text-foreground' },
            { label: 'In Progress', value: inProgress, color: 'text-blue-600' },
            { label: 'Completed', value: complete, color: 'text-green-600' },
            { label: 'Urgent', value: urgent, color: 'text-red-600' },
          ].map(s => (
            <Card key={s.label} className="border shadow-sm rounded-xl">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Unified toolbar (new) — includes view switcher + category filters + new event */}
        <CalendarToolbar
          viewMode={viewMode}
          onViewChange={setViewMode}
          categories={visibleCategories}
          onCategoryToggle={toggleCategory}
          onNewEvent={() => setShowEventModal(true)}
        />

        {/* Legacy ops-task filters (kept for list/weekly/calendar views) */}
        {viewMode !== 'twelveWeek' && (
          <Card className="mb-5 border shadow-sm rounded-xl">
            <CardContent className="p-3 flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
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
              <Button
                size="sm"
                onClick={() => { setEditingTask(null); setDefaultDate(null); setShowForm(true); }}
              >
                + New Task
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── 12-Week View (new default) ── */}
        {viewMode === 'twelveWeek' && (
          <TwelveWeekView
            opsTasks={tasks}
            events={events}
            cycle={activeCycle}
            visibleCategories={visibleCategories}
          />
        )}

        {/* ── Calendar (month) View ── */}
        {viewMode === 'calendar' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => setCalendarDate(d => subMonths(d, 1))}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Prev
              </Button>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-foreground text-lg">{format(calendarDate, 'MMMM yyyy')}</h2>
                {!isSameDay(calendarDate, new Date()) && (
                  <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => { setCalendarDate(new Date()); setSelectedDay(new Date()); }}>
                    Today
                  </Button>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => setCalendarDate(d => addMonths(d, 1))}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <Card className="border shadow-sm rounded-xl overflow-hidden">
                  <div className="grid grid-cols-7 bg-foreground">
                    {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                      <div key={d} className="text-center text-xs font-semibold text-background py-2">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {calendarDays.map((day, idx) => {
                      const dayTasks = getTasksForDay(day);
                      const isCurrentMonth = isSameMonth(day, calendarDate);
                      const todayCell = isToday(day);
                      const isSelected = selectedDay && isSameDay(day, selectedDay);
                      return (
                        <button
                          key={idx}
                          onClick={() => setSelectedDay(isSelected ? null : day)}
                          className={`relative min-h-[70px] p-1.5 border-b border-r border-border text-left transition-all
                            ${isCurrentMonth ? 'bg-card hover:bg-secondary/40' : 'bg-secondary/20'}
                            ${isSelected ? 'bg-primary/5 ring-2 ring-inset ring-primary' : ''}
                          `}
                        >
                          <span className={`text-xs font-semibold inline-flex w-6 h-6 items-center justify-center rounded-full
                            ${todayCell ? 'bg-primary text-primary-foreground' : isCurrentMonth ? 'text-foreground' : 'text-muted-foreground/40'}
                          `}>
                            {format(day, 'd')}
                          </span>
                          <div className="mt-1 space-y-0.5">
                            {dayTasks.slice(0, 2).map(t => (
                              <div key={t.id} className={`text-xs px-1 py-0.5 rounded truncate
                                ${t.status === 'complete' ? 'bg-green-100 text-green-700' :
                                  t.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                                  t.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                                  'bg-secondary text-muted-foreground'}`}>
                                {t.title}
                              </div>
                            ))}
                            {dayTasks.length > 2 && (
                              <div className="text-xs text-muted-foreground px-1">+{dayTasks.length - 2} more</div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              </div>

              {selectedDay && (
                <div className="w-72 flex-shrink-0">
                  <Card className="border shadow-sm rounded-xl overflow-hidden sticky top-4">
                    <div className="bg-foreground px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-background font-semibold">{format(selectedDay, 'EEEE')}</p>
                        <p className="text-muted-foreground/60 text-xs">{format(selectedDay, 'dd MMMM yyyy')}</p>
                      </div>
                      <button onClick={() => setSelectedDay(null)} className="text-muted-foreground hover:text-background">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                    <CardContent className="p-3 max-h-[400px] overflow-y-auto">
                      {selectedDayTasks.length === 0 ? (
                        <div className="text-center py-6">
                          <p className="text-xs text-muted-foreground">No tasks due this day</p>
                          <button
                            onClick={() => { setEditingTask(null); setDefaultDate(format(selectedDay, 'yyyy-MM-dd')); setShowForm(true); }}
                            className="mt-2 text-xs text-primary font-medium"
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
                              onArchive={() => archiveMutation.mutate(task)}
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

        {/* ── Week Navigator ── */}
        {viewMode === 'weekly' && (() => {
          const jan1 = new Date(new Date().getFullYear(), 0, 1);
          const wStart = addDays(jan1, (selectedWeek - 1) * 7);
          const wEnd = addDays(wStart, 6);
          return (
            <div className="flex items-center justify-between mb-4">
              <Button variant="outline" size="sm" onClick={() => setSelectedWeek(Math.max(1, selectedWeek - 1))}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Prev
              </Button>
              <div className="text-center">
                <p className="font-bold text-foreground text-lg">Week {selectedWeek}</p>
                <p className="text-xs text-muted-foreground">{format(wStart, 'd MMM')} – {format(wEnd, 'd MMM')} · {weekTasks.length} tasks</p>
                {selectedWeek !== getCurrentWeek() && (
                  <button onClick={() => setSelectedWeek(getCurrentWeek())} className="text-xs text-primary hover:underline mt-0.5">
                    Back to current week
                  </button>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelectedWeek(Math.min(52, selectedWeek + 1))}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          );
        })()}

        {/* ── Weekly View ── */}
        {viewMode === 'weekly' && (
          <div className="space-y-4">
            {DAYS.map(day => {
              const dayTasks = weekTasks.filter(t => t.day_of_week === day);
              return (
                <Card key={day} className="border shadow-sm rounded-xl overflow-hidden">
                  <div className="bg-foreground/90 px-4 py-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-background capitalize">{day}</h3>
                    <span className="text-xs text-muted-foreground/60">{dayTasks.length} task{dayTasks.length !== 1 ? 's' : ''}</span>
                  </div>
                  <CardContent className="p-3">
                    {dayTasks.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">No tasks — free day!</p>
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

        {/* ── List View ── */}
        {viewMode === 'list' && (() => {
          const all = applyFilters(tasks);
          const STATUS_ORDER = ['not_started', 'in_progress', 'on_hold', 'complete', 'archived'];
          const STATUS_LABELS = { not_started: 'Not Started', in_progress: 'In Progress', on_hold: 'On Hold', complete: 'Complete', archived: 'Archived' };
          const grouped = STATUS_ORDER.reduce((acc, s) => {
            const items = all.filter(t => t.status === s);
            if (items.length) acc[s] = items;
            return acc;
          }, {});
          if (all.length === 0) return (
            <Card className="border shadow-sm rounded-xl">
              <CardContent className="p-8 text-center">
                <p className="text-muted-foreground text-sm">No tasks found. Create one with "+ New Task".</p>
              </CardContent>
            </Card>
          );
          return (
            <div className="space-y-5">
              {Object.entries(grouped).map(([status, items]) => (
                <div key={status}>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusColors[status]}`}>{STATUS_LABELS[status]}</span>
                    <span className="text-xs text-muted-foreground">{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map(task => (
                      <OpsTaskCard
                        key={task.id}
                        task={task}
                        users={users}
                        onStatusToggle={handleStatusToggle}
                        onUpdate={(data) => updateMutation.mutate({ id: task.id, data })}
                        onEdit={() => { setEditingTask(task); setShowForm(true); }}
                        onDelete={() => setDeleteConfirm(task)}
                        onArchive={() => archiveMutation.mutate(task)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Dialogs */}
        {showForm && (
          <OpsTaskFormDialog
            task={editingTask}
            users={users}
            clients={clients}
            orders={orders}
            projects={projects}
            aletheaProjects={aletheaProjects}
            onClose={() => { setShowForm(false); setEditingTask(null); setDefaultDate(null); }}
            onSubmit={handleSubmit}
            defaultDate={defaultDate}
          />
        )}

        <EventModal
          open={showEventModal}
          onClose={() => setShowEventModal(false)}
        />

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
