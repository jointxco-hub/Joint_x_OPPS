import { useState, useEffect, useMemo, useRef } from "react";
import { dataClient } from "@/api/dataClient";
import { supabase } from "@/lib/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  CheckCircle2, Circle,
  Camera, Edit2, Check, X, CalendarDays, ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { format, isToday, isPast } from "date-fns";
import { toast } from "sonner";

// lib
import { getWeekNumber, scoreColor } from "@/lib/twelveWeekYear";
import { getTaskCompletionPatch, getTaskEntityName, isTaskComplete, toEntityTaskPayload } from "@/lib/taskAdapters";

// hooks
import { useCompanyNorthStar } from "@/hooks/useCompanyNorthStar";
import { useActiveCompanyCycle } from "@/hooks/useActiveCompanyCycle";
import { useMyRole } from "@/hooks/useMyRole";
import { useMyTags } from "@/hooks/useMyTags";
import { useMyExecutionScore } from "@/hooks/useMyExecutionScore";

// hub components
import NorthStarBanner from "@/components/hub/NorthStarBanner";
import CycleProgressBar from "@/components/hub/CycleProgressBar";
import ExecutionScoreCard from "@/components/hub/ExecutionScoreCard";
import MyRoleCard from "@/components/hub/MyRoleCard";
import DailyQbrCheck from "@/components/hub/DailyQbrCheck";
import MyTagsInbox from "@/components/hub/MyTagsInbox";
import KpiTile from "@/components/hub/KpiTile";
import WamPanel from "@/components/hub/WamPanel";

const opsStatusColors = {
  not_started: "bg-slate-100 text-slate-700",
  in_progress: "bg-primary/10 text-primary",
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

  // ── North Star & Cycle ──────────────────────────────────────────────────
  const { data: northStar } = useCompanyNorthStar();
  const { data: cycle } = useActiveCompanyCycle();
  const currentWeek = cycle ? getWeekNumber(cycle.start_date) : 0;

  // ── Role / Tags / Execution Score ────────────────────────────────────────
  const { data: myRole } = useMyRole(userEmail);
  const { data: myTags = [] } = useMyTags(userEmail);
  const { data: execScore } = useMyExecutionScore(userEmail, cycle?.id);

  // ── KPIs (company-scope, or assigned to me) ──────────────────────────────
  const { data: kpis = [] } = useQuery({
    queryKey: ["my-kpis", userEmail],
    enabled: !!userEmail,
    queryFn: () => dataClient.entities.KPI.list("-created_date", 20),
  });

  // ── WAM weekly scores ────────────────────────────────────────────────────
  const { data: weeklyScores = [] } = useQuery({
    queryKey: ["weekly-scores", userEmail, cycle?.id],
    enabled: !!userEmail && !!cycle?.id && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weekly_scores")
        .select("*")
        .eq("user_email", userEmail)
        .eq("cycle_id", cycle.id)
        .order("week_number", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // ── Goals (mine, active) ─────────────────────────────────────────────────
  const { data: myGoals = [] } = useQuery({
    queryKey: ["my-goals", userEmail],
    enabled: !!userEmail,
    queryFn: () =>
      dataClient.entities.Goal.filter({
        assigned_to: userEmail,
        is_archived: false,
      }),
  });

  const { data: whatsappConversations = [] } = useQuery({
    queryKey: ["my-whatsapp-hub"],
    enabled: !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opps_conversations")
        .select(`
          id, unread_count, last_message_at, last_message_preview,
          opps_messages (
            id, created_at, direction,
            opps_message_intelligence ( intent, risk_level, suggested_department )
          )
        `)
        .eq("channel", "whatsapp")
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // ── Ops tasks (primary task entity used across the app) ──────────────────
  const opsEntity = /** @type {any} */ (dataClient.entities).OpsTask;
  const { data: opsTasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["user-opsTasks", userEmail],
    enabled: !!userEmail && !!opsEntity,
    queryFn: () => opsEntity.list("-created_date", 500),
  });

  // ── Legacy Task entity (kept for backwards compat) ────────────────────────
  const { data: legacyTasks = [] } = useQuery({
    queryKey: ["user-tasks", userEmail],
    enabled: !!userEmail,
    queryFn: () =>
      dataClient.entities.Task.filter({ assigned_to: userEmail, is_archived: false }),
  });

  const updateTaskMutation = useMutation({
    mutationFn: (/** @type {any} */ { task, data }) => {
      const entityName = getTaskEntityName(task);
      return dataClient.entities[entityName].update(task.id, toEntityTaskPayload(task, data));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-opsTasks"] });
      queryClient.invalidateQueries({ queryKey: ["user-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["opsTasks"] });
      queryClient.invalidateQueries({ queryKey: ["legacyTasks"] });
    },
    onError: (error) => {
      toast.error(error?.message || "Could not update task");
    },
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

  // ── Derived stats ─────────────────────────────────────────────────────────
  // All OpsTask items assigned to me (primary task entity)
  const myOpsTasks = opsTasks.filter(t =>
    t.status !== "archived" &&
    (Array.isArray(t.assigned_to) ? t.assigned_to.includes(userEmail) : t.assigned_to === userEmail)
  );

  // Merge with legacy Task items assigned to me
  const allMyTasks = [
    ...myOpsTasks,
    ...legacyTasks.filter((/** @type {any} */ lt) => !myOpsTasks.some((/** @type {any} */ ot) => ot.id === lt.id)),
  ];

  const pendingTasks = allMyTasks.filter(t => !isTaskComplete(t));
  const urgentTasks = pendingTasks.filter(t => t.priority === "urgent");
  const todayTasks = allMyTasks.filter(t => {
    const d = t.deadline || t.due_date;
    return d && isToday(new Date(d)) && !isTaskComplete(t);
  });
  const overdueTasks = allMyTasks.filter(t => {
    const d = t.deadline || t.due_date;
    return d && isPast(new Date(d)) && !isToday(new Date(d)) && !isTaskComplete(t);
  });
  const urgentOpsTasks = myOpsTasks.filter(t => t.priority === "urgent" && !isTaskComplete(t));
  const myWeekOpsTasks = myOpsTasks.filter(t => t.week_number === currentWeek);
  const weekDone = myWeekOpsTasks.filter(isTaskComplete).length;
  const weekScore = myWeekOpsTasks.length > 0
    ? Math.round((weekDone / myWeekOpsTasks.length) * 100)
    : 0;

  const whatsappWidgets = useMemo(() => {
    const latestByConversation = whatsappConversations.map((conversation) => {
      const latestMessage = [...(conversation.opps_messages || [])].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0];
      return {
        ...conversation,
        latestMessage,
        intelligence: latestMessage?.opps_message_intelligence?.[0],
      };
    });

    return {
      actionNeeded: latestByConversation.filter((item) => Number(item.unread_count || 0) > 0).length,
      design: latestByConversation.filter((item) => item.intelligence?.intent === "artwork_request").length,
      production: latestByConversation.filter((item) => item.intelligence?.intent === "order_update").length,
      finance: latestByConversation.filter((item) => item.intelligence?.intent === "invoice_request").length,
      activity: latestByConversation.filter((item) => item.intelligence?.intent === "team_log").length,
    };
  }, [whatsappConversations]);
  // ── Guards ────────────────────────────────────────────────────────────────
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

        {/* 1 — North Star Banner */}
        <NorthStarBanner northStar={northStar} />

        {/* 2 — Profile Header */}
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

            {/* Execution score badge (desktop) */}
            {execScore !== undefined && (
              <div className="text-center hidden md:block">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-1 ${
                  scoreColor(execScore) === 'green' ? 'bg-green-100' :
                  scoreColor(execScore) === 'amber' ? 'bg-amber-100' : 'bg-red-100'
                }`}>
                  <span className={`text-xl font-bold ${
                    scoreColor(execScore) === 'green' ? 'text-green-600' :
                    scoreColor(execScore) === 'amber' ? 'text-amber-600' : 'text-red-600'
                  }`}>{execScore}%</span>
                </div>
                <p className="text-xs text-muted-foreground">Exec Score</p>
              </div>
            )}
          </div>
        </div>

        {/* 3 — Cycle Progress Bar */}
        <CycleProgressBar cycle={cycle} />

        {/* 4 — 3-col row: Execution Score | My Role | Daily QBR */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <ExecutionScoreCard score={execScore} />
          <MyRoleCard role={myRole} />
          <DailyQbrCheck userEmail={userEmail} />
        </div>

        {/* 5 — Stats row */}
        <div className="grid grid-cols-2 gap-3 mb-6 md:grid-cols-4">
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
          <div className={`rounded-2xl border p-4 text-center shadow-sm ${(urgentTasks.length + myTags.length) > 0 ? "bg-amber-50 border-amber-100" : "bg-card border-border"}`}>
            <p className={`text-2xl font-bold ${(urgentTasks.length + myTags.length) > 0 ? "text-amber-700" : "text-foreground"}`}>{urgentTasks.length + myTags.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Needs Me</p>
          </div>
        </div>

        {/* 6 — Goals + Ops Week grid */}
        <div className="grid md:grid-cols-2 gap-5 mb-6">
          {/* My Goals */}
          <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" /> My Goals
              </h2>
              <Link to="/Goals" className="text-xs text-primary flex items-center gap-0.5 hover:underline">
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {myGoals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active goals yet.</p>
            ) : (
              <div className="space-y-2">
                {myGoals.slice(0, 4).map(g => (
                  <div key={g.id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{g.title}</p>
                      <div className="w-full bg-secondary rounded-full h-1 mt-1">
                        <div
                          className="bg-primary h-1 rounded-full"
                          style={{ width: `${g.progress ?? 0}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{g.progress ?? 0}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ops This Week */}
          <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" /> Ops — Week {currentWeek || "—"}
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
                      {t.status?.replace("_", " ")}
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
        </div>

        {/* 7 — My Tags Inbox */}
        <MyTagsInbox tags={myTags} userEmail={userEmail} />

        {/* 7b — WhatsApp / Meta Inbox shortcuts */}
        <div className="mb-6 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">WhatsApp items needing action</h2>
              <p className="text-xs text-muted-foreground">Quick links into the Phase 1 inbox</p>
            </div>
            <Link to="/MetaWhatsAppInbox" className="text-xs text-primary hover:underline">Open inbox</Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <WhatsAppHubCard label="WhatsApp items needing action" value={whatsappWidgets.actionNeeded} to="/MetaWhatsAppInbox?unread=1" />
            <WhatsAppHubCard label="Design requests detected" value={whatsappWidgets.design} to="/MetaWhatsAppInbox?intent=artwork_request" />
            <WhatsAppHubCard label="Production/order update requests" value={whatsappWidgets.production} to="/MetaWhatsAppInbox?intent=order_update" />
            <WhatsAppHubCard label="Finance/invoice/payment queries" value={whatsappWidgets.finance} to="/MetaWhatsAppInbox?intent=invoice_request" />
            <WhatsAppHubCard label="Daily activity signals" value={whatsappWidgets.activity} to="/MetaWhatsAppInbox?intent=team_log" />
          </div>
        </div>

        {/* 8 — KPI grid */}
        {kpis.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">KPIs</h2>
              <Link to="/Goals" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {kpis.slice(0, 6).map(k => <KpiTile key={k.id} kpi={k} />)}
            </div>
          </div>
        )}

        {/* 9 — My Tasks */}
        <div className="bg-card rounded-2xl border border-border shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" /> My Tasks
            </h2>
            <Link to="/Tasks" className="text-xs text-primary flex items-center gap-0.5 hover:underline">
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          {tasksLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : pendingTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">All caught up.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-2">
              {pendingTasks.slice(0, 6).map(t => {
                const dueDate = t.deadline || t.due_date;
                const isOver = dueDate && isPast(new Date(dueDate)) && !isToday(new Date(dueDate));
                const completeTask = () => updateTaskMutation.mutate({ task: t, data: getTaskCompletionPatch(t) });
                return (
                  <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl ${isOver ? "bg-red-50 border border-red-100" : "bg-secondary/40"}`}>
                    <button
                      type="button"
                      onClick={completeTask}
                      className="flex-shrink-0"
                      title="Mark done"
                      aria-label={`Mark ${t.title || "task"} done`}
                    >
                      <Circle className={`w-4 h-4 ${isOver ? "text-red-400" : "text-muted-foreground hover:text-primary"}`} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isOver ? "text-red-700" : "text-foreground"}`}>{t.title}</p>
                      {dueDate && <p className={`text-xs ${isOver ? "text-red-400" : "text-muted-foreground"}`}>{format(new Date(dueDate), "d MMM")}</p>}
                    </div>
                    <button
                      onClick={completeTask}
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

        {/* 10 — WAM Panel */}
        <WamPanel weeklyScores={weeklyScores} currentWeek={currentWeek} />

      </div>
    </div>
  );
}

/**
 * @param {{ label: string; value: string | number; to: string }} props
 */
function WhatsAppHubCard({ label, value, to }) {
  return (
    <Link to={to} className="rounded-2xl border border-border bg-secondary/20 p-4 transition-colors hover:border-primary/30 hover:bg-primary/5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-primary">Open filtered inbox</p>
    </Link>
  );
}
