import React, { useState, useEffect } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Clock, Package, Target, TrendingUp, AlertTriangle, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format, isToday, isPast, startOfWeek, endOfWeek } from "date-fns";

const greetings = ["Good morning", "Good afternoon", "Good evening"];
const getGreeting = () => {
  const h = new Date().getHours();
  return h < 12 ? greetings[0] : h < 18 ? greetings[1] : greetings[2];
};

const statusColors = {
  confirmed: "bg-blue-100 text-blue-700",
  in_production: "bg-orange-100 text-orange-700",
  ready: "bg-green-100 text-green-700",
  shipped: "bg-purple-100 text-purple-700",
  delivered: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-100 text-red-700",
};

export default function Dashboard() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    dataClient.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks-dash"],
    queryFn: () => dataClient.entities.Task.filter({ is_archived: false }),
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["orders-dash"],
    queryFn: () => dataClient.entities.Order.filter({ is_archived: false }, "-created_date", 10),
  });

  const { data: goals = [] } = useQuery({
    queryKey: ["goals-dash"],
    queryFn: () => dataClient.entities.Goal.filter({ status: "active" }),
  });

  const today = new Date();
  const todayTasks = tasks.filter(t => t.deadline && isToday(new Date(t.deadline)) && t.status !== "done");
  const overdueTasks = tasks.filter(t => t.deadline && isPast(new Date(t.deadline)) && !isToday(new Date(t.deadline)) && t.status !== "done");
  const weekTasks = tasks.filter(t => {
    if (!t.deadline || t.status === "done") return false;
    const d = new Date(t.deadline);
    return d >= startOfWeek(today) && d <= endOfWeek(today) && !isToday(d) && !isPast(d);
  });

  const activeOrders = orders.filter(o => !["delivered", "cancelled"].includes(o.status));
  const urgentOrders = orders.filter(o => o.priority === "urgent" && o.status !== "delivered");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        {/* Header */}
        <div className="mb-8">
          <p className="text-muted-foreground text-sm mb-1">{format(today, "EEEE, d MMMM yyyy")}</p>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">
            {getGreeting()}{user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""} 👋
          </h1>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Today" value={todayTasks.length} color="blue" icon={Clock} to="/Tasks" />
          <StatCard label="Overdue" value={overdueTasks.length} color={overdueTasks.length > 0 ? "red" : "slate"} icon={AlertTriangle} to="/Tasks" />
          <StatCard label="Active Orders" value={activeOrders.length} color="orange" icon={Package} to="/Orders" />
          <StatCard label="Goals" value={goals.length} color="purple" icon={Target} to="/Executive" />
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* Tasks Column */}
          <div className="space-y-4">
            {/* Overdue */}
            {overdueTasks.length > 0 && (
              <Section title="Overdue" count={overdueTasks.length} accent="red" link="/Tasks">
                {overdueTasks.slice(0, 3).map(t => <TaskRow key={t.id} task={t} overdue />)}
              </Section>
            )}

            {/* Today */}
            <Section title="Today" count={todayTasks.length} accent="blue" link="/Tasks">
              {todayTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">Nothing due today 🎉</p>
              ) : todayTasks.slice(0, 5).map(t => <TaskRow key={t.id} task={t} />)}
            </Section>

            {/* This Week */}
            {weekTasks.length > 0 && (
              <Section title="This Week" count={weekTasks.length} accent="slate" link="/Tasks">
                {weekTasks.slice(0, 3).map(t => <TaskRow key={t.id} task={t} />)}
              </Section>
            )}
          </div>

          {/* Right Column */}
          <div className="space-y-4">
            {/* Active Orders */}
            <Section title="Active Orders" count={activeOrders.length} accent="orange" link="/Orders">
              {activeOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No active orders</p>
              ) : activeOrders.slice(0, 5).map(o => <OrderRow key={o.id} order={o} />)}
            </Section>

            {/* Goals */}
            {goals.length > 0 && (
              <Section title="Active Goals" count={goals.length} accent="purple" link="/Executive">
                {goals.slice(0, 3).map(g => (
                  <div key={g.id} className="py-2.5 border-b border-border last:border-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-foreground truncate flex-1">{g.title}</p>
                      <span className="text-xs text-muted-foreground ml-2">{g.progress || 0}%</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-1.5">
                      <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${g.progress || 0}%` }} />
                    </div>
                  </div>
                ))}
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon: Icon, to }) {
  const colors = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    red: "bg-red-50 text-red-600 border-red-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    purple: "bg-purple-50 text-purple-600 border-purple-100",
    slate: "bg-secondary text-muted-foreground border-border",
  };
  const inner = (
    <>
      <Icon className="w-4 h-4 mb-2 opacity-70" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium opacity-70 mt-0.5">{label}</p>
    </>
  );
  if (to) return (
    <Link to={to} className={`rounded-2xl border p-4 ${colors[color] || colors.slate} hover:shadow-apple-sm transition-all cursor-pointer block`}>
      {inner}
    </Link>
  );
  return <div className={`rounded-2xl border p-4 ${colors[color] || colors.slate}`}>{inner}</div>;
}

function Section({ title, count, accent, link, children }) {
  const accents = {
    red: "text-red-500",
    blue: "text-primary",
    orange: "text-orange-500",
    purple: "text-purple-500",
    slate: "text-muted-foreground",
  };
  return (
    <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {count > 0 && (
            <span className={`text-xs font-bold ${accents[accent] || accents.slate}`}>({count})</span>
          )}
        </div>
        <Link to={link} className="text-xs text-primary flex items-center gap-0.5 hover:underline">
          View all <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      {children}
    </div>
  );
}

function TaskRow({ task, overdue }) {
  const priorityDot = { urgent: "bg-red-500", high: "bg-orange-400", medium: "bg-yellow-400", low: "bg-slate-300" };
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
      <Circle className={`w-4 h-4 flex-shrink-0 ${overdue ? "text-red-400" : "text-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${overdue ? "text-red-700" : "text-foreground"}`}>{task.title}</p>
        {task.deadline && (
          <p className={`text-xs mt-0.5 ${overdue ? "text-red-400" : "text-muted-foreground"}`}>
            {format(new Date(task.deadline), "d MMM")}
          </p>
        )}
      </div>
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityDot[task.priority] || priorityDot.medium}`} />
    </div>
  );
}

function OrderRow({ order }) {
  const statusColors = {
    confirmed: "bg-blue-100 text-blue-700",
    in_production: "bg-orange-100 text-orange-700",
    ready: "bg-green-100 text-green-700",
    shipped: "bg-purple-100 text-purple-700",
  };
  const trackingUrl = `?order_number=${order.order_number}`;
  
  return (
    <a 
      href={`/TrackOrder${trackingUrl}`}
      className="flex items-center gap-3 py-2.5 border-b border-border last:border-0 hover:bg-secondary/50 rounded-lg px-2 -mx-2 transition-colors cursor-pointer"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{order.client_name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{order.order_number}</p>
      </div>
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[order.status] || "bg-secondary text-muted-foreground"}`}>
        {order.status?.replace("_", " ")}
      </span>
    </a>
  );
}
