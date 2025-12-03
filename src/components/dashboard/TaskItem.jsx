import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { MapPin, Calendar } from "lucide-react";
import { format } from "date-fns";

const locationLabels = {
  jg_electronics_randburg: "JG Electronics, Randburg",
  dtf_randburg: "DTF Printer, Randburg",
  dtf_joburg: "DTF Printer, Joburg",
  blanks_joburg: "Blanks Supplier, Joburg",
  pep_paxi_riverside: "Pep Paxi, Riverside View",
  client_location: "Client Location",
  hq: "HQ",
  other: "Other"
};

const typeColors = {
  pickup_materials: "bg-amber-100 text-amber-700",
  pickup_blanks: "bg-blue-100 text-blue-700",
  drop_for_printing: "bg-purple-100 text-purple-700",
  collect_printing: "bg-green-100 text-green-700",
  delivery: "bg-emerald-100 text-emerald-700",
  other: "bg-slate-100 text-slate-700"
};

const typeLabels = {
  pickup_materials: "Pickup Materials",
  pickup_blanks: "Pickup Blanks",
  drop_for_printing: "Drop for Printing",
  collect_printing: "Collect Printing",
  delivery: "Delivery",
  other: "Task"
};

export default function TaskItem({ task, onStatusChange }) {
  const isCompleted = task.status === "completed";
  
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${isCompleted ? 'bg-slate-50 border-slate-100' : 'bg-white border-slate-200'}`}>
      <Checkbox 
        checked={isCompleted}
        onCheckedChange={(checked) => onStatusChange?.(task.id, checked ? "completed" : "pending")}
        className="mt-1"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className={`font-medium ${isCompleted ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
            {task.title}
          </p>
          <Badge className={`${typeColors[task.type]} border-0 text-xs`}>
            {typeLabels[task.type]}
          </Badge>
        </div>
        
        {task.location && (
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <MapPin className="w-3 h-3" />
            <span>{locationLabels[task.location] || task.location}</span>
          </div>
        )}
        
        {task.due_date && (
          <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
            <Calendar className="w-3 h-3" />
            <span>{format(new Date(task.due_date), "dd MMM")}</span>
          </div>
        )}
      </div>
    </div>
  );
}