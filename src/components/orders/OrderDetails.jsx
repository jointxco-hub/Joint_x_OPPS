import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { 
  X, User, Phone, Mail, Calendar, Shirt, 
  FileText, DollarSign, Truck, Copy, Check, Archive, Trash2,
  AlertCircle, MessageCircle
} from "lucide-react";
import OrderStatusBadge from "../dashboard/OrderStatusBadge";
import ClientAssetsPanel from "./ClientAssetsPanel";
import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const printTypeLabels = {
  vinyl_videoflex: "Vinyl (Videoflex)",
  vinyl_flock: "Vinyl (Flock)",
  vinyl_silicon: "Vinyl (Silicon)",
  dtf_randburg: "DTF (Randburg - Quality)",
  dtf_joburg: "DTF (Joburg)"
};

const priorityColors = {
  low: "bg-slate-100 text-slate-700",
  normal: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700"
};

const stuckReasons = {
  none: { label: "No blockers", color: "bg-slate-100 text-slate-600", show: false },
  waiting_on_payment: { label: "Waiting on Payment", color: "bg-red-100 text-red-700", show: true },
  waiting_on_materials: { label: "Waiting on Materials", color: "bg-orange-100 text-orange-700", show: true },
  waiting_on_approval: { label: "Waiting on Approval", color: "bg-amber-100 text-amber-700", show: true },
  waiting_on_vendor: { label: "Waiting on Vendor", color: "bg-purple-100 text-purple-700", show: true }
};

export default function OrderDetails({ order, onClose, onEdit, onUpdateStatus, onArchive, onDelete }) {
  const [copied, setCopied] = useState(false);
  const [stuckReason, setStuckReason] = useState(order.stuck_reason || "none");

  const copyTrackingCode = () => {
    navigator.clipboard.writeText(order.tracking_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStuckReasonChange = async (newReason) => {
    setStuckReason(newReason);
    await onUpdateStatus(order.id, order.status, { stuck_reason: newReason });
  };

  const whatsappUrl = base44.agents.getWhatsAppConnectURL('order_assistant');
  const balance = (order.quoted_price || 0) - (order.deposit_paid || 0);
  const currentStuckConfig = stuckReasons[stuckReason] || stuckReasons.none;

  return (
    <Card className="bg-white border-0 shadow-lg">
      <div className="p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h2 className="text-xl font-bold text-slate-900">{order.order_number}</h2>
              <OrderStatusBadge status={order.status} />
              <Badge className={`${priorityColors[order.priority]} border-0`}>
                {order.priority.charAt(0).toUpperCase() + order.priority.slice(1)}
              </Badge>
              {currentStuckConfig.show && (
                <Badge className={`${currentStuckConfig.color} border-0 flex items-center gap-1`}>
                  <AlertCircle className="w-3 h-3" />
                  {currentStuckConfig.label}
                </Badge>
              )}
            </div>
            <p className="text-slate-500">{order.client_name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Stuck Reason Selector */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900 mb-2">Order Blocker Status</h3>
              <Select value={stuckReason} onValueChange={handleStuckReasonChange}>
                <SelectTrigger className="bg-white border-amber-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">✓ No blockers</SelectItem>
                  <SelectItem value="waiting_on_payment">💰 Waiting on Payment</SelectItem>
                  <SelectItem value="waiting_on_materials">📦 Waiting on Materials</SelectItem>
                  <SelectItem value="waiting_on_approval">✋ Waiting on Approval</SelectItem>
                  <SelectItem value="waiting_on_vendor">🏢 Waiting on Vendor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Client Info */}
          <div className="space-y-4">
            <h3 className="font-semibold text-slate-700">Client Details</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <User className="w-4 h-4 text-slate-400" />
                <span>{order.client_name}</span>
              </div>
              {order.client_email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-slate-400" />
                  <span>{order.client_email}</span>
                </div>
              )}
              {order.client_phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="w-4 h-4 text-slate-400" />
                  <span>{order.client_phone}</span>
                </div>
              )}
            </div>
          </div>

          {/* Order Info */}
          <div className="space-y-4">
            <h3 className="font-semibold text-slate-700">Order Details</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Shirt className="w-4 h-4 text-slate-400" />
                <span>{order.quantity}x {printTypeLabels[order.print_type]}</span>
              </div>
              {order.blank_type && (
                <div className="flex items-center gap-3 text-sm">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <span>{order.blank_type}</span>
                </div>
              )}
              {order.due_date && (
                <div className="flex items-center gap-3 text-sm">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <span>Due: {format(new Date(order.due_date), "dd MMMM yyyy")}</span>
                </div>
              )}
            </div>
          </div>

          {/* Pricing */}
          <div className="space-y-4">
            <h3 className="font-semibold text-slate-700">Pricing</h3>
            <div className="bg-slate-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Quoted Price</span>
                <span className="font-medium">R{(order.quoted_price || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Deposit Paid</span>
                <span className="font-medium text-emerald-600">R{(order.deposit_paid || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm border-t pt-2">
                <span className="font-medium">Balance Due</span>
                <span className="font-bold text-slate-900">R{balance.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Tracking & WhatsApp */}
          <div className="space-y-4">
            <h3 className="font-semibold text-slate-700">Client Tracking</h3>
            <div className="bg-slate-900 text-white rounded-lg p-4">
              <p className="text-xs text-slate-400 mb-1">Tracking Code</p>
              <div className="flex items-center justify-between mb-3">
                <span className="text-2xl font-mono font-bold">{order.tracking_code}</span>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={copyTrackingCode}
                  className="text-white hover:bg-slate-800"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <a 
                href={whatsappUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white rounded-lg px-4 py-2 text-sm transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp Order Updates
              </a>
            </div>
          </div>
        </div>

        {/* Description */}
        {order.description && (
          <div className="mt-6">
            <h3 className="font-semibold text-slate-700 mb-2">Description</h3>
            <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-4">{order.description}</p>
          </div>
        )}

        {/* Delivery Estimate */}
        {(order.estimated_delivery_date || order.estimated_delivery_time) && (
          <div className="mt-4">
            <h3 className="font-semibold text-slate-700 mb-2">Estimated Delivery</h3>
            <div className="bg-emerald-50 rounded-lg p-4 space-y-1">
              {order.estimated_delivery_date && (
                <p className="text-sm text-emerald-800">
                  📅 {format(new Date(order.estimated_delivery_date), "dd MMM yyyy")}
                </p>
              )}
              {order.estimated_delivery_time && (
                <p className="text-sm text-emerald-700">⏱️ {order.estimated_delivery_time}</p>
              )}
            </div>
          </div>
        )}

        {/* Notes */}
        {order.notes && (
          <div className="mt-4">
            <h3 className="font-semibold text-slate-700 mb-2">Internal Notes</h3>
            <p className="text-sm text-slate-600 bg-amber-50 rounded-lg p-4">{order.notes}</p>
          </div>
        )}

        {/* Client Assets */}
        <div className="mt-6">
          <ClientAssetsPanel orderId={order.id} clientName={order.client_name} />
        </div>

        {/* Actions */}
        <div className="space-y-3 mt-6 pt-6 border-t">
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => onEdit(order)} className="flex-1">
              Edit Order
            </Button>
            <select 
              className="flex-1 px-4 py-2 border rounded-lg bg-white"
              value={order.status}
              onChange={(e) => onUpdateStatus(order.id, e.target.value)}
            >
              <option value="received">Received</option>
              <option value="materials_needed">Materials Needed</option>
              <option value="in_production">In Production</option>
              <option value="ready">Ready</option>
              <option value="out_for_delivery">Out for Delivery</option>
              <option value="delivered">Delivered</option>
            </select>
          </div>
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={() => onArchive?.(order)}
              className="flex-1"
            >
              <Archive className="w-4 h-4 mr-2" /> Archive
            </Button>
            <Button 
              variant="outline" 
              onClick={() => onDelete?.(order)}
              className="flex-1 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}