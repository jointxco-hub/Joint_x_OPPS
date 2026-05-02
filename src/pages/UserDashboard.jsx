import { useState, useEffect, useRef } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  CheckCircle2, Circle, Clock,
  Camera, Edit2, Check, X, CalendarDays, ChevronRight, Zap
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { format, isToday, isPast } from "date-fns";
import { toast } from "sonner";

function getCurrentWeek() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
}

const opsStatusColors = {
  not_started: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  complete: "bg-green-100 text-green-700",
  on_hold: "bg-orange-100 text-orange-700",
};

export default function UserDashboard() {
  const [user, setUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    dataClient.auth.me()
      .then(u => { setUser(u); setNewName(u?.full_name || ""); })
      .catch(() => {})
      .finally(() => setUserLoading(false));
  }, []);

  const userEmail = user?.email;
  const currentWeek = getCurrentWeek();

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["user-tasks", userEmail],
    enabled: !!userEmail,
    queryFn: () => dataClient.entities.Task.filter({ assigned_to: userEmail, is_archived: false }),
  });

  const opsEntity = /** @type {any} */ (dataClient.entities).OpsTask;
  const { data: opsTasks = [] } = useQuery({
    queryKey: ["user-opsTasks", userEmail],
    enabled: !!userEmail && !!opsEntity,
    queryFn: () => opsEntity.list("-created_date", 200),
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.Task.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user-tasks"] }),
  });

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
      await dataClient.auth.updateMe({ profile_photo: file_url });
      const updated = await dataClient.auth.me();
      setUser(updated);
      toast.success("Photo updated!");
    } catch {
      toast.error("Photo upload not available.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleNameSave = async () => {
    if (!newName.trim()) return;
    await dataClient.auth.updateMe({ full_name: newName.trim() });
    const updated = await dataClient.auth.me();
    setUser(updated);
    setEditingName(false);
    toast.success("Name updated!");
  };

  // Regular tasks — use due_date (Task normalize alias)
  const pendingTasks = tasks.filter(t => t.status !== "done");
  const todayTasks = tasks.filter(t => t.due_date && isToday(new Date(t.due_date)) && t.status !== "done");
  const overdueTasks = tasks.filter(t =>
    t.due_date && isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date)) && t.status !== "done"
  );

  // Ops tasks — filtered to current user
  const myOpsTasks = opsTasks.filter(t =>
    t.status !== 'archived' &&
    (Array.isArray(t.assigned_to) ? t.assigned_to.includes(userEmail) : t.assigned_to === userEmail)
  );
  const myWeekOpsTasks = myOpsTasks.filter(t => t.week_number === currentWeek);
  const urgentOpsTasks = myOpsTasks.filter(t => t.priority === 'urgent' && t.status !== 'complete');
  const weekDone = myWeekOpsTasks.filter(t => t.status === 'complete').length;
  const weekScore = myWeekOpsTasks.length > 0 ? Math.round((weekDone / myWeekOpsTasks.length) * 100) : 0;
  const inProgressOps = myOpsTasks.filter(t => t.status === 'in_progress');

  if (userLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
  if (!user) return (
    <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm">
      Not signed in.
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 md:py-8">

        {/* Profile Header */}
        <div className="bg-card rounded-3xl border border-border shadow-sm p-6 mb-6">
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
                  <Input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    className="h-8 text-lg font-bold rounded-xl max-w-xs"
                    onKeyDown={e => e.key === "Enter" && handleNameSave()}
                  />
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
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-1 ${weekScore >= 75 ? 'bg-green-100' : weekScore >= 40 ? 'bg-primary/10' : 'bg-slate-100'}`}>
                <span className={`text-xl font-bold ${weekScore >= 75 ? 'text-green-600' : 'text-primary'}`}>{weekScore}%</span>
              </div>
              <p className="text-xs text-muted-foreground">Wk {currentWeek}</p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-card rounded-2xl border border-border p-4 text-center shadow-sm">
            <p className="text-2xl font-bold text-foreground">{todayTasks.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Due Today</p>
          </div>
          <div className={`rounded-2xl border p-4 text-center shadow-sm ${overdueTasks.length > 0 ? "bg-red-50 border-red-100" : "bg-card border-border"}`}>
            <p className={`text-2xl font-bold ${overdueTasks.length > 0 ? "text-red-600" : "text-foreground"}`}>{overdueTasks.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Overdue</p>
          </div>
          <div className={`rounded-2xl border p-4 text-center shadow-sm ${urgentOpsTasks.length > 0 ? "bg-red-50 border-red-100" : "bg-card border-border"}`}>
            <p className={`text-2xl font-bold ${urgentOpsTasks.length > 0 ? "text-red-600" : "text-foreground"}`}>{urgentOpsTasks.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Urgent Ops</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* Ops This Week */}
          <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" /> Ops — Week {currentWeek}
              </h2>
              <Link to="/OpsCalendar" className="text-xs text-primary flex items-center gap-0.5 hover:underline">
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {myWeekOpsTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ops tasks assigned to you this week.</p>
            ) : (
              <>
                {myWeekOpsTasks.slice(0, 5).map(t => (
                  <div key={t.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${t.status === "complete" ? "bg-primary" : t.status === "in_progress" ? "bg-blue-400" : "bg-border"}`} />
                    <p className={`text-sm flex-1 truncate ${t.status === "complete" ? "line-through text-muted-foreground" : "text-foreground"}`}>{t.title}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${opsStatusColors[t.status] || "bg-slate-100 text-slate-600"}`}>
                      {t.status?.replace('_', ' ')}
                    </span>
                  </div>
                ))}
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-muted-foreground">Week progress</p>
                    <p className="text-xs font-semibold text-primary">{weekDone}/{myWeekOpsTasks.length} done</p>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-1.5">
                    <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${weekScore}%` }} />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* In Progress Ops */}
          <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" /> In Progress
              </h2>
              <Link to="/OpsCalendar" className="text-xs text-primary flex items-center gap-0.5 hover:underline">
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {inProgressOps.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in progress right now.</p>
            ) : inProgressOps.slice(0, 5).map(t => (
              <div key={t.id} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                <Clock className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{t.title}</p>
                  {t.client_name && <p className="text-xs text-muted-foreground">{t.client_name}</p>}
                </div>
                {t.priority === 'urgent' && (
                  <span className="text-xs text-red-500 font-semibold flex-shrink-0">!</span>
                )}
              </div>
            ))}
          </div>

          {/* My Tasks */}
          <div className="bg-card rounded-2xl border border-border shadow-sm p-5 md:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" /> My Tasks
              </h2>
              <Link to="/Tasks" className="text-xs text-primary flex items-center gap-0.5 hover:underline">
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : pendingTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">All caught up! 🎉</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-2">
                {pendingTasks.slice(0, 6).map(t => {
                  const isOver = t.due_date && isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date));
                  return (
                    <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl ${isOver ? "bg-red-50 border border-red-100" : "bg-secondary/40"}`}>
                      <Circle className={`w-4 h-4 flex-shrink-0 ${isOver ? "text-red-400" : "text-muted-foreground"}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${isOver ? "text-red-700" : "text-foreground"}`}>{t.title}</p>
                        {t.due_date && <p className={`text-xs ${isOver ? "text-red-400" : "text-muted-foreground"}`}>{format(new Date(t.due_date), "d MMM")}</p>}
                      </div>
                      <button
                        onClick={() => updateTaskMutation.mutate({ id: t.id, data: { status: "done" } })}
                        className="text-muted-foreground hover:text-primary transition-all flex-shrink-0"
                        title="Mark done"
                      >
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
