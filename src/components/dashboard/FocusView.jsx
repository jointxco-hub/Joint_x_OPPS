import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Package, ShoppingCart, AlertTriangle, Truck, 
  ClipboardList, X
} from "lucide-react";

const FOCUS_MODES = [
  { id: "all", name: "All", icon: Package, color: "bg-slate-600" },
  { id: "orders", name: "Orders", icon: Package, color: "bg-blue-600" },
  { id: "urgent", name: "Urgent", icon: AlertTriangle, color: "bg-red-600" },
  { id: "delivery", name: "Delivery", icon: Truck, color: "bg-emerald-600" },
  { id: "tasks", name: "Tasks", icon: ClipboardList, color: "bg-orange-600" },
  { id: "purchasing", name: "Purchasing", icon: ShoppingCart, color: "bg-purple-600" }
];

export default function FocusView({ activeMode, onModeChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {FOCUS_MODES.map(mode => {
        const Icon = mode.icon;
        const isActive = activeMode === mode.id;
        
        return (
          <Button
            key={mode.id}
            variant={isActive ? "default" : "outline"}
            size="sm"
            onClick={() => onModeChange(mode.id)}
            className={isActive ? `${mode.color} border-0` : ''}
          >
            <Icon className="w-4 h-4 mr-1" />
            {mode.name}
          </Button>
        );
      })}
    </div>
  );
}