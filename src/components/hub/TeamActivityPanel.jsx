import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/lib/supabaseClient";
import { isAdmin } from "@/lib/admin";

export default function TeamActivityPanel({ user }) {
  const admin = isAdmin(user);
  const { data: events = [] } = useQuery({ queryKey: ["team-activity"], enabled: admin, queryFn: async () => { const { data, error } = await supabase.from("opps_activity_events").select("id, actor_name, actor_email, event_type, summary, created_at").order("created_at", { ascending: false }).limit(20); if (error) throw error; return data ?? []; } });
  if (!admin) return null;
  return <section className="mb-6 rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="mb-3"><h2 className="text-sm font-semibold text-foreground">Team activity</h2><p className="text-xs text-muted-foreground">Claims, acknowledgements and report submissions across the workspace.</p></div>{events.length === 0 ? <p className="text-sm text-muted-foreground">No activity has been logged yet.</p> : <div className="space-y-2">{events.map(event => <div key={event.id} className="rounded-xl bg-secondary/40 px-3 py-2"><p className="text-sm text-foreground">{event.summary}</p><p className="mt-0.5 text-xs text-muted-foreground">{event.actor_name || event.actor_email} · {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}</p></div>)}</div>}</section>;
}