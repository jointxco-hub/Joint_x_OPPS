import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Package, ClipboardList, Building2, Users, Boxes, RotateCcw, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { toast } from "sonner";

const TABS = [
  { key: "orders", label: "Orders", icon: Package },
  { key: "tasks", label: "Tasks", icon: ClipboardList },
  { key: "clients", label: "Clients", icon: Users },
  { key: "suppliers", label: "Suppliers", icon: Building2 },
  { key: "inventory", label: "Inventory", icon: Boxes },
];

export default function ArchivePage() {
  const [activeTab, setActiveTab] = useState("orders");
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: orders = [] } = useQuery({
    queryKey: ["archived-orders"],
    queryFn: () => base44.entities.Order.list("-archived_at", 200),
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ["archived-tasks"],
    queryFn: () => base44.entities.Task.list("-archived_at", 200),
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["archived-clients"],
    queryFn: () => base44.entities.Client.list("-updated_date", 200),
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["archived-suppliers"],
    queryFn: () => base44.entities.Supplier.list("-updated_date", 200),
  });
  const { data: inventory = [] } = useQuery({
    queryKey: ["archived-inventory"],
    queryFn: () => base44.entities.InventoryItem.list("-updated_date", 200),
  });

  const archivedOrders = orders.filter(o => o.is_archived);
  const archivedTasks = tasks.filter(t => t.is_archived);
  const archivedClients = clients.filter(c => c.is_archived);
  const archivedSuppliers = suppliers.filter(s => s.is_archived);
  const archivedInventory = inventory.filter(i => i.is_archived);

  const counts = {
    orders: archivedOrders.length,
    tasks: archivedTasks.length,
    clients: archivedClients.length,
    suppliers: archivedSuppliers.length,
    inventory: archivedInventory.length,
  };

  const restoreMutation = useMutation({
    mutationFn: ({ entity, id }) => {
      const map = {
        orders: base44.entities.Order,
        tasks: base44.entities.Task,
        clients: base44.entities.Client,
        suppliers: base44.entities.Supplier,
        inventory: base44.entities.InventoryItem,
      };
      return map[entity].update(id, { is_archived: false });
    },
    onSuccess: (_, { entity }) => {
      queryClient.invalidateQueries({ queryKey: [`archived-${entity}`] });
      queryClient.invalidateQueries({ queryKey: [entity] });
      toast.success("Restored successfully");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ entity, id }) => {
      const map = {
        orders: base44.entities.Order,
        tasks: base44.entities.Task,
        clients: base44.entities.Client,
        suppliers: base44.entities.Supplier,
        inventory: base44.entities.InventoryItem,
      };
      return map[entity].delete(id);
    },
    onSuccess: (_, { entity }) => {
      queryClient.invalidateQueries({ queryKey: [`archived-${entity}`] });
      toast.success("Permanently deleted");
    },
  });

  const handleDelete = (entity, id, name) => {
    if (confirm(`Permanently delete "${name}"? This cannot be undone.`)) {
      deleteMutation.mutate({ entity, id });
    }
  };

  const getActiveItems = () => {
    const q = search.toLowerCase();
    switch (activeTab) {
      case "orders": return archivedOrders.filter(o =>
        !q || o.client_name?.toLowerCase().includes(q) || o.order_number?.toLowerCase().includes(q));
      case "tasks": return archivedTasks.filter(t =>
        !q || t.title?.toLowerCase().includes(q));
      case "clients": return archivedClients.filter(c =>
        !q || c.name?.toLowerCase().includes(q));
      case "suppliers": return archivedSuppliers.filter(s =>
        !q || s.name?.toLowerCase().includes(q));
      case "inventory": return archivedInventory.filter(i =>
        !q || i.name?.toLowerCase().includes(q));
      default: return [];
    }
  };

  const items = getActiveItems();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center">
            <Archive className="w-5 h-5 text-slate-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Archive</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Archived items — restore or permanently delete here</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const count = counts[tab.key];
            return (
              <button key={tab.key} onClick={() => { setActiveTab(tab.key); setSearch(""); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeTab === tab.key ? 'bg-primary text-primary-foreground shadow-apple-sm' : 'bg-card border border-border text-muted-foreground hover:text-foreground'}`}>
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.key ? 'bg-white/20' : 'bg-secondary'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search archived items..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-card rounded-xl h-9" />
        </div>

        {/* Items */}
        {items.length === 0 ? (
          <div className="text-center py-20 bg-card rounded-2xl border border-border">
            <Archive className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No archived {activeTab}</p>
            <p className="text-muted-foreground/60 text-sm mt-1">Items you archive will appear here</p>
          </div>
        ) : (
          <div className="bg-card rounded-2xl border border-border shadow-apple-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-amber-50/50 flex items-center gap-2">
              <Archive className="w-4 h-4 text-amber-500" />
              <p className="text-xs text-amber-700 font-medium">You can restore items or permanently delete them here</p>
            </div>
            {items.map((item, idx) => (
              <div key={item.id} className="flex items-center justify-between px-5 py-4 border-b border-border last:border-0 hover:bg-secondary/30 transition-all">
                <div className="flex-1 min-w-0 mr-4">
                  <p className="text-sm font-medium text-foreground truncate">
                    {activeTab === "orders" ? `${item.client_name} — ${item.order_number}` :
                     activeTab === "tasks" ? item.title :
                     item.name}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {activeTab === "orders" && item.status && (
                      <Badge variant="outline" className="text-xs">{item.status}</Badge>
                    )}
                    {activeTab === "orders" && item.total_amount && (
                      <span className="text-xs text-muted-foreground">R{item.total_amount.toLocaleString()}</span>
                    )}
                    {activeTab === "tasks" && item.priority && (
                      <Badge variant="outline" className="text-xs">{item.priority}</Badge>
                    )}
                    {activeTab === "suppliers" && item.type && (
                      <Badge variant="outline" className="text-xs">{item.type}</Badge>
                    )}
                    {activeTab === "inventory" && (
                      <span className="text-xs text-muted-foreground">{item.current_stock ?? 0} {item.unit || ''}</span>
                    )}
                    {item.archived_at && (
                      <span className="text-xs text-muted-foreground">
                        Archived {format(new Date(item.archived_at), "d MMM yyyy")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button variant="outline" size="sm" className="rounded-xl gap-1.5 text-xs"
                    onClick={() => restoreMutation.mutate({ entity: activeTab, id: item.id })}
                    disabled={restoreMutation.isPending}>
                    <RotateCcw className="w-3 h-3" /> Restore
                  </Button>
                  <Button variant="ghost" size="sm" className="rounded-xl text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(activeTab, item.id,
                      activeTab === "orders" ? `${item.client_name} ${item.order_number}` :
                      activeTab === "tasks" ? item.title : item.name
                    )}
                    disabled={deleteMutation.isPending}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}