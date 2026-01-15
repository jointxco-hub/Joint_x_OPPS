import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Check, Truck, Package, MapPin, Clock, Car, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

const statusConfig = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-700", icon: Package },
  pending: { label: "Pending", className: "bg-amber-100 text-amber-700", icon: AlertTriangle },
  approved: { label: "Approved", className: "bg-blue-100 text-blue-700", icon: Check },
  ordered: { label: "Ordered", className: "bg-purple-100 text-purple-700", icon: Truck },
  partial: { label: "Partial", className: "bg-orange-100 text-orange-700", icon: Package },
  received: { label: "Received", className: "bg-emerald-100 text-emerald-700", icon: Check },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-700", icon: X }
};

export default function POModal({ po, supplier, onClose, onStatusChange, onEdit }) {
  if (!po) return null;

  const config = statusConfig[po.status] || statusConfig.draft;
  const StatusIcon = config.icon;

  return (
    <div 
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-slate-100 p-6 pb-4 rounded-t-3xl">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-slate-900">{po.po_number}</h2>
                <Badge className={`${config.className} border-0`}>
                  <StatusIcon className="w-3 h-3 mr-1" />
                  {config.label}
                </Badge>
              </div>
              {po.auto_generated && (
                <Badge className="mt-2 bg-amber-50 text-amber-600 border-amber-200 text-xs">
                  Auto-generated from low stock
                </Badge>
              )}
            </div>
            <button 
              onClick={onClose}
              className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5 text-slate-600" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Supplier Card */}
          <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl p-4">
            <p className="text-sm text-slate-500 mb-1">Supplier</p>
            <p className="font-semibold text-lg">{po.supplier_name}</p>
            {supplier && (
              <div className="flex flex-wrap gap-3 mt-3 text-sm text-slate-600">
                {supplier.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4 text-slate-400" />
                    {supplier.location}
                  </span>
                )}
                {supplier.lead_time_days && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4 text-slate-400" />
                    {supplier.lead_time_days}d lead
                  </span>
                )}
                {supplier.avg_uber_fee > 0 && (
                  <span className="flex items-center gap-1">
                    <Car className="w-4 h-4 text-slate-400" />
                    ~R{supplier.avg_uber_fee}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 rounded-2xl p-4 text-center">
              <p className="text-xs text-slate-500 mb-1">Order Date</p>
              <p className="font-semibold">
                {po.order_date ? format(new Date(po.order_date), "dd MMM yyyy") : "—"}
              </p>
            </div>
            <div className="bg-slate-50 rounded-2xl p-4 text-center">
              <p className="text-xs text-slate-500 mb-1">Expected</p>
              <p className="font-semibold">
                {po.expected_delivery ? format(new Date(po.expected_delivery), "dd MMM yyyy") : "—"}
              </p>
            </div>
          </div>

          {/* Items */}
          <div>
            <p className="text-sm text-slate-500 mb-3">Items ({po.items?.length || 0})</p>
            <div className="space-y-2">
              {po.items?.map((item, i) => (
                <div key={i} className="bg-slate-50 rounded-2xl p-4 flex justify-between items-center">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-slate-500">
                      {item.quantity} {item.unit} × R{item.unit_price}
                    </p>
                  </div>
                  <p className="font-semibold">R{(item.total || 0).toFixed(0)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Total */}
          <div className="bg-slate-900 text-white rounded-2xl p-4 flex justify-between items-center">
            <p className="font-medium">Total</p>
            <p className="text-2xl font-bold">R{(po.total || 0).toFixed(2)}</p>
          </div>

          {/* Notes */}
          {po.notes && (
            <div className="bg-amber-50 rounded-2xl p-4">
              <p className="text-xs text-amber-600 mb-1">Notes</p>
              <p className="text-sm text-amber-800">{po.notes}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="sticky bottom-0 bg-white border-t border-slate-100 p-6 pt-4 rounded-b-3xl">
          {onEdit && (
            <Button 
              onClick={() => onEdit(po)} 
              variant="outline"
              className="w-full mb-3 h-12 rounded-xl"
            >
              Edit Purchase Order
            </Button>
          )}
          <div className="flex gap-3">
            {po.status === 'draft' && (
              <>
                <Button 
                  onClick={() => onStatusChange(po, 'pending')} 
                  className="flex-1 h-12 rounded-xl bg-slate-900 hover:bg-slate-800"
                >
                  Submit for Approval
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => onStatusChange(po, 'cancelled')}
                  className="h-12 rounded-xl"
                >
                  Cancel
                </Button>
              </>
            )}
            {po.status === 'pending' && (
              <>
                <Button 
                  onClick={() => onStatusChange(po, 'approved')} 
                  className="flex-1 h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700"
                >
                  <Check className="w-4 h-4 mr-2" /> Approve
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => onStatusChange(po, 'draft')}
                  className="h-12 rounded-xl"
                >
                  Back to Draft
                </Button>
              </>
            )}
            {po.status === 'approved' && (
              <Button 
                onClick={() => onStatusChange(po, 'ordered')} 
                className="flex-1 h-12 rounded-xl bg-purple-600 hover:bg-purple-700"
              >
                <Truck className="w-4 h-4 mr-2" /> Mark Ordered
              </Button>
            )}
            {po.status === 'ordered' && (
              <Button 
                onClick={() => onStatusChange(po, 'received')} 
                className="flex-1 h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700"
              >
                <Package className="w-4 h-4 mr-2" /> Mark Received
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}