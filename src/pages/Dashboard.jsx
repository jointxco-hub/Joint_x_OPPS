import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { 
  Package, ClipboardList, Truck, CheckCircle2, 
  Plus, Clock, AlertTriangle 
} from "lucide-react";
import StatsCard from "@/components/dashboard/StatsCard";
import ActiveOrderCard from "@/components/dashboard/ActiveOrderCard";
import TaskItem from "@/components/dashboard/TaskItem";
import OrderForm from "@/components/orders/OrderForm";
import OrderDetails from "@/components/orders/OrderDetails";
import TaskForm from "@/components/tasks/TaskForm";

export default function Dashboard() {
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const queryClient = useQueryClient();

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 100)
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => base44.entities.Task.list('-created_date', 100)
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

  const activeOrders = orders.filter(o => o.status !== 'delivered');
  const pendingTasks = tasks.filter(t => t.status !== 'completed');
  const urgentOrders = orders.filter(o => o.priority === 'urgent' && o.status !== 'delivered');
  const readyForDelivery = orders.filter(o => o.status === 'ready' || o.status === 'out_for_delivery');

  const handleOrderSubmit = (data) => {
    if (editingOrder) {
      updateOrderMutation.mutate({ id: editingOrder.id, data });
    } else {
      createOrderMutation.mutate(data);
    }
  };

  const handleUpdateStatus = (orderId, status) => {
    updateOrderMutation.mutate({ id: orderId, data: { status } });
  };

  const handleTaskStatusChange = (taskId, status) => {
    updateTaskMutation.mutate({ id: taskId, data: { status } });
  };

  if (showOrderForm || editingOrder) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-8">
        <div className="max-w-3xl mx-auto">
          <OrderForm 
            order={editingOrder}
            onSubmit={handleOrderSubmit}
            onCancel={() => {
              setShowOrderForm(false);
              setEditingOrder(null);
            }}
          />
        </div>
      </div>
    );
  }

  if (showTaskForm) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
          <TaskForm 
            orders={orders}
            onSubmit={(data) => createTaskMutation.mutate(data)}
            onCancel={() => setShowTaskForm(false)}
          />
        </div>
      </div>
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

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-slate-500 mt-1">Manage your orders and tasks</p>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => setShowTaskForm(true)} variant="outline">
              <Plus className="w-4 h-4 mr-2" /> New Task
            </Button>
            <Button onClick={() => setShowOrderForm(true)} className="bg-slate-900 hover:bg-slate-800">
              <Plus className="w-4 h-4 mr-2" /> New Order
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
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
            title="Urgent" 
            value={urgentOrders.length} 
            icon={AlertTriangle}
            color="red"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active Orders */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Active Orders</h2>
              <span className="text-sm text-slate-500">{activeOrders.length} orders</span>
            </div>
            
            {activeOrders.length === 0 ? (
              <div className="bg-white rounded-xl p-8 text-center">
                <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No active orders</p>
                <Button onClick={() => setShowOrderForm(true)} className="mt-4">
                  Create First Order
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeOrders.slice(0, 6).map(order => (
                  <ActiveOrderCard 
                    key={order.id} 
                    order={order} 
                    onClick={setSelectedOrder}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Tasks */}
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
              <div className="space-y-3">
                {pendingTasks.slice(0, 8).map(task => (
                  <TaskItem 
                    key={task.id} 
                    task={task} 
                    onStatusChange={handleTaskStatusChange}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}