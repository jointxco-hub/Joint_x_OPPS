import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Check, Truck, Package, MapPin, Clock, Car, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import CommentThread from "@/components/common/CommentThread";

const statusConfig = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-700", icon: Package },
  pending: { label: "Pending", className: "bg-amber-100 text-amber-700", icon: AlertTriangle },
  approved: { label: "Approved", className: "bg-primary/10 text-primary", icon: Check },
  ordered: { label: "Ordered", className: "bg-purple-100 text-purple-700", icon: Truck },
  partial: { label: "Partial", className: "bg-orange-100 text-orange-700", icon: Package },
  received: { label: "Received", className: "bg-emerald-100 text-emerald-700", icon: Check },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-700", icon: X },
};

export default function POModal({ po, supplier, users = [], onClose, onStatusChange, onUpdate, onEdit }) {
  if (!po) return null;

  const config = statusConfig[po.status] || statusConfig.draft;
  const StatusIcon = config.icon;
  const expectedDate = po.expected_delivery || po.expected_date || po.due_date;
  const total = Number(po.total_amount ?? po.total ?? 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 rounded-t-2xl border-b border-border bg-card/95 p-6 pb-4 backdrop-blur-sm">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-foreground">{po.po_number}</h2>
                <Badge className={`${config.className} border-0`}>
                  <StatusIcon className="mr-1 h-3 w-3" />
                  {config.label}
                </Badge>
              </div>
              {po.auto_generated && <Badge className="mt-2 border-amber-200 bg-amber-50 text-xs text-amber-600">Auto-generated from low stock</Badge>}
            </div>
            <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary hover:bg-border">
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="space-y-6 p-6">
          <div className="rounded-2xl bg-primary/5 p-4">
            <p className="mb-1 text-sm text-muted-foreground">Supplier</p>
            <p className="text-lg font-semibold text-foreground">{po.supplier_name || supplier?.name || "No supplier selected"}</p>
            {supplier && (
              <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground">
                {supplier.location && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{supplier.location}</span>}
                {supplier.lead_time_days && <span className="flex items-center gap-1"><Clock className="h-4 w-4" />{supplier.lead_time_days}d lead</span>}
                {supplier.avg_uber_fee > 0 && <span className="flex items-center gap-1"><Car className="h-4 w-4" />~R{supplier.avg_uber_fee}</span>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <DateBox label="Order Date" value={po.order_date} />
            <DateBox label="Expected" value={expectedDate} />
          </div>

          <div>
            <p className="mb-3 text-sm text-muted-foreground">Items ({po.items?.length || 0})</p>
            <div className="space-y-2">
              {(po.items || []).map((item, index) => {
                const itemTotal = Number(item.total ?? (Number(item.quantity || 0) * Number(item.unit_price || 0)));
                return (
                  <div key={index} className="flex items-center justify-between rounded-2xl bg-secondary/40 p-4">
                    <div>
                      <p className="font-medium text-foreground">{item.name}</p>
                      <p className="text-sm text-muted-foreground">{item.quantity} {item.unit || "units"} x R{Number(item.unit_price || 0).toFixed(2)}</p>
                    </div>
                    <p className="font-semibold text-foreground">R{itemTotal.toFixed(0)}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl bg-foreground p-4 text-white">
            <p className="font-medium">Total</p>
            <p className="text-2xl font-bold">R{total.toFixed(2)}</p>
          </div>

          {po.notes && (
            <div className="rounded-2xl bg-amber-50 p-4">
              <p className="mb-1 text-xs text-amber-600">Notes</p>
              <p className="text-sm text-amber-800">{po.notes}</p>
            </div>
          )}

          {onUpdate && (
            <CommentThread
              comments={po.comments || []}
              users={users}
              title="PO Comments"
              placeholder="Add supplier update, approval note, or tag @team..."
              onChange={(comments) => onUpdate({ comments })}
            />
          )}
        </div>

        <div className="sticky bottom-0 rounded-b-2xl border-t border-border bg-card p-6 pt-4">
          {onEdit && (
            <Button onClick={() => onEdit(po)} variant="outline" className="mb-3 h-12 w-full rounded-xl">
              Edit Purchase Order
            </Button>
          )}
          <div className="flex gap-3">
            {po.status === "draft" && (
              <>
                <Button onClick={() => onStatusChange(po, "pending")} className="h-12 flex-1 rounded-xl">Submit for Approval</Button>
                <Button variant="outline" onClick={() => onStatusChange(po, "cancelled")} className="h-12 rounded-xl">Cancel</Button>
              </>
            )}
            {po.status === "pending" && (
              <>
                <Button onClick={() => onStatusChange(po, "approved")} className="h-12 flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700">
                  <Check className="mr-2 h-4 w-4" /> Approve
                </Button>
                <Button variant="outline" onClick={() => onStatusChange(po, "draft")} className="h-12 rounded-xl">Back to Draft</Button>
              </>
            )}
            {po.status === "approved" && (
              <Button onClick={() => onStatusChange(po, "ordered")} className="h-12 flex-1 rounded-xl bg-purple-600 hover:bg-purple-700">
                <Truck className="mr-2 h-4 w-4" /> Mark Ordered
              </Button>
            )}
            {po.status === "ordered" && (
              <Button onClick={() => onStatusChange(po, "received")} className="h-12 flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700">
                <Package className="mr-2 h-4 w-4" /> Mark Received
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DateBox({ label, value }) {
  return (
    <div className="rounded-2xl bg-secondary/40 p-4 text-center">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold text-foreground">{value ? format(new Date(value), "dd MMM yyyy") : "-"}</p>
    </div>
  );
}
