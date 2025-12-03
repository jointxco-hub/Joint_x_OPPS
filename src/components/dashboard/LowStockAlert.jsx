import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ShoppingCart } from "lucide-react";

export default function LowStockAlert({ item, onCreatePO }) {
  const stockPercent = item.reorder_point > 0 
    ? Math.round((item.current_stock / item.reorder_point) * 100) 
    : 100;
  
  return (
    <Card className="p-4 bg-gradient-to-r from-red-50 to-orange-50 border-red-100">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-red-100 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-slate-900">{item.name}</h4>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-2 bg-red-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-red-500 rounded-full"
                style={{ width: `${Math.min(stockPercent, 100)}%` }}
              />
            </div>
            <span className="text-xs text-red-600 font-medium whitespace-nowrap">
              {item.current_stock} / {item.reorder_point} {item.unit}
            </span>
          </div>
        </div>
        <Button 
          size="sm" 
          onClick={() => onCreatePO?.(item)}
          className="bg-red-600 hover:bg-red-700"
        >
          <ShoppingCart className="w-4 h-4 mr-1" /> Reorder
        </Button>
      </div>
    </Card>
  );
}