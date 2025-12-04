import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  TrendingUp, TrendingDown, DollarSign, Package, 
  Clock, AlertTriangle, Users, Truck, CheckCircle2,
  BarChart3, PieChart, Activity, ArrowUpRight, ArrowDownRight,
  Calendar, Target, Zap, AlertCircle
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, isWithinInterval, differenceInDays } from "date-fns";
import { AreaChart, Area, BarChart, Bar, PieChart as RechartsPie, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const COLORS = {
  teal: "#0F9B8E",
  terracotta: "#C44D3B",
  lavender: "#D4C4E8",
  slate: "#475569"
};

export default function Executive() {
  const [timeRange, setTimeRange] = useState("30");

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 500)
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => base44.entities.Task.list('-created_date', 500)
  });

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['purchaseOrders'],
    queryFn: () => base44.entities.PurchaseOrder.list('-created_date', 200)
  });

  const { data: inventory = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => base44.entities.InventoryItem.list('name', 100)
  });

  // Filter by time range
  const cutoffDate = subDays(new Date(), parseInt(timeRange));
  const filteredOrders = orders.filter(o => new Date(o.created_date) >= cutoffDate);
  const filteredTasks = tasks.filter(t => new Date(t.created_date) >= cutoffDate);
  const filteredPOs = purchaseOrders.filter(po => new Date(po.created_date) >= cutoffDate);

  // Financial Metrics
  const financials = useMemo(() => {
    const revenue = filteredOrders
      .filter(o => o.status === 'delivered')
      .reduce((sum, o) => sum + (o.quoted_price || 0), 0);
    
    const pendingRevenue = filteredOrders
      .filter(o => o.status !== 'delivered')
      .reduce((sum, o) => sum + (o.quoted_price || 0), 0);
    
    const costs = filteredPOs
      .filter(po => po.status === 'received')
      .reduce((sum, po) => sum + (po.total || 0), 0);
    
    const pendingCosts = filteredPOs
      .filter(po => ['approved', 'ordered'].includes(po.status))
      .reduce((sum, po) => sum + (po.total || 0), 0);
    
    const depositsReceived = filteredOrders.reduce((sum, o) => sum + (o.deposit_paid || 0), 0);
    
    const profit = revenue - costs;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    return { revenue, pendingRevenue, costs, pendingCosts, depositsReceived, profit, margin };
  }, [filteredOrders, filteredPOs]);

  // Production Metrics
  const production = useMemo(() => {
    const delivered = filteredOrders.filter(o => o.status === 'delivered').length;
    const inProduction = filteredOrders.filter(o => o.status === 'in_production').length;
    const pending = filteredOrders.filter(o => ['received', 'materials_needed'].includes(o.status)).length;
    const ready = filteredOrders.filter(o => o.status === 'ready').length;
    
    const completedTasks = filteredTasks.filter(t => t.status === 'completed').length;
    const totalTasks = filteredTasks.length;
    const taskCompletionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    // Average lead time for delivered orders
    const deliveredWithDates = orders.filter(o => o.status === 'delivered' && o.due_date && o.created_date);
    const avgLeadTime = deliveredWithDates.length > 0
      ? deliveredWithDates.reduce((sum, o) => sum + differenceInDays(new Date(o.due_date), new Date(o.created_date)), 0) / deliveredWithDates.length
      : 0;

    return { delivered, inProduction, pending, ready, completedTasks, totalTasks, taskCompletionRate, avgLeadTime };
  }, [filteredOrders, filteredTasks, orders]);

  // Bottleneck Analysis
  const bottlenecks = useMemo(() => {
    const issues = [];

    // Orders waiting for materials
    const waitingMaterials = orders.filter(o => o.status === 'materials_needed');
    if (waitingMaterials.length > 2) {
      issues.push({
        severity: "high",
        type: "Materials",
        title: `${waitingMaterials.length} orders waiting for materials`,
        description: "Consider expediting supplier orders or finding alternative sources",
        icon: Package
      });
    }

    // Overdue tasks
    const today = new Date();
    const overdueTasks = tasks.filter(t => 
      t.status !== 'completed' && t.due_date && new Date(t.due_date) < today
    );
    if (overdueTasks.length > 0) {
      issues.push({
        severity: "high",
        type: "Tasks",
        title: `${overdueTasks.length} overdue tasks`,
        description: "Review task assignments and priorities",
        icon: Clock
      });
    }

    // Low stock critical items
    const criticalStock = inventory.filter(i => 
      i.reorder_point && i.current_stock < i.reorder_point * 0.5
    );
    if (criticalStock.length > 0) {
      issues.push({
        severity: "critical",
        type: "Inventory",
        title: `${criticalStock.length} items critically low`,
        description: criticalStock.map(i => i.name).slice(0, 3).join(", "),
        icon: AlertTriangle
      });
    }

    // Pending POs not approved
    const stuckPOs = purchaseOrders.filter(po => po.status === 'pending');
    if (stuckPOs.length > 3) {
      issues.push({
        severity: "medium",
        type: "Purchasing",
        title: `${stuckPOs.length} POs pending approval`,
        description: "Review and approve to avoid production delays",
        icon: AlertCircle
      });
    }

    // High urgent orders ratio
    const urgentRatio = orders.length > 0 
      ? (orders.filter(o => o.priority === 'urgent' && o.status !== 'delivered').length / orders.filter(o => o.status !== 'delivered').length) * 100
      : 0;
    if (urgentRatio > 30) {
      issues.push({
        severity: "medium",
        type: "Workload",
        title: `${urgentRatio.toFixed(0)}% orders are urgent`,
        description: "High urgency ratio may indicate capacity issues",
        icon: Zap
      });
    }

    // Tasks by phase bottleneck
    const tasksByPhase = {};
    tasks.filter(t => t.status !== 'completed' && t.phase).forEach(t => {
      tasksByPhase[t.phase] = (tasksByPhase[t.phase] || 0) + 1;
    });
    const maxPhase = Object.entries(tasksByPhase).sort((a, b) => b[1] - a[1])[0];
    if (maxPhase && maxPhase[1] > 5) {
      issues.push({
        severity: "medium",
        type: "Production",
        title: `${maxPhase[1]} tasks stuck in ${maxPhase[0]} phase`,
        description: "Consider adding capacity to this phase",
        icon: Activity
      });
    }

    return issues.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.severity] - order[b.severity];
    });
  }, [orders, tasks, inventory, purchaseOrders]);

  // Chart Data
  const revenueByWeek = useMemo(() => {
    const weeks = [];
    for (let i = parseInt(timeRange); i >= 0; i -= 7) {
      const weekStart = subDays(new Date(), i);
      const weekEnd = subDays(new Date(), Math.max(0, i - 6));
      const weekOrders = orders.filter(o => {
        const date = new Date(o.created_date);
        return date >= weekStart && date <= weekEnd;
      });
      weeks.push({
        week: format(weekStart, "dd MMM"),
        revenue: weekOrders.filter(o => o.status === 'delivered').reduce((s, o) => s + (o.quoted_price || 0), 0),
        orders: weekOrders.length
      });
    }
    return weeks;
  }, [orders, timeRange]);

  const ordersByStatus = useMemo(() => {
    const statusCounts = {};
    filteredOrders.forEach(o => {
      statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    });
    return Object.entries(statusCounts).map(([name, value]) => ({
      name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value
    }));
  }, [filteredOrders]);

  const tasksByPhaseData = useMemo(() => {
    const phaseCounts = {};
    filteredTasks.filter(t => t.phase).forEach(t => {
      phaseCounts[t.phase] = (phaseCounts[t.phase] || 0) + 1;
    });
    return Object.entries(phaseCounts).map(([name, value]) => ({
      name: name.replace(/\b\w/g, l => l.toUpperCase()),
      value
    }));
  }, [filteredTasks]);

  const PIE_COLORS = [COLORS.teal, COLORS.terracotta, COLORS.lavender, COLORS.slate, "#94a3b8", "#64748b"];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Executive Dashboard</h1>
            <p className="text-slate-500 mt-1">Business overview & performance insights</p>
          </div>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-40 rounded-xl">
              <Calendar className="w-4 h-4 mr-2 text-slate-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">This year</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Financial Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MetricCard
            title="Revenue"
            value={`R${financials.revenue.toLocaleString()}`}
            subtitle={`R${financials.pendingRevenue.toLocaleString()} pending`}
            icon={DollarSign}
            trend={financials.revenue > 0 ? "up" : "neutral"}
            color={COLORS.teal}
          />
          <MetricCard
            title="Costs"
            value={`R${financials.costs.toLocaleString()}`}
            subtitle={`R${financials.pendingCosts.toLocaleString()} committed`}
            icon={TrendingDown}
            trend="neutral"
            color={COLORS.terracotta}
          />
          <MetricCard
            title="Profit"
            value={`R${financials.profit.toLocaleString()}`}
            subtitle={`${financials.margin.toFixed(1)}% margin`}
            icon={TrendingUp}
            trend={financials.profit > 0 ? "up" : "down"}
            color={financials.profit > 0 ? COLORS.teal : COLORS.terracotta}
          />
          <MetricCard
            title="Deposits"
            value={`R${financials.depositsReceived.toLocaleString()}`}
            subtitle="Cash received"
            icon={Target}
            trend="up"
            color={COLORS.lavender}
          />
        </div>

        {/* Bottleneck Alerts */}
        {bottlenecks.length > 0 && (
          <Card className="mb-8 border-0 bg-gradient-to-r from-red-50 via-orange-50 to-amber-50 shadow-lg rounded-3xl overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2 text-slate-800">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                Bottlenecks & Alerts ({bottlenecks.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {bottlenecks.map((issue, i) => (
                  <BottleneckCard key={i} issue={issue} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Production Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <StatBadge label="Delivered" value={production.delivered} color="bg-emerald-100 text-emerald-700" />
          <StatBadge label="In Production" value={production.inProduction} color="bg-blue-100 text-blue-700" />
          <StatBadge label="Pending" value={production.pending} color="bg-amber-100 text-amber-700" />
          <StatBadge label="Ready" value={production.ready} color="bg-purple-100 text-purple-700" />
          <StatBadge label="Avg Lead Time" value={`${production.avgLeadTime.toFixed(0)}d`} color="bg-slate-100 text-slate-700" />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Revenue Trend */}
          <Card className="border-0 bg-white/90 backdrop-blur shadow-sm rounded-3xl">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-slate-400" />
                Revenue & Orders Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueByWeek}>
                    <defs>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.teal} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={COLORS.teal} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <Tooltip 
                      contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      formatter={(value, name) => [name === 'revenue' ? `R${value.toLocaleString()}` : value, name === 'revenue' ? 'Revenue' : 'Orders']}
                    />
                    <Area type="monotone" dataKey="revenue" stroke={COLORS.teal} fillOpacity={1} fill="url(#colorRevenue)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Orders by Status */}
          <Card className="border-0 bg-white/90 backdrop-blur shadow-sm rounded-3xl">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <PieChart className="w-5 h-5 text-slate-400" />
                Orders by Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPie>
                    <Pie
                      data={ordersByStatus}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {ordersByStatus.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </RechartsPie>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tasks & Production Pipeline */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Task Completion */}
          <Card className="border-0 bg-white/90 backdrop-blur shadow-sm rounded-3xl">
            <CardHeader>
              <CardTitle className="text-base">Task Performance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center py-4">
                <div className="relative w-32 h-32 mx-auto">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="64" cy="64" r="56" stroke="#e2e8f0" strokeWidth="12" fill="none" />
                    <circle 
                      cx="64" cy="64" r="56" 
                      stroke={COLORS.teal} 
                      strokeWidth="12" 
                      fill="none"
                      strokeDasharray={`${production.taskCompletionRate * 3.52} 352`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-3xl font-bold">{production.taskCompletionRate.toFixed(0)}%</span>
                  </div>
                </div>
                <p className="text-sm text-slate-500 mt-2">
                  {production.completedTasks} of {production.totalTasks} tasks completed
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Tasks by Phase */}
          <Card className="lg:col-span-2 border-0 bg-white/90 backdrop-blur shadow-sm rounded-3xl">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-5 h-5 text-slate-400" />
                Production Pipeline by Phase
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tasksByPhaseData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} stroke="#94a3b8" width={80} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: 'none' }} />
                    <Bar dataKey="value" fill={COLORS.teal} radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle, icon: Icon, trend, color }) {
  return (
    <Card className="border-0 bg-white/90 backdrop-blur shadow-sm rounded-2xl overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}20` }}>
            <Icon className="w-5 h-5" style={{ color }} />
          </div>
          {trend === "up" && <ArrowUpRight className="w-5 h-5 text-emerald-500" />}
          {trend === "down" && <ArrowDownRight className="w-5 h-5 text-red-500" />}
        </div>
        <p className="text-2xl font-bold text-slate-900 mt-3">{value}</p>
        <p className="text-sm text-slate-500 mt-1">{title}</p>
        {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function StatBadge({ label, value, color }) {
  return (
    <div className={`${color} rounded-2xl p-4 text-center`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs mt-1 opacity-80">{label}</p>
    </div>
  );
}

function BottleneckCard({ issue }) {
  const severityColors = {
    critical: "border-l-4 border-red-500 bg-red-50",
    high: "border-l-4 border-orange-500 bg-orange-50",
    medium: "border-l-4 border-amber-500 bg-amber-50",
    low: "border-l-4 border-blue-500 bg-blue-50"
  };

  const Icon = issue.icon;

  return (
    <div className={`${severityColors[issue.severity]} rounded-xl p-4`}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-white/60 flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs">
              {issue.type}
            </Badge>
          </div>
          <p className="font-medium text-sm text-slate-800">{issue.title}</p>
          <p className="text-xs text-slate-600 mt-1">{issue.description}</p>
        </div>
      </div>
    </div>
  );
}