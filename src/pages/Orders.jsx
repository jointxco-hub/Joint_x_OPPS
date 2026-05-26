import { Component, Suspense, lazy, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Package, LayoutGrid, List, AlertTriangle, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import OrderTagBadges from "@/components/orders/OrderTagBadges";
import { useArchive } from "@/hooks/useArchive";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { SourceBadge } from "@/lib/opsDisplay";
import { toast } from "sonner";

const loadOrderDrawer = () => import("@/components/orders/OrderDrawer");
const loadNewOrderDrawer = () => import("@/components/orders/NewOrderDrawer");

function lazyWithRefresh(loader, key) {
  return lazy(() =>
    loader().catch((error) => {
      const retryKey = `opps-lazy-retry:${key}`;
      if (typeof window !== "undefined" && !window.sessionStorage.getItem(retryKey)) {
        window.sessionStorage.setItem(retryKey, "1");
        window.location.reload();
        return new Promise(() => {});
      }
      throw error;
    })
  );
}

const OrderDrawer = lazyWithRefresh(loadOrderDrawer, "OrderDrawer");
const NewOrderDrawer = lazyWithRefresh(loadNewOrderDrawer, "NewOrderDrawer");

function BasicOrderDrawer({ order, onClose }) {
  const sc = statusConfig[order?.status] || { label: order?.status || "Order", color: "bg-secondary text-muted-foreground" };
  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-[60] flex h-full w-full max-w-xl flex-col bg-card shadow-apple-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-bold text-foreground">{order?.client_name || "Order"}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${sc.color}`}>{sc.label}</span>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">#{order?.order_number || order?.id || "draft"}</p>
          </div>
          <button onClick={onClose} className="rounded-xl bg-secondary px-3 py-2 text-xs font-medium text-muted-foreground">
            Close
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <div className="rounded-2xl border border-border bg-secondary/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</p>
            <p className="mt-1 text-sm font-medium text-foreground">{order?.client_name || "Not added"}</p>
            {order?.client_email && <p className="mt-1 text-xs text-muted-foreground">{order.client_email}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-secondary/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
              <p className="mt-1 text-sm font-bold text-foreground">
                {order?.total_amount ? `R${Number(order.total_amount).toLocaleString()}` : "Not set"}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-secondary/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Due</p>
              <p className="mt-1 text-sm font-bold text-foreground">{order?.due_date || "No due date"}</p>
            </div>
          </div>
          {Array.isArray(order?.products) && order.products.length > 0 && (
            <div className="rounded-2xl border border-border bg-secondary/30 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Products</p>
              <div className="space-y-2">
                {order.products.slice(0, 8).map((product, index) => (
                  <div key={`${product?.name || "item"}-${index}`} className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-foreground">{product?.name || "Item"}</span>
                    <span className="shrink-0 text-muted-foreground">{product?.quantity ? `x${product.quantity}` : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
            Basic view is active for this order. You can close and reopen to load the full workspace.
          </p>
        </div>
      </div>
    </>
  );
}

class OrderDrawerErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("[Orders] Order drawer failed to render", error);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return <BasicOrderDrawer order={this.props.order} onClose={this.props.onClose} />;
    }

    return this.props.children;
  }
}

const statusConfig = {
  confirmed:     { label: "Confirmed",     color: "bg-primary/10 text-primary" },
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
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [viewMode, setViewMode] = useState("list");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [printSummary, setPrintSummary] = useState(null);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => dataClient.entities.Order.list("-created_date", 200),
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadOrderDrawer();
      loadNewOrderDrawer();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => dataClient.entities.User.list("name", 100),
    staleTime: 300_000,
  });

  // Auto-open drawer when navigated from Dashboard with ?open=<id>
  useEffect(() => {
    const openId = searchParams.get("open");
    if (openId && orders.length > 0) {
      const target = orders.find((/** @type {any} */ o) => o.id === openId);
      if (target) {
        setSelectedOrder(target);
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, orders]);

  const { data: stages = [] } = useQuery({
    queryKey: ["orderStages"],
    queryFn: () => dataClient.entities.OrderStage.list("sequence", 50),
    staleTime: 300_000,
  });

  const updateMutation = useMutation({
    mutationFn: (/** @type {any} */ { id, data }) => dataClient.entities.Order.update(id, data),
    onSuccess: (/** @type {any} */ updatedOrder) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      // Keep the open drawer in sync so selects don't snap back to stale values
      if (updatedOrder && selectedOrder?.id === updatedOrder.id) {
        setSelectedOrder((/** @type {any} */ prev) => ({ ...prev, ...updatedOrder }));
      }
    },
    onError: () => toast.error("Failed to update order — please try again"),
  });

  const { archive: archiveOrder, isPending: isArchiving } = useArchive("Order", {
    onSuccess: () => setSelectedOrder(null),
  });

  const filtered = orders.filter(o => {
    if (o.is_archived) return false;
    if (statusFilter === "active" && ["delivered", "cancelled"].includes(o.status)) return false;
    if (statusFilter === "delivered" && o.status !== "delivered") return false;
    if (statusFilter === "cancelled" && o.status !== "cancelled") return false;
    if (assigneeFilter !== "all" && o.assigned_to !== assigneeFilter) return false;
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setPrintSummary("active")}
              className="hidden gap-2 rounded-xl md:inline-flex"
            >
              <Printer className="w-4 h-4" /> Active summary
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPrintSummary("due")}
              className="hidden gap-2 rounded-xl md:inline-flex"
            >
              <Printer className="w-4 h-4" /> Due
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
          <div className="flex gap-2 flex-wrap">
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
            {users.length > 0 && (
              <select
                value={assigneeFilter}
                onChange={e => setAssigneeFilter(e.target.value)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all border appearance-none cursor-pointer ${
                  assigneeFilter !== "all"
                    ? "bg-primary text-primary-foreground border-primary shadow-apple-sm"
                    : "bg-card border-border text-muted-foreground"
                }`}
              >
                <option value="all">All assignees</option>
                {(/** @type {any[]} */ (users)).map((/** @type {any} */ u) => (
                  <option key={u.id} value={u.email}>{u.full_name || u.name || u.email}</option>
                ))}
              </select>
            )}
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
                    <div className="md:hidden px-4 py-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <SourceBadge source={order.source} />
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sc.color}`}>{sc.label}</span>
                      </div>
                      <p className="truncate text-base font-semibold text-foreground">{order.client_name || "Customer"}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-mono">{order.order_number}</span>
                        <span>{order.due_date ? format(new Date(order.due_date), "d MMM") : "No due date"}</span>
                        {order.total_amount ? <span className="font-semibold text-foreground">R{Number(order.total_amount).toLocaleString()}</span> : null}
                      </div>
                      <div className="mt-2">
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
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> Exceptions ({exceptionOrders.length})
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
        <OrderDrawerErrorBoundary resetKey={selectedOrder.id} order={selectedOrder} onClose={() => setSelectedOrder(null)}>
          <Suspense fallback={<DrawerLoadingFallback onClose={() => setSelectedOrder(null)} />}>
            <OrderDrawer
              key={selectedOrder.id}
              order={selectedOrder}
              onClose={() => setSelectedOrder(null)}
              onUpdate={(id, data) => {
                updateMutation.mutate({ id, data });
                setSelectedOrder(prev => ({ ...(prev || selectedOrder), ...data }));
              }}
              onArchive={() => archiveOrder(selectedOrder.id)}
              isArchiving={isArchiving}
            />
          </Suspense>
        </OrderDrawerErrorBoundary>
      )}

      {showNew && (
        <Suspense fallback={<DrawerLoadingFallback onClose={() => setShowNew(false)} label="Loading new order..." />}>
          <NewOrderDrawer
            onClose={() => setShowNew(false)}
            onCreate={async (orderData) => {
              await dataClient.entities.Order.create(orderData);
              queryClient.invalidateQueries({ queryKey: ["orders"] });
              setShowNew(false);
            }}
          />
        </Suspense>
      )}

      {printSummary && (
        <OrdersProductionSummary
          type={printSummary}
          orders={orders}
          stages={stages}
          onClose={() => setPrintSummary(null)}
        />
      )}
    </div>
  );
}

function DrawerLoadingFallback({ onClose, label = "Loading order..." }) {
  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-[60] flex h-full w-full max-w-xl flex-col bg-card p-5 shadow-apple-xl">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <div className="h-5 w-40 animate-pulse rounded bg-secondary" />
            <div className="mt-2 h-3 w-24 animate-pulse rounded bg-secondary/70" />
          </div>
          <button onClick={onClose} className="rounded-xl bg-secondary px-3 py-2 text-xs text-muted-foreground">Close</button>
        </div>
        <div className="mt-5 space-y-3">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-2xl bg-secondary/60" />
          ))}
        </div>
      </div>
    </>
  );
}

function OrdersProductionSummary({ type, orders, stages, onClose }) {
  const activeOrders = orders
    .filter(order => !order.is_archived && !["delivered", "cancelled"].includes(order.status))
    .sort((a, b) => {
      const aDue = Date.parse(a.due_date || "") || Number.MAX_SAFE_INTEGER;
      const bDue = Date.parse(b.due_date || "") || Number.MAX_SAFE_INTEGER;
      return aDue - bDue || String(a.client_name || "").localeCompare(String(b.client_name || ""));
    });

  const summaryOrders = type === "due"
    ? activeOrders.filter(order => order.due_date)
    : activeOrders;
  const stageLabelByKey = new Map((stages || []).map(stage => [stage.key, stage.display_name || stage.name || stage.key]));
  const groups = groupProductionSummaryOrders(summaryOrders, stageLabelByKey, type);
  const printedAt = format(new Date(), "d MMM yyyy HH:mm");

  return (
    <div className="fixed inset-0 z-[80] bg-background/95 p-4 print:static print:bg-white print:p-0">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .orders-production-print, .orders-production-print * { visibility: visible; }
          .orders-production-print { position: absolute; inset: 0; width: 100%; padding: 18mm; background: #fff; color: #111; }
          .no-print { display: none !important; }
          .print-order-card { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 flex max-w-6xl items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-apple-sm">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {type === "due" ? "Due order production summary" : "Active order production summary"}
          </p>
          <p className="text-xs text-muted-foreground">Categorised with mockups, contact aliases, due dates, and execution notes.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose} className="rounded-xl">Close</Button>
          <Button type="button" onClick={() => window.print()} className="rounded-xl gap-2">
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <div className="orders-production-print mx-auto max-h-[calc(100vh-96px)] max-w-6xl overflow-y-auto rounded-2xl border border-border bg-white p-6 shadow-apple-sm print:max-h-none print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="mb-6 flex items-start justify-between gap-6 border-b border-zinc-200 pb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-700">Joint X OPPS</p>
            <h1 className="mt-2 text-2xl font-bold text-zinc-950">
              {type === "due" ? "Due Order Summary" : "Active Production Summary"}
            </h1>
            <p className="mt-1 text-sm text-zinc-600">Team handover sheet for production, packing, and follow-up.</p>
          </div>
          <div className="text-right text-xs text-zinc-600">
            <p>Printed {printedAt}</p>
            <p className="mt-1 font-semibold text-zinc-950">{summaryOrders.length} orders</p>
          </div>
        </header>

        {summaryOrders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500">
            No matching active orders.
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map(group => (
              <section key={group.title} className="space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
                  <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-zinc-800">{group.title}</h2>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-600">{group.orders.length}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 print:grid-cols-2">
                  {group.orders.map(order => (
                    <ProductionSummaryOrderCard key={order.id} order={order} stageLabel={stageLabelByKey.get(order.pipeline_stage)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductionSummaryOrderCard({ order, stageLabel }) {
  const thumb = getOrderThumbnail(order);
  const products = getOrderProducts(order);
  const statusLabel = statusConfig[order.status]?.label || String(order.status || "Active").replace(/_/g, " ");
  const dueLabel = order.due_date ? format(new Date(order.due_date), "d MMM yyyy") : "No due date";
  const notes = [order.notes, order.special_instructions, order.delivery_note].filter(Boolean).join(" / ");

  return (
    <article className="print-order-card rounded-2xl border border-zinc-200 bg-white p-3">
      <div className="flex gap-3">
        <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase tracking-wide text-zinc-400">No mockup</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="truncate text-sm font-bold text-zinc-950">{order.client_name || "Client"}</h3>
              <p className="font-mono text-xs text-zinc-500">{order.order_number || order.id}</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">{statusLabel}</span>
          </div>

          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <PrintDatum label="Due" value={dueLabel} />
            <PrintDatum label="Stage" value={stageLabel || order.pipeline_stage || "Order received"} />
            <PrintDatum label="WhatsApp" value={order.whatsapp_name || "Not saved"} />
            <PrintDatum label="Saved as" value={order.saved_contact_name || "Not saved"} />
            <PrintDatum label="PEP/Courier" value={order.pep_code || order.tracking_number || "Not added"} />
            <PrintDatum label="Total" value={order.total_amount ? `R${Number(order.total_amount).toLocaleString()}` : "Not set"} />
          </dl>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-zinc-50 p-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Products / Work</p>
        {products.length > 0 ? (
          <ul className="mt-1 space-y-1 text-xs text-zinc-800">
            {products.slice(0, 5).map((product, index) => (
              <li key={`${product.name}-${index}`} className="flex justify-between gap-2">
                <span>{product.quantity ? `${product.quantity} x ` : ""}{product.name || "Item"}</span>
                <span className="text-zinc-500">{[product.size, product.color].filter(Boolean).join(" / ")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">No product lines added.</p>
        )}
      </div>

      {notes ? (
        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          {notes}
        </p>
      ) : null}
    </article>
  );
}

function PrintDatum({ label, value }) {
  return (
    <div>
      <dt className="text-[9px] font-bold uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="truncate font-medium text-zinc-800">{value || "—"}</dd>
    </div>
  );
}

function groupProductionSummaryOrders(orders, stageLabelByKey, type) {
  if (type === "due") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    return [
      { title: "Overdue", orders: orders.filter(order => order.due_date && new Date(order.due_date) < today) },
      { title: "Due today", orders: orders.filter(order => order.due_date && sameDay(new Date(order.due_date), today)) },
      { title: "Due tomorrow", orders: orders.filter(order => order.due_date && sameDay(new Date(order.due_date), tomorrow)) },
      { title: "Due this week", orders: orders.filter(order => {
        if (!order.due_date) return false;
        const due = new Date(order.due_date);
        return due > tomorrow && due <= nextWeek;
      }) },
      { title: "Later", orders: orders.filter(order => order.due_date && new Date(order.due_date) > nextWeek) },
    ].filter(group => group.orders.length > 0);
  }

  const groups = new Map();
  orders.forEach(order => {
    const title = stageLabelByKey.get(order.pipeline_stage) || statusConfig[order.status]?.label || "Active orders";
    groups.set(title, [...(groups.get(title) || []), order]);
  });
  return [...groups.entries()].map(([title, groupOrders]) => ({ title, orders: groupOrders }));
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getOrderProducts(order) {
  if (Array.isArray(order.products)) return order.products;
  if (Array.isArray(order.items)) return order.items;
  return [];
}

function getOrderThumbnail(order) {
  const candidates = [
    ...extractUrls(order.portal_visible_file_urls),
    ...extractUrls(order.file_urls),
    ...extractUrls(order.mockup_urls),
    ...getOrderProducts(order).flatMap(product => extractUrls([product.image_url, product.image, product.thumbnail_url, product.thumbnail])),
  ];
  return candidates.find(isImageUrl) || "";
}

function extractUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") return [value];
  return [];
}

function isImageUrl(url) {
  return /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(String(url || ""));
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
      <div className="mb-1">
        <SourceBadge source={order.source} />
      </div>
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
