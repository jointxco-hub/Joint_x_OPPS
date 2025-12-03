import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ShoppingCart, AlertTriangle, Check } from "lucide-react";

const statusConfig = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-700" },
  pending: { label: "Pending Approval", className: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved", className: "bg-blue-100 text-blue-700" },
  ordered: { label: "Ordered", className: "bg-purple-100 text-purple-700" },
  partial: { label: "Partial", className: "bg-orange-100 text-orange-700" },
  received: { label: "Received", className: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-700" }
};

export default function PendingPOCard({ po, onApprove, onView }) {
  const config = statusConfig[po.status] || statusConfig.draft;
  
  return (
    <Card className="p-4 bg-white border-0 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold text-slate-900">{po.po_number}</p>
            {po.auto_generated && (
              <Badge className="bg-amber-50 text-amber-600 border-amber-200 text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Auto
              </Badge>
            )}
          </div>
          <p className="text-sm text-slate-500">{po.supplier_name}</p>
        </div>
        <Badge className={`${config.className} border-0`}>
          {config.label}
        </Badge>
      </div>
      
      <div className="space-y-2 text-sm mb-3">
        <div className="flex justify-between">
          <span className="text-slate-500">Items</span>
          <span className="font-medium">{po.items?.length || 0}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Total</span>
          <span className="font-semibold text-slate-900">R{(po.total || 0).toFixed(2)}</span>
        </div>
        {po.expected_delivery && (
          <div className="flex justify-between">
            <span className="text-slate-500">Expected</span>
            <span>{format(new Date(po.expected_delivery), "dd MMM")}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onView?.(po)} className="flex-1">
          View
        </Button>
        {(po.status === 'draft' || po.status === 'pending') && (
          <Button 
            size="sm" 
            onClick={() => onApprove?.(po)} 
            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
          >
            <Check className="w-4 h-4 mr-1" /> Approve
          </Button>
        )}
      </div>
    </Card>
  );
}