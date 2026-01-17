import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Package, Store, CheckCircle2, XCircle, Archive, Trash2, Check } from "lucide-react";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ActiveOrderCard from "@/components/dashboard/ActiveOrderCard";
import TypeformOrderForm from "@/components/orders/TypeformOrderForm";
import OrderDetails from "@/components/orders/OrderDetails";
import { format } from "date-fns";
import { toast } from "sonner";

export default function Orders() {
  const [showForm, setShowForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [confirmDialog, setConfirmDialog] = useState({ open: false, type: null, order: null });
  const [selectedOrders, setSelectedOrders] = useState([]);
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("production");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 200)
  });

  const { data: clientOrders = [] } = useQuery({
    queryKey: ['clientOrders'],
    queryFn: () => base44.entities.ClientOrder.list('-created_date', 200)
  });

  const convertToProductionMutation = useMutation({
    mutationFn: async (clientOrder) => {
      // Create production order from client order
      const productionOrder = {
        order_number: clientOrder.order_number,
        client_name: clientOrder.client_name,
        client_email: clientOrder.client_email,
        client_phone: clientOrder.client_phone,
        description: clientOrder.items?.map(i => `${i.quantity}x ${i.name} (${i.size}, ${i.color})`).join(', '),
        quantity: clientOrder.items?.reduce((sum, i) => sum + (i.quantity || 0), 0) || 0,
        print_type: "dtf_randburg",
        status: "received",
        priority: "normal",
        quoted_price: clientOrder.total,
        deposit_paid: 0,
        notes: clientOrder.notes
      };
      await base44.entities.Order.create(productionOrder);
      await base44.entities.ClientOrder.update(clientOrder.id, { status: "converted" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['clientOrders'] });
    }
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Order.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setShowForm(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Order.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setEditingOrder(null);
      setSelectedOrder(null);
    }
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => base44.entities.Order.update(id, { status: "archived" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setConfirmDialog({ open: false, type: null, order: null });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Order.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setConfirmDialog({ open: false, type: null, order: null });
      setSelectedOrders([]);
    }
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) {
        await base44.entities.Order.update(id, { status: "archived" });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setSelectedOrders([]);
      toast.success(`Archived ${selectedOrders.length} orders`);
    }
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) {
        await base44.entities.Order.delete(id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setSelectedOrders([]);
      toast.success(`Deleted ${selectedOrders.length} orders`);
    }
  });

  const handleSubmit = async (data) => {
    if (editingOrder) {
      await updateMutation.mutateAsync({ id: editingOrder.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = !search || 
      order.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      order.order_number?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || order.status === statusFilter;
    const notArchived = order.status !== "archived";
    return matchesSearch && matchesStatus && notArchived;
  });

  const handleArchive = (order) => {
    setConfirmDialog({
      open: true,
      type: "archive",
      order,
      title: "Archive Order?",
      description: `Are you sure you want to archive order ${order.order_number}? You can still view it in archived orders.`
    });
  };

  const handleDelete = (order) => {
    setConfirmDialog({
      open: true,
      type: "delete",
      order,
      title: "Delete Order?",
      description: `Are you sure you want to permanently delete order ${order.order_number}? This action cannot be undone.`
    });
  };

  const handleConfirm = () => {
    if (confirmDialog.type === "archive") {
      archiveMutation.mutate(confirmDialog.order.id);
    } else if (confirmDialog.type === "delete") {
      deleteMutation.mutate(confirmDialog.order.id);
    } else if (confirmDialog.type === "bulk_archive") {
      bulkArchiveMutation.mutate(selectedOrders);
    } else if (confirmDialog.type === "bulk_delete") {
      bulkDeleteMutation.mutate(selectedOrders);
    }
  };

  const toggleOrderSelection = (orderId) => {
    setSelectedOrders(prev => 
      prev.includes(orderId) 
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedOrders.length === filteredOrders.length) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(filteredOrders.map(o => o.id));
    }
  };

  if (showForm || editingOrder) {
    return (
      <TypeformOrderForm 
        order={editingOrder}
        onSubmit={handleSubmit}
        onCancel={() => {
          setShowForm(false);
          setEditingOrder(null);
        }}
      />
    );
  }

  if (selectedOrder) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-8">
        <div className="max-w-3xl mx-auto">
          <OrderDetails 
            order={selectedOrder}
            onClose={() => setSelectedOrder(null)}
            onEdit={(order) => {
              setSelectedOrder(null);
              setEditingOrder(order);
            }}
            onUpdateStatus={(id, status, extraData = {}) => updateMutation.mutate({ id, data: { status, ...extraData } })}
            onArchive={handleArchive}
            onDelete={handleDelete}
          />
        </div>
      </div>
    );
  }

  const pendingClientOrders = clientOrders.filter(o => o.status === 'pending' || o.status === 'confirmed');

  return (
    <div className="min-h-screen bg-slate-50">
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, open })}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={handleConfirm}
        confirmText={confirmDialog.type === "delete" ? "Delete" : "Archive"}
        variant={confirmDialog.type === "delete" ? "destructive" : "default"}
      />
      
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-slate-900">Orders</h1>
            {selectedOrders.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">{selectedOrders.length} selected</span>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setConfirmDialog({
                    open: true,
                    type: "bulk_archive",
                    title: "Archive Selected Orders?",
                    description: `Archive ${selectedOrders.length} orders?`
                  })}
                >
                  <Archive className="w-4 h-4 mr-1" /> Archive
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setConfirmDialog({
                    open: true,
                    type: "bulk_delete",
                    title: "Delete Selected Orders?",
                    description: `Permanently delete ${selectedOrders.length} orders?`
                  })}
                  className="text-red-600 border-red-200"
                >
                  <Trash2 className="w-4 h-4 mr-1" /> Delete
                </Button>
              </div>
            )}
          </div>
          <Button onClick={() => setShowForm(true)} className="bg-slate-900 hover:bg-slate-800">
            <Plus className="w-4 h-4 mr-2" /> New Order
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList className="bg-white p-1 rounded-xl">
            <TabsTrigger value="production" className="rounded-lg">
              <Package className="w-4 h-4 mr-2" />
              Production ({orders.length})
            </TabsTrigger>
            <TabsTrigger value="shop" className="rounded-lg">
              <Store className="w-4 h-4 mr-2" />
              Shop Orders ({pendingClientOrders.length})
              {pendingClientOrders.length > 0 && (
                <span className="ml-2 w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="production">
            {/* Filters */}
            <div className="bg-white rounded-xl p-4 mb-6 flex flex-col md:flex-row gap-4">
              <div className="flex items-center gap-3">
                <Checkbox 
                  checked={selectedOrders.length === filteredOrders.length && filteredOrders.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-sm text-slate-500">Select all</span>
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input 
                  placeholder="Search orders..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="received">Received</SelectItem>
                  <SelectItem value="materials_needed">Materials Needed</SelectItem>
                  <SelectItem value="in_production">In Production</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="out_for_delivery">Out for Delivery</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Orders Grid */}
            {filteredOrders.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center">
                <Package className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-700 mb-2">No orders found</h3>
                <p className="text-slate-500 mb-4">Create your first order to get started</p>
                <Button onClick={() => setShowForm(true)}>
                  <Plus className="w-4 h-4 mr-2" /> Create Order
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredOrders.map(order => (
                  <div key={order.id} className="relative group">
                    <Checkbox 
                      checked={selectedOrders.includes(order.id)}
                      onCheckedChange={() => toggleOrderSelection(order.id)}
                      className="absolute top-3 left-3 z-10 bg-white border-2"
                    />
                    <div onClick={() => setSelectedOrder(order)}>
                      <ActiveOrderCard 
                        order={order} 
                        onClick={setSelectedOrder}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="shop">
            {pendingClientOrders.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center">
                <Store className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-700 mb-2">No shop orders</h3>
                <p className="text-slate-500">Orders from the client catalog will appear here</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingClientOrders.map(order => (
                  <Card key={order.id} className="bg-white border-0 shadow-sm rounded-2xl overflow-hidden">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-semibold text-slate-900">{order.order_number}</p>
                          <p className="text-sm text-slate-500">{order.client_name}</p>
                          {order.company_name && (
                            <p className="text-xs text-slate-400">{order.company_name}</p>
                          )}
                        </div>
                        <Badge className={order.status === 'confirmed' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}>
                          {order.status}
                        </Badge>
                      </div>

                      <div className="text-sm text-slate-600 mb-3">
                        <p>{order.client_phone}</p>
                        {order.client_email && <p className="text-slate-400">{order.client_email}</p>}
                      </div>

                      <div className="bg-slate-50 rounded-xl p-3 mb-3 max-h-32 overflow-y-auto">
                        <p className="text-xs text-slate-500 mb-2">Items ({order.items?.length || 0})</p>
                        {order.items?.map((item, i) => (
                          <div key={i} className="text-sm flex justify-between">
                            <span>{item.quantity}x {item.name} ({item.size}, {item.color})</span>
                            <span className="text-slate-500">R{item.total}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                        <div>
                          <p className="text-xs text-slate-500">Total</p>
                          <p className="text-xl font-bold text-emerald-600">R{(order.total || 0).toFixed(2)}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            size="sm"
                            onClick={() => convertToProductionMutation.mutate(order)}
                            disabled={convertToProductionMutation.isPending}
                            className="bg-emerald-600 hover:bg-emerald-700"
                          >
                            <CheckCircle2 className="w-4 h-4 mr-1" />
                            Convert to Order
                          </Button>
                        </div>
                      </div>

                      {order.notes && (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <p className="text-xs text-slate-500">Notes</p>
                          <p className="text-sm text-slate-600">{order.notes}</p>
                        </div>
                      )}

                      <p className="text-xs text-slate-400 mt-2">
                        {format(new Date(order.created_date), "dd MMM yyyy 'at' HH:mm")}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}