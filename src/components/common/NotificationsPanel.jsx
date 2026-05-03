import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataClient } from "@/api/dataClient";
import { supabase } from "@/lib/supabaseClient";
import { Bell, AlertTriangle, Tag, CheckSquare, X } from "lucide-react";

function buildNotifications(inventory, tags, tasks) {
  const notes = [];

  // Low stock alerts
  const lowStock = (inventory || []).filter(i => !i.is_archived && i.reorder_point != null && i.current_stock <= i.reorder_point);
  for (const item of lowStock) {
    notes.push({
      id: `stock_${item.id}`,
      kind: "stock",
      icon: AlertTriangle,
      color: "text-red-500",
      bg: "bg-red-50",
      title: `Low stock: ${item.name}`,
      body: `${item.current_stock} ${item.unit} remaining (reorder at ${item.reorder_point})`,
    });
  }

  // Unresolved order tags for current user
  for (const tag of (tags || [])) {
    notes.push({
      id: `tag_${tag.id}`,
      kind: "tag",
      icon: Tag,
      color: "text-amber-500",
      bg: "bg-amber-50",
      title: `You're tagged on an order`,
      body: tag.orders?.order_number ? `Order ${tag.orders.order_number} · ${tag.role_key}` : `Role: ${tag.role_key}`,
    });
  }

  // Overdue tasks
  const overdue = (tasks || []).filter(t => t.status === "overdue" || (t.due_date && new Date(t.due_date) < new Date() && !["done","complete"].includes(t.status)));
  for (const task of overdue.slice(0, 5)) {
    notes.push({
      id: `task_${task.id}`,
      kind: "task",
      icon: CheckSquare,
      color: "text-orange-500",
      bg: "bg-orange-50",
      title: `Overdue: ${task.title}`,
      body: task.due_date ? `Due ${new Date(task.due_date).toLocaleDateString("en-ZA")}` : "No due date set",
    });
  }

  return notes;
}

export default function NotificationsPanel({ placement = "topbar" }) {
  const [open, setOpen] = useState(false);

  const { data: inventory = [] } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => dataClient.entities.InventoryItem.list("name", 200),
    staleTime: 120_000,
  });

  const { data: tags = [] } = useQuery({
    queryKey: ["myTags", "panel"],
    queryFn: async () => {
      const { data: me } = await supabase.auth.getUser();
      if (!me?.user?.email) return [];
      const { data } = await supabase
        .from("order_tags")
        .select("id, role_key, orders(order_number)")
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

  const notifications = buildNotifications(inventory, tags, tasks);
  const count = notifications.length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative w-8 h-8 flex items-center justify-center rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-all"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`fixed z-50 w-80 max-h-[70vh] bg-card border border-border rounded-2xl shadow-apple-xl overflow-hidden flex flex-col ${
            placement === "sidebar"
              ? "bottom-20 left-[228px]"
              : "top-14 right-4"
          }`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="text-center py-10">
                  <Bell className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">All clear</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {notifications.map(n => (
                    <div key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.bg}`}>
                      <n.icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${n.color}`} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground leading-snug">{n.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
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
