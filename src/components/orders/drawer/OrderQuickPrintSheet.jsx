import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSignedFileUrl } from "@/lib/privateFiles";
import { computeImageReadiness } from "@/lib/printReadiness";
import { dataClient } from "@/api/dataClient";
import FileLightbox from "@/components/files/FileLightbox";
import { buildLightboxItems, resolveLightboxIndex } from "@/lib/filePresentation";
import { buildOrderPrimaryImageGallery, resolveOrderPrimaryImage } from "@/lib/orderPrimaryImage";

const PRINT_SIGNED_URL_TTL_SECONDS = 1800;

const statusConfig = {
  confirmed: { label: "Confirmed", color: "bg-primary/10 text-primary" },
  in_production: { label: "In Production", color: "bg-purple-100 text-purple-700" },
  ready: { label: "Ready", color: "bg-green-100 text-green-700" },
  shipped: { label: "Shipped", color: "bg-teal-100 text-teal-700" },
  delivered: { label: "Delivered", color: "bg-slate-100 text-slate-600" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-700" },
};

export default function OrderQuickPrintSheet({ type, order, payments, totalPaid, balance, onClose }) {
  const invoices = Array.isArray(order.invoice_files) ? order.invoice_files : [];
  const products = Array.isArray(order.products) ? order.products : [];
  const printedAt = new Date().toLocaleString();
  const completedPayments = (Array.isArray(payments) ? payments : []).filter((payment) => payment.status === "completed");
  const showMockups = type !== "invoices";
  const [resolvedImages, setResolvedImages] = useState({});
  // { files, index } | null. files/index are raw canonical refs built from
  // the shared Phase 1B.2 primary-image gallery via filePresentation.js
  // helpers - never the print view's resolved signed URLs, and never a
  // persisted ClientAsset id (preserveIdentity: false), matching
  // Production Summary's gallery.
  const [printImagePreview, setPrintImagePreview] = useState(null);

  // Canonical ClientAsset context behind this order's current files -
  // never client_assets.order_id. Same batched, read-only RPC Production
  // Summary and OrderFilesTab use, so all three surfaces resolve the same
  // primary image the same way. Required whenever the order has a client
  // (even with no explicit pin - an unpinned client-linked order may still
  // have a canonical Mockups asset that outranks the product/order-file
  // fallback, and until context arrives the resolver can't know that).
  const contextRequired = Boolean(order.client_id);
  const {
    data: primaryImageContext = [],
    isLoading: primaryImageContextLoading,
    isError: primaryImageContextError,
    refetch: refetchPrimaryImageContext,
  } = useQuery({
    queryKey: ["orderPrimaryImageContext", order.id],
    queryFn: async () => dataClient.files.getOrderPrimaryImageContext([order.id]),
    enabled: Boolean(order.id) && contextRequired,
    staleTime: 15_000,
  });
  const contextLoaded = !contextRequired || (!primaryImageContextLoading && !primaryImageContextError);

  const primaryResolution = resolveOrderPrimaryImage(order, primaryImageContext);
  // A pin exists but didn't resolve to "explicit" (asset no longer valid/
  // linked) once context has actually, successfully loaded - the resolver
  // already fell back safely, this just surfaces that to staff rather
  // than silently printing a different image than what they think is
  // pinned, or treating the order as fully ready when it isn't.
  const explicitPrimaryUnresolved = Boolean(order.primary_image_asset_id)
    && contextLoaded
    && primaryResolution.source !== "explicit";

  // The actual printed image cards AND the click-to-preview lightbox
  // collection both come from the same shared Phase 1B.2 primary-image
  // gallery - primary first, wherever it actually lives (canonical
  // Mockups, product fallback, any other order image), never restricted
  // to a local "mockups folder or bust" list. Without this, an explicit
  // primary or product-fallback image outside the local Mockups folder
  // could appear first in the on-screen lightbox while being completely
  // absent from the printed A4 output.
  const productionImageRefs = showMockups ? buildOrderPrimaryImageGallery(order, primaryImageContext) : [];
  const imageTargetsKey = productionImageRefs.join("\n");

  const openImagePreview = (clickedUrl) => {
    const files = buildLightboxItems(productionImageRefs, { preserveIdentity: false });
    setPrintImagePreview({ files, index: resolveLightboxIndex(files, clickedUrl) });
  };

  useEffect(() => {
    if (!imageTargetsKey) {
      setResolvedImages({});
      return undefined;
    }
    const targets = imageTargetsKey.split("\n");
    let cancelled = false;
    setResolvedImages((prev) => {
      const next = {};
      targets.forEach((ref) => {
        next[ref] = prev[ref] || { status: "loading", url: "" };
      });
      return next;
    });
    targets.forEach((ref) => {
      getSignedFileUrl(ref, { expiresIn: PRINT_SIGNED_URL_TTL_SECONDS })
        .then((url) => {
          if (cancelled) return;
          // The signed URL is browser-loadable, but not yet proven loaded -
          // the <img> below still has to fire onLoad before this is "ready".
          setResolvedImages((prev) => (prev[ref]?.status === "ready" ? prev : { ...prev, [ref]: { status: "loading", url } }));
        })
        .catch(() => {
          if (cancelled) return;
          setResolvedImages((prev) => ({ ...prev, [ref]: { status: "error", url: "" } }));
        });
    });
    return () => { cancelled = true; };
  }, [imageTargetsKey]);

  const handleImageLoaded = (ref, url) => {
    setResolvedImages((prev) => ({ ...prev, [ref]: { status: "ready", url } }));
  };
  const handleImageFailed = (ref) => {
    setResolvedImages((prev) => ({ ...prev, [ref]: { status: "error", url: "" } }));
  };

  const { pendingCount: pendingImageCount, failedCount: failedImageCount, ready: imageResolutionReady } = computeImageReadiness(
    productionImageRefs.map((ref) => ({ key: ref, ref })),
    Object.fromEntries(productionImageRefs.map((ref) => [ref, resolvedImages[ref] ? { ref, status: resolvedImages[ref].status } : null]))
  );
  // Print must never enable while: the canonical context a client-linked
  // order needs is still loading or failed to load (never just when a
  // pin exists - an unpinned order can still have a canonical Mockups
  // asset outranking whatever fallback is showing right now), or an
  // explicit primary exists but couldn't be resolved after a successful
  // load. A lower-priority fallback must never quietly print as if it
  // were the verified, fully-resolved production image.
  const printReady = imageResolutionReady && contextLoaded && !explicitPrimaryUnresolved;

  const title = type === "invoices"
    ? "Invoice Printout"
    : type === "mockups"
      ? "Mockup Printout"
      : "Order Summary";

  const productRows = products.length ? products : [{ name: order.notes || "Order setup", quantity: "", size: "", color: "" }];

  return (
    <>
    <div className="fixed inset-0 z-[95] bg-black/30 p-4 print:static print:bg-white print:p-0">
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .order-quick-print, .order-quick-print * { visibility: visible !important; }
          .order-quick-print {
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            max-width: none !important;
            box-shadow: none !important;
            border: 0 !important;
            background: #fff !important;
            color: #111 !important;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          .order-quick-print-actions { display: none !important; }
          .order-print-header,
          .order-print-section,
          .order-print-card,
          .order-print-metric {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .order-print-card img {
            max-height: 180mm;
          }
          a { color: #111 !important; text-decoration: none !important; }
          /* Screen-only click affordance on mockup/production images -
             the printed A4 output must show a plain static image. */
          .order-print-image-trigger {
            cursor: default !important;
            pointer-events: none !important;
          }
          .order-print-image-trigger:focus,
          .order-print-image-trigger:focus-visible {
            outline: none !important;
            box-shadow: none !important;
          }
          /* The FileLightbox gallery is screen-only - never part of the
             printed document, even if left open. */
          .order-quick-print-lightbox {
            display: none !important;
          }
          /* Staff-facing resolution warning - never part of the customer
             printed document. */
          .order-print-primary-warning {
            display: none !important;
          }
        }
      `}</style>
      <div className="order-quick-print mx-auto flex max-h-[92vh] max-w-4xl flex-col overflow-hidden rounded-2xl bg-card shadow-apple-xl print:max-h-none print:overflow-visible print:rounded-none">
        <div className="order-quick-print-actions flex items-center justify-between border-b border-border p-4">
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">A4-friendly browser print for production use.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => window.print()} disabled={!printReady} className="rounded-xl">
              <Printer className="mr-2 h-4 w-4" />
              {printReady ? "Print" : "Preparing images..."}
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground hover:text-foreground"
              aria-label="Close printout"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-6 print:overflow-visible print:p-8">
          <header className="order-print-header mb-6 border-b border-zinc-300 pb-4 print:mb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Joint X / OPPS</p>
                <h1 className="mt-1 text-2xl font-bold text-zinc-950">{title}</h1>
                <p className="mt-1 text-sm text-zinc-600">Order #{order.order_number || order.id}</p>
              </div>
              <div className="text-left text-sm text-zinc-700 sm:text-right">
                <p>Printed {printedAt}</p>
                <p className="font-semibold text-zinc-950">{order.client_name || "Client"}</p>
              </div>
            </div>
          </header>

          <OrderPrintSection title="Client & Delivery">
            <OrderPrintRow label="Client" value={order.client_name} />
            <OrderPrintRow label="WhatsApp Name" value={order.whatsapp_name} />
            <OrderPrintRow label="Saved Contact" value={order.saved_contact_name} />
            <OrderPrintRow label="Email" value={order.client_email} />
            <OrderPrintRow label="Order" value={order.order_number} />
            <OrderPrintRow label="Status" value={statusConfig[order.status]?.label || order.status} />
            <OrderPrintRow label="Courier" value={order.courier} />
            <OrderPrintRow label="PEP / Courier Code" value={order.pep_code} />
            <OrderPrintRow label="Delivery Note" value={order.delivery_note} />
          </OrderPrintSection>

          {type !== "mockups" && (
            <OrderPrintSection title="Order Summary">
              <div className="space-y-2">
                {productRows.map((product, index) => (
                  <div key={`${product.name || product.title || "product"}-${index}`} className="order-print-card rounded-lg border border-zinc-200 p-3 print:p-2.5">
                    <p className="font-semibold text-zinc-950">{product.name || product.title || "Product"}</p>
                    <div className="mt-1 grid gap-1 text-sm text-zinc-700 sm:grid-cols-4">
                      <span>Qty: {product.quantity || product.qty || "-"}</span>
                      <span>Size: {formatInlineValue(product.size || product.sizes)}</span>
                      <span>Colour: {formatInlineValue(product.color || product.colour)}</span>
                      <span>Total: {order.total_amount ? formatCurrency(order.total_amount) : "-"}</span>
                    </div>
                    {(product.print_method || product.print || product.notes) && (
                      <p className="mt-2 text-sm text-zinc-700">{product.print_method || product.print || product.notes}</p>
                    )}
                    {formatProductOptions(product.selected_print_options || product.print_options || product.printOptions) && (
                      <p className="mt-2 text-sm text-emerald-800">
                        <strong>Print:</strong> {formatProductOptions(product.selected_print_options || product.print_options || product.printOptions)}
                      </p>
                    )}
                    {formatProductOptions(product.selected_addons || product.addons || product.add_ons) && (
                      <p className="mt-1 text-sm text-amber-800">
                        <strong>Add-ons:</strong> {formatProductOptions(product.selected_addons || product.addons || product.add_ons)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </OrderPrintSection>
          )}

          {type !== "mockups" && (
            <OrderPrintSection title="Payment / Invoice Status">
              <div className="grid gap-3 sm:grid-cols-3">
                <OrderPrintMetric label="Order / Invoice" value={formatCurrency(order.total_amount)} />
                <OrderPrintMetric label="Paid" value={formatCurrency(totalPaid)} />
                <OrderPrintMetric label="Balance" value={formatCurrency(balance)} tone={balance > 0 ? "warn" : "ok"} />
              </div>
              {completedPayments.length > 0 && (
                <div className="mt-3 space-y-1 text-sm text-zinc-700">
                  {completedPayments.map((payment) => (
                    <p key={payment.id || `${payment.amount}-${payment.payment_date}`}>
                      {formatCurrency(payment.amount)} - {(payment.method || payment.payment_method || "payment").replace(/_/g, " ")} - {payment.payment_date || payment.date || ""}
                    </p>
                  ))}
                </div>
              )}
            </OrderPrintSection>
          )}

          {showMockups && (
            <OrderPrintSection title="Mockups / Production Images">
              {contextRequired && primaryImageContextLoading && (
                <p className="order-print-primary-warning mb-3 text-xs font-medium text-zinc-600">
                  Preparing primary image context...
                </p>
              )}
              {contextRequired && primaryImageContextError && (
                <p className="order-print-primary-warning mb-3 flex flex-wrap items-center gap-2 text-xs font-medium text-red-700">
                  Primary image context could not be loaded.
                  <button
                    type="button"
                    onClick={() => refetchPrimaryImageContext()}
                    className="order-print-image-trigger rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-semibold hover:bg-red-100"
                  >
                    Retry
                  </button>
                </p>
              )}
              {explicitPrimaryUnresolved && (
                <p className="order-print-primary-warning mb-3 text-xs font-medium text-amber-700">
                  The selected primary image could not be verified - showing the standard fallback instead.
                </p>
              )}
              {failedImageCount > 0 && (
                <p className="mb-3 text-xs font-medium text-amber-700">
                  {failedImageCount} image{failedImageCount > 1 ? "s" : ""} could not be loaded.
                </p>
              )}
              {productionImageRefs.length ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {productionImageRefs.map((url, index) => {
                    const resolved = resolvedImages[url];
                    const imageBody = resolved?.status === "error" ? (
                      <div className="flex h-64 w-full items-center justify-center rounded-lg bg-zinc-100 text-xs font-semibold uppercase tracking-wide text-zinc-400 print:h-auto">
                        Image unavailable
                      </div>
                    ) : resolved?.url ? (
                      <div className="relative h-64 w-full print:h-auto">
                        <img
                          src={resolved.url}
                          alt=""
                          className={`h-64 w-full rounded-lg object-contain print:h-auto print:max-h-[180mm] ${resolved.status === "ready" ? "" : "opacity-0 absolute inset-0"}`}
                          onLoad={() => handleImageLoaded(url, resolved.url)}
                          onError={() => handleImageFailed(url)}
                        />
                        {resolved.status !== "ready" && (
                          <div className="flex h-64 w-full animate-pulse items-center justify-center rounded-lg bg-zinc-100 text-xs font-semibold uppercase tracking-wide text-zinc-400 print:h-auto">
                            Preparing...
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex h-64 w-full animate-pulse items-center justify-center rounded-lg bg-zinc-100 text-xs font-semibold uppercase tracking-wide text-zinc-400 print:h-auto">
                        Preparing...
                      </div>
                    );
                    return (
                      <div key={url} className="order-print-card rounded-xl border border-zinc-200 p-3 print:p-2.5">
                        <button
                          type="button"
                          onClick={() => openImagePreview(url)}
                          className="order-print-image-trigger block w-full cursor-zoom-in rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          aria-label={`Open image ${index + 1} of ${productionImageRefs.length} in gallery view`}
                        >
                          {imageBody}
                        </button>
                        <p className="mt-2 break-words text-xs text-zinc-500">{index + 1}. {printFileName(url)}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-zinc-600">No mockup/image files attached yet.</p>
              )}
            </OrderPrintSection>
          )}

          {type !== "mockups" && (
            <OrderPrintSection title="Invoices">
              {invoices.length ? (
                <div className="space-y-2">
                  {invoices.map((invoice, index) => (
                    <div key={`${invoice.url || invoice.file_url || invoice.name}-${index}`} className="order-print-card rounded-lg border border-zinc-200 p-3 print:p-2.5">
                      <p className="font-semibold text-zinc-950">{invoice.name || invoice.invoice_number || `Invoice ${index + 1}`}</p>
                      <div className="mt-1 grid gap-1 text-sm text-zinc-700 sm:grid-cols-3">
                        <span>Ref: {invoice.invoice_number || "-"}</span>
                        <span>Total: {invoice.invoice_total ? formatCurrency(invoice.invoice_total) : "-"}</span>
                        <span>Balance: {invoice.invoice_total ? formatCurrency(Math.max(Number(invoice.invoice_total || 0) - totalPaid, 0)) : "-"}</span>
                      </div>
                      {(invoice.url || invoice.file_url) && (
                        <p className="mt-2 break-words text-xs text-zinc-500">{invoice.url || invoice.file_url}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-600">No invoice files attached yet.</p>
              )}
            </OrderPrintSection>
          )}

          <OrderPrintSection title="Notes">
            <p className="whitespace-pre-wrap text-sm text-zinc-700">{order.notes || order.special_instructions || "No notes added."}</p>
          </OrderPrintSection>

          <footer className="mt-6 border-t border-zinc-300 pt-4 text-xs text-zinc-600">
            Confirm invoice, mockup, sizing, colour, and delivery details before production.
          </footer>
        </div>
      </div>
    </div>
    {printImagePreview && (
      <div className="order-quick-print-lightbox">
        <FileLightbox
          files={printImagePreview.files}
          index={printImagePreview.index}
          onClose={() => setPrintImagePreview(null)}
        />
      </div>
    )}
    </>
  );
}

function OrderPrintSection({ title, children }) {
  return (
    <section className="order-print-section mt-4 rounded-xl border border-zinc-200 bg-white p-4 print:mt-3 print:p-3">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

function OrderPrintRow({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="mb-2 grid grid-cols-[140px_1fr] gap-3 text-sm">
      <span className="font-semibold text-zinc-500">{label}</span>
      <span className="break-words text-zinc-950">{value}</span>
    </div>
  );
}

function OrderPrintMetric({ label, value, tone }) {
  return (
    <div className={`order-print-metric rounded-lg border p-3 ${tone === "warn" ? "border-amber-200 bg-amber-50" : tone === "ok" ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-zinc-50"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-zinc-950">{value}</p>
    </div>
  );
}

function printFileName(url = "") {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split("/").pop() || url);
  } catch {
    return decodeURIComponent(String(url).split("/").pop() || String(url));
  }
}

function formatInlineValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return Object.values(value).join(", ");
  return value || "-";
}

function formatProductOptions(value) {
  if (!Array.isArray(value) || value.length === 0) return "";
  return value
    .map((option) => {
      if (!option) return "";
      if (typeof option === "string" || typeof option === "number") return String(option);
      const name = option.name || option.label || option.title || option.type || "Option";
      const locations = Array.isArray(option.locations) ? option.locations.join("/") : option.location || option.placement || "";
      const price = option.price || option.cost ? `R${Number(option.price || option.cost).toLocaleString()}` : "";
      return [name, locations, price].filter(Boolean).join(" - ");
    })
    .filter(Boolean)
    .join(", ");
}

function formatCurrency(value) {
  return `R${Number(value || 0).toLocaleString()}`;
}
