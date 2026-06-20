import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search, Package, CheckCircle2, Truck, Clock,
  Shirt, MapPin, X, ChevronLeft, ChevronRight,
  Image, FileText, Play, Copy, Check, AlertTriangle, MessageSquare, ExternalLink
} from "lucide-react";
import { format } from "date-fns";

const COURIERS = [
  { value: "the_courier_guy", label: "The Courier Guy", url: "https://portal.thecourierguy.co.za/track", appendTracking: false },
  { value: "courier_it", label: "Courier IT", url: "https://www.courier-it.co.za/tracking/?tracking=" },
  { value: "pep_paxi", label: "Pep Paxi", url: "https://www.paxi.co.za/track?parcelref=" },
  { value: "aramex", label: "Aramex", url: "https://www.aramex.com/tools/track?l=" },
  { value: "dhl", label: "DHL", url: "https://www.dhl.com/za-en/home/tracking.html?tracking-id=" },
  { value: "fedex", label: "FedEx", url: "https://www.fedex.com/apps/fedextrack/?tracknumbers=" },
  { value: "fastway", label: "Fastway", url: "https://www.fastway.co.za/tools/track/?number=" },
  { value: "sa_post", label: "SA Post Office", url: "https://www.postoffice.co.za/tracking?id=" },
  { value: "dawn_wing", label: "Dawn Wing", url: "https://www.dawnwing.co.za/tracking?waybill=" },
];

const buildCourierTrackingUrl = (courier, trackingNumber) => {
  if (!trackingNumber) return null;

  const rawTracking = String(trackingNumber).trim();
  if (/^https?:\/\//i.test(rawTracking)) {
    return rawTracking;
  }

  if (!courier?.url) return null;

  const encodedTracking = encodeURIComponent(rawTracking);
  if (!encodedTracking) return null;

  if (courier.url.includes("{tracking}")) {
    return courier.url.replace("{tracking}", encodedTracking);
  }

  if (courier.appendTracking === false) {
    return courier.url;
  }

  return `${courier.url}${encodedTracking}`;
};

const formatCourierLabel = (courierValue) => {
  const courier = COURIERS.find(c => c.value === courierValue);
  return courier?.label || courierValue;
};

const statusSteps = [
  { key: "confirmed", label: "Confirmed", icon: Package },
  { key: "in_production", label: "In Production", icon: Shirt },
  { key: "ready", label: "Ready", icon: CheckCircle2 },
  { key: "shipped", label: "Shipped", icon: Truck },
  { key: "delivered", label: "Delivered", icon: CheckCircle2 },
];

const PRODUCTION_DETAIL_LABELS = {
  waiting_design_assets: "Waiting for design assets",
  artwork_check: "Artwork check",
  artwork_setup: "Artwork setup",
  awaiting_client_approval: "Awaiting client approval",
  print_setup: "Print setup",
  queued_pressing: "Queued for pressing",
  pressing: "Pressing",
  queued_embroidery: "Queued for embroidery",
  embroidering: "Embroidering",
  queued_tailor: "Queued for tailor",
  at_tailor: "At tailor",
  cropping_alterations: "Cropping / alterations",
  finishing: "Finishing",
  quality_check: "Quality check",
  rework: "Rework / correction",
  waiting_stock: "Waiting on stock / blanks",
  packing: "Packing",
  custom: "Custom production update",
};

const PRODUCTION_METHOD_LABELS = {
  dtf: "DTF printing",
  vinyl: "Vinyl cutting",
  screen: "Screen printing",
  embroidery: "Embroidery",
  pressing: "Heat pressing",
  tailoring: "Tailoring",
  cropping: "Cropping / alterations",
  labeling: "Labeling / tagging",
  mixed: "Mixed production",
  custom: "Custom work",
};

const getStepIndex = (status) => {
  const i = statusSteps.findIndex(s => s.key === status);
  return i === -1 ? 0 : i;
};

const getLatestInvoiceTotal = (invoiceFiles) => {
  if (!Array.isArray(invoiceFiles)) return 0;
  return [...invoiceFiles]
    .reverse()
    .map((file) => Number(file?.invoice_total || 0))
    .find((amount) => amount > 0) || 0;
};

const formatMoney = (value) => `R${Number(value || 0).toLocaleString()}`;

const readableProductionValue = (value, labels) => {
  if (!value) return "";
  return labels[value] || String(value).replace(/_/g, " ");
};

const productionDetailCopy = (order) => {
  const detail = readableProductionValue(order?.production_detail_stage || order?.pipeline_stage, PRODUCTION_DETAIL_LABELS);
  const method = readableProductionValue(order?.production_method, PRODUCTION_METHOD_LABELS);
  const update = order?.production_client_update || "";
  if (!detail && !method && !update) return null;

  return {
    title: detail || method || "Production update",
    method,
    body: update || (detail ? `Your order is currently at ${detail.toLowerCase()}.` : "Your order is moving through production."),
  };
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
  const [trackingCode, setTrackingCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get("code") || params.get("order") || params.get("tracking") || "").toUpperCase();
  });
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mediaUrl, setMediaUrl] = useState(null);
  const [copied, setCopied] = useState(false);

  const copyTrackingLink = () => {
    const code = encodeURIComponent(order?.order_number || order?.tracking_number || order?.id || "");
    const link = `${window.location.origin}/track?order=${code}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSearch = async () => {
    if (!trackingCode.trim()) return;
    setLoading(true);
    setError("");
    setOrder(null);

    const val = trackingCode.trim().toUpperCase();

    // Normalise input the same way filenames are normalised on upload
    const valNorm = val.replace(/\s+/g, "-").replace(/[^A-Z0-9\-]/g, "");

    const { data, error: lookupError } = await supabase.rpc("get_public_order_tracking", {
      p_lookup: valNorm || val,
      p_tenant_slug: "joint-x",
    });
    if (lookupError) setError("We could not look up that order right now.");
    else if (data) setOrder(data);
    else setError("No order found with this tracking code or invoice number. Please check and try again.");
    
    setLoading(false);
  };

  useEffect(() => {
    if (trackingCode.trim()) {
      handleSearch();
    }
  }, []);

  const currentStepIndex = order ? getStepIndex(order.status) : 0;
  const courier = order ? COURIERS.find(c => c.value === order.courier) : null;
  const courierLabel = order?.courier ? formatCourierLabel(order.courier) : "";
  const trackingUrl = order ? buildCourierTrackingUrl(courier, order.tracking_number) : null;
  const portalFiles = order?.portal_show_files
    ? (Array.isArray(order.portal_visible_file_urls) ? order.portal_visible_file_urls : [])
    : [];
  const invoiceTotal = getLatestInvoiceTotal(order?.invoice_files);
  const orderTotal = Number(invoiceTotal || order?.total_amount || 0);
  const amountPaid = Number(order?.amount_paid ?? order?.deposit_paid ?? 0);
  const balanceDue = Math.max(orderTotal - amountPaid, 0);
  const isPaidInFull = orderTotal > 0 && amountPaid >= orderTotal;
  const productionDetail = order ? productionDetailCopy(order) : null;

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
          <p className="text-white/50 text-sm">Enter your order number, tracking code, or invoice number</p>
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
                className="pl-11 h-12 rounded-xl font-mono border-white/15 placeholder:text-white/30"
                style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "white" }}
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
              {orderTotal > 0 && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <p className="text-white/40 text-xs mb-1">Invoice Value</p>
                  <p className="text-white font-semibold">{formatMoney(orderTotal)}</p>
                  {isPaidInFull && (
                    <p className="text-[#4ade80] text-xs font-semibold mt-1">Paid in full</p>
                  )}
                </div>
              )}
              {order.courier && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <p className="text-white/40 text-xs mb-1">Courier</p>
                  <p className="text-white font-semibold">{courierLabel}</p>
                </div>
              )}
              {order.tracking_number && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <p className="text-white/40 text-xs mb-1">Tracking #</p>
                  <p className="text-white font-semibold font-mono text-sm">{order.tracking_number}</p>
                </div>
              )}
              {order.pep_code && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <p className="text-white/40 text-xs mb-1">PEP / Courier Code</p>
                  <p className="text-white font-semibold font-mono text-sm">{order.pep_code}</p>
                </div>
              )}
            </div>

            {trackingUrl && (
              <a
                href={trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-[#1a7a5e]/15 border border-[#1a7a5e]/30 rounded-xl p-3.5 text-[#4ade80] hover:bg-[#1a7a5e]/25 transition-all text-sm font-medium mb-4"
              >
                <ExternalLink className="w-4 h-4" />
                Track with {courierLabel || "courier"}
              </a>
            )}

            {productionDetail && (
              <div className="bg-[#1a7a5e]/10 border border-[#1a7a5e]/25 rounded-xl p-4 mb-4">
                <p className="text-[#4ade80] text-xs font-semibold uppercase tracking-wide mb-1">Production detail</p>
                <p className="text-white font-semibold text-sm">{productionDetail.title}</p>
                {productionDetail.method && (
                  <p className="text-white/50 text-xs mt-0.5">{productionDetail.method}</p>
                )}
                <p className="text-white/80 text-sm leading-relaxed mt-2">{productionDetail.body}</p>
              </div>
            )}

            {/* Portal: message from team */}
            {order.portal_message && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4 flex gap-3">
                <MessageSquare className="w-4 h-4 text-[#4ade80] flex-shrink-0 mt-0.5" />
                <p className="text-white/90 text-sm leading-relaxed">{order.portal_message}</p>
              </div>
            )}

            {/* Portal: attention items */}
            {Array.isArray(order.portal_attention_items) && order.portal_attention_items.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-4">
                <p className="text-amber-300 text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> Action Required
                </p>
                <div className="space-y-1.5">
                  {order.portal_attention_items.map((item, i) => (
                    <p key={i} className="text-amber-200 text-sm">• {item}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Portal: outstanding balance */}
            {order.portal_show_balance && orderTotal > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-white/40 text-xs mb-1">Invoice</p>
                  <p className="text-white font-semibold">{formatMoney(orderTotal)}</p>
                </div>
                <div>
                  <p className="text-white/40 text-xs mb-1">Amount Paid</p>
                  <p className="text-[#4ade80] font-semibold">
                    {formatMoney(Math.min(orderTotal, amountPaid))}
                  </p>
                </div>
                <div>
                  <p className="text-white/40 text-xs mb-1">Balance</p>
                  <p className={`font-semibold ${balanceDue > 0 ? "text-amber-300" : "text-[#4ade80]"}`}>
                    {balanceDue > 0 ? formatMoney(balanceDue) : "Paid in full"}
                  </p>
                </div>
              </div>
            )}

            {/* Design Files */}
            {portalFiles.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4">
                <p className="text-white/40 text-xs mb-3">Files &amp; Approvals</p>
                <div className="flex flex-wrap gap-2">
                  {portalFiles.map((url, i) => (
                    <FileThumb key={i} url={url} onClick={setMediaUrl} />
                  ))}
                </div>
              </div>
            )}


            {/* Current Step Message */}
            <div className="bg-[#1a7a5e]/15 border border-[#1a7a5e]/30 rounded-xl p-4 mb-3">
              <p className="text-[#4ade80] font-medium text-sm">
                {currentStepIndex < statusSteps.length - 1
                  ? `Currently: ${statusSteps[currentStepIndex].label} · Next: ${statusSteps[currentStepIndex + 1].label}`
                  : "Your order has been delivered! 🎉"}
              </p>
            </div>

            {/* Share tracking link */}
            <button
              onClick={copyTrackingLink}
              className="w-full flex items-center justify-center gap-2 bg-white/5 border border-white/10 rounded-xl p-3.5 text-white/60 hover:text-white hover:bg-white/10 transition-all text-sm font-medium"
            >
              {copied ? <Check className="w-4 h-4 text-[#4ade80]" /> : <Copy className="w-4 h-4" />}
              {copied ? "Link copied — paste into WhatsApp" : "Copy tracking link for client"}
            </button>
          </div>
        )}

        <div className="text-center mt-8 text-white/25 text-xs">
          Questions? Contact Joint X for support.
        </div>
      </div>
    </div>
  );
}
