import { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Package, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import OrderDrawer from "@/components/orders/OrderDrawer";
import NewOrderDrawer from "@/components/orders/NewOrderDrawer";
import OrderTagBadges from "@/components/orders/OrderTagBadges";
import { useArchive } from "@/hooks/useArchive";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

const statusConfig = {
  confirmed:     { label: "Confirmed",     color: "bg-blue-100 text-blue-700" },
  in_production: { label: "In Production", color: "bg-orange-100 text-orange-700" },
  ready:         { label: "Ready",         color: "bg-green-100 text-green-700" },
  shipped:       { label: "Shipped",       color: "bg-purple-100 text-purple-700" },
  delivered:     { label: "Delivered",     color: "bg-slate-100 text-slate-600" },
  cancelled:     { label: "Cancelled",     color: "bg-red-100 text-red-600" },
};

const priorityDot = {
  urgent: "bg-red-500",
  high:   "bg-orange-400",
  normal: "bg-slate-300",
  low:    "bg-slate-200",
};

export default function Orders() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [viewMode, setViewMode] = useState("list");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const queryClient = useQueryClient();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => dataClient.entities.Order.list("-created_date", 200),
  });

  const { data: stages = [] } = useQuery({
    queryKey: ["orderStages"],
    queryFn: () => dataClient.entities.OrderStage.list("sequence", 50),
    staleTime: 300_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.Order.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });

  const { archive: archiveOrder, isPending: isArchiving } = useArchive("Order", {
    onSuccess: () => setSelectedOrder(null),
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
    active:    orders.filter(o => !o.is_archived && !["delivered","cancelled"].includes(o.status)).length,
    delivered: orders.filter(o => !o.is_archived && o.status === "delivered").length,
    cancelled: orders.filter(o => !o.is_archived && o.status === "cancelled").length,
  };

  // Kanban helpers
  const normalStages = stages.filter(s => !s.is_exception).sort((a, b) => a.sequence - b.sequence);
  const exceptionStages = stages.filter(s => s.is_exception);
  const exceptionKeys = new Set(exceptionStages.map(s => s.key));

  const activeOrders = orders.filter(o => !o.is_archived);
  const exceptionOrders = activeOrders.filter(o => exceptionKeys.has(o.pipeline_stage));
  const getColumnOrders = (stageKey) =>
    activeOrders.filter(o => (o.pipeline_stage ?? 'received') === stageKey && !exceptionKeys.has(o.pipeline_stage));

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const newStage = destination.droppableId;
    updateMutation.mutate({ id: draggableId, data: { pipeline_stage: newStage } });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Orders</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {counts.active} active · {counts.delivered} delivered
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex bg-secondary rounded-xl p-0.5">
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-lg transition-all ${viewMode === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("kanban")}
                className={`p-1.5 rounded-lg transition-all ${viewMode === "kanban" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}
                title="Kanban view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
            <Button onClick={() => setShowNew(true)} className="gap-2 shadow-apple-sm rounded-xl">
              <Plus className="w-4 h-4" /> New Order
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-6">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search orders..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-card rounded-xl h-9"
            />
          </div>
          <div className="flex gap-2">
            {[
              { key: "active",    label: `Active (${counts.active})` },
              { key: "delivered", label: `Delivered (${counts.delivered})` },
              { key: "all",       label: "All" },
            ].map(s => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
                  statusFilter === s.key
                    ? "bg-primary text-primary-foreground shadow-apple-sm"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-20 bg-card rounded-2xl animate-pulse" />)}
          </div>
        ) : viewMode === "list" ? (
          /* ── LIST VIEW ── */
          filtered.length === 0 ? (
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
                  <button
                    key={order.id}
                    onClick={() => setSelectedOrder(order)}
                    className="w-full text-left border-b border-border last:border-0 hover:bg-secondary/40 transition-all"
                  >
                    {/* Mobile */}
                    <div className="md:hidden grid grid-cols-2 items-center px-5 py-4 gap-2">
                      <div>
                        <p className="font-medium text-foreground text-sm">{order.client_name}</p>
                        <p className="text-xs text-muted-foreground">{order.order_number}</p>
                      </div>
                      <div className="text-right">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sc.color}`}>{sc.label}</span>
                      </div>
                      <div className="col-span-2">
                        <OrderTagBadges order={order} />
                      </div>
                    </div>
                    {/* Desktop */}
                    <div className="hidden md:grid grid-cols-12 items-center px-5 py-4 gap-2">
                      <div className="col-span-4 flex items-start gap-3">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${priorityDot[order.priority] || priorityDot.normal}`} />
                        <div>
                          <p className="font-medium text-foreground text-sm">{order.client_name}</p>
                          <div className="mt-0.5">
                            <OrderTagBadges order={order} />
                          </div>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <p className="text-sm text-muted-foreground font-mono">{order.order_number}</p>
                      </div>
                      <div className="col-span-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sc.color}`}>{sc.label}</span>
                      </div>
                      <div className="col-span-2">
                        <p className="text-sm text-muted-foreground">
                          {order.due_date ? format(new Date(order.due_date), "d MMM") : "—"}
                        </p>
                      </div>
                      <div className="col-span-2 text-right">
                        <p className="text-sm font-semibold text-foreground">
                          {order.total_amount ? `R${Number(order.total_amount).toLocaleString()}` : "—"}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        ) : (
          /* ── KANBAN VIEW ── */
          <DragDropContext onDragEnd={onDragEnd}>
            {/* Exception lane */}
            {exceptionOrders.length > 0 && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-3">
                <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">
                  🚨 Exceptions ({exceptionOrders.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {exceptionOrders.map(order => (
                    <KanbanCard
                      key={order.id}
                      order={order}
                      index={0}
                      onClick={() => setSelectedOrder(order)}
                      isException
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Normal stage columns */}
            <div className="overflow-x-auto pb-4">
              <div className="flex gap-3 min-w-max">
                {normalStages.map(stage => {
                  const colOrders = getColumnOrders(stage.key);
                  return (
                    <div key={stage.key} className="w-52 flex-shrink-0">
                      <div className="flex items-center justify-between mb-2 px-1">
                        <p className="text-xs font-semibold text-foreground truncate">{stage.display_name}</p>
                        <span className="text-xs text-muted-foreground ml-1">{colOrders.length}</span>
                      </div>
                      <Droppable droppableId={stage.key}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`min-h-[120px] rounded-xl p-1.5 transition-colors ${
                              snapshot.isDraggingOver ? "bg-primary/5 border-2 border-primary/20 border-dashed" : "bg-secondary/30"
                            }`}
                          >
                            {colOrders.map((order, index) => (
                              <Draggable key={order.id} draggableId={order.id} index={index}>
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    style={provided.draggableProps.style}
                                  >
                                    <KanbanCard
                                      order={order}
                                      index={index}
                                      onClick={() => setSelectedOrder(order)}
                                      isDragging={snapshot.isDragging}
                                    />
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                            {colOrders.length === 0 && !snapshot.isDraggingOver && (
                              <p className="text-[11px] text-muted-foreground/40 text-center pt-4">Drop here</p>
                            )}
                          </div>
                        )}
                      </Droppable>
                    </div>
                  );
                })}
              </div>
            </div>
          </DragDropContext>
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
          onArchive={() => archiveOrder(selectedOrder.id)}
          isArchiving={isArchiving}
        />
      )}

      {showNew && (
        <NewOrderDrawer
          onClose={() => setShowNew(false)}
          onCreate={async (orderData) => {
            await dataClient.entities.Order.create(orderData);
            queryClient.invalidateQueries({ queryKey: ["orders"] });
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}

function KanbanCard({ order, onClick, isDragging, isException }) {
  const sc = statusConfig[order.status] || { label: order.status, color: "bg-secondary text-muted-foreground" };
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-card rounded-xl border p-2.5 mb-1.5 last:mb-0 transition-all ${
        isDragging
          ? "shadow-lg border-primary/30 rotate-1"
          : isException
          ? "border-red-200 shadow-sm"
          : "border-border shadow-sm hover:shadow-md hover:border-primary/20"
      }`}
    >
      <p className="text-xs font-semibold text-foreground truncate mb-0.5">{order.client_name}</p>
      {order.order_number && (
        <p className="text-[10px] text-muted-foreground font-mono mb-1">{order.order_number}</p>
      )}
      <div className="flex items-center justify-between gap-1">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${sc.color}`}>{sc.label}</span>
        {order.total_amount && (
          <span className="text-[10px] font-semibold text-foreground">R{Number(order.total_amount).toLocaleString()}</span>
        )}
      </div>
      <div className="mt-1.5">
        <OrderTagBadges order={order} />
      </div>
    </button>
  );
}
