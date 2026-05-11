import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataClient } from "@/api/dataClient";
import { supabase } from "@/lib/supabaseClient";
import { AlertTriangle, Bell, CheckSquare, Clock, MessageSquare, Tag, X } from "lucide-react";

const doneStatuses = ["done", "complete", "completed"];

function isAssignedToMe(item, email) {
  if (!email) return false;
  const assigned = item?.assigned_to ?? item?.assignee_email ?? item?.owner_email;
  if (Array.isArray(assigned)) return assigned.includes(email);
  return assigned === email;
}

function buildNotifications(inventory, tags, tasks, opsTasks, fileComments, email) {
  const notes = [];

  for (const item of (inventory || []).filter(i => !i.is_archived && i.reorder_point != null && i.current_stock <= i.reorder_point)) {
    notes.push({
      id: `stock_${item.id}`,
      icon: AlertTriangle,
      color: "text-red-500",
      bg: "bg-red-50",
      title: `Low stock: ${item.name}`,
      body: `${item.current_stock} ${item.unit || "units"} remaining`,
    });
  }

  for (const tag of (tags || [])) {
    notes.push({
      id: `tag_${tag.id}`,
      icon: Tag,
      color: "text-amber-500",
      bg: "bg-amber-50",
      title: "You're tagged on an order",
      body: tag.orders?.order_number ? `${tag.orders.customer_name || "Order"} - ${tag.orders.order_number}` : `Role: ${tag.role_key}`,
    });
  }

  const myTasks = (tasks || []).filter((task) => isAssignedToMe(task, email) || !task.assigned_to);
  const overdue = myTasks.filter(t => t.status === "overdue" || (t.due_date && new Date(t.due_date) < new Date() && !doneStatuses.includes(t.status)));
  for (const task of overdue.slice(0, 5)) {
    notes.push({
      id: `task_${task.id}`,
      icon: CheckSquare,
      color: "text-orange-500",
      bg: "bg-orange-50",
      title: `Overdue: ${task.title}`,
      body: task.due_date ? `Due ${new Date(task.due_date).toLocaleDateString("en-ZA")}` : "No due date set",
    });
  }

  for (const task of myTasks.filter(t => t.priority === "urgent" && !doneStatuses.includes(t.status)).slice(0, 5)) {
    notes.push({
      id: `urgent_task_${task.id}`,
      icon: AlertTriangle,
      color: "text-red-500",
      bg: "bg-red-50",
      title: `Urgent task: ${task.title}`,
      body: task.due_date ? `Due ${new Date(task.due_date).toLocaleDateString("en-ZA")}` : "Needs attention",
    });
  }

  const myOpsTasks = (opsTasks || []).filter((task) => isAssignedToMe(task, email) && !["archived", "complete"].includes(task.status));
  for (const task of myOpsTasks.filter(t => t.priority === "urgent").slice(0, 5)) {
    notes.push({
      id: `urgent_ops_${task.id}`,
      icon: Clock,
      color: "text-red-500",
      bg: "bg-red-50",
      title: `Urgent ops: ${task.title}`,
      body: task.week_number ? `12-week action - week ${task.week_number}` : "Ops calendar action",
    });
  }

  for (const comment of (fileComments || []).slice(0, 5)) {
    notes.push({
      id: `file_comment_${comment.id}`,
      icon: MessageSquare,
      color: "text-blue-500",
      bg: "bg-blue-50",
      title: "You're mentioned on a file",
      body: comment.comment_text ? comment.comment_text.slice(0, 90) : "Open File Manager to review",
    });
  }

  return notes;
}

export default function NotificationsPanel({ placement = "topbar" }) {
  const [open, setOpen] = useState(false);
  const lastNotifiedRef = useRef("");

  const { data: me } = useQuery({
    queryKey: ["authUser", "notifications"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data?.user ?? null;
    },
    staleTime: 120_000,
  });

  const { data: inventory = [] } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => dataClient.entities.InventoryItem.list("name", 200),
    staleTime: 120_000,
  });

  const { data: tags = [] } = useQuery({
    queryKey: ["myTags", "panel", me?.email],
    enabled: !!me?.email,
    queryFn: async () => {
      const { data } = await supabase
        .from("order_tags")
        .select("id, role_key, tag_type, orders(order_number, customer_name, pipeline_stage, source)")
        .eq("user_email", me.email)
        .is("resolved_at", null)
        .limit(10);
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => dataClient.entities.Task.list("-created_date", 100),
    staleTime: 120_000,
  });

  const { data: opsTasks = [] } = useQuery({
    queryKey: ["opsTasks", "notifications"],
    queryFn: () => {
      const OpsTask = /** @type {any} */ (dataClient.entities).OpsTask;
      return OpsTask?.list ? OpsTask.list("-created_date", 100) : [];
    },
    staleTime: 120_000,
  });

  const { data: fileComments = [] } = useQuery({
    queryKey: ["fileComments", "mentions", me?.email],
    enabled: !!me?.email,
    queryFn: () => dataClient.entities.FileComment.filter({ mentioned_user: me.email }, "-created_date", 20),
    staleTime: 60_000,
  });

  const notifications = useMemo(
    () => buildNotifications(inventory, tags, tasks, opsTasks, fileComments, me?.email),
    [inventory, tags, tasks, opsTasks, fileComments, me?.email]
  );
  const count = notifications.length;

  useEffect(() => {
    if (!notifications.length || typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
    const first = notifications[0];
    const signature = `${first.id}:${notifications.length}`;
    if (lastNotifiedRef.current === signature || localStorage.getItem("jx_last_notification") === signature) return;
    lastNotifiedRef.current = signature;
    localStorage.setItem("jx_last_notification", signature);
    const showFallback = () => new Notification("Joint X needs attention", { body: first.title });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((registration) => registration.showNotification("Joint X needs attention", {
          body: first.title,
          tag: first.id,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
        }))
        .catch(showFallback);
    } else {
      showFallback();
    }
  }, [notifications]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-all hover:text-foreground"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`fixed z-50 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-80 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-apple-xl ${
            placement === "sidebar" ? "bottom-20 left-[228px]" : "right-4 top-16"
          }`}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              <button onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Close notifications">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-10 text-center">
                  <Bell className="mx-auto mb-2 h-8 w-8 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">All clear</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {notifications.map(n => (
                    <div key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.bg}`}>
                      <n.icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${n.color}`} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold leading-snug text-foreground">{n.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
