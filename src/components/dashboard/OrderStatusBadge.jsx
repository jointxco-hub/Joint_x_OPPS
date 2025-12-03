import { Badge } from "@/components/ui/badge";

const statusConfig = {
  received: { label: "Received", className: "bg-slate-100 text-slate-700" },
  materials_needed: { label: "Materials Needed", className: "bg-amber-100 text-amber-700" },
  in_production: { label: "In Production", className: "bg-blue-100 text-blue-700" },
  ready: { label: "Ready", className: "bg-emerald-100 text-emerald-700" },
  out_for_delivery: { label: "Out for Delivery", className: "bg-purple-100 text-purple-700" },
  delivered: { label: "Delivered", className: "bg-green-100 text-green-700" }
};

export default function OrderStatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig.received;
  
  return (
    <Badge className={`${config.className} font-medium border-0`}>
      {config.label}
    </Badge>
  );
}