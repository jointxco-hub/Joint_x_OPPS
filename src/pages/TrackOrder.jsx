import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Search, Package, CheckCircle2, Truck, Clock, 
  Shirt, MapPin, X, ChevronLeft, ChevronRight,
  Image, FileText, Play
} from "lucide-react";
import { format } from "date-fns";

const statusSteps = [
  { key: "confirmed", label: "Confirmed", icon: Package },
  { key: "in_production", label: "In Production", icon: Shirt },
  { key: "ready", label: "Ready", icon: CheckCircle2 },
  { key: "shipped", label: "Shipped", icon: Truck },
  { key: "delivered", label: "Delivered", icon: CheckCircle2 },
];

const getStepIndex = (status) => {
  const i = statusSteps.findIndex(s => s.key === status);
  return i === -1 ? 0 : i;
};

function MediaViewer({ url, onClose }) {
  const isImage = /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url);
  const isVideo = /\.(mp4|mov|webm|avi)(\?|$)/i.test(url);
  const isPDF = /\.pdf(\?|$)/i.test(url);

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-all z-10">
        <X className="w-5 h-5" />
      </button>
      <div className="max-w-4xl max-h-[85vh] w-full" onClick={e => e.stopPropagation()}>
        {isImage && <img src={url} alt="Preview" className="max-w-full max-h-[85vh] object-contain rounded-2xl mx-auto" />}
        {isVideo && <video src={url} controls autoPlay className="max-w-full max-h-[85vh] rounded-2xl mx-auto" />}
        {isPDF && <iframe src={url} title="PDF" className="w-full h-[85vh] rounded-2xl" />}
        {!isImage && !isVideo && !isPDF && (
          <div className="bg-white/10 rounded-2xl p-8 text-center text-white">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-60" />
            <p className="text-sm opacity-80 mb-4">Preview not available</p>
            <a href={url} target="_blank" rel="noreferrer" className="text-primary underline text-sm">Open file</a>
          </div>
        )}
      </div>
    </div>
  );
}

function FileThumb({ url, onClick }) {
  const isImage = /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url);
  const isVideo = /\.(mp4|mov|webm|avi)(\?|$)/i.test(url);
  return (
    <button
      onClick={() => onClick(url)}
      className="w-16 h-16 rounded-xl overflow-hidden border border-white/20 flex items-center justify-center bg-white/5 hover:bg-white/10 transition-all flex-shrink-0"
    >
      {isImage ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : isVideo ? (
        <Play className="w-6 h-6 text-white/70" />
      ) : (
        <FileText className="w-6 h-6 text-white/70" />
      )}
    </button>
  );
}

export default function TrackOrder() {
  const [trackingCode, setTrackingCode] = useState("");
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mediaUrl, setMediaUrl] = useState(null);

  const handleSearch = async () => {
    if (!trackingCode.trim()) return;
    setLoading(true);
    setError("");
    setOrder(null);

    const val = trackingCode.trim().toUpperCase();
    
    // Search across multiple fields
    let orders = await dataClient.entities.Order.list();
    const found = orders.find(o => 
      o.tracking_number?.toUpperCase() === val ||
      o.order_number?.toUpperCase() === val ||
      o.id === val
    );
    
    if (found) {
      setOrder(found);
    } else {
      // Try ClientOrder as fallback
      const clientOrders = await dataClient.entities.ClientOrder.list();
      const clientFound = clientOrders.find(co => co.tracking_code?.toUpperCase() === val);
      if (clientFound) {
        setOrder(clientFound);
      } else {
        setError("No order found with this tracking code or invoice number. Please check and try again.");
      }
    }
    
    setLoading(false);
  };

  const currentStepIndex = order ? getStepIndex(order.status) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0d1117] via-[#111827] to-[#0d1117]">
      {mediaUrl && <MediaViewer url={mediaUrl} onClose={() => setMediaUrl(null)} />}

      <div className="max-w-lg mx-auto p-4 md:p-8">
        {/* Brand Header */}
        <div className="text-center mb-10 pt-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5 relative">
            <div className="absolute inset-0 rounded-2xl bg-white/5 border border-white/10" />
            <div className="relative w-8 h-8">
              <span className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-[#1a7a5e]" />
              <span className="absolute bottom-0 left-0 w-3.5 h-3.5 rounded-full bg-[#b83a1a]" />
              <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-[#c0a4e0]" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Track Your Order</h1>
          <p className="text-white/50 text-sm">Enter your order number or tracking code</p>
        </div>

        {/* Search */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6 backdrop-blur-sm">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <Input
                placeholder="e.g. JX-001 or TRACK123"
                value={trackingCode}
                onChange={e => setTrackingCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                className="pl-11 h-12 bg-white/8 border-white/15 text-white placeholder:text-white/30 rounded-xl font-mono"
              />
            </div>
            <Button onClick={handleSearch} disabled={loading} className="h-12 px-6 bg-[#1a7a5e] hover:bg-[#1a7a5e]/90 text-white rounded-xl font-medium">
              {loading ? "..." : "Track"}
            </Button>
          </div>
          {error && <p className="text-red-400 text-sm mt-3 text-center">{error}</p>}
        </div>

        {/* Order Result */}
        {order && (
          <div className="animate-fade-in">
            {/* Status Card */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-4 backdrop-blur-sm">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <p className="text-white/40 text-xs mb-1">Order</p>
                  <p className="text-white font-bold text-lg">{order.order_number}</p>
                  {order.client_name && <p className="text-white/60 text-sm mt-0.5">{order.client_name}</p>}
                </div>
                <div className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                  order.status === "delivered" ? "bg-[#1a7a5e]/20 text-[#4ade80]" :
                  order.status === "in_production" ? "bg-orange-500/20 text-orange-300" :
                  order.status === "shipped" ? "bg-purple-500/20 text-purple-300" :
                  order.status === "cancelled" ? "bg-red-500/20 text-red-300" :
                  "bg-white/10 text-white/70"
                }`}>
                  {order.status?.replace(/_/g, " ")}
                </div>
              </div>

              {/* Progress Track */}
              <div className="relative">
                <div className="absolute top-4 left-4 right-4 h-px bg-white/10">
                  <div
                    className="h-full bg-[#1a7a5e] transition-all duration-700"
                    style={{ width: `${(currentStepIndex / (statusSteps.length - 1)) * 100}%` }}
                  />
                </div>
                <div className="relative flex justify-between">
                  {statusSteps.map((step, i) => {
                    const done = i <= currentStepIndex;
                    const current = i === currentStepIndex;
                    const Icon = step.icon;
                    return (
                      <div key={step.key} className="flex flex-col items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center z-10 transition-all ${
                          done ? "bg-[#1a7a5e]" : "bg-white/10"
                        } ${current ? "ring-4 ring-[#1a7a5e]/30 scale-110" : ""}`}>
                          <Icon className={`w-4 h-4 ${done ? "text-white" : "text-white/30"}`} />
                        </div>
                        <p className={`text-xs text-center leading-tight max-w-12 ${done ? "text-white/80" : "text-white/25"}`}>
                          {step.label}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {order.due_date && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <p className="text-white/40 text-xs mb-1">Expected By</p>
                  <p className="text-white font-semibold">{format(new Date(order.due_date), "dd MMM yyyy")}</p>
                </div>
              )}
              {order.total_amount && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <p className="text-white/40 text-xs mb-1">Order Value</p>
                  <p className="text-white font-semibold">R{order.total_amount?.toLocaleString()}</p>
                </div>
              )}
              {order.courier && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <p className="text-white/40 text-xs mb-1">Courier</p>
                  <p className="text-white font-semibold">{order.courier}</p>
                </div>
              )}
              {order.tracking_number && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <p className="text-white/40 text-xs mb-1">Tracking #</p>
                  <p className="text-white font-semibold font-mono text-sm">{order.tracking_number}</p>
                </div>
              )}
            </div>

            {/* Design Files */}
            {order.file_urls?.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4">
                <p className="text-white/40 text-xs mb-3">Design Files</p>
                <div className="flex flex-wrap gap-2">
                  {order.file_urls.map((url, i) => (
                    <FileThumb key={i} url={url} onClick={setMediaUrl} />
                  ))}
                </div>
              </div>
            )}

            {/* Current Step Message */}
            <div className="bg-[#1a7a5e]/15 border border-[#1a7a5e]/30 rounded-xl p-4">
              <p className="text-[#4ade80] font-medium text-sm">
                {currentStepIndex < statusSteps.length - 1
                  ? `Currently: ${statusSteps[currentStepIndex].label} · Next: ${statusSteps[currentStepIndex + 1].label}`
                  : "Your order has been delivered! 🎉"}
              </p>
            </div>
          </div>
        )}

        <div className="text-center mt-8 text-white/25 text-xs">
          Questions? Contact Joint X for support.
        </div>
      </div>
    </div>
  );
}
