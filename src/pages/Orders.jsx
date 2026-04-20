import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Package, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import OrderDrawer from "@/components/orders/OrderDrawer";
import NewOrderDrawer from "@/components/orders/NewOrderDrawer";

const statusConfig = {
  confirmed: { label: "Confirmed", color: "bg-blue-100 text-blue-700" },
  in_production: { label: "In Production", color: "bg-orange-100 text-orange-700" },
  ready: { label: "Ready", color: "bg-green-100 text-green-700" },
  shipped: { label: "Shipped", color: "bg-purple-100 text-purple-700" },
  delivered: { label: "Delivered", color: "bg-slate-100 text-slate-600" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-600" },
};

const priorityDot = {
  urgent: "bg-red-500",
  high: "bg-orange-400",
  normal: "bg-slate-300",
  low: "bg-slate-200",
};

export default function Orders() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const queryClient = useQueryClient();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => base44.entities.Order.list("-created_date", 200),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Order.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });

  const filtered = orders.filter(o => {
    if (o.is_archived) return false;
    if (statusFilter === "active" && ["delivered", "cancelled"].includes(o.status)) return false;
    if (statusFilter === "delivered" && o.status !== "delivered") return false;
    if (statusFilter === "cancelled" && o.status !== "cancelled") return false;
    if (search) {
      const q = search.toLowerCase();
      return o.client_name?.toLowerCase().includes(q) || o.order_number?.toLowerCase().includes(q);
    }
    return true;
  });

  const counts = {
    active: orders.filter(o => !o.is_archived && !["delivered", "cancelled"].includes(o.status)).length,
    delivered: orders.filter(o => !o.is_archived && o.status === "delivered").length,
    cancelled: orders.filter(o => !o.is_archived && o.status === "cancelled").length,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Orders</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {counts.active} active · {counts.delivered} delivered
            </p>
          </div>
          <Button onClick={() => setShowNew(true)} className="gap-2 shadow-apple-sm rounded-xl">
            <Plus className="w-4 h-4" /> New Order
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search orders..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-card rounded-xl h-9" />
          </div>
          <div className="flex gap-2">
            {[
              { key: "active", label: `Active (${counts.active})` },
              { key: "delivered", label: `Delivered (${counts.delivered})` },
              { key: "all", label: "All" },
            ].map(s => (
              <button key={s.key} onClick={() => setStatusFilter(s.key)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${statusFilter === s.key ? 'bg-primary text-primary-foreground shadow-apple-sm' : 'bg-card border border-border text-muted-foreground hover:text-foreground'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Orders Table */}
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-card rounded-2xl animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Package className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-muted-foreground">No orders found</p>
          </div>
        ) : (
          <div className="bg-card rounded-2xl border border-border shadow-apple-sm overflow-hidden">
            <div className="hidden md:grid grid-cols-12 text-xs font-semibold text-muted-foreground uppercase tracking-wide px-5 py-3 border-b border-border bg-secondary/30">
              <span className="col-span-4">Client</span>
              <span className="col-span-2">Order #</span>
              <span className="col-span-2">Status</span>
              <span className="col-span-2">Due</span>
              <span className="col-span-2 text-right">Total</span>
            </div>
            {filtered.map(order => {
              const sc = statusConfig[order.status] || { label: order.status, color: "bg-secondary text-muted-foreground" };
              return (
                <button key={order.id} onClick={() => setSelectedOrder(order)}
                  className="w-full grid grid-cols-2 md:grid-cols-12 items-center px-5 py-4 border-b border-border last:border-0 hover:bg-secondary/40 transition-all text-left gap-2">
                  {/* Mobile */}
                  <div className="md:hidden col-span-2 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground text-sm">{order.client_name}</p>
                      <p className="text-xs text-muted-foreground">{order.order_number}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sc.color}`}>{sc.label}</span>
                  </div>
                  {/* Desktop */}
                  <div className="hidden md:flex md:col-span-4 items-center gap-3">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityDot[order.priority] || priorityDot.normal}`} />
                    <div>
                      <p className="font-medium text-foreground text-sm">{order.client_name}</p>
                      {order.total_amount && <p className="text-xs text-muted-foreground">R{order.total_amount.toLocaleString()}</p>}
                    </div>
                  </div>
                  <div className="hidden md:block col-span-2">
                    <p className="text-sm text-muted-foreground font-mono">{order.order_number}</p>
                  </div>
                  <div className="hidden md:block col-span-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sc.color}`}>{sc.label}</span>
                  </div>
                  <div className="hidden md:block col-span-2">
                    <p className="text-sm text-muted-foreground">
                      {order.due_date ? format(new Date(order.due_date), "d MMM") : "—"}
                    </p>
                  </div>
                  <div className="hidden md:block col-span-2 text-right">
                    <p className="text-sm font-semibold text-foreground">
                      {order.total_amount ? `R${order.total_amount.toLocaleString()}` : "—"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedOrder && (
        <OrderDrawer
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdate={(id, data) => {
            updateMutation.mutate({ id, data });
            setSelectedOrder(prev => ({ ...prev, ...data }));
          }}
        />
      )}

      {showNew && (
        <NewOrderDrawer
          onClose={() => setShowNew(false)}
          onCreate={async (orderData) => {
            await base44.entities.Order.create(orderData);
            queryClient.invalidateQueries({ queryKey: ["orders"] });
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}