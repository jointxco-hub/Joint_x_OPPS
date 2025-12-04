import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Package, ClipboardList, Truck, CheckCircle2, 
  Plus, AlertTriangle, ShoppingCart, ArrowRight
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import StatsCard from "@/components/dashboard/StatsCard";
import ActiveOrderCard from "@/components/dashboard/ActiveOrderCard";
import TaskItem from "@/components/dashboard/TaskItem";
import POModal from "@/components/purchaseorders/POModal";
import LowStockAlert from "@/components/dashboard/LowStockAlert";
import FocusView from "@/components/dashboard/FocusView";
import TypeformOrderForm from "@/components/orders/TypeformOrderForm";
import TypeformTaskForm from "@/components/tasks/TypeformTaskForm";
import TypeformPOForm from "@/components/purchaseorders/TypeformPOForm";
import OrderDetails from "@/components/orders/OrderDetails";

export default function Dashboard() {
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showPOForm, setShowPOForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [focusMode, setFocusMode] = useState("all");
  const [selectedPO, setSelectedPO] = useState(null);
  const queryClient = useQueryClient();

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 100)
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => base44.entities.Task.list('-created_date', 100)
  });

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['purchaseOrders'],
    queryFn: () => base44.entities.PurchaseOrder.list('-created_date', 50)
  });

  const { data: inventory = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => base44.entities.InventoryItem.list('name', 100)
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => base44.entities.Supplier.list('name', 100)
  });

  const createOrderMutation = useMutation({
    mutationFn: (data) => base44.entities.Order.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setShowOrderForm(false);
    }
  });

  const updateOrderMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Order.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setEditingOrder(null);
      setSelectedOrder(null);
    }
  });

  const createTaskMutation = useMutation({
    mutationFn: (data) => base44.entities.Task.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setShowTaskForm(false);
    }
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Task.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] })
  });

  const createPOMutation = useMutation({
    mutationFn: (data) => base44.entities.PurchaseOrder.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      setShowPOForm(false);
    }
  });

  const updatePOMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PurchaseOrder.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] })
  });

  // Auto-generate POs for low stock
  useEffect(() => {
    const checkLowStock = async () => {
      const lowStockItems = inventory.filter(
        item => item.reorder_point && item.current_stock <= item.reorder_point
      );

      for (const item of lowStockItems) {
        const existingPO = purchaseOrders.find(
          po => po.trigger_item_id === item.id && 
               ['draft', 'pending', 'approved', 'ordered'].includes(po.status)
        );

        if (!existingPO && item.preferred_supplier_id) {
          const supplier = suppliers.find(s => s.id === item.preferred_supplier_id);
          if (supplier) {
            await base44.entities.PurchaseOrder.create({
              po_number: `PO-AUTO-${Date.now().toString(36).toUpperCase()}`,
              supplier_id: supplier.id,
              supplier_name: supplier.name,
              status: "draft",
              items: [{
                inventory_item_id: item.id,
                name: item.name,
                sku: item.sku || "",
                quantity: item.reorder_quantity || 10,
                unit: item.unit || "pieces",
                unit_price: item.cost_price || item.unit_cost || 0,
                total: (item.reorder_quantity || 10) * (item.cost_price || item.unit_cost || 0)
              }],
              subtotal: (item.reorder_quantity || 10) * (item.cost_price || item.unit_cost || 0),
              total: (item.reorder_quantity || 10) * (item.cost_price || item.unit_cost || 0),
              auto_generated: true,
              trigger_item_id: item.id,
              order_date: new Date().toISOString().split('T')[0]
            });
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
          }
        }
      }
    };

    if (inventory.length > 0 && suppliers.length > 0) {
      checkLowStock();
    }
  }, [inventory, suppliers, purchaseOrders]);

  const activeOrders = orders.filter(o => o.status !== 'delivered');
  const pendingTasks = tasks.filter(t => t.status !== 'completed');
  const urgentOrders = orders.filter(o => o.priority === 'urgent' && o.status !== 'delivered');
  const readyForDelivery = orders.filter(o => o.status === 'ready' || o.status === 'out_for_delivery');
  const pendingPOs = purchaseOrders.filter(po => ['draft', 'pending', 'approved', 'ordered'].includes(po.status));
  const lowStockItems = inventory.filter(item => item.reorder_point && item.current_stock <= item.reorder_point);

  const handleOrderSubmit = async (data) => {
    if (editingOrder) {
      await updateOrderMutation.mutateAsync({ id: editingOrder.id, data });
    } else {
      await createOrderMutation.mutateAsync(data);
    }
  };

  const handleUpdateStatus = (orderId, status) => {
    updateOrderMutation.mutate({ id: orderId, data: { status } });
  };

  const handleTaskStatusChange = (taskId, status) => {
    updateTaskMutation.mutate({ id: taskId, data: { status } });
  };

  const handlePOStatusChange = (po, status) => {
    updatePOMutation.mutate({ id: po.id, data: { status } });
    setSelectedPO(null);
  };

  const handleCreatePOFromItem = (item) => {
    setShowPOForm(true);
  };

  if (showOrderForm || editingOrder) {
    return (
      <TypeformOrderForm 
        order={editingOrder}
        onSubmit={handleOrderSubmit}
        onCancel={() => {
          setShowOrderForm(false);
          setEditingOrder(null);
        }}
      />
    );
  }

  if (showTaskForm) {
    return (
      <TypeformTaskForm 
        orders={orders}
        onSubmit={(data) => createTaskMutation.mutateAsync(data)}
        onCancel={() => setShowTaskForm(false)}
      />
    );
  }

  if (showPOForm) {
    return (
      <TypeformPOForm 
        suppliers={suppliers}
        inventoryItems={inventory}
        onSubmit={(data) => createPOMutation.mutateAsync(data)}
        onCancel={() => setShowPOForm(false)}
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
            onUpdateStatus={handleUpdateStatus}
          />
        </div>
      </div>
    );
  }

  // Filter content based on focus mode
  const showOrders = focusMode === "all" || focusMode === "orders" || focusMode === "urgent" || focusMode === "delivery";
  const showTasks = focusMode === "all" || focusMode === "tasks";
  const showPurchasing = focusMode === "all" || focusMode === "purchasing";
  const showLowStock = focusMode === "all" || focusMode === "purchasing";

  const displayOrders = focusMode === "urgent" 
    ? urgentOrders 
    : focusMode === "delivery" 
      ? readyForDelivery 
      : activeOrders;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* PO Modal */}
      {selectedPO && (
        <POModal 
          po={selectedPO}
          supplier={suppliers.find(s => s.id === selectedPO.supplier_id)}
          onClose={() => setSelectedPO(null)}
          onStatusChange={handlePOStatusChange}
        />
      )}

      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-slate-500 mt-1">Manage your orders, tasks & inventory</p>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => setShowTaskForm(true)} variant="outline">
              <Plus className="w-4 h-4 mr-2" /> Task
            </Button>
            <Button onClick={() => setShowPOForm(true)} variant="outline">
              <ShoppingCart className="w-4 h-4 mr-2" /> PO
            </Button>
            <Button onClick={() => setShowOrderForm(true)} className="bg-slate-900 hover:bg-slate-800">
              <Plus className="w-4 h-4 mr-2" /> Order
            </Button>
          </div>
        </div>

        {/* Focus View */}
        <Card className="mb-6 p-4 bg-white border-0 shadow-sm">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm font-medium text-slate-500">Focus:</span>
            <FocusView activeMode={focusMode} onModeChange={setFocusMode} />
          </div>
        </Card>

        {/* Low Stock Alerts */}
        {showLowStock && lowStockItems.length > 0 && (
          <div className="mb-6 space-y-3">
            <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wide flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Low Stock Alerts
            </h2>
            {lowStockItems.slice(0, 3).map(item => (
              <LowStockAlert 
                key={item.id} 
                item={item} 
                onCreatePO={handleCreatePOFromItem}
              />
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <StatsCard 
            title="Active Orders" 
            value={activeOrders.length} 
            icon={Package}
            color="blue"
          />
          <StatsCard 
            title="Pending Tasks" 
            value={pendingTasks.length} 
            icon={ClipboardList}
            color="orange"
          />
          <StatsCard 
            title="Ready for Delivery" 
            value={readyForDelivery.length} 
            icon={Truck}
            color="green"
          />
          <StatsCard 
            title="Pending POs" 
            value={pendingPOs.length} 
            icon={ShoppingCart}
            color="purple"
          />
          <StatsCard 
            title="Urgent" 
            value={urgentOrders.length} 
            icon={AlertTriangle}
            color="red"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Orders Section */}
          {showOrders && (
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  {focusMode === "urgent" ? "Urgent Orders" : 
                   focusMode === "delivery" ? "Ready for Delivery" : "Active Orders"}
                </h2>
                <Link to={createPageUrl("Orders")} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1">
                  View all <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
              
              {displayOrders.length === 0 ? (
                <div className="bg-white rounded-xl p-8 text-center">
                  <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">No orders to show</p>
                  <Button onClick={() => setShowOrderForm(true)} className="mt-4">
                    Create Order
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {displayOrders.slice(0, 6).map(order => (
                    <ActiveOrderCard 
                      key={order.id} 
                      order={order} 
                      onClick={setSelectedOrder}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Right Column */}
          <div className={`space-y-6 ${!showOrders ? 'lg:col-span-3' : ''}`}>
            {/* Purchase Orders */}
            {showPurchasing && pendingPOs.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">Purchase Orders</h2>
                  <Link to={createPageUrl("PurchaseOrders")} className="text-sm text-blue-600 hover:text-blue-700">
                    View all
                  </Link>
                </div>
                <div className={`grid gap-3 ${!showOrders ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : ''}`}>
                  {pendingPOs.slice(0, showOrders ? 3 : 6).map(po => (
                    <DashboardPOCard 
                      key={po.id} 
                      po={po} 
                      onClick={() => setSelectedPO(po)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Tasks */}
            {showTasks && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">Today's Tasks</h2>
                  <Button variant="ghost" size="sm" onClick={() => setShowTaskForm(true)}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                
                {pendingTasks.length === 0 ? (
                  <div className="bg-white rounded-xl p-6 text-center">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                    <p className="text-slate-500 text-sm">All caught up!</p>
                  </div>
                ) : (
                  <div className={`space-y-3 ${!showOrders ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 space-y-0' : ''}`}>
                    {pendingTasks.slice(0, showOrders ? 5 : 9).map(task => (
                      <TaskItem 
                        key={task.id} 
                        task={task} 
                        onStatusChange={handleTaskStatusChange}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Dashboard PO Card Component
function DashboardPOCard({ po, onClick }) {
  const statusColors = {
    draft: "bg-slate-100 text-slate-700",
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-blue-100 text-blue-700",
    ordered: "bg-purple-100 text-purple-700"
  };

  return (
    <Card 
      className="border-0 bg-white/90 backdrop-blur shadow-sm hover:shadow-md transition-all cursor-pointer rounded-2xl"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="font-semibold text-slate-900">{po.po_number}</p>
            <p className="text-sm text-slate-500">{po.supplier_name}</p>
          </div>
          <Badge className={`${statusColors[po.status] || statusColors.draft} border-0 rounded-full text-xs`}>
            {po.status}
          </Badge>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 mt-2">
          <span className="text-xs text-slate-500">{po.items?.length || 0} items</span>
          <span className="font-semibold">R{(po.total || 0).toLocaleString()}</span>
        </div>
      </CardContent>
    </Card>
  );
}