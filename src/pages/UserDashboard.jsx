import React, { useState, useEffect, useRef } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { 
  Target, CheckCircle2, Circle, Clock, TrendingUp, 
  Plus, Camera, User, ChevronRight, BarChart2, Calendar,
  Edit2, Check, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { format, isToday, isPast } from "date-fns";
import { toast } from "sonner";

export default function UserDashboard() {
  const [user, setUser] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    dataClient.auth.me().then(u => { setUser(u); setNewName(u?.full_name || ""); }).catch(() => {});
  }, []);

  const userEmail = user?.email;

const { data: tasks = [], isLoading } = useQuery({
  queryKey: ["user-tasks", userEmail],
  enabled: !!userEmail,
  queryFn: () =>
    dataClient.entities.Task.filter({
      assigned_to: userEmail,
      is_archived: false,
    }),
});

  const { data: goals = [] } = useQuery({
    queryKey: ["user-goals", user?.email],
    queryFn: () => dataClient.entities.Goal.filter({ assigned_to: user.email, status: "active" }),
    enabled: !!user,
  });

  const { data: weeklyTasks = [] } = useQuery({
    queryKey: ["user-weekly-tasks", user?.email],
    queryFn: () => dataClient.entities.WeeklyTask.list("-created_date", 200),
    enabled: !!user,
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.Task.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user-tasks"] }),
  });

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingPhoto(true);
    const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
    await dataClient.auth.updateMe({ profile_photo: file_url });
    const updated = await dataClient.auth.me();
    setUser(updated);
    setUploadingPhoto(false);
    toast.success("Photo updated!");
  };

  const handleNameSave = async () => {
    if (!newName.trim()) return;
    await dataClient.auth.updateMe({ full_name: newName.trim() });
    const updated = await dataClient.auth.me();
    setUser(updated);
    setEditingName(false);
    toast.success("Name updated!");
  };

  const pendingTasks = tasks.filter(t => t.status !== "done" && t.status !== "overdue");
  const overdueTasks = tasks.filter(t => isPast(new Date(t.deadline || 0)) && !isToday(new Date(t.deadline || 0)) && t.status !== "done");
  const todayTasks = tasks.filter(t => t.deadline && isToday(new Date(t.deadline)) && t.status !== "done");

  // Current week (1-12)
  const currentWeek = Math.min(12, Math.ceil((new Date() - new Date(new Date().getFullYear(), 0, 1)) / (7 * 86400000)));
  const myWeekTasks = weeklyTasks.filter(t => 
    t.week_number === currentWeek && 
    (Array.isArray(t.assigned_to) ? t.assigned_to.includes(user?.email) : t.assigned_to === user?.email)
  );
  const weekDone = myWeekTasks.filter(t => t.status === "complete").length;
  const weekScore = myWeekTasks.length > 0 ? Math.round((weekDone / myWeekTasks.length) * 100) : 0;

  if (!user) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 md:py-8">
        
        {/* Profile Header */}
        <div className="bg-card rounded-3xl border border-border shadow-apple p-6 mb-6">
          <div className="flex items-center gap-5">
            {/* Avatar */}
            <div className="relative group">
              <div className="w-20 h-20 rounded-2xl overflow-hidden bg-primary/10 flex items-center justify-center flex-shrink-0">
                {user.profile_photo ? (
                  <img src={user.profile_photo} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl font-bold text-primary">
                    {(user.full_name || user.email || "U").charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-2xl bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all"
                disabled={uploadingPhoto}
              >
                <Camera className="w-5 h-5 text-white" />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
            </div>

            {/* Name & Role */}
            <div className="flex-1">
              {editingName ? (
                <div className="flex items-center gap-2 mb-1">
                  <Input value={newName} onChange={e => setNewName(e.target.value)} className="h-8 text-lg font-bold rounded-xl max-w-xs" onKeyDown={e => e.key === "Enter" && handleNameSave()} />
                  <button onClick={handleNameSave} className="text-primary"><Check className="w-4 h-4" /></button>
                  <button onClick={() => setEditingName(false)} className="text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-xl font-bold text-foreground">{user.full_name || "Set your name"}</h1>
                  <button onClick={() => setEditingName(true)} className="text-muted-foreground hover:text-foreground transition-all">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <Badge className="mt-1 capitalize">{user.role || "user"}</Badge>
            </div>

            {/* Week Score */}
            <div className="text-center hidden md:block">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-1">
                <span className="text-xl font-bold text-primary">{weekScore}%</span>
              </div>
              <p className="text-xs text-muted-foreground">Week {currentWeek}</p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-card rounded-2xl border border-border p-4 text-center shadow-apple-sm">
            <p className="text-2xl font-bold text-foreground">{todayTasks.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Due Today</p>
          </div>
          <div className={`rounded-2xl border p-4 text-center shadow-apple-sm ${overdueTasks.length > 0 ? "bg-red-50 border-red-100" : "bg-card border-border"}`}>
            <p className={`text-2xl font-bold ${overdueTasks.length > 0 ? "text-red-600" : "text-foreground"}`}>{overdueTasks.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Overdue</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4 text-center shadow-apple-sm">
            <p className="text-2xl font-bold text-primary">{goals.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Active Goals</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* 12-Week Goals */}
          <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" /> My Goals
              </h2>
              <Link to="/WeeklyCalendar" className="text-xs text-primary flex items-center gap-0.5 hover:underline">
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {goals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active goals assigned to you.</p>
            ) : goals.slice(0, 4).map(g => (
              <div key={g.id} className="mb-3 last:mb-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-foreground truncate flex-1">{g.title}</p>
                  <span className="text-xs text-muted-foreground ml-2">{g.progress || 0}%</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-1.5">
                  <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${g.progress || 0}%` }} />
                </div>
                {g.end_date && <p className="text-xs text-muted-foreground mt-0.5">Due {format(new Date(g.end_date), "d MMM")}</p>}
              </div>
            ))}
          </div>

          {/* This Week's Tasks */}
          <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" /> Week {currentWeek} Tasks
              </h2>
              <Link to="/WeeklyCalendar" className="text-xs text-primary flex items-center gap-0.5 hover:underline">
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {myWeekTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks for this week.</p>
            ) : myWeekTasks.slice(0, 5).map(t => (
              <div key={t.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${t.status === "complete" ? "bg-primary" : "bg-border"}`} />
                <p className={`text-sm flex-1 truncate ${t.status === "complete" ? "line-through text-muted-foreground" : "text-foreground"}`}>{t.title}</p>
                <span className="text-xs text-muted-foreground capitalize">{t.day_of_week}</span>
              </div>
            ))}
            {/* Week progress bar */}
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">Weekly score</p>
                <p className="text-xs font-semibold text-primary">{weekDone}/{myWeekTasks.length} done</p>
              </div>
              <div className="w-full bg-secondary rounded-full h-1.5">
                <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${weekScore}%` }} />
              </div>
            </div>
          </div>

          {/* My Tasks */}
          <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-5 md:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" /> My Tasks
              </h2>
              <Link to="/Tasks" className="text-xs text-primary flex items-center gap-0.5 hover:underline">
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {pendingTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">All caught up! 🎉</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-2">
                {pendingTasks.slice(0, 6).map(t => {
                  const isOver = t.deadline && isPast(new Date(t.deadline)) && !isToday(new Date(t.deadline));
                  return (
                    <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl ${isOver ? "bg-red-50 border border-red-100" : "bg-secondary/40"}`}>
                      <Circle className={`w-4 h-4 flex-shrink-0 ${isOver ? "text-red-400" : "text-muted-foreground"}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${isOver ? "text-red-700" : "text-foreground"}`}>{t.title}</p>
                        {t.deadline && <p className={`text-xs ${isOver ? "text-red-400" : "text-muted-foreground"}`}>{format(new Date(t.deadline), "d MMM")}</p>}
                      </div>
                      <button onClick={() => updateTaskMutation.mutate({ id: t.id, data: { status: "done" } })} className="text-muted-foreground hover:text-primary transition-all flex-shrink-0">
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
