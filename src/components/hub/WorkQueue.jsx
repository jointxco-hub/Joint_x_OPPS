import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isPast, isToday } from "date-fns";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

function dueLabel(order) {
  if (!order.due_date) return "No due date";
  const due = new Date(order.due_date);
  if (isPast(due) && !isToday(due)) return `Overdue · ${format(due, "d MMM")}`;
  if (isToday(due)) return "Due today";
  return `Due ${format(due, "d MMM")}`;
}

export default function WorkQueue({ user }) {
  const queryClient = useQueryClient();
  const email = user?.email;
  const name = user?.full_name || email;
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["hub-unassigned-orders"],
    enabled: Boolean(email && supabase),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, tenant_id, order_number, client_name, pipeline_stage, priority, due_date, assigned_to")
        .eq("is_archived", false)
        .not("status", "in", "(delivered,cancelled)")
        .or("assigned_to.is.null,assigned_to.eq.")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const claimMutation = useMutation({
    mutationFn: async (order) => {
      const now = new Date().toISOString();
      const { error } = await supabase.from("orders").update({
        assigned_to: email,
        assigned_to_name: name,
        assigned_at: now,
        acknowledged_at: now,
      }).eq("id", order.id).is("assigned_to", null);
      if (error) throw error;
      const { error: eventError } = await supabase.from("opps_activity_events").insert({
        tenant_id: order.tenant_id,
        actor_email: email,
        actor_name: name,
        event_type: "work_claimed",
        entity_type: "order",
        entity_id: order.id,
        summary: `${name} claimed ${order.order_number || "an order"}`,
      });
      if (eventError) throw eventError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hub-unassigned-orders"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Order claimed — the team can now see you own it.");
    },
    onError: (error) => toast.error(error?.message || "Could not claim this order"),
  });

  const visibleOrders = useMemo(() => orders.slice(0, 6), [orders]);
  return <section className="mb-6 rounded-2xl border border-border bg-card p-5 shadow-sm">
    <div className="mb-3 flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-foreground">Available work</h2><p className="text-xs text-muted-foreground">Claim an order so it never waits for an owner.</p></div><span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{orders.length} open</span></div>
    {isLoading ? <p className="text-sm text-muted-foreground">Loading work queue…</p> : visibleOrders.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is waiting to be claimed. Lovely.</p> : <div className="space-y-2">{visibleOrders.map(order => <div key={order.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{order.order_number || "Order"} · {order.client_name || "Client not set"}</p><p className="text-xs text-muted-foreground">{order.pipeline_stage || "Received"} · {dueLabel(order)}</p></div><button type="button" onClick={() => claimMutation.mutate(order)} disabled={claimMutation.isPending} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{claimMutation.isPending ? "Claiming…" : "Claim work"}</button></div>)}</div>}
  </section>;
}