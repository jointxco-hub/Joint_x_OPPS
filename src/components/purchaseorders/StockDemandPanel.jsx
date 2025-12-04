import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Package, TrendingUp, Check } from "lucide-react";

export default function StockDemandPanel({ orders, inventory, purchaseOrders }) {
  // Calculate demand from orders
  const demandByProduct = {};
  
  orders?.forEach(order => {
    if (order.status === 'delivered') return;
    
    // Parse order details for product demands
    const qty = order.quantity || 0;
    const printType = order.print_type || '';
    const blankType = order.blank_type || '';
    
    // Map to product categories
    if (blankType.toLowerCase().includes('jv1') || blankType.toLowerCase().includes('180')) {
      demandByProduct['JV1 T-Shirt'] = (demandByProduct['JV1 T-Shirt'] || 0) + qty;
    } else if (blankType.toLowerCase().includes('jet') || blankType.toLowerCase().includes('220')) {
      demandByProduct['JET T-Shirt'] = (demandByProduct['JET T-Shirt'] || 0) + qty;
    } else if (blankType.toLowerCase().includes('jhg') || blankType.toLowerCase().includes('300') || blankType.toLowerCase().includes('heavy')) {
      demandByProduct['JHG T-Shirt'] = (demandByProduct['JHG T-Shirt'] || 0) + qty;
    } else if (blankType.toLowerCase().includes('hoodie')) {
      demandByProduct['Hoodie'] = (demandByProduct['Hoodie'] || 0) + qty;
    } else if (qty > 0) {
      demandByProduct['Unspecified Blanks'] = (demandByProduct['Unspecified Blanks'] || 0) + qty;
    }
  });

  // Calculate incoming stock from POs
  const incomingByProduct = {};
  
  purchaseOrders?.forEach(po => {
    if (!['approved', 'ordered', 'pending'].includes(po.status)) return;
    
    po.items?.forEach(item => {
      const name = item.name || '';
      incomingByProduct[name] = (incomingByProduct[name] || 0) + (item.quantity || 0);
    });
  });

  // Cross-check with inventory
  const stockAnalysis = [];
  
  inventory?.forEach(item => {
    const name = item.name || '';
    const currentStock = item.current_stock || 0;
    
    // Find matching demand
    let demand = 0;
    Object.entries(demandByProduct).forEach(([key, qty]) => {
      if (name.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(name.split(' ')[0].toLowerCase())) {
        demand += qty;
      }
    });

    // Find incoming
    let incoming = 0;
    Object.entries(incomingByProduct).forEach(([key, qty]) => {
      if (name.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(name.split(' ')[0].toLowerCase())) {
        incoming += qty;
      }
    });

    const availableAfterOrders = currentStock - demand + incoming;
    const isShortage = availableAfterOrders < 0;
    const isLowStock = item.reorder_point && currentStock <= item.reorder_point;
    const isBlack = name.toLowerCase().includes('black') || name.toLowerCase().includes('blk');

    if (demand > 0 || isLowStock || isShortage) {
      stockAnalysis.push({
        name,
        sku: item.sku,
        currentStock,
        demand,
        incoming,
        availableAfterOrders,
        isShortage,
        isLowStock,
        isBlack,
        reorderPoint: item.reorder_point
      });
    }
  });

  // Sort by urgency
  stockAnalysis.sort((a, b) => {
    if (a.isShortage && !b.isShortage) return -1;
    if (!a.isShortage && b.isShortage) return 1;
    if (a.isBlack && a.isShortage) return -1;
    return a.availableAfterOrders - b.availableAfterOrders;
  });

  const shortages = stockAnalysis.filter(s => s.isShortage);
  const lowStock = stockAnalysis.filter(s => s.isLowStock && !s.isShortage);

  if (stockAnalysis.length === 0) {
    return (
      <Card className="border-0 bg-gradient-to-br from-emerald-50 to-teal-50">
        <CardContent className="p-6 text-center">
          <Check className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <p className="font-medium text-emerald-700">Stock levels healthy</p>
          <p className="text-sm text-emerald-600 mt-1">No shortages detected for current orders</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Critical Shortages */}
      {shortages.length > 0 && (
        <Card className="border-0 bg-gradient-to-br from-red-50 to-orange-50 shadow-lg">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" />
              Stock Shortages ({shortages.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {shortages.map((item, i) => (
              <div key={i} className="bg-white/60 rounded-2xl p-4 backdrop-blur-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-900">{item.name}</p>
                      {item.isBlack && (
                        <Badge className="bg-slate-900 text-white text-xs">BLACK</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{item.sku}</p>
                  </div>
                  <Badge className="bg-red-100 text-red-700 border-0">
                    Need {Math.abs(item.availableAfterOrders)}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
                  <div className="text-center bg-white/50 rounded-xl p-2">
                    <p className="text-slate-500 text-xs">In Stock</p>
                    <p className="font-bold">{item.currentStock}</p>
                  </div>
                  <div className="text-center bg-white/50 rounded-xl p-2">
                    <p className="text-slate-500 text-xs">Needed</p>
                    <p className="font-bold text-red-600">{item.demand}</p>
                  </div>
                  <div className="text-center bg-white/50 rounded-xl p-2">
                    <p className="text-slate-500 text-xs">Incoming</p>
                    <p className="font-bold text-blue-600">{item.incoming}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Low Stock Warning */}
      {lowStock.length > 0 && (
        <Card className="border-0 bg-gradient-to-br from-amber-50 to-yellow-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700">
              <Package className="w-5 h-5" />
              Low Stock ({lowStock.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {lowStock.map((item, i) => (
              <div key={i} className="flex items-center justify-between bg-white/60 rounded-xl p-3">
                <div>
                  <p className="font-medium text-sm">{item.name}</p>
                  <p className="text-xs text-slate-500">
                    {item.currentStock} in stock • Reorder at {item.reorderPoint}
                  </p>
                </div>
                <Badge className="bg-amber-100 text-amber-700 border-0">
                  {item.incoming > 0 ? `${item.incoming} coming` : 'Reorder'}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Demand Summary */}
      <Card className="border-0 bg-gradient-to-br from-slate-50 to-slate-100">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-slate-600" />
            Order Demand Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(demandByProduct).map(([product, qty]) => (
              <div key={product} className="bg-white rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-slate-900">{qty}</p>
                <p className="text-xs text-slate-500">{product}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}