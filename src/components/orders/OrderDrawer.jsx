import React, { useState } from "react";
import { format } from "date-fns";
import {
  X, Package, CreditCard, Paperclip,
  CheckCircle2, ChevronRight, ExternalLink,
  Archive, ShoppingCart, AlertTriangle, Copy, Check,
  User, FileText, Plus, Trash2, Pencil
} from "lucide-react";

const DEFAULT_COURIERS = [
  { value: "the_courier_guy", label: "The Courier Guy", url: "https://portal.thecourierguy.co.za/track", appendTracking: false },
  { value: "courier_it", label: "Courier IT", url: "https://www.courier-it.co.za/tracking/?tracking=" },
  { value: "pep_paxi", label: "Pep Paxi", url: "https://www.paxi.co.za/track?parcelref=" },
  { value: "aramex", label: "Aramex", url: "https://www.aramex.com/tools/track?l=" },
  { value: "dhl", label: "DHL", url: "https://www.dhl.com/za-en/home/tracking.html?tracking-id=" },
  { value: "fedex", label: "FedEx", url: "https://www.fedex.com/apps/fedextrack/?tracknumbers=" },
  { value: "fastway", label: "Fastway", url: "https://www.fastway.co.za/tools/track/?number=" },
  { value: "sa_post", label: "SA Post Office", url: "https://www.postoffice.co.za/tracking?id=" },
  { value: "dawn_wing", label: "Dawn Wing", url: "https://www.dawnwing.co.za/tracking?waybill=" },
  { value: "other", label: "Other / Hand delivery", url: "" },
];

const buildCourierTrackingUrl = (courier, trackingNumber) => {
  if (!trackingNumber) return null;

  const rawTracking = String(trackingNumber).trim();
  if (/^https?:\/\//i.test(rawTracking)) {
    return rawTracking;
  }

  if (!courier?.url) return null;

  const encodedTracking = encodeURIComponent(rawTracking);
  if (!encodedTracking) return null;

  if (courier.url.includes("{tracking}")) {
    return courier.url.replace("{tracking}", encodedTracking);
  }

  if (courier.appendTracking === false) {
    return courier.url;
  }

  return `${courier.url}${encodedTracking}`;
};
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dataClient } from "@/api/dataClient";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PipelineStrip from "@/components/orders/PipelineStrip";
import OrderTagBadges from "@/components/orders/OrderTagBadges";
import ExceptionFlag from "@/components/orders/ExceptionFlag";
import MediaPreview from "@/components/common/MediaPreview";
import TypeformPOForm from "@/components/purchaseorders/TypeformPOForm";

const statusConfig = {
  confirmed: { label: "Confirmed", color: "bg-primary/10 text-primary" },
  in_production: { label: "In Production", color: "bg-purple-100 text-purple-700" },
  ready: { label: "Ready", color: "bg-green-100 text-green-700" },
  shipped: { label: "Shipped", color: "bg-teal-100 text-teal-700" },
  delivered: { label: "Delivered", color: "bg-slate-100 text-slate-600" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-700" },
};

const ORDER_STATUSES = ["confirmed", "in_production", "ready", "shipped", "delivered", "cancelled"];

const progressStages = ["confirmed", "in_production", "ready", "shipped", "delivered"];

export default function OrderDrawer({ order, couriers, onClose, onUpdate, onArchive }) {
  const [tab, setTab] = useState("details");
  const [editingField, setEditingField] = useState(null);
  const [fieldValue, setFieldValue] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'eft', notes: '' });
  const [uploading, setUploading] = useState(false);
  const [showException, setShowException] = useState(false);
  const [localPipelineStage, setLocalPipelineStage] = useState(order.pipeline_stage);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState("medium");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState("_none");
  const [showNewPO, setShowNewPO] = useState(false);
  const [newPOForm, setNewPOForm] = useState({ supplier_name: "", expected_delivery: "", notes: "" });
  const [poCreateError, setPoCreateError] = useState("");
  const [editingLinkedPO, setEditingLinkedPO] = useState(false);
  const queryClient = useQueryClient();

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', order.id],
    queryFn: () => dataClient.entities.Payment.filter({ order_id: order.id })
  });

  const { data: legacyTasks = [] } = useQuery({
    queryKey: ['orderTasks', order.id],
    queryFn: () => dataClient.entities.Task.filter({ linked_order_id: order.id })
  });

  const { data: linkedOpsTasks = [] } = useQuery({
    queryKey: ['orderOpsTasks', order.id],
    queryFn: () => dataClient.entities.OpsTask.filter({ order_id: order.id })
  });

  const allLinkedTasks = [...legacyTasks, ...linkedOpsTasks];

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['purchaseOrders'],
    queryFn: () => dataClient.entities.PurchaseOrder.list('-created_date', 100)
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => dataClient.entities.User.list('-created_date', 100)
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => dataClient.entities.Supplier.list('name', 100),
    enabled: editingLinkedPO,
  });

  const { data: inventoryItems = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => dataClient.entities.InventoryItem.list('name', 100),
    enabled: editingLinkedPO,
  });

  const linkedPO = purchaseOrders.find(po => po.id === order.linked_po_id);
  const activePOs = purchaseOrders.filter(po => ['draft','pending','approved','ordered','partial'].includes(po.status));

  const updatePOMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.PurchaseOrder.update(id, data),
    onSuccess: (updated) => {
      queryClient.setQueryData(['purchaseOrders'], (/** @type {any} */ old) =>
        Array.isArray(old) ? old.map(po => po.id === updated?.id ? updated : po) : old
      );
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      setEditingLinkedPO(false);
      toast.success("Purchase order updated");
    },
    onError: (err) => toast.error("PO update failed — " + ((/** @type {any} */ err)?.message || "unknown error")),
  });

  const addPaymentMutation = useMutation({
    mutationFn: (data) => dataClient.entities.Payment.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', order.id] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['income'] });
      setShowPayment(false);
      setPaymentForm({ amount: '', method: 'eft', notes: '' });
      toast.success("Payment added");
    },
    onError: (err) => toast.error("Payment failed — " + ((/** @type {any} */ err)?.message || "check Supabase transactions table")),
  });

  const startEdit = (field, value) => {
    setEditingField(field);
    setFieldValue(value || '');
  };

  const saveEdit = () => {
    if (editingField) {
      onUpdate(order.id, { [editingField]: fieldValue });
      setEditingField(null);
    }
  };

  const uploadFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
      const updated = { file_urls: [...(order.file_urls || []), file_url] };
      onUpdate(order.id, updated);
      toast.success("File uploaded");
    } catch (err) {
      toast.error((/** @type {any} */ (err))?.message || "Upload failed");
    }
    setUploading(false);
    e.target.value = "";
  };

  const addPayment = () => {
    if (!paymentForm.amount) return;
    addPaymentMutation.mutate({
      order_id: order.id,
      order_number: order.order_number,
      client_name: order.client_name,
      amount: parseFloat(paymentForm.amount),
      payment_method: paymentForm.method,
      payment_status: 'completed',
      payment_date: new Date().toISOString().split('T')[0],
      notes: paymentForm.notes,
    });
  };

  const createTaskMutation = useMutation({
    mutationFn: (data) => dataClient.entities.OpsTask.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderOpsTasks', order.id] });
      queryClient.invalidateQueries({ queryKey: ['opsTasks'] });
      queryClient.invalidateQueries({ queryKey: ['legacyTasks'] });
      setShowNewTask(false);
      setNewTaskTitle("");
      setNewTaskPriority("medium");
      setNewTaskDeadline("");
      setNewTaskAssignee("_none");
      toast.success("Task created and linked to this order");
    }
  });

  const createPOMutation = useMutation({
    mutationFn: (data) => dataClient.entities.PurchaseOrder.create(data),
    onSuccess: (po) => {
      if (!po?.id) {
        setPoCreateError("PO created but no ID returned — check Supabase RLS on purchase_orders");
        return;
      }
      setPoCreateError("");
      queryClient.setQueryData(['purchaseOrders'], (/** @type {any} */ old) =>
        Array.isArray(old) ? [po, ...old] : [po]
      );
      onUpdate(order.id, { linked_po_id: po.id });
      setShowNewPO(false);
      setNewPOForm({ supplier_name: "", expected_delivery: "", notes: "" });
      toast.success("Purchase order created and linked");
    },
    onError: (err) => {
      const msg = (/** @type {any} */ (err))?.message || "Unknown error — check Supabase purchase_orders table";
      setPoCreateError(msg);
    },
  });

  const handleCreateTask = () => {
    if (!newTaskTitle.trim()) return;
    createTaskMutation.mutate({
      title: newTaskTitle.trim(),
      status: "not_started",
      priority: newTaskPriority,
      deadline: newTaskDeadline || undefined,
      assigned_to: newTaskAssignee && newTaskAssignee !== "_none" ? [newTaskAssignee] : [],
      order_id: order.id,
      notes: `Order #${order.order_number || ''} — ${order.client_name || ''}`.trim(),
    });
  };

  const currentStageIndex = progressStages.indexOf(order.status);
  const totalPaid = payments.filter(p => p.status === 'completed').reduce((s, p) => s + (p.amount || 0), 0);
  const balance = (order.total_amount || 0) - totalPaid;

  const resolvedCouriers = couriers?.length ? couriers : DEFAULT_COURIERS;
  const courier = resolvedCouriers.find(c => c.value === order.courier);
  const trackingUrl = buildCourierTrackingUrl(courier, order.tracking_number);
  const [copiedTracking, setCopiedTracking] = useState(false);
  const [copiedXlab, setCopiedXlab] = useState(false);
  const copyTrackingLink = () => {
    const code = encodeURIComponent(order.order_number || order.tracking_number || order.id || "");
    const link = `${window.location.origin}/track?order=${code}`;
    navigator.clipboard.writeText(link).then(() => { setCopiedTracking(true); setTimeout(() => setCopiedTracking(false), 2000); });
  };
  const copyXlabTrackingLink = () => {
    const code = encodeURIComponent(order.order_number || order.tracking_number || order.id || "");
    const link = `${window.location.origin}/track?order=${code}`;
    navigator.clipboard.writeText(link).then(() => { setCopiedXlab(true); setTimeout(() => setCopiedXlab(false), 2000); });
  };

  return (
    <>
      <div className="fixed inset-0 z-[55]" onClick={onClose}>
        <div className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-none" />
      </div>
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-card shadow-apple-xl z-[60] flex flex-col animate-slide-in-right" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h2 className="font-bold text-foreground">{order.client_name}</h2>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusConfig[order.status]?.color || 'bg-secondary'}`}>
                {statusConfig[order.status]?.label || order.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-1.5">#{order.order_number || order.id?.slice(0,8)}</p>
            <OrderTagBadges order={{ ...order, pipeline_stage: localPipelineStage ?? order.pipeline_stage }} />
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center hover:bg-border transition-all ml-3 flex-shrink-0">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* 5-stage legacy progress bar */}
        <div className="px-5 py-4 border-b border-border bg-secondary/30">
          <div className="flex items-center justify-between">
            {progressStages.map((stage, i) => (
              <React.Fragment key={stage}>
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all
                    ${i <= currentStageIndex ? 'bg-primary text-white' : 'bg-border text-muted-foreground'}`}>
                    {i < currentStageIndex ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <span className="text-xs font-bold">{i + 1}</span>
                    )}
                  </div>
                  <span className={`text-xs font-medium capitalize ${i <= currentStageIndex ? 'text-primary' : 'text-muted-foreground'}`}>
                    {stage.replace('_', ' ')}
                  </span>
                </div>
                {i < progressStages.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 rounded-full ${i < currentStageIndex ? 'bg-primary' : 'bg-border'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* 13-stage detailed pipeline strip */}
        <PipelineStrip
          order={{ ...order, pipeline_stage: localPipelineStage ?? order.pipeline_stage }}
          onStageChange={setLocalPipelineStage}
        />

        {/* Quick Actions */}
        <div className="flex gap-2 px-5 py-3 border-b border-border overflow-x-auto">
          {ORDER_STATUSES.filter(s => s !== order.status && s !== 'cancelled').map(s => (
            <button
              key={s}
              onClick={() => onUpdate(order.id, { status: s })}
              className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full bg-secondary hover:bg-border transition-all capitalize"
            >
              → {statusConfig[s]?.label || s}
            </button>
          ))}
          <button
            onClick={() => {
              if (!showPayment && balance > 0) {
                setPaymentForm(pf => ({ ...pf, amount: pf.amount || String(balance) }));
              }
              setShowPayment(v => !v);
            }}
            className="flex-shrink-0 flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full bg-green-50 text-green-700 hover:bg-green-100 transition-all"
          >
            <CreditCard className="w-3 h-3" /> Add Payment
          </button>
          <label className="flex-shrink-0 cursor-pointer">
            <span className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-all">
              <Paperclip className="w-3 h-3" /> {uploading ? 'Uploading...' : 'Upload File'}
            </span>
            <input type="file" className="hidden" onChange={uploadFile} disabled={uploading} />
          </label>
          <button
            onClick={() => setShowException(true)}
            className="flex-shrink-0 flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full bg-red-50 text-red-700 hover:bg-red-100 transition-all"
          >
            <AlertTriangle className="w-3 h-3" /> Flag Exception
          </button>
        </div>

        {/* Add Payment Form */}
        {showPayment && (
          <div className="px-5 py-3 bg-green-50/50 border-b border-border">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-xs font-semibold text-green-800">Add Payment</h4>
              <button onClick={() => setShowPayment(false)}><X className="w-3 h-3 text-muted-foreground" /></button>
            </div>
            <div className="flex gap-2">
              <Input value={paymentForm.amount} onChange={e => setPaymentForm({...paymentForm, amount: e.target.value})}
                placeholder="Amount (R)" type="number" className="rounded-lg h-8 text-sm flex-1" />
              <Select value={paymentForm.method} onValueChange={v => setPaymentForm({...paymentForm, method: v})}>
                <SelectTrigger className="h-8 rounded-lg text-xs w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['cash','card','eft','bank_transfer'].map(m => <SelectItem key={m} value={m}>{m.replace('_',' ')}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={addPayment} className="h-8 rounded-lg px-3">Add</Button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-border px-5 overflow-x-auto">
          {['details', 'payments', 'tasks', 'po', 'tracking', 'files', 'invoices', 'portal'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-3 text-xs font-semibold capitalize border-b-2 transition-all whitespace-nowrap
                ${tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {t === 'portal' ? 'Client Portal' : t}
              {t === 'payments' && payments.length > 0 && (
                <span className="ml-1 text-xs bg-primary/10 text-primary px-1 rounded-full">{payments.length}</span>
              )}
              {t === 'tasks' && allLinkedTasks.length > 0 && (
                <span className="ml-1 text-xs bg-secondary text-muted-foreground px-1 rounded-full">{allLinkedTasks.length}</span>
              )}
              {t === 'po' && linkedPO && (
                <span className="ml-1 text-xs bg-primary/10 text-primary px-1 rounded-full">1</span>
              )}
              {t === 'invoices' && (order.invoice_files?.length || 0) > 0 && (
                <span className="ml-1 text-xs bg-amber-100 text-amber-700 px-1 rounded-full">{order.invoice_files.length}</span>
              )}
              {t === 'portal' && order.portal_message && (
                <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1 rounded-full">ON</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {tab === 'details' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <EditField label="Client Name" field="client_name" value={order.client_name}
                  editing={editingField === 'client_name'} editValue={fieldValue}
                  onEdit={() => startEdit('client_name', order.client_name)}
                  onChange={setFieldValue} onSave={saveEdit} />
                <EditField label="Order Number" field="order_number" value={order.order_number}
                  editing={editingField === 'order_number'} editValue={fieldValue}
                  onEdit={() => startEdit('order_number', order.order_number)}
                  onChange={setFieldValue} onSave={saveEdit} />
                <EditField label="Total Amount" field="total_amount" value={order.total_amount ? `R${order.total_amount.toLocaleString()}` : '—'}
                  editing={editingField === 'total_amount'} editValue={fieldValue}
                  onEdit={() => startEdit('total_amount', order.total_amount)}
                  onChange={setFieldValue} onSave={saveEdit} inputType="number" />
                <div className="bg-secondary/30 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-1">Status</p>
                  <Select value={order.status} onValueChange={v => onUpdate(order.id, { status: v })}>
                    <SelectTrigger className="h-7 border-0 bg-transparent p-0 text-xs font-medium">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{statusConfig[s]?.label || s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Assigned To */}
              <div className="bg-secondary/30 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <User className="w-3 h-3 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Assigned To</p>
                </div>
                <Select value={order.assigned_to || '__none'} onValueChange={v => onUpdate(order.id, { assigned_to: v === '__none' ? null : v })}>
                  <SelectTrigger className="h-7 border-0 bg-transparent p-0 text-xs font-medium">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Unassigned</SelectItem>
                    {users.map(u => <SelectItem key={u.id} value={u.email}>{u.full_name || u.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Products — fully editable */}
              <ProductsEditor order={order} onUpdate={onUpdate} />

              {/* Notes */}
              <div className="bg-secondary/30 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</h3>
                  {editingField !== 'notes' && <button onClick={() => startEdit('notes', order.notes)} className="text-xs text-primary">Edit</button>}
                </div>
                {editingField === 'notes' ? (
                  <div className="space-y-2">
                    <textarea value={fieldValue} onChange={e => setFieldValue(e.target.value)}
                      className="w-full text-sm bg-card border border-border rounded-lg p-2 resize-none h-20 outline-none" />
                    <div className="flex gap-2">
                      <button onClick={() => setEditingField(null)} className="text-xs text-muted-foreground">Cancel</button>
                      <button onClick={saveEdit} className="text-xs text-primary font-medium">Save</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{order.notes || 'No notes'}</p>
                )}
              </div>

              {/* Timeline */}
              <div className="bg-secondary/30 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Timeline</h3>
                <div className="space-y-3">
                  <TimelineEntry icon={<Package className="w-3 h-3" />} label="Order Created" time={order.created_date} />
                  {payments.length > 0 && <TimelineEntry icon={<CreditCard className="w-3 h-3" />} label={`Payment received — R${totalPaid.toLocaleString()}`} time={payments[0]?.payment_date} />}
                  {['in_production', 'ready', 'shipped', 'delivered'].filter(s => progressStages.indexOf(s) <= currentStageIndex).map(s => (
                    <TimelineEntry key={s} icon={<CheckCircle2 className="w-3 h-3" />} label={statusConfig[s]?.label} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'payments' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-green-50 rounded-xl p-3 border border-green-100">
                  <p className="text-xs text-green-700 mb-1">Total Paid</p>
                  <p className="text-lg font-bold text-green-800">R{totalPaid.toLocaleString()}</p>
                </div>
                <div className={`rounded-xl p-3 border ${balance > 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
                  <p className={`text-xs mb-1 ${balance > 0 ? 'text-red-700' : 'text-green-700'}`}>Balance</p>
                  <p className={`text-lg font-bold ${balance > 0 ? 'text-red-800' : 'text-green-800'}`}>R{Math.abs(balance).toLocaleString()}</p>
                </div>
              </div>
              {payments.length === 0 ? (
                <div className="text-center py-8">
                  <CreditCard className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No payments recorded</p>
                  <button onClick={() => setShowPayment(true)} className="mt-2 text-xs text-primary font-medium">Add first payment</button>
                </div>
              ) : (
                payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-secondary/30 rounded-xl">
                    <div>
                      <p className="text-sm font-semibold text-foreground">R{p.amount?.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground capitalize">{p.method?.replace('_', ' ')} · {p.payment_date ? format(new Date(p.payment_date), 'MMM d, yyyy') : ''}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${p.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {p.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'tasks' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Linked Tasks ({allLinkedTasks.length})
                </p>
                <button
                  onClick={() => setShowNewTask(v => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Task
                </button>
              </div>

              {showNewTask && (
                <div className="bg-secondary/30 rounded-2xl p-3 space-y-2.5 border border-border">
                  <Input
                    value={newTaskTitle}
                    onChange={e => setNewTaskTitle(e.target.value)}
                    placeholder={`Task for ${order.client_name || 'this order'}…`}
                    className="rounded-xl h-9 text-sm"
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleCreateTask()}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={newTaskPriority} onValueChange={setNewTaskPriority}>
                      <SelectTrigger className="h-8 rounded-xl text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['urgent','high','medium','low'].map(p => (
                          <SelectItem key={p} value={p} className="capitalize text-xs">{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input type="date" value={newTaskDeadline} onChange={e => setNewTaskDeadline(e.target.value)} className="h-8 rounded-xl text-xs" />
                  </div>
                  <Select value={newTaskAssignee} onValueChange={setNewTaskAssignee}>
                    <SelectTrigger className="h-8 rounded-xl text-xs"><SelectValue placeholder="Assign to…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Unassigned</SelectItem>
                      {users.filter(u => u.is_active !== false).map(u => (
                        <SelectItem key={u.id || u.email} value={u.email || u.user_email} className="text-xs">
                          {u.full_name || u.name || u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 h-8 rounded-xl text-xs"
                      onClick={handleCreateTask}
                      disabled={!newTaskTitle.trim() || createTaskMutation.isPending}
                    >
                      {createTaskMutation.isPending ? 'Creating…' : 'Create Task'}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={() => setShowNewTask(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {allLinkedTasks.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No tasks linked to this order</p>
                  <button onClick={() => setShowNewTask(true)} className="mt-2 text-xs text-primary font-medium">Add first task</button>
                </div>
              ) : allLinkedTasks.map(task => (
                <div key={task.id} className="flex items-center gap-3 p-3 bg-secondary/30 rounded-xl">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    task.status === 'complete' || task.status === 'done' ? 'bg-green-500' :
                    task.status === 'in_progress' ? 'bg-primary' :
                    task.status === 'on_hold' ? 'bg-orange-400' : 'bg-amber-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${task.status === 'complete' || task.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                      {task.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {task.deadline && <span className="text-xs text-muted-foreground">{format(new Date(task.deadline), 'MMM d')}</span>}
                      {Array.isArray(task.assigned_to) && task.assigned_to.length > 0 && (
                        <span className="text-xs text-muted-foreground truncate">{task.assigned_to[0]}</span>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                    task.status === 'complete' || task.status === 'done' ? 'bg-green-100 text-green-700' :
                    task.status === 'in_progress' ? 'bg-primary/10 text-primary' :
                    task.status === 'on_hold' ? 'bg-orange-100 text-orange-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {(task.status || 'pending').replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === 'po' && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <ShoppingCart className="w-3.5 h-3.5" /> Linked Purchase Order
                  </p>
                  <button
                    onClick={() => setShowNewPO(v => !v)}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New PO
                  </button>
                </div>
                <Select value={order.linked_po_id || '__none'} onValueChange={v => onUpdate(order.id, { linked_po_id: v === '__none' ? '' : v })}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Link existing PO..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No PO linked</SelectItem>
                    {activePOs.map(po => (
                      <SelectItem key={po.id} value={po.id}>
                        {po.po_number} — {po.supplier_name}
                      </SelectItem>
                    ))}
                    {linkedPO && !activePOs.find(p => p.id === linkedPO.id) && (
                      <SelectItem value={linkedPO.id}>{linkedPO.po_number} — {linkedPO.supplier_name}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {showNewPO && (
                <div className="bg-secondary/30 rounded-2xl p-4 space-y-3 border border-border">
                  <p className="text-xs font-semibold text-foreground">Create New Purchase Order</p>
                  <Input
                    placeholder="Supplier name (optional)"
                    value={newPOForm.supplier_name}
                    onChange={e => setNewPOForm(f => ({ ...f, supplier_name: e.target.value }))}
                    className="rounded-xl h-9 text-sm"
                    autoFocus
                  />
                  <Input
                    type="date"
                    value={newPOForm.expected_delivery}
                    onChange={e => setNewPOForm(f => ({ ...f, expected_delivery: e.target.value }))}
                    className="rounded-xl h-9 text-sm"
                  />
                  <Input
                    placeholder="Notes (optional)"
                    value={newPOForm.notes}
                    onChange={e => setNewPOForm(f => ({ ...f, notes: e.target.value }))}
                    className="rounded-xl h-9 text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 h-8 rounded-xl text-xs"
                      disabled={createPOMutation.isPending}
                      onClick={() => {
                        setPoCreateError("");
                        const poNumber = `PO-${Date.now().toString().slice(-6)}`;
                        createPOMutation.mutate({
                          po_number: poNumber,
                          supplier_name: newPOForm.supplier_name.trim() || undefined,
                          linked_order_id: order.id,
                          expected_delivery: newPOForm.expected_delivery || undefined,
                          notes: newPOForm.notes || undefined,
                          status: 'draft',
                          items: [],
                        });
                      }}
                    >
                      {createPOMutation.isPending ? 'Creating…' : 'Create & Link PO'}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={() => { setShowNewPO(false); setPoCreateError(""); }}>
                      Cancel
                    </Button>
                  </div>
                  {poCreateError && (
                    <div className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-800 break-words">
                      <p className="font-semibold mb-0.5">Create failed</p>
                      <p className="font-mono">{poCreateError}</p>
                      {poCreateError.includes('migration') && (
                        <p className="mt-1 text-red-700">Run <code>supabase/migrations/202605180002_create_purchase_orders_table.sql</code> in Supabase SQL Editor.</p>
                      )}
                      {poCreateError.includes('RLS') && (
                        <p className="mt-1 text-red-700">Go to Supabase → Authentication → Policies and add an ALL policy for the <code>purchase_orders</code> table.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {editingLinkedPO && linkedPO && (
                <TypeformPOForm
                  purchaseOrder={linkedPO}
                  suppliers={suppliers}
                  inventoryItems={inventoryItems}
                  onSubmit={(data) => updatePOMutation.mutateAsync({ id: linkedPO.id, data })}
                  onCancel={() => setEditingLinkedPO(false)}
                />
              )}

              {linkedPO ? (
                <div className="bg-secondary/40 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-foreground">{linkedPO.po_number}</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditingLinkedPO(true)}
                        className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                      >
                        <Pencil className="w-3 h-3" /> Edit PO
                      </button>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium capitalize">{linkedPO.status}</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm text-muted-foreground">Supplier: <span className="text-foreground font-medium">{linkedPO.supplier_name}</span></p>
                    {linkedPO.expected_delivery && (
                      <p className="text-sm text-muted-foreground">Expected: <span className="text-foreground font-medium">{format(new Date(linkedPO.expected_delivery), 'dd MMM yyyy')}</span></p>
                    )}
                    {linkedPO.total > 0 && (
                      <p className="text-sm text-muted-foreground">PO Value: <span className="text-foreground font-semibold">R{linkedPO.total?.toLocaleString()}</span></p>
                    )}
                  </div>
                  {linkedPO.items?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">Items</p>
                      <div className="space-y-1">
                        {linkedPO.items.map((item, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="text-foreground">{item.name}</span>
                            <span className="text-muted-foreground">×{item.quantity} {item.unit || ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                !showNewPO && (
                  <div className="text-center py-8">
                    <ShoppingCart className="w-10 h-10 text-muted-foreground/20 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No purchase order linked</p>
                    <p className="text-xs text-muted-foreground mt-1">Link an existing PO or create a new one above</p>
                  </div>
                )
              )}
            </div>
          )}

          {tab === 'tracking' && (
            <div className="space-y-4">
              {/* Courier — saves immediately on selection */}
              <div className="bg-secondary/30 rounded-xl p-3">
                <p className="text-xs text-muted-foreground mb-1.5">Courier</p>
                <Select
                  value={order.courier || '__none'}
                  onValueChange={v => onUpdate(order.id, { courier: v === '__none' ? null : v })}
                >
                  <SelectTrigger className="h-8 border-0 bg-transparent p-0 text-sm font-medium">
                    <SelectValue placeholder="Select courier…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No courier selected</SelectItem>
                    {resolvedCouriers.map((/** @type {any} */ c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <EditField label="Tracking Number" field="tracking_number" value={order.tracking_number}
                editing={editingField === 'tracking_number'} editValue={fieldValue}
                onEdit={() => startEdit('tracking_number', order.tracking_number)}
                onChange={setFieldValue} onSave={saveEdit} />
              {trackingUrl && (
                <a href={trackingUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 p-4 bg-primary/5 rounded-xl border border-primary/20 text-primary hover:bg-primary/10 transition-all">
                  <ExternalLink className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    {courier?.appendTracking === false ? `Open ${courier?.label} tracker` : `Track with ${courier?.label}`}
                  </span>
                  <ChevronRight className="w-4 h-4 ml-auto" />
                </a>
              )}
              <button
                onClick={copyTrackingLink}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all"
              >
                {copiedTracking ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                {copiedTracking ? "OPS link copied!" : "Copy OPS tracker link"}
              </button>
              <button
                onClick={copyXlabTrackingLink}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all"
              >
                {copiedXlab ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                {copiedXlab ? "X LAB link copied!" : "Copy X LAB tracker link"}
              </button>
            </div>
          )}

          {tab === 'files' && (
            <div className="space-y-3">
              <label className="cursor-pointer block">
                <div className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-border rounded-2xl hover:border-primary/40 transition-all">
                  <Paperclip className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{uploading ? 'Uploading...' : 'Upload a file'}</span>
                </div>
                <input type="file" className="hidden" onChange={uploadFile} disabled={uploading} />
              </label>
              {order.file_urls?.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {order.file_urls.map((/** @type {string} */ url, /** @type {number} */ i) => (
                    <MediaPreview key={url} url={url} title={`Order file ${i + 1}`} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No files attached</p>
              )}
            </div>
          )}

          {tab === 'invoices' && (
            <InvoicesTab order={order} onUpdate={onUpdate} totalPaid={totalPaid} />
          )}

          {tab === 'portal' && (
            <PortalTab order={order} onUpdate={onUpdate} balance={balance} />
          )}
        </div>

        {/* Archive */}
        <div className="p-4 border-t border-border">
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-border py-2 text-sm text-muted-foreground hover:text-destructive hover:border-destructive transition-all"
            onClick={() => {
              if (window.confirm('Archive this order? It can be restored from the Archive page.')) {
                onArchive && onArchive();
              }
            }}
          >
            <Archive className="w-4 h-4" /> Archive order
          </button>
        </div>
      </div>

      <ExceptionFlag
        open={showException}
        onClose={() => setShowException(false)}
        order={{ ...order, pipeline_stage: localPipelineStage ?? order.pipeline_stage }}
        onStageChange={(stage) => {
          setLocalPipelineStage(stage);
          queryClient.invalidateQueries({ queryKey: ['orders'] });
        }}
      />
    </>
  );
}

function ProductsEditor({ order, onUpdate }) {
  const { data: catalogItems = [] } = useQuery({
    queryKey: ["catalogItems"],
    queryFn: () => dataClient.entities.CatalogItem.list("name", 500),
    staleTime: 0,
  });
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => dataClient.entities.InventoryItem.list("name", 200),
    staleTime: 0,
  });

  const [editingIdx, setEditingIdx] = useState(/** @type {number|null} */ (null));
  const [editRow, setEditRow] = useState({ name: "", quantity: 1, price: "" });
  const [addMode, setAddMode] = useState(false);
  const [newRow, setNewRow] = useState({ name: "", quantity: 1, price: "" });
  const [pickerSearch, setPickerSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  const products = order.products || [];

  const saveRow = () => {
    if (!editRow.name.trim()) return;
    const updated = products.map((p, i) =>
      i === editingIdx ? { name: editRow.name, quantity: Number(editRow.quantity) || 1, price: editRow.price } : p
    );
    onUpdate(order.id, { products: updated });
    setEditingIdx(null);
  };

  const removeRow = (/** @type {number} */ idx) => {
    const updated = products.filter((_, i) => i !== idx);
    onUpdate(order.id, { products: updated });
  };

  const addRow = () => {
    if (!newRow.name.trim()) return;
    const updated = [...products, { name: newRow.name, quantity: Number(newRow.quantity) || 1, price: newRow.price }];
    onUpdate(order.id, { products: updated });
    setNewRow({ name: "", quantity: 1, price: "" });
    setAddMode(false);
    setPickerSearch("");
    setShowPicker(false);
  };

  const allPickerItems = [
    ...(/** @type {any[]} */ (catalogItems))
      .filter((/** @type {any} */ c) => c.is_archived !== true && c.status !== "draft")
      .map((/** @type {any} */ c) => ({ name: c.name, price: c.price ?? c.base_price ?? "", source: "catalog" })),
    ...(/** @type {any[]} */ (inventoryItems))
      .filter((/** @type {any} */ i) => !i.is_archived && !(/** @type {any[]} */ (catalogItems)).some((/** @type {any} */ c) => c.name?.toLowerCase() === i.name?.toLowerCase()))
      .map((/** @type {any} */ i) => ({ name: i.name, price: i.selling_price ?? "", source: "stock" })),
  ];

  const filtered = pickerSearch
    ? allPickerItems.filter(p => p.name?.toLowerCase().includes(pickerSearch.toLowerCase()))
    : allPickerItems.slice(0, 8);

  return (
    <div className="bg-secondary/30 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Products</h3>
        {!addMode && (
          <button onClick={() => setAddMode(true)} className="flex items-center gap-1 text-xs text-primary font-medium">
            <Plus className="w-3 h-3" /> Add
          </button>
        )}
      </div>

      {/* Existing rows */}
      <div className="space-y-2 mb-3">
        {products.length === 0 && !addMode && (
          <p className="text-xs text-muted-foreground italic">No products — click Add to start</p>
        )}
        {products.map((/** @type {any} */ p, /** @type {number} */ i) =>
          editingIdx === i ? (
            <div key={i} className="flex items-center gap-1.5 bg-card rounded-lg px-2 py-1.5 border border-border">
              <Input value={editRow.name} onChange={(/** @type {any} */ e) => setEditRow(r => ({ ...r, name: e.target.value }))}
                className="h-7 text-xs flex-1 rounded-lg" placeholder="Name" autoFocus />
              <Input value={editRow.quantity} onChange={(/** @type {any} */ e) => setEditRow(r => ({ ...r, quantity: e.target.value }))}
                type="number" className="h-7 text-xs w-12 rounded-lg" placeholder="Qty" />
              <Input value={editRow.price} onChange={(/** @type {any} */ e) => setEditRow(r => ({ ...r, price: e.target.value }))}
                type="number" className="h-7 text-xs w-16 rounded-lg" placeholder="R" />
              <button onClick={saveRow} className="text-xs text-primary font-medium whitespace-nowrap">Save</button>
              <button onClick={() => setEditingIdx(null)} className="text-xs text-muted-foreground">✕</button>
            </div>
          ) : (
            <div key={i} className="flex items-center justify-between group px-1 py-1 rounded-lg hover:bg-card/60 transition-all">
              <span className="text-sm text-foreground flex-1 truncate">{p.name}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-muted-foreground">×{p.quantity || 1}</span>
                {p.price && <span className="text-sm font-semibold text-foreground">R{Number(p.price).toLocaleString()}</span>}
                <button onClick={() => { setEditingIdx(i); setEditRow({ name: p.name, quantity: p.quantity || 1, price: p.price || "" }); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all">
                  <Pencil className="w-3 h-3" />
                </button>
                <button onClick={() => removeRow(i)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {/* Add new row */}
      {addMode && (
        <div className="bg-card rounded-xl border border-border p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Add product</p>
          <div className="relative">
            <Input
              value={newRow.name}
              onChange={(/** @type {any} */ e) => { setNewRow(r => ({ ...r, name: e.target.value })); setPickerSearch(e.target.value); setShowPicker(true); }}
              onFocus={() => setShowPicker(true)}
              onBlur={() => setTimeout(() => setShowPicker(false), 150)}
              placeholder="Search inventory or type name…"
              className="h-8 text-sm rounded-xl"
              autoFocus
            />
            {showPicker && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-apple-lg z-30 max-h-56 overflow-y-auto">
                {filtered.map((item, idx) => (
                  <button key={idx} type="button"
                    onMouseDown={() => {
                      setNewRow(r => ({ ...r, name: item.name, price: item.price ? String(item.price) : r.price }));
                      setPickerSearch("");
                      setShowPicker(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-secondary transition-all flex items-center justify-between">
                    <span className="text-sm text-foreground">{item.name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {item.price ? <span className="text-xs font-semibold text-primary">R{Number(item.price).toLocaleString()}</span> : null}
                      <span className="text-[10px] text-muted-foreground capitalize">{item.source}</span>
                    </div>
                  </button>
                ))}
                {/* Always-visible custom item option */}
                {newRow.name.trim() && (
                  <button
                    type="button"
                    onMouseDown={() => { setPickerSearch(""); setShowPicker(false); }}
                    className="w-full text-left px-3 py-2.5 border-t border-border hover:bg-primary/5 transition-all rounded-b-xl flex items-center gap-2"
                  >
                    <Plus className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    <span className="text-sm text-primary font-medium">
                      Add &ldquo;{newRow.name.trim()}&rdquo; as custom item
                    </span>
                  </button>
                )}
                {!newRow.name.trim() && filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground px-3 py-2">Type a product name above</p>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Input value={newRow.quantity} onChange={(/** @type {any} */ e) => setNewRow(r => ({ ...r, quantity: e.target.value }))}
              type="number" placeholder="Qty" className="h-8 text-sm rounded-xl w-16" />
            <Input value={newRow.price} onChange={(/** @type {any} */ e) => setNewRow(r => ({ ...r, price: e.target.value }))}
              type="number" placeholder="Price (R)" className="h-8 text-sm rounded-xl flex-1" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 h-8 rounded-xl text-xs" onClick={addRow} disabled={!newRow.name.trim()}>Add</Button>
            <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={() => { setAddMode(false); setPickerSearch(""); setShowPicker(false); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EditField({ label, value, editing, editValue, onEdit, onChange, onSave, inputType = "text", isSelect, options }) {
  return (
    <div className="bg-secondary/30 rounded-xl p-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        {!editing && <button onClick={onEdit} className="text-xs text-primary">Edit</button>}
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          {isSelect ? (
            <Select value={editValue} onValueChange={onChange}>
              <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>{options?.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Input value={editValue} onChange={e => onChange(e.target.value)} type={inputType}
              className="h-7 text-xs flex-1" onKeyDown={e => e.key === 'Enter' && onSave()} autoFocus />
          )}
          <button onClick={onSave} className="text-xs text-primary font-medium whitespace-nowrap">Save</button>
        </div>
      ) : (
        <p className="text-sm font-medium text-foreground">{value || '—'}</p>
      )}
    </div>
  );
}

function TimelineEntry({ icon, label, time }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5 text-primary">
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium text-foreground">{label}</p>
        {time && <p className="text-xs text-muted-foreground">{format(new Date(time), 'MMM d, yyyy')}</p>}
      </div>
    </div>
  );
}

// Extract an invoice/reference number from a filename.
// Matches patterns like INV-1234, ZB-5678, INV_001, ZB001, 2024-INV-99, etc.
// Falls back to the full filename stem so any name (e.g. "xlab labels") is trackable.
function extractInvoiceNumber(/** @type {string} */ filename) {
  const stem = filename.replace(/\.[^.]+$/, "");
  const patterns = [
    /\b(INV[-_]?\d+)\b/i,
    /\b(ZB[-_]?\d+)\b/i,
    /\b([A-Z]{2,6}[-_]\d{3,})\b/i,
    /\b(\d{4,})\b/,
  ];
  for (const re of patterns) {
    const m = stem.match(re);
    if (m) return m[1].toUpperCase().replace(/[_\s]/g, "-");
  }
  // Fallback: normalise the full stem so the tracker can still find this order
  return stem.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9\-]/g, "") || null;
}

function parseMoneyInput(/** @type {string | number | null | undefined} */ value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatCurrency(/** @type {number | null | undefined} */ value) {
  return `R${Number(value || 0).toLocaleString()}`;
}

function PortalTab({ order, onUpdate, balance = 0 }) {
  const [newItem, setNewItem] = useState("");

  const portalMessage   = order.portal_message || "";
  const showBalance     = !!order.portal_show_balance;
  const showFiles       = !!order.portal_show_files;
  const attentionItems  = Array.isArray(order.portal_attention_items) ? order.portal_attention_items : [];

  const toggle = (field) => onUpdate(order.id, { [field]: !order[field] });

  const addAttention = () => {
    const item = newItem.trim();
    if (!item) return;
    onUpdate(order.id, { portal_attention_items: [...attentionItems, item] });
    setNewItem("");
  };

  const removeAttention = (/** @type {number} */ idx) => {
    onUpdate(order.id, { portal_attention_items: attentionItems.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-5">
      {/* Info banner */}
      <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
        <p className="text-xs font-semibold text-blue-800 mb-0.5">Client Portal Settings</p>
        <p className="text-xs text-blue-700">
          Choose what your client sees when they track this order. Share the tracking link from the Tracking tab.
        </p>
      </div>

      {/* Message to client */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
          Message to Client
        </label>
        <textarea
          value={portalMessage}
          onChange={(/** @type {any} */ e) => onUpdate(order.id, { portal_message: e.target.value })}
          placeholder="e.g. Hi! Your order is in production. Outstanding balance of R500 due on collection."
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none h-24 outline-none focus:ring-2 focus:ring-primary/20"
        />
        <p className="text-xs text-muted-foreground">Shown at the top of the client tracker when set.</p>
      </div>

      {/* Toggles */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">Show on Tracker</label>
        <div className="space-y-2">
          <label className="flex items-center justify-between p-3 bg-secondary/30 rounded-xl cursor-pointer hover:bg-secondary/50 transition-all">
            <div>
              <p className="text-sm font-medium text-foreground">Outstanding Balance</p>
              <p className="text-xs text-muted-foreground">
                Shows R{Math.abs(balance).toLocaleString()} {balance > 0 ? "owed" : "— fully paid"}
              </p>
            </div>
            <div
              onClick={() => toggle("portal_show_balance")}
              className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${showBalance ? "bg-primary" : "bg-border"}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${showBalance ? "translate-x-4" : "translate-x-0"}`} />
            </div>
          </label>
          <label className="flex items-center justify-between p-3 bg-secondary/30 rounded-xl cursor-pointer hover:bg-secondary/50 transition-all">
            <div>
              <p className="text-sm font-medium text-foreground">Uploaded Files</p>
              <p className="text-xs text-muted-foreground">Design approvals, proofs, artwork</p>
            </div>
            <div
              onClick={() => toggle("portal_show_files")}
              className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${showFiles ? "bg-primary" : "bg-border"}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${showFiles ? "translate-x-4" : "translate-x-0"}`} />
            </div>
          </label>
        </div>
      </div>

      {/* Attention items */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
          Attention Items
        </label>
        <p className="text-xs text-muted-foreground -mt-1">Things the client needs to action or be aware of.</p>
        <div className="space-y-1.5">
          {attentionItems.map((item, i) => (
            <div key={i} className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-100 rounded-xl">
              <span className="text-xs font-medium text-amber-900 flex-1">⚠ {item}</span>
              <button onClick={() => removeAttention(i)} className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newItem}
            onChange={(/** @type {any} */ e) => setNewItem(e.target.value)}
            placeholder='e.g. "Approve artwork by Friday" or "Balance R1 200 due"'
            className="h-9 rounded-xl text-sm flex-1"
            onKeyDown={(/** @type {any} */ e) => e.key === "Enter" && addAttention()}
          />
          <Button size="sm" variant="outline" className="h-9 rounded-xl px-3 text-xs" onClick={addAttention} disabled={!newItem.trim()}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function InvoicesTab({ order, onUpdate, totalPaid = 0 }) {
  const [uploading, setUploading] = useState(false);
  const [manualRef, setManualRef] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [amountIdx, setAmountIdx] = useState(/** @type {number|null} */ (null));
  const [amountInput, setAmountInput] = useState("");
  const orderTotal = Number(order.total_amount || 0);
  const typedInvoiceTotal = parseMoneyInput(invoiceTotal);
  const visibleInvoiceTotal = typedInvoiceTotal ?? orderTotal;
  const visibleBalance = Math.max(visibleInvoiceTotal - totalPaid, 0);
  const hasOrderTotal = orderTotal > 0;

  const saveInvoiceAmount = (idx) => {
    const amount = parseMoneyInput(amountInput);
    if (!amount) return;
    const files = [...(order.invoice_files || [])];
    files[idx] = {
      ...files[idx],
      invoice_total: amount,
      balance_after_payments: Math.max(amount - totalPaid, 0),
    };
    onUpdate(order.id, {
      invoice_files: files,
      ...(!hasOrderTotal ? { total_amount: amount } : {}),
    });
    setAmountIdx(null);
    setAmountInput("");
  };

  const uploadInvoice = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
      const existing = order.invoice_files || [];
      const invoiceNumber = extractInvoiceNumber(file.name);
      const existingNumbers = order.invoice_numbers || [];
      const invoiceAmountInput = parseMoneyInput(invoiceTotal);
      const invoiceAmount = invoiceAmountInput ?? (hasOrderTotal ? orderTotal : null);
      const shouldSetOrderTotal = !hasOrderTotal && invoiceAmountInput;

      onUpdate(order.id, {
        ...(shouldSetOrderTotal ? { total_amount: invoiceAmount } : {}),
        invoice_files: [
          ...existing,
          {
            name: file.name,
            url: file_url,
            type: file.type,
            uploaded_at: new Date().toISOString(),
            source: 'zoho_books',
            invoice_number: invoiceNumber,
            invoice_total: invoiceAmount,
            balance_after_payments: invoiceAmount ? Math.max(invoiceAmount - totalPaid, 0) : undefined,
            paid_at_upload: totalPaid,
          },
        ],
        // Append extracted number to the searchable invoice_numbers array
        invoice_numbers: invoiceNumber && !existingNumbers.includes(invoiceNumber)
          ? [...existingNumbers, invoiceNumber]
          : existingNumbers,
      });
      setInvoiceTotal("");
      toast.success(invoiceNumber
        ? `Invoice uploaded — reference ${invoiceNumber} added to tracking`
        : "Invoice uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removeInvoice = (idx) => {
    const files = order.invoice_files || [];
    const updated = files.filter((/** @type {any} */ _, /** @type {number} */ i) => i !== idx);
    // Also remove the invoice number from the tracking array if no other file uses it
    const remainingNumbers = updated
      .map((/** @type {any} */ f) => f.invoice_number)
      .filter(Boolean);
    const updatedNumbers = (order.invoice_numbers || []).filter(
      (/** @type {string} */ n) => remainingNumbers.includes(n)
    );
    onUpdate(order.id, { invoice_files: updated, invoice_numbers: updatedNumbers });
  };

  const invoices = order.invoice_files || [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-2">
        <p className="text-xs font-semibold text-amber-800 mb-0.5">Invoices &amp; Tracking References</p>
        <p className="text-xs text-amber-700">
          Upload invoices — reference numbers are extracted from filenames automatically. You can also add a reference manually so any name (e.g. &ldquo;xlab labels&rdquo;) works in the tracker.
        </p>
        {(order.invoice_numbers || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {(order.invoice_numbers || []).map((/** @type {string} */ n) => (
              <span key={n} className="text-xs font-mono bg-amber-200 text-amber-900 px-2 py-0.5 rounded-md flex items-center gap-1">
                {n}
                <button
                  onClick={() => {
                    const updated = (order.invoice_numbers || []).filter((/** @type {string} */ x) => x !== n);
                    onUpdate(order.id, { invoice_numbers: updated });
                  }}
                  className="text-amber-600 hover:text-red-600 transition-colors leading-none"
                  title="Remove reference"
                >×</button>
              </span>
            ))}
          </div>
        )}
        {/* Manual reference number */}
        <div className="flex gap-2 pt-1">
          <Input
            value={manualRef}
            onChange={(/** @type {any} */ e) => setManualRef(e.target.value.toUpperCase())}
            placeholder="Add reference manually (e.g. XLAB-LABELS)"
            className="h-8 rounded-lg text-xs font-mono flex-1"
            onKeyDown={(/** @type {any} */ e) => {
              if (e.key === "Enter") {
                const ref = manualRef.trim().replace(/\s+/g, "-");
                if (!ref) return;
                const existing = order.invoice_numbers || [];
                if (!existing.includes(ref)) {
                  onUpdate(order.id, { invoice_numbers: [...existing, ref] });
                }
                setManualRef("");
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-lg text-xs px-3 border-amber-300 text-amber-800 hover:bg-amber-100"
            onClick={() => {
              const ref = manualRef.trim().replace(/\s+/g, "-");
              if (!ref) return;
              const existing = order.invoice_numbers || [];
              if (!existing.includes(ref)) {
                onUpdate(order.id, { invoice_numbers: [...existing, ref] });
              }
              setManualRef("");
            }}
          >
            Add
          </Button>
        </div>
      </div>

      <div className="rounded-xl bg-card border border-border p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Invoice pricing</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hasOrderTotal
                ? "Order total already exists, so the invoice gets a reference highlight."
                : "Add the invoice total before upload to set the missing order price."}
            </p>
          </div>
          {hasOrderTotal && (
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
              Order {formatCurrency(orderTotal)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input
            value={invoiceTotal}
            onChange={(/** @type {any} */ e) => setInvoiceTotal(e.target.value)}
            placeholder={hasOrderTotal ? "Invoice total (optional)" : "Invoice total"}
            type="number"
            min="0"
            step="0.01"
            className="h-9 rounded-xl text-sm"
          />
          <div className="sm:col-span-2 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-secondary/50 px-2 py-1.5">
              <p className="text-[10px] text-muted-foreground">Invoice</p>
              <p className="text-xs font-semibold text-foreground">{formatCurrency(visibleInvoiceTotal)}</p>
            </div>
            <div className="rounded-lg bg-green-50 px-2 py-1.5">
              <p className="text-[10px] text-green-700">Paid</p>
              <p className="text-xs font-semibold text-green-800">{formatCurrency(totalPaid)}</p>
            </div>
            <div className={`rounded-lg px-2 py-1.5 ${visibleBalance > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
              <p className={`text-[10px] ${visibleBalance > 0 ? 'text-red-700' : 'text-green-700'}`}>Balance</p>
              <p className={`text-xs font-semibold ${visibleBalance > 0 ? 'text-red-800' : 'text-green-800'}`}>{formatCurrency(visibleBalance)}</p>
            </div>
          </div>
        </div>
      </div>

      <label className="cursor-pointer block">
        <div className={`flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-2xl transition-all ${
          uploading ? 'border-border opacity-60' : 'border-amber-300 hover:border-amber-400 hover:bg-amber-50/50'
        }`}>
          <Paperclip className="w-4 h-4 text-amber-600" />
          <span className="text-sm text-amber-700 font-medium">
            {uploading ? 'Uploading invoice…' : 'Upload Zoho Books invoice'}
          </span>
        </div>
        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={uploadInvoice} disabled={uploading} />
      </label>

      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4 bg-secondary/30 rounded-xl">
          No invoices uploaded yet
        </p>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-amber-700" />
              </div>
              <div className="flex-1 min-w-0">
                <a href={inv.url} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-medium text-amber-800 hover:underline truncate block">
                  {inv.name}
                </a>
                <p className="text-xs text-amber-600 mt-0.5">
                  {inv.invoice_number && (
                    <span className="font-mono bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded mr-1.5">{inv.invoice_number}</span>
                  )}
                  Zoho Books · {inv.uploaded_at ? format(new Date(inv.uploaded_at), 'd MMM yyyy') : 'Uploaded'}
                </p>
                {amountIdx === i ? (
                  <div className="mt-2 flex items-center gap-1.5">
                    <Input
                      type="number"
                      placeholder="Invoice total (R)"
                      value={amountInput}
                      onChange={(/** @type {any} */ e) => setAmountInput(e.target.value)}
                      className="h-7 text-xs rounded-lg flex-1"
                      autoFocus
                      onKeyDown={(/** @type {any} */ e) => e.key === 'Enter' && saveInvoiceAmount(i)}
                    />
                    <Button size="sm" onClick={() => saveInvoiceAmount(i)} className="h-7 text-xs px-2 rounded-lg">Save</Button>
                    <button onClick={() => { setAmountIdx(null); setAmountInput(""); }} className="text-xs text-muted-foreground px-1">✕</button>
                  </div>
                ) : inv.invoice_total ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      onClick={() => { setAmountIdx(i); setAmountInput(String(inv.invoice_total)); }}
                      className="text-[11px] font-semibold bg-white/70 text-amber-900 border border-amber-200 rounded-full px-2 py-0.5 hover:bg-amber-100 transition-colors"
                      title="Click to edit"
                    >
                      Invoice {formatCurrency(inv.invoice_total)}
                    </button>
                    <span className="text-[11px] font-semibold bg-green-50 text-green-800 border border-green-100 rounded-full px-2 py-0.5">
                      Paid {formatCurrency(totalPaid)}
                    </span>
                    <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border ${
                      Math.max(inv.invoice_total - totalPaid, 0) > 0
                        ? 'bg-red-50 text-red-800 border-red-100'
                        : 'bg-green-50 text-green-800 border-green-100'
                    }`}>
                      Balance {formatCurrency(Math.max(inv.invoice_total - totalPaid, 0))}
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAmountIdx(i); setAmountInput(""); }}
                    className="mt-1 text-xs text-amber-700 hover:text-amber-900 underline underline-offset-2 transition-colors block"
                  >
                    + Set invoice total
                  </button>
                )}
              </div>
              <button
                onClick={() => removeInvoice(i)}
                className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                title="Remove"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
