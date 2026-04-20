import React, { useState } from "react";
import { format } from "date-fns";
import {
  X, Edit2, Package, Truck, CreditCard, Paperclip, Plus,
  CheckCircle2, Clock, Circle, ChevronRight, ExternalLink,
  Archive, MapPin, Send
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const statusConfig = {
  confirmed: { label: "Confirmed", color: "bg-blue-100 text-blue-700" },
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
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiveInput, setArchiveInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', order.id],
    queryFn: () => base44.entities.Payment.filter({ order_id: order.id })
  });

  const { data: orderTasks = [] } = useQuery({
    queryKey: ['orderTasks', order.id],
    queryFn: () => base44.entities.Task.filter({ linked_order_id: order.id })
  });

  const addPaymentMutation = useMutation({
    mutationFn: (data) => base44.entities.Payment.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', order.id] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      setShowPayment(false);
      toast.success("Payment added");
    }
  });

  const startEdit = (field, value) => {
    setEditingField(field);
    setFieldValue(value || '');
  };

  const saveEdit = () => {
    if (editingField) {
      onUpdate({ [editingField]: fieldValue });
      setEditingField(null);
    }
  };

  const uploadFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const updated = { file_urls: [...(order.file_urls || []), file_url] };
      onUpdate(updated);
      toast.success("File uploaded");
    } catch {
      toast.error("Upload failed");
    }
    setUploading(false);
  };

  const addPayment = () => {
    if (!paymentForm.amount) return;
    addPaymentMutation.mutate({
      order_id: order.id,
      order_number: order.order_number,
      client_name: order.client_name,
      amount: parseFloat(paymentForm.amount),
      method: paymentForm.method,
      notes: paymentForm.notes,
      status: 'completed',
      payment_date: new Date().toISOString().split('T')[0],
    });
  };

  const currentStageIndex = progressStages.indexOf(order.status);
  const totalPaid = payments.filter(p => p.status === 'completed').reduce((s, p) => s + (p.amount || 0), 0);
  const balance = (order.total_amount || 0) - totalPaid;

  const courier = couriers?.find(c => c.value === order.courier);
  const trackingUrl = courier && order.tracking_number
    ? `${courier.url}${order.tracking_number}`
    : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-card shadow-apple-xl z-50 flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h2 className="font-bold text-foreground">{order.client_name}</h2>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusConfig[order.status]?.color || 'bg-secondary'}`}>
                {statusConfig[order.status]?.label || order.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">#{order.order_number || order.id?.slice(0,8)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center hover:bg-border transition-all">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Progress Bar */}
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

        {/* Quick Actions */}
        <div className="flex gap-2 px-5 py-3 border-b border-border overflow-x-auto">
          {ORDER_STATUSES.filter(s => s !== order.status).slice(0,3).map(s => (
            <button
              key={s}
              onClick={() => onUpdate({ status: s })}
              className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full bg-secondary hover:bg-border transition-all capitalize"
            >
              → {statusConfig[s]?.label || s}
            </button>
          ))}
          <button
            onClick={() => setShowPayment(!showPayment)}
            className="flex-shrink-0 flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full bg-green-50 text-green-700 hover:bg-green-100 transition-all"
          >
            <CreditCard className="w-3 h-3" /> Add Payment
          </button>
          <label className="flex-shrink-0 cursor-pointer">
            <span className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 transition-all">
              <Paperclip className="w-3 h-3" /> {uploading ? 'Uploading...' : 'Upload File'}
            </span>
            <input type="file" className="hidden" onChange={uploadFile} disabled={uploading} />
          </label>
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
        <div className="flex border-b border-border px-5">
          {['details', 'payments', 'tasks', 'tracking', 'files'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-3 text-xs font-semibold capitalize border-b-2 transition-all
                ${tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {t}
              {t === 'payments' && payments.length > 0 && (
                <span className="ml-1 text-xs bg-primary/10 text-primary px-1 rounded-full">{payments.length}</span>
              )}
              {t === 'tasks' && orderTasks.length > 0 && (
                <span className="ml-1 text-xs bg-secondary text-muted-foreground px-1 rounded-full">{orderTasks.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5">
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
                  <Select value={order.status} onValueChange={v => onUpdate({ status: v })}>
                    <SelectTrigger className="h-7 border-0 bg-transparent p-0 text-xs font-medium">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{statusConfig[s]?.label || s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Products */}
              {order.products && order.products.length > 0 && (
                <div className="bg-secondary/30 rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Products</h3>
                  <div className="space-y-2">
                    {order.products.map((p, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm text-foreground">{p.name}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">x{p.quantity}</span>
                          {p.price && <span className="text-sm font-medium">R{p.price}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
            <div className="space-y-2">
              {orderTasks.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No tasks linked to this order</p>
                </div>
              ) : orderTasks.map(task => (
                <div key={task.id} className="flex items-center gap-3 p-3 bg-secondary/30 rounded-xl">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${task.status === 'done' ? 'bg-green-500' : task.status === 'in_progress' ? 'bg-blue-500' : 'bg-amber-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${task.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{task.title}</p>
                    {task.deadline && <p className="text-xs text-muted-foreground">{format(new Date(task.deadline), 'MMM d')}</p>}
                  </div>
                  <span className="text-xs capitalize text-muted-foreground">{task.status?.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'tracking' && (
            <div className="space-y-4">
              <EditField label="Courier" field="courier" value={order.courier}
                editing={editingField === 'courier'} editValue={fieldValue}
                onEdit={() => startEdit('courier', order.courier)}
                onChange={setFieldValue} onSave={saveEdit}
                isSelect options={couriers?.map(c => ({ value: c.value, label: c.label }))} />
              <EditField label="Tracking Number" field="tracking_number" value={order.tracking_number}
                editing={editingField === 'tracking_number'} editValue={fieldValue}
                onEdit={() => startEdit('tracking_number', order.tracking_number)}
                onChange={setFieldValue} onSave={saveEdit} />
              {trackingUrl && (
                <a href={trackingUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 p-4 bg-primary/5 rounded-xl border border-primary/20 text-primary hover:bg-primary/10 transition-all">
                  <ExternalLink className="w-4 h-4" />
                  <span className="text-sm font-medium">Track with {courier?.label}</span>
                  <ChevronRight className="w-4 h-4 ml-auto" />
                </a>
              )}
            </div>
          )}

          {tab === 'files' && (
            <div className="space-y-2">
              <label className="cursor-pointer">
                <div className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-border rounded-2xl hover:border-primary/40 transition-all">
                  <Paperclip className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{uploading ? 'Uploading...' : 'Upload a file'}</span>
                </div>
                <input type="file" className="hidden" onChange={uploadFile} disabled={uploading} />
              </label>
              {order.file_urls?.length > 0 ? (
                order.file_urls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 bg-secondary/30 rounded-xl hover:bg-secondary transition-all">
                    <Paperclip className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-foreground flex-1">File {i + 1}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                  </a>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No files attached</p>
              )}
            </div>
          )}
        </div>

        {/* Archive */}
        <div className="p-4 border-t border-border">
          {showArchiveConfirm ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground text-center">Type <strong>DELETE</strong> to archive</p>
              <Input value={archiveInput} onChange={e => setArchiveInput(e.target.value)} placeholder="Type DELETE" className="rounded-xl text-center" />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowArchiveConfirm(false)} className="flex-1 rounded-xl">Cancel</Button>
                <Button variant="destructive" onClick={onArchive} disabled={archiveInput !== 'DELETE'} className="flex-1 rounded-xl">Archive</Button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowArchiveConfirm(true)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-destructive transition-all mx-auto">
              <Archive className="w-3.5 h-3.5" /> Archive order
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function EditField({ label, field, value, editing, editValue, onEdit, onChange, onSave, inputType = "text", isSelect, options }) {
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