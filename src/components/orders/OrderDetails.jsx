import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { 
  X, User, Phone, Mail, Calendar, Shirt, 
  FileText, DollarSign, Truck, Copy, Check
} from "lucide-react";
import OrderStatusBadge from "../dashboard/OrderStatusBadge";
import { useState } from "react";

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

export default function OrderDetails({ order, onClose, onEdit, onUpdateStatus, onArchive, onDelete }) {
  const [copied, setCopied] = useState(false);

  const copyTrackingCode = () => {
    navigator.clipboard.writeText(order.tracking_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const balance = (order.quoted_price || 0) - (order.deposit_paid || 0);

  return (
    <Card className="bg-white border-0 shadow-lg">
      <div className="p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-xl font-bold text-slate-900">{order.order_number}</h2>
              <OrderStatusBadge status={order.status} />
              <Badge className={`${priorityColors[order.priority]} border-0`}>
                {order.priority.charAt(0).toUpperCase() + order.priority.slice(1)}
              </Badge>
            </div>
            <p className="text-slate-500">{order.client_name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
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

          {/* Tracking */}
          <div className="space-y-4">
            <h3 className="font-semibold text-slate-700">Client Tracking</h3>
            <div className="bg-slate-900 text-white rounded-lg p-4">
              <p className="text-xs text-slate-400 mb-1">Tracking Code</p>
              <div className="flex items-center justify-between">
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

        {/* Notes */}
        {order.notes && (
          <div className="mt-4">
            <h3 className="font-semibold text-slate-700 mb-2">Internal Notes</h3>
            <p className="text-sm text-slate-600 bg-amber-50 rounded-lg p-4">{order.notes}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 mt-6 pt-6 border-t">
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
      </div>
    </Card>
  );
}