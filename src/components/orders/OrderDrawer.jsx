import React, { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  X, Package, CreditCard, Paperclip,
  CheckCircle2, ChevronRight, ExternalLink,
  Archive, AlertTriangle, Copy, Check,
  User, Plus, Trash2, Pencil, Printer
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
import { useOrderDrawerData } from "@/hooks/useOrderDrawerData";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PipelineStrip from "@/components/orders/PipelineStrip";
import OrderTagBadges from "@/components/orders/OrderTagBadges";
import ExceptionFlag from "@/components/orders/ExceptionFlag";
import { normalizeOrderFileFolders } from "@/components/orders/drawer/OrderDrawerShared";

const ProductionReadinessCard = React.lazy(() => import("@/components/orders/ProductionReadinessCard"));
const OrderFilesTab = React.lazy(() => import("@/components/orders/drawer/OrderFilesTab"));
const PortalTab = React.lazy(() => import("@/components/orders/drawer/PortalTab"));
const OrderQuickPrintSheet = React.lazy(() => import("@/components/orders/drawer/OrderQuickPrintSheet"));
const InvoicesTab = React.lazy(() => import("@/components/orders/drawer/InvoicesTab"));
const PurchaseOrderTab = React.lazy(() => import("@/components/orders/drawer/PurchaseOrderTab"));
const ProductsEditor = React.lazy(() => import("@/components/orders/drawer/ProductsEditor"));

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

const PRODUCTION_METHODS = [
  { value: "__none", label: "Not set" },
  { value: "dtf", label: "DTF printing" },
  { value: "vinyl", label: "Vinyl cutting" },
  { value: "screen", label: "Screen printing" },
  { value: "embroidery", label: "Embroidery" },
  { value: "pressing", label: "Heat pressing" },
  { value: "tailoring", label: "Tailoring" },
  { value: "cropping", label: "Cropping / alterations" },
  { value: "labeling", label: "Labeling / tagging" },
  { value: "mixed", label: "Mixed production" },
  { value: "custom", label: "Custom" },
];

const PRODUCTION_DETAIL_STAGES = [
  { value: "__none", label: "Not set" },
  { value: "waiting_design_assets", label: "Waiting for design assets" },
  { value: "artwork_check", label: "Artwork check" },
  { value: "artwork_setup", label: "Artwork setup" },
  { value: "awaiting_client_approval", label: "Awaiting client approval" },
  { value: "print_setup", label: "Print setup" },
  { value: "queued_pressing", label: "Queued for pressing" },
  { value: "pressing", label: "Pressing" },
  { value: "queued_embroidery", label: "Queued for embroidery" },
  { value: "embroidering", label: "Embroidering" },
  { value: "queued_tailor", label: "Queued for tailor" },
  { value: "at_tailor", label: "At tailor" },
  { value: "cropping_alterations", label: "Cropping / alterations" },
  { value: "finishing", label: "Finishing" },
  { value: "quality_check", label: "Quality check" },
  { value: "rework", label: "Rework / correction" },
  { value: "waiting_stock", label: "Waiting on stock / blanks" },
  { value: "packing", label: "Packing" },
  { value: "custom", label: "Custom" },
];

function selectValue(value, fallback = "__none") {
  if (Array.isArray(value)) {
    const first = value.find((item) => item !== null && item !== undefined && String(item).trim() !== "");
    return first === undefined ? fallback : String(first);
  }
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}
function markDrawerPerf(name) {
  if (!import.meta.env.DEV || typeof performance === "undefined") return;
  try {
    performance.mark(name);
  } catch {
    // Performance marks are best-effort diagnostics only.
  }
}

function measureDrawerPerf(name, start, end) {
  if (!import.meta.env.DEV || typeof performance === "undefined") return;
  try {
    performance.measure(name, start, end);
  } catch {
    // Missing marks should never affect app behavior.
  }
}

class DrawerSectionBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message || "Unknown render error" };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.groupCollapsed(`[OrderDrawer] ${this.props.label || "section"} failed`);
      console.error("message:", error?.message);
      console.error("error:", error);
      console.error("stack:", error?.stack);
      console.error("componentStack:", info?.componentStack);
      console.error("resetKey:", this.props.resetKey);
      console.groupEnd();
      return;
    }

    console.error(`[OrderDrawer] ${this.props.label || "section"} failed`, error?.message || error);
    try {
      window.localStorage?.setItem("opps:last-order-drawer-section-error", JSON.stringify({
        label: this.props.label || "section",
        message: error?.message || String(error || "Unknown error"),
        at: new Date().toISOString(),
      }));
    } catch {
      // Diagnostics only.
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">{this.props.label || "This section"} could not load</p>
          <p className="mt-1 text-xs leading-5">You can still use the rest of this order. Close and reopen after saving any changes.</p>
          {this.props.label === "Order workspace" && this.state.errorMessage && (
            <p className="mt-2 break-words font-mono text-[11px] text-amber-800">{this.state.errorMessage}</p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default function OrderDrawer({ order, couriers, stages, onClose, onUpdate, onArchive }) {
  const [tab, setTab] = useState("details");
  const [editingField, setEditingField] = useState(null);
  const [fieldValue, setFieldValue] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    method: 'eft',
    status: 'completed',
    date: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [uploading, setUploading] = useState(false);
  const [showException, setShowException] = useState(false);
  const [printView, setPrintView] = useState(null);
  const [localPipelineStage, setLocalPipelineStage] = useState(order.pipeline_stage);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState("medium");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState("_none");
  const queryClient = useQueryClient();

  const drawerData = useOrderDrawerData(order, tab);
  const {
    payments: safePayments,
    linkedTasks: allLinkedTasks,
    users: safeUsers,
    linkedPO,
    activePOs,
    displayClientEmail,
    displayWhatsappName,
    displaySavedContactName,
    clientDisplay,
    totalPaid,
    balance,
    paymentCount,
    linkedTaskCount,
    linkedPOCount,
    invoiceCount,
    fileCount,
    paymentsLoading,
    tasksLoading,
    paymentsError,
    tasksError,
  } = drawerData;

  const addPaymentMutation = useMutation({
    mutationFn: (data) => dataClient.entities.Payment.create(data),
    onSuccess: (_created, variables) => {
      const paidAmount = Number((/** @type {any} */ variables)?.amount || 0);
      const nextTotalPaid = totalPaid + paidAmount;
      if (paidAmount > 0) {
        onUpdate(order.id, { deposit_paid: nextTotalPaid });
      }
      queryClient.invalidateQueries({ queryKey: ['payments', order.id] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['income'] });
      setShowPayment(false);
      resetPaymentForm();
      toast.success("Payment added");
    },
    onError: (err) => toast.error("Payment failed - " + ((/** @type {any} */ err)?.message || "check Supabase transactions table")),
  });

  const updatePaymentMutation = useMutation({
    mutationFn: ({ id, data }) => dataClient.entities.Payment.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', order.id] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['income'] });
      setShowPayment(false);
      resetPaymentForm();
      toast.success("Payment updated");
    },
    onError: (err) => toast.error("Payment update failed - " + ((/** @type {any} */ err)?.message || "check Supabase transactions table")),
  });

  const deletePaymentMutation = useMutation({
    mutationFn: (id) => dataClient.entities.Payment.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', order.id] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['income'] });
      toast.success("Payment removed");
    },
    onError: (err) => toast.error("Payment delete failed - " + ((/** @type {any} */ err)?.message || "check Supabase transactions table")),
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

  const uploadFile = async (e, folderId = "") => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of files) {
        const { file_url } = await dataClient.integrations.Core.UploadFile({ file });
        if (file_url) uploaded.push(file_url);
      }
      const folderMetadata = normalizeOrderFileFolders(order.order_file_folders);
      const nextFileFolders = { ...(folderMetadata.fileFolders || {}) };
      if (folderId) {
        uploaded.forEach((url) => {
          nextFileFolders[url] = folderId;
        });
      }
      const updated = {
        file_urls: Array.from(new Set([...(order.file_urls || []), ...uploaded])),
        portal_visible_file_urls: Array.isArray(order.portal_visible_file_urls) ? order.portal_visible_file_urls : [],
        order_file_folders: {
          ...folderMetadata,
          fileFolders: nextFileFolders,
        },
      };
      onUpdate(order.id, updated);
      toast.success(uploaded.length === 1 ? "File uploaded" : `${uploaded.length} files uploaded`);
    } catch (err) {
      toast.error((/** @type {any} */ (err))?.message || "Upload failed");
    }
    setUploading(false);
    e.target.value = "";
  };

  const addPayment = () => {
    if (!paymentForm.amount) return;
    const payload = {
      order_id: order.id,
      order_number: order.order_number,
      client_name: order.client_name,
      amount: parseFloat(paymentForm.amount),
      payment_method: paymentForm.method,
      payment_status: paymentForm.status,
      payment_date: paymentForm.date || new Date().toISOString().split('T')[0],
      notes: paymentForm.notes,
    };

    if (editingPaymentId) {
      updatePaymentMutation.mutate({ id: editingPaymentId, data: payload });
      return;
    }

    addPaymentMutation.mutate(payload);
  };

  const resetPaymentForm = () => {
    setEditingPaymentId(null);
    setPaymentForm({
      amount: '',
      method: 'eft',
      status: 'completed',
      date: new Date().toISOString().split('T')[0],
      notes: '',
    });
  };

  const startPaymentEdit = (payment) => {
    setEditingPaymentId(payment.id);
    setPaymentForm({
      amount: payment.amount != null ? String(payment.amount) : '',
      method: payment.method || payment.payment_method || 'eft',
      status: payment.status || payment.payment_status || 'completed',
      date: payment.payment_date || payment.date || new Date().toISOString().split('T')[0],
      notes: payment.notes || '',
    });
    setShowPayment(true);
  };

  const removePayment = (payment) => {
    if (!payment?.id) return;
    const confirmed = window.confirm(`Remove payment of R${Number(payment.amount || 0).toLocaleString()} from this order?`);
    if (!confirmed) return;
    deletePaymentMutation.mutate(payment.id);
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

  useEffect(() => {
    markDrawerPerf("opps:drawer-shell-visible");
    measureDrawerPerf("opps:order-click-to-drawer-shell", "opps:order-row-click", "opps:drawer-shell-visible");
  }, [order.id]);

  useEffect(() => {
    markDrawerPerf("opps:drawer-core-visible");
    measureDrawerPerf("opps:order-click-to-drawer-core", "opps:order-row-click", "opps:drawer-core-visible");
  }, [order.id]);

  const handleCreateTask = () => {
    if (!newTaskTitle.trim()) return;
    createTaskMutation.mutate({
      title: newTaskTitle.trim(),
      status: "not_started",
      priority: newTaskPriority,
      deadline: newTaskDeadline || undefined,
      assigned_to: newTaskAssignee && newTaskAssignee !== "_none" ? [newTaskAssignee] : [],
      order_id: order.id,
      notes: `Order #${order.order_number || ''} - ${order.client_name || ''}`.trim(),
    });
  };

  const currentStageIndex = progressStages.indexOf(order.status);
  const statusValue = ORDER_STATUSES.includes(String(order.status || ""))
    ? String(order.status)
    : "confirmed";
  const assignedToValue = selectValue(order.assigned_to);
  const courierValue = selectValue(order.courier);
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
    const link = `https://xlab.jointx.co.za/track?order=${code}`;
    navigator.clipboard.writeText(link).then(() => { setCopiedXlab(true); setTimeout(() => setCopiedXlab(false), 2000); });
  };

  return (
    <>
      <div className="fixed inset-0 z-[55]" onClick={onClose}>
        <div className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-none" />
      </div>
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-card shadow-apple-xl z-[60] flex flex-col animate-slide-in-right" onClick={e => e.stopPropagation()}>
        <DrawerSectionBoundary label="Order workspace" resetKey={`${order.id}-workspace-${tab}`}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h2 className="font-bold text-foreground">{clientDisplay.name}</h2>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusConfig[order.status]?.color || 'bg-secondary'}`}>
                {statusConfig[order.status]?.label || order.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-1.5">
              #{order.order_number || order.id?.slice(0,8)}
              {displayWhatsappName ? <span> / WhatsApp: {displayWhatsappName}</span> : null}
            </p>
            <DrawerSectionBoundary label="Order tags" resetKey={`${order.id}-tags`}>
              <OrderTagBadges order={{ ...order, pipeline_stage: localPipelineStage ?? order.pipeline_stage }} />
            </DrawerSectionBoundary>
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
        <DrawerSectionBoundary label="Pipeline" resetKey={`${order.id}-pipeline`}>
          <PipelineStrip
            order={{ ...order, pipeline_stage: localPipelineStage ?? order.pipeline_stage }}
            stages={stages}
            onStageChange={setLocalPipelineStage}
          />
        </DrawerSectionBoundary>

        {/* Quick Actions */}
        <div className="flex gap-2 px-5 py-3 border-b border-border overflow-x-auto">
          {ORDER_STATUSES.filter(s => s !== order.status && s !== 'cancelled').map(s => (
            <button
              key={s}
              onClick={() => onUpdate(order.id, { status: s })}
              className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full bg-secondary hover:bg-border transition-all capitalize"
            >
              Next: {statusConfig[s]?.label || s}
            </button>
          ))}
          <button
            onClick={() => {
              setEditingPaymentId(null);
              if (!showPayment && balance > 0) {
                setPaymentForm(pf => ({
                  ...pf,
                  amount: pf.amount || String(balance),
                  status: pf.status || 'completed',
                  date: pf.date || new Date().toISOString().split('T')[0],
                }));
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
            <input type="file" className="hidden" multiple onChange={uploadFile} disabled={uploading} />
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
              <h4 className="text-xs font-semibold text-green-800">{editingPaymentId ? 'Edit Payment' : 'Add Payment'}</h4>
              <button
                onClick={() => {
                  setShowPayment(false);
                  resetPaymentForm();
                }}
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_120px_130px_auto]">
              <Input value={paymentForm.amount} onChange={e => setPaymentForm({...paymentForm, amount: e.target.value})}
                placeholder="Amount (R)" type="number" className="rounded-lg h-8 text-sm" />
              <Select value={paymentForm.method} onValueChange={v => setPaymentForm({...paymentForm, method: v})}>
                <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['cash','card','eft','bank_transfer','other'].map(m => <SelectItem key={m} value={m}>{m.replace('_',' ')}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={paymentForm.status} onValueChange={v => setPaymentForm({...paymentForm, status: v})}>
                <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['completed','pending','failed','refunded'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input value={paymentForm.date} onChange={e => setPaymentForm({...paymentForm, date: e.target.value})}
                type="date" className="rounded-lg h-8 text-sm" />
              <Button
                size="sm"
                onClick={addPayment}
                disabled={addPaymentMutation.isPending || updatePaymentMutation.isPending}
                className="h-8 rounded-lg px-3"
              >
                {editingPaymentId ? 'Save' : 'Add'}
              </Button>
            </div>
            <Input
              value={paymentForm.notes}
              onChange={e => setPaymentForm({...paymentForm, notes: e.target.value})}
              placeholder="Payment note, reference, or correction reason"
              className="mt-2 rounded-lg h-8 text-sm"
            />
            {editingPaymentId && (
              <button onClick={resetPaymentForm} className="mt-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                Cancel edit and add a new payment instead
              </button>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-border px-3 md:px-5">
          {['details', 'readiness', 'payments', 'tasks', 'po', 'tracking', 'files', 'invoices', 'portal'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`shrink-0 px-3 py-3 text-xs font-semibold capitalize border-b-2 transition-all whitespace-nowrap
                ${tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {t === 'portal' ? 'Client Portal' : t === 'readiness' ? 'Readiness' : t}
              {t === 'payments' && paymentCount > 0 && (
                <span className="ml-1 text-xs bg-primary/10 text-primary px-1 rounded-full">{paymentCount}</span>
              )}
              {t === 'tasks' && linkedTaskCount > 0 && (
                <span className="ml-1 text-xs bg-secondary text-muted-foreground px-1 rounded-full">{linkedTaskCount}</span>
              )}
              {t === 'po' && linkedPOCount > 0 && (
                <span className="ml-1 text-xs bg-primary/10 text-primary px-1 rounded-full">{linkedPOCount}</span>
              )}
              {t === 'files' && fileCount > 0 && (
                <span className="ml-1 text-xs bg-secondary text-muted-foreground px-1 rounded-full">{fileCount}</span>
              )}
              {t === 'invoices' && invoiceCount > 0 && (
                <span className="ml-1 text-xs bg-amber-100 text-amber-700 px-1 rounded-full">{invoiceCount}</span>
              )}
              {t === 'portal' && order.portal_message && (
                <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1 rounded-full">ON</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <DrawerSectionBoundary label={`${tab === "po" ? "PO" : tab} tab`} resetKey={`${order.id}-${tab}`}>
          {tab === 'details' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-secondary/20 p-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Order printouts</p>
                  <p className="text-xs text-muted-foreground">Quick production print views for this order.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPrintView("summary")}
                  className="inline-flex items-center gap-2 rounded-full bg-foreground px-3 py-2 text-xs font-semibold text-background hover:bg-foreground/90"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print summary
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <EditField label="Client Name" field="client_name" value={order.client_name}
                  editing={editingField === 'client_name'} editValue={fieldValue}
                  onEdit={() => startEdit('client_name', order.client_name)}
                  onChange={setFieldValue} onSave={saveEdit} />
                <EditField label="Client Email" field="client_email" value={displayClientEmail}
                  editing={editingField === 'client_email'} editValue={fieldValue}
                  onEdit={() => startEdit('client_email', displayClientEmail)}
                  onChange={setFieldValue} onSave={saveEdit} />
                <EditField label="WhatsApp Name" field="whatsapp_name" value={displayWhatsappName}
                  editing={editingField === 'whatsapp_name'} editValue={fieldValue}
                  onEdit={() => startEdit('whatsapp_name', displayWhatsappName)}
                  onChange={setFieldValue} onSave={saveEdit} />
                <EditField label="Saved Contact Name" field="saved_contact_name" value={displaySavedContactName}
                  editing={editingField === 'saved_contact_name'} editValue={fieldValue}
                  onEdit={() => startEdit('saved_contact_name', displaySavedContactName)}
                  onChange={setFieldValue} onSave={saveEdit} />
                <EditField label="Order Number" field="order_number" value={order.order_number}
                  editing={editingField === 'order_number'} editValue={fieldValue}
                  onEdit={() => startEdit('order_number', order.order_number)}
                  onChange={setFieldValue} onSave={saveEdit} />
                <EditField label="Total Amount" field="total_amount" value={order.total_amount ? `R${order.total_amount.toLocaleString()}` : '-'}
                  editing={editingField === 'total_amount'} editValue={fieldValue}
                  onEdit={() => startEdit('total_amount', order.total_amount)}
                  onChange={setFieldValue} onSave={saveEdit} inputType="number" />
                <div className="bg-secondary/30 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-1">Status</p>
                  <Select value={statusValue} onValueChange={v => onUpdate(order.id, { status: v })}>
                    <SelectTrigger className="h-7 border-0 bg-transparent p-0 text-xs font-medium">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{statusConfig[s]?.label || s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-secondary/20 p-3 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Production tracker detail</p>
                  <p className="text-xs text-muted-foreground">Use this to show clients the real merch stage instead of leaving them wondering if production is stuck.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="bg-background/70 rounded-xl p-3">
                    <p className="text-xs text-muted-foreground mb-1">Production method</p>
                    <Select
                      value={selectValue(order.production_method)}
                      onValueChange={v => onUpdate(order.id, { production_method: v === "__none" ? null : v })}
                    >
                      <SelectTrigger className="h-8 border-0 bg-transparent p-0 text-xs font-medium">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRODUCTION_METHODS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="bg-background/70 rounded-xl p-3">
                    <p className="text-xs text-muted-foreground mb-1">Detailed stage</p>
                    <Select
                      value={selectValue(order.production_detail_stage)}
                      onValueChange={v => onUpdate(order.id, { production_detail_stage: v === "__none" ? null : v })}
                    >
                      <SelectTrigger className="h-8 border-0 bg-transparent p-0 text-xs font-medium">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRODUCTION_DETAIL_STAGES.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["artwork_check", "Artwork check"],
                    ["print_setup", "Print setup"],
                    ["pressing", "Pressing"],
                    ["quality_check", "QC"],
                    ["packing", "Packing"],
                    ["waiting_design_assets", "Waiting assets"],
                    ["waiting_stock", "Waiting stock"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onUpdate(order.id, { production_detail_stage: value })}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                        order.production_detail_stage === value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <DraftTextarea
                      label="Client-facing production update"
                      value={order.production_client_update || ""}
                      onSave={(value) => onUpdate(order.id, { production_client_update: value })}
                      placeholder="e.g. Your order is currently queued for embroidery. We are preparing the logo placement before stitching begins."
                    />
                  </div>
                  <div>
                    <DraftTextarea
                      label="Internal hold-up note"
                      value={order.production_internal_note || order.production_hold_reason || ""}
                      onSave={(value) => onUpdate(order.id, { production_internal_note: value, production_hold_reason: value })}
                      placeholder="e.g. Missing left chest logo file. WhatsApp sent Tuesday. Hold until client replies."
                    />
                  </div>
                </div>
              </div>

              {/* Assigned To */}
              <div className="bg-secondary/30 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <User className="w-3 h-3 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Assigned To</p>
                </div>
                <Select value={assignedToValue} onValueChange={v => onUpdate(order.id, { assigned_to: v === '__none' ? null : v })}>
                  <SelectTrigger className="h-7 border-0 bg-transparent p-0 text-xs font-medium">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Unassigned</SelectItem>
                    {safeUsers
                      .map((u) => ({ ...u, value: u.email || u.user_email || u.id }))
                      .filter((u) => u.value)
                      .map(u => <SelectItem key={u.id || u.value} value={u.value}>{u.full_name || u.name || u.value}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Products - fully editable */}
              <DrawerSectionBoundary label="Products" resetKey={`${order.id}-products`}>
                <React.Suspense fallback={<TabSectionFallback label="Products" />}>
                  <ProductsEditor order={order} onUpdate={onUpdate} />
                </React.Suspense>
              </DrawerSectionBoundary>

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
                  {paymentCount > 0 && <TimelineEntry icon={<CreditCard className="w-3 h-3" />} label={`Payment received - R${totalPaid.toLocaleString()}`} time={safePayments[0]?.payment_date} />}
                  {['in_production', 'ready', 'shipped', 'delivered'].filter(s => progressStages.indexOf(s) <= currentStageIndex).map(s => (
                    <TimelineEntry key={s} icon={<CheckCircle2 className="w-3 h-3" />} label={statusConfig[s]?.label} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'readiness' && (
            <React.Suspense fallback={<TabSectionFallback label="Production readiness" />}>
              <ProductionReadinessCard order={order} readinessQuery={drawerData.readinessQuery} />
            </React.Suspense>
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
              {paymentsError && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Payments could not load. Existing order balance values are still shown.
                </div>
              )}
              {paymentsLoading && (
                <div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
                  Loading payments...
                </div>
              )}
              {paymentCount === 0 && !paymentsLoading ? (
                <div className="text-center py-8">
                  <CreditCard className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No payments recorded</p>
                  <button
                    onClick={() => {
                      resetPaymentForm();
                      setPaymentForm(pf => ({ ...pf, amount: balance > 0 ? String(balance) : '' }));
                      setShowPayment(true);
                    }}
                    className="mt-2 text-xs text-primary font-medium"
                  >
                    Add first payment
                  </button>
                </div>
              ) : paymentCount > 0 ? (
                safePayments.map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-3 p-3 bg-secondary/30 rounded-xl">
                    <div>
                      <p className="text-sm font-semibold text-foreground">R{p.amount?.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground capitalize">{p.method?.replace('_', ' ')} / {p.payment_date ? format(new Date(p.payment_date), 'MMM d, yyyy') : ''}</p>
                      {p.notes && <p className="mt-1 text-xs text-muted-foreground">{p.notes}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded-full ${p.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {p.status}
                      </span>
                      <button
                        onClick={() => startPaymentEdit(p)}
                        className="rounded-full p-1.5 text-muted-foreground hover:bg-background hover:text-primary"
                        title="Edit payment"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => removePayment(p)}
                        disabled={deletePaymentMutation.isPending}
                        className="rounded-full p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        title="Remove payment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              ) : null}
            </div>
          )}

          {tab === 'tasks' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Linked Tasks ({linkedTaskCount})
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
                    placeholder={`Task for ${order.client_name || 'this order'}...`}
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
                    <SelectTrigger className="h-8 rounded-xl text-xs"><SelectValue placeholder="Assign to..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Unassigned</SelectItem>
                      {safeUsers
                        .filter(u => u.is_active !== false)
                        .map((u) => ({ ...u, value: u.email || u.user_email || u.id }))
                        .filter((u) => u.value)
                        .map(u => (
                        <SelectItem key={u.id || u.value} value={u.value} className="text-xs">
                          {u.full_name || u.name || u.value}
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
                      {createTaskMutation.isPending ? 'Creating...' : 'Create Task'}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={() => setShowNewTask(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {tasksError && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Tasks could not load. You can still add a new task or try again later.
                </div>
              )}
              {tasksLoading && (
                <div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
                  Loading linked tasks...
                </div>
              )}
              {linkedTaskCount === 0 && !tasksLoading ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No tasks linked to this order</p>
                  <button onClick={() => setShowNewTask(true)} className="mt-2 text-xs text-primary font-medium">Add first task</button>
                </div>
              ) : linkedTaskCount > 0 ? allLinkedTasks.map(task => (
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
              )) : null}
            </div>
          )}

          {tab === 'po' && (
            <React.Suspense fallback={<TabSectionFallback label="Purchase order" />}>
              <PurchaseOrderTab
                order={order}
                onUpdate={onUpdate}
                linkedPO={linkedPO}
                activePOs={activePOs}
              />
            </React.Suspense>
          )}
          {tab === 'tracking' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900">Where each delivery field goes</p>
                <div className="mt-2 space-y-1 text-xs text-amber-800">
                  <p><span className="font-semibold">PEP / courier code:</span> client-provided pickup code, PAXI code, locker code, branch/store code, or delivery instruction before you send.</p>
                  <p><span className="font-semibold">Tracking number or link:</span> courier-provided waybill, tracking number, or full tracking URL after the parcel is booked/dispatched.</p>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Before dispatch - client delivery info</p>
                <div className="mt-3 space-y-3">
                  <EditField label="PEP / Courier Pickup Code" field="pep_code" value={order.pep_code}
                    help="Use this for codes/details the client gives you: PAXI, PEP branch, locker code, pickup code, delivery reference."
                    editing={editingField === 'pep_code'} editValue={fieldValue}
                    onEdit={() => startEdit('pep_code', order.pep_code)}
                    onChange={setFieldValue} onSave={saveEdit} />
                  <EditField label="Delivery Note / Pickup Point" field="delivery_note" value={order.delivery_note}
                    help="Use this for store name, address hint, collection note, special delivery instruction, or package handover note."
                    editing={editingField === 'delivery_note'} editValue={fieldValue}
                    onEdit={() => startEdit('delivery_note', order.delivery_note)}
                    onChange={setFieldValue} onSave={saveEdit} />
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">After dispatch - courier tracking</p>
                <p className="mt-1 text-xs text-muted-foreground">Choose the courier, then paste the waybill/tracking number or full tracking URL supplied by the courier.</p>
                <div className="mt-3 space-y-3">
                  {/* Courier saves immediately on selection */}
              <div className="bg-secondary/30 rounded-xl p-3">
                <p className="text-xs text-muted-foreground mb-1.5">Courier Company</p>
                <Select
                  value={courierValue}
                  onValueChange={v => onUpdate(order.id, { courier: v === '__none' ? null : v })}
                >
                  <SelectTrigger className="h-8 border-0 bg-transparent p-0 text-sm font-medium">
                    <SelectValue placeholder="Select courier..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No courier selected</SelectItem>
                    {resolvedCouriers.map((/** @type {any} */ c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <EditField label="Tracking Number / Tracking Link" field="tracking_number" value={order.tracking_number}
                help="Use this only after booking the delivery. Paste the waybill number, courier tracking number, or the full tracking URL."
                editing={editingField === 'tracking_number'} editValue={fieldValue}
                onEdit={() => startEdit('tracking_number', order.tracking_number)}
                onChange={setFieldValue} onSave={saveEdit} />
                </div>
              </div>
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
            <React.Suspense fallback={<TabSectionFallback label="Order files" />}>
              <OrderFilesTab order={order} onUpdate={onUpdate} uploadFile={uploadFile} uploading={uploading} onPrint={setPrintView} />
            </React.Suspense>
          )}

          {tab === 'invoices' && (
            <React.Suspense fallback={<TabSectionFallback label="Invoices" />}>
              <InvoicesTab order={order} onUpdate={onUpdate} totalPaid={totalPaid} onPrint={setPrintView} />
            </React.Suspense>
          )}

          {tab === 'portal' && (
            <React.Suspense fallback={<TabSectionFallback label="Client portal" />}>
              <PortalTab order={order} onUpdate={onUpdate} balance={balance} />
            </React.Suspense>
          )}
          </DrawerSectionBoundary>
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
        </DrawerSectionBoundary>
      </div>

      {printView && (
        <React.Suspense fallback={null}>
          <OrderQuickPrintSheet
            type={printView}
            order={{
              ...order,
              client_email: displayClientEmail,
              whatsapp_name: displayWhatsappName,
              saved_contact_name: displaySavedContactName,
            }}
            payments={safePayments}
            totalPaid={totalPaid}
            balance={balance}
            onClose={() => setPrintView(null)}
          />
        </React.Suspense>
      )}

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

function DraftTextarea({ label, value, onSave, placeholder }) {
  const [draft, setDraft] = useState(value || "");
  const isDirty = draft !== (value || "");

  useEffect(() => {
    setDraft(value || "");
  }, [value]);

  const save = () => {
    if (!isDirty) return;
    onSave(draft);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="block text-xs text-muted-foreground">{label}</label>
        {isDirty && (
          <button
            type="button"
            onClick={save}
            className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/15"
          >
            Save
          </button>
        )}
      </div>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        placeholder={placeholder}
        className="h-20 w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}

function EditField({ label, value, help, editing, editValue, onEdit, onChange, onSave, inputType = "text", isSelect, options }) {
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
        <p className="text-sm font-medium text-foreground">{value || '-'}</p>
      )}
      {help && <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{help}</p>}
    </div>
  );
}

function TabSectionFallback({ label = "Section" }) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/30 p-4">
      <div className="h-4 w-36 animate-pulse rounded bg-secondary" />
      <div className="mt-4 space-y-2">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-12 animate-pulse rounded-xl bg-background/70" />
        ))}
      </div>
      <p className="sr-only">Loading {label}</p>
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
