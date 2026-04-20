import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { BarChart2, TrendingUp, DollarSign, Package, Users, Target, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";

const PIN = "1234";

export default function Executive() {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const handlePin = (e) => {
    e.preventDefault();
    if (pin === PIN) {
      setUnlocked(true);
      setError("");
    } else {
      setError("Incorrect PIN");
      setPin("");
    }
  };

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card rounded-3xl border border-border shadow-apple-xl p-8 w-full max-w-sm text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-1">Executive View</h2>
          <p className="text-muted-foreground text-sm mb-6">Enter PIN to access financial overview</p>
          <form onSubmit={handlePin} className="space-y-3">
            <Input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              placeholder="Enter PIN"
              className="text-center text-lg tracking-widest rounded-xl"
              maxLength={6}
              autoFocus
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button type="submit" className="w-full rounded-xl">Unlock</Button>
          </form>
        </div>
      </div>
    );
  }

  return <ExecutiveDashboard />;
}

function ExecutiveDashboard() {
  const { data: orders = [] } = useQuery({
    queryKey: ["exec-orders"],
    queryFn: () => base44.entities.Order.list("-created_date", 500),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["exec-payments"],
    queryFn: () => base44.entities.Payment.list("-payment_date", 500),
  });

  const { data: goals = [] } = useQuery({
    queryKey: ["exec-goals"],
    queryFn: () => base44.entities.Goal.list(),
  });

  // Revenue by month (last 6 months)
  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const month = subMonths(new Date(), 5 - i);
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    const monthPayments = payments.filter(p => {
      if (!p.payment_date || p.status !== "completed") return false;
      const d = new Date(p.payment_date);
      return d >= start && d <= end;
    });
    return {
      month: format(month, "MMM"),
      revenue: monthPayments.reduce((s, p) => s + (p.amount || 0), 0),
      orders: orders.filter(o => {
        if (!o.created_date) return false;
        const d = new Date(o.created_date);
        return d >= start && d <= end;
      }).length,
    };
  });

  const totalRevenue = payments.filter(p => p.status === "completed").reduce((s, p) => s + (p.amount || 0), 0);
  const thisMonthRevenue = monthlyData[monthlyData.length - 1]?.revenue || 0;
  const lastMonthRevenue = monthlyData[monthlyData.length - 2]?.revenue || 0;
  const revenueGrowth = lastMonthRevenue > 0 ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1) : 0;

  const activeOrders = orders.filter(o => !["delivered", "cancelled"].includes(o.status) && !o.is_archived).length;
  const totalOrderValue = orders.filter(o => !o.is_archived).reduce((s, o) => s + (o.total_amount || 0), 0);
  const avgOrderValue = orders.length > 0 ? totalOrderValue / orders.length : 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        <div className="mb-7">
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-primary" /> Executive Overview
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">{format(new Date(), "MMMM yyyy")}</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <KPICard label="Total Revenue" value={`R${totalRevenue.toLocaleString()}`} icon={DollarSign} color="green" />
          <KPICard
            label="This Month"
            value={`R${thisMonthRevenue.toLocaleString()}`}
            sub={revenueGrowth !== 0 ? `${revenueGrowth > 0 ? "+" : ""}${revenueGrowth}% vs last month` : ""}
            icon={TrendingUp}
            color="blue"
          />
          <KPICard label="Active Orders" value={activeOrders} icon={Package} color="orange" />
          <KPICard label="Avg Order Value" value={`R${avgOrderValue.toFixed(0)}`} icon={Users} color="purple" />
        </div>

        {/* Revenue Chart */}
        <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-5 mb-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Revenue (Last 6 Months)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: 12 }}
                formatter={(v) => [`R${v.toLocaleString()}`, "Revenue"]}
              />
              <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Goals */}
        {goals.length > 0 && (
          <div className="bg-card rounded-2xl border border-border shadow-apple-sm p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> Active Goals
            </h2>
            <div className="space-y-4">
              {goals.filter(g => g.status === "active").map(g => (
                <div key={g.id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-medium text-foreground">{g.title}</p>
                    <span className="text-xs text-muted-foreground">{g.progress || 0}%</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${g.progress || 0}%` }} />
                  </div>
                  {g.end_date && (
                    <p className="text-xs text-muted-foreground mt-1">Due {format(new Date(g.end_date), "d MMM yyyy")}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KPICard({ label, value, sub, icon: Icon, color }) {
  const colors = {
    green: "bg-green-50 text-green-600",
    blue: "bg-blue-50 text-blue-600",
    orange: "bg-orange-50 text-orange-600",
    purple: "bg-purple-50 text-purple-600",
  };
  return (
    <div className={`rounded-2xl p-4 ${colors[color]}`}>
      <Icon className="w-4 h-4 mb-2 opacity-70" />
      <p className="text-xl font-bold">{value}</p>
      <p className="text-xs font-medium opacity-70 mt-0.5">{label}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}