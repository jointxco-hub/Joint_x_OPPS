import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, TrendingUp, Package, DollarSign, RefreshCw, Activity } from "lucide-react";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { toast } from "sonner";

export default function Executive() {
  const [dateRange, setDateRange] = useState("30");
  const queryClient = useQueryClient();

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list('-created_date', 500)
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 500)
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date', 500)
  });

  const { data: inventory = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => base44.entities.InventoryItem.list('-created_date', 500)
  });

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['purchaseOrders'],
    queryFn: () => base44.entities.PurchaseOrder.list('-created_date', 500)
  });

  // Calculate metrics
  const now = new Date();
  const daysAgo = parseInt(dateRange);
  const cutoffDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

  const newClientsThisMonth = clients.filter(c => {
    const created = new Date(c.created_date);
    return created >= startOfMonth(now) && created <= endOfMonth(now);
  }).length;

  const activeClients = clients.filter(c => c.status === 'active').length;
  const dormantClients = clients.filter(c => c.status === 'dormant').length;

  const totalRevenue = orders.reduce((sum, o) => sum + (o.quoted_price || 0), 0);
  const revenueThisPeriod = orders.filter(o => new Date(o.created_date) >= cutoffDate)
    .reduce((sum, o) => sum + (o.quoted_price || 0), 0);

  const ordersInProgress = orders.filter(o => !['delivered', 'archived'].includes(o.status)).length;
  const ordersCompleted = orders.filter(o => o.status === 'delivered').length;

  const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;

  // Finance calculations
  const totalExpenses = orders.reduce((sum, o) => 
    sum + (o.materials_cost || 0) + (o.transport_cost || 0), 0
  );
  const pendingPOValue = purchaseOrders
    .filter(po => !['received', 'cancelled', 'archived'].includes(po.status))
    .reduce((sum, po) => sum + (po.total || 0), 0);
  const inventoryValue = inventory.reduce((sum, item) => 
    sum + (item.current_stock || 0) * (item.cost_price || 0), 0
  );
  const profitMargin = totalRevenue > 0 
    ? ((totalRevenue - totalExpenses) / totalRevenue) * 100 
    : 0;
  const cashPosition = totalRevenue - totalExpenses - pendingPOValue;
  
  // Deposits & Outstanding
  const totalDeposits = orders.reduce((sum, o) => sum + (o.deposit_paid || 0), 0);
  const outstandingPayments = orders
    .filter(o => o.status !== 'archived')
    .reduce((sum, o) => sum + Math.max(0, (o.quoted_price || 0) - (o.deposit_paid || 0)), 0);

  // Top clients by revenue
  const topClients = clients
    .filter(c => c.total_revenue > 0)
    .sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0))
    .slice(0, 10);

  // Recent activity
  const recentActivity = [
    ...orders.slice(0, 5).map(o => ({
      type: 'order',
      title: `New order: ${o.order_number}`,
      subtitle: o.client_name,
      date: o.created_date
    })),
    ...clients.slice(0, 5).map(c => ({
      type: 'client',
      title: `New client: ${c.name}`,
      subtitle: c.email,
      date: c.created_date
    }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

  // Monthly revenue trend (last 6 months)
  const monthlyRevenue = Array.from({ length: 6 }, (_, i) => {
    const month = subMonths(now, 5 - i);
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    
    const revenue = orders.filter(o => {
      const orderDate = new Date(o.created_date);
      return orderDate >= monthStart && orderDate <= monthEnd;
    }).reduce((sum, o) => sum + (o.quoted_price || 0), 0);

    return {
      month: format(month, 'MMM'),
      revenue
    };
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Executive Dashboard</h1>
            <p className="text-slate-500 mt-1">High-level business metrics</p>
          </div>
          <div className="flex gap-3">
            <Button 
              onClick={() => {
                queryClient.invalidateQueries();
                toast.success("Refreshed!");
              }} 
              variant="ghost"
              size="icon"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last year</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4 mb-6">
          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs md:text-sm text-slate-500">Total Revenue</p>
                <DollarSign className="w-4 h-4 md:w-5 md:h-5 text-green-500" />
              </div>
              <p className="text-xl md:text-2xl font-bold text-slate-900">R{totalRevenue.toLocaleString()}</p>
              <p className="text-xs text-slate-600 mt-1">R{revenueThisPeriod.toLocaleString()} period</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs md:text-sm text-slate-500">Total Expenses</p>
                <Package className="w-4 h-4 md:w-5 md:h-5 text-red-500" />
              </div>
              <p className="text-xl md:text-2xl font-bold text-slate-900">R{totalExpenses.toLocaleString()}</p>
              <p className="text-xs text-slate-600 mt-1">Materials + Transport</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-emerald-500 to-emerald-600">
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs md:text-sm text-white/90">Gross Profit</p>
                <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-white" />
              </div>
              <p className="text-xl md:text-2xl font-bold text-white">R{(totalRevenue - totalExpenses).toLocaleString()}</p>
              <p className="text-xs text-white/80 mt-1">{profitMargin.toFixed(1)}% margin</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs md:text-sm text-slate-500">Deposits Received</p>
                <DollarSign className="w-4 h-4 md:w-5 md:h-5 text-blue-500" />
              </div>
              <p className="text-xl md:text-2xl font-bold text-slate-900">R{totalDeposits.toLocaleString()}</p>
              <p className="text-xs text-slate-600 mt-1">From {orders.filter(o => o.deposit_paid > 0).length} orders</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs md:text-sm text-slate-500">Outstanding</p>
                <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-orange-500" />
              </div>
              <p className="text-xl md:text-2xl font-bold text-slate-900">R{outstandingPayments.toLocaleString()}</p>
              <p className="text-xs text-slate-600 mt-1">Pending payments</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs md:text-sm text-slate-500">Pending POs</p>
                <Package className="w-4 h-4 md:w-5 md:h-5 text-purple-500" />
              </div>
              <p className="text-xl md:text-2xl font-bold text-slate-900">R{pendingPOValue.toLocaleString()}</p>
              <p className="text-xs text-slate-600 mt-1">To be paid</p>
            </CardContent>
          </Card>
        </div>

        {/* Cash Position Card */}
        <Card className="mb-6 bg-gradient-to-br from-slate-800 to-slate-900">
          <CardContent className="p-4 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-sm text-white/70 mb-2">Estimated Cash Position</p>
                <p className={`text-3xl md:text-4xl font-bold ${cashPosition >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  R{cashPosition.toLocaleString()}
                </p>
                <p className="text-xs text-white/60 mt-2">
                  Revenue (R{totalRevenue.toLocaleString()}) - Expenses (R{totalExpenses.toLocaleString()}) - Pending POs (R{pendingPOValue.toLocaleString()})
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-1 gap-3">
                <div className="bg-white/10 rounded-lg p-3">
                  <p className="text-xs text-white/70">Inventory Value</p>
                  <p className="text-lg font-semibold text-white">R{inventoryValue.toLocaleString()}</p>
                </div>
                <div className="bg-white/10 rounded-lg p-3">
                  <p className="text-xs text-white/70">Active Clients</p>
                  <p className="text-lg font-semibold text-white">{activeClients}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Financial Health */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
          <Card>
            <CardContent className="p-4 md:p-6">
              <p className="text-xs md:text-sm text-slate-500 mb-2">Active Clients</p>
              <p className="text-xl md:text-2xl font-bold text-green-600">{activeClients}</p>
              <p className="text-xs text-slate-500 mt-1">{clients.length} total</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 md:p-6">
              <p className="text-xs md:text-sm text-slate-500 mb-2">Active Orders</p>
              <p className="text-xl md:text-2xl font-bold text-orange-600">{ordersInProgress}</p>
              <p className="text-xs text-slate-500 mt-1">{ordersCompleted} completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 md:p-6">
              <p className="text-xs md:text-sm text-slate-500 mb-2">Active Projects</p>
              <p className="text-xl md:text-2xl font-bold text-blue-600">{projects.filter(p => p.status === 'active').length}</p>
              <p className="text-xs text-slate-500 mt-1">{projects.length} total</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 md:p-6">
              <p className="text-xs md:text-sm text-slate-500 mb-2">Low Stock Items</p>
              <p className="text-xl md:text-2xl font-bold text-red-600">
                {inventory.filter(i => i.current_stock <= (i.reorder_point || 0)).length}
              </p>
              <p className="text-xs text-slate-500 mt-1">{inventory.length} items tracked</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Top Clients */}
          <Card>
            <CardHeader>
              <CardTitle>Top 10 Clients by Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topClients.map((client, i) => (
                  <div key={client.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-slate-400">#{i + 1}</span>
                      <div>
                        <p className="font-medium text-slate-900">{client.name}</p>
                        <p className="text-sm text-slate-500">{client.total_orders} orders</p>
                      </div>
                    </div>
                    <p className="font-semibold text-green-600">R{(client.total_revenue || 0).toLocaleString()}</p>
                  </div>
                ))}
                {topClients.length === 0 && (
                  <p className="text-center text-slate-500 py-8">No revenue data yet</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentActivity.map((activity, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-slate-900 text-sm">{activity.title}</p>
                      <p className="text-xs text-slate-500">{activity.subtitle}</p>
                    </div>
                    <p className="text-xs text-slate-400">{format(new Date(activity.date), 'MMM d')}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Monthly Revenue Trend */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Revenue Trend (Last 6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-4 h-64">
              {monthlyRevenue.map((month, i) => {
                const maxRevenue = Math.max(...monthlyRevenue.map(m => m.revenue));
                const height = maxRevenue > 0 ? (month.revenue / maxRevenue) * 100 : 0;
                
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full bg-slate-100 rounded-t-lg relative" style={{ height: `${height}%`, minHeight: '20px' }}>
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0F9B8E] to-[#0F9B8E]/60 rounded-t-lg" />
                      <p className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-semibold text-slate-700 whitespace-nowrap">
                        R{month.revenue.toLocaleString()}
                      </p>
                    </div>
                    <p className="text-sm text-slate-500">{month.month}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}