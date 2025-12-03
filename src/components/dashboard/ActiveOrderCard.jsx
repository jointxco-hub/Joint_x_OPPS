import { Card } from "@/components/ui/card";
import { Calendar, User, Shirt } from "lucide-react";
import { format } from "date-fns";
import OrderStatusBadge from "./OrderStatusBadge";

const printTypeLabels = {
  vinyl_videoflex: "Vinyl (Videoflex)",
  vinyl_flock: "Vinyl (Flock)",
  vinyl_silicon: "Vinyl (Silicon)",
  dtf_randburg: "DTF (Randburg)",
  dtf_joburg: "DTF (Joburg)"
};

export default function ActiveOrderCard({ order, onClick }) {
  return (
    <Card 
      className="p-4 bg-white border-0 shadow-sm hover:shadow-md transition-all cursor-pointer"
      onClick={() => onClick?.(order)}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-semibold text-slate-900">{order.order_number}</p>
          <p className="text-sm text-slate-500">{order.client_name}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>
      
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-slate-600">
          <Shirt className="w-4 h-4" />
          <span>{order.quantity}x {printTypeLabels[order.print_type] || order.print_type}</span>
        </div>
        {order.due_date && (
          <div className="flex items-center gap-2 text-slate-600">
            <Calendar className="w-4 h-4" />
            <span>Due: {format(new Date(order.due_date), "dd MMM yyyy")}</span>
          </div>
        )}
      </div>
      
      {order.quoted_price && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between items-center">
          <span className="text-sm text-slate-500">Quoted</span>
          <span className="font-semibold text-slate-900">R{order.quoted_price.toLocaleString()}</span>
        </div>
      )}
    </Card>
  );
}