import { Badge } from "@/components/ui/badge";

const statusStyles = {
  draft: "bg-secondary text-muted-foreground border-border",
  approved: "bg-primary/10 text-primary border-primary/20",
  exported: "bg-blue-50 text-blue-700 border-blue-100",
  imported_to_zoho: "bg-purple-50 text-purple-700 border-purple-100",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-100",
  partially_paid: "bg-amber-50 text-amber-700 border-amber-100",
  overdue: "bg-red-50 text-red-700 border-red-100",
  void: "bg-slate-100 text-slate-600 border-slate-200",
};

const labels = {
  draft: "Draft",
  approved: "Approved",
  exported: "Exported",
  imported_to_zoho: "Imported to Zoho",
  paid: "Paid",
  partially_paid: "Partially paid",
  overdue: "Overdue",
  void: "Void",
};

export default function InvoiceStatusBadge({ status }) {
  const value = status || "draft";
  return (
    <Badge variant="outline" className={`rounded-full ${statusStyles[value] || statusStyles.draft}`}>
      {labels[value] || value.replace(/_/g, " ")}
    </Badge>
  );
}
