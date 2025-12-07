import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Search, Package, CheckCircle2, Truck, Clock, 
  Shirt, Calendar, ArrowRight
} from "lucide-react";
import { format } from "date-fns";

const statusSteps = [
  { key: "received", label: "Order Received", icon: Package },
  { key: "materials_needed", label: "Getting Materials", icon: Clock },
  { key: "in_production", label: "In Production", icon: Shirt },
  { key: "ready", label: "Ready", icon: CheckCircle2 },
  { key: "out_for_delivery", label: "Out for Delivery", icon: Truck },
  { key: "delivered", label: "Delivered", icon: CheckCircle2 }
];

const getStepIndex = (status) => {
  const index = statusSteps.findIndex(s => s.key === status);
  return index === -1 ? 0 : index;
};

export default function TrackOrder() {
  const [trackingCode, setTrackingCode] = useState("");
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    if (!trackingCode.trim()) return;
    
    setLoading(true);
    setError("");
    setOrder(null);

    const searchValue = trackingCode.trim().toUpperCase();

    // Try searching by tracking code first
    let orders = await base44.entities.Order.filter({
      tracking_code: searchValue
    });

    // If not found, try searching by invoice number
    if (orders.length === 0) {
      orders = await base44.entities.Order.filter({
        invoice_number: searchValue
      });
    }

    setLoading(false);

    if (orders.length > 0) {
      setOrder(orders[0]);
    } else {
      setError("No order found with this tracking code or invoice number. Please check and try again.");
    }
  };

  const currentStepIndex = order ? getStepIndex(order.status) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-2xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="text-center mb-8 pt-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-4">
            <Shirt className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Track Your Order</h1>
          <p className="text-slate-400">Enter your tracking code or invoice number</p>
        </div>

        {/* Search */}
        <Card className="bg-white/5 border-white/10 backdrop-blur-sm mb-8">
          <CardContent className="p-6">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <Input
                  placeholder="Enter tracking code or invoice number"
                  value={trackingCode}
                  onChange={(e) => setTrackingCode(e.target.value.toUpperCase())}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  className="pl-12 h-14 bg-white/10 border-white/20 text-white placeholder:text-slate-500 text-lg font-mono"
                />
              </div>
              <Button 
                onClick={handleSearch} 
                disabled={loading}
                className="h-14 px-8 bg-white text-slate-900 hover:bg-slate-100"
              >
                {loading ? "Searching..." : "Track"}
              </Button>
            </div>
            {error && (
              <p className="text-red-400 text-sm mt-3">{error}</p>
            )}
          </CardContent>
        </Card>

        {/* Order Details */}
        {order && (
          <Card className="bg-white border-0 shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-500 to-teal-500 p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-emerald-100 text-sm">Order Number</p>
                  <p className="text-2xl font-bold">{order.order_number}</p>
                </div>
                <div className="text-right">
                  <p className="text-emerald-100 text-sm">Tracking Code</p>
                  <p className="text-xl font-mono font-bold">{order.tracking_code}</p>
                </div>
              </div>
            </div>

            <CardContent className="p-6">
              {/* Progress Steps */}
              <div className="mb-8">
                <div className="relative">
                  {/* Progress Line */}
                  <div className="absolute top-5 left-5 right-5 h-0.5 bg-slate-200">
                    <div 
                      className="h-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${(currentStepIndex / (statusSteps.length - 1)) * 100}%` }}
                    />
                  </div>

                  {/* Steps */}
                  <div className="relative flex justify-between">
                    {statusSteps.map((step, index) => {
                      const isCompleted = index <= currentStepIndex;
                      const isCurrent = index === currentStepIndex;
                      const Icon = step.icon;

                      return (
                        <div key={step.key} className="flex flex-col items-center">
                          <div className={`
                            w-10 h-10 rounded-full flex items-center justify-center
                            transition-all duration-300 z-10
                            ${isCompleted 
                              ? 'bg-emerald-500 text-white' 
                              : 'bg-slate-100 text-slate-400'}
                            ${isCurrent ? 'ring-4 ring-emerald-100 scale-110' : ''}
                          `}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <p className={`
                            text-xs mt-2 text-center max-w-16
                            ${isCompleted ? 'text-emerald-600 font-medium' : 'text-slate-400'}
                          `}>
                            {step.label}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Order Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-xs text-slate-500 mb-1">Items</p>
                  <p className="font-semibold text-slate-900">{order.quantity} pieces</p>
                </div>
                {order.due_date && (
                  <div className="bg-slate-50 rounded-lg p-4">
                    <p className="text-xs text-slate-500 mb-1">Expected By</p>
                    <p className="font-semibold text-slate-900">
                      {format(new Date(order.due_date), "dd MMM yyyy")}
                    </p>
                  </div>
                )}
              </div>

              {/* Current Status Message */}
              <div className="mt-6 p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                    {React.createElement(statusSteps[currentStepIndex].icon, {
                      className: "w-5 h-5 text-emerald-600"
                    })}
                  </div>
                  <div>
                    <p className="font-semibold text-emerald-800">
                      {statusSteps[currentStepIndex].label}
                    </p>
                    <p className="text-sm text-emerald-600">
                      {currentStepIndex < statusSteps.length - 1 
                        ? `Next: ${statusSteps[currentStepIndex + 1].label}`
                        : "Your order has been delivered!"}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center mt-8 text-slate-500 text-sm">
          <p>Questions about your order?</p>
          <p>Contact us for support</p>
        </div>
      </div>
    </div>
  );
}