import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizeOrderFileFolders } from "./OrderDrawerShared";

const statusConfig = {
  confirmed: { label: "Confirmed", color: "bg-primary/10 text-primary" },
  in_production: { label: "In Production", color: "bg-purple-100 text-purple-700" },
  ready: { label: "Ready", color: "bg-green-100 text-green-700" },
  shipped: { label: "Shipped", color: "bg-teal-100 text-teal-700" },
  delivered: { label: "Delivered", color: "bg-slate-100 text-slate-600" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-700" },
};

export default function OrderQuickPrintSheet({ type, order, payments, totalPaid, balance, onClose }) {
  const metadata = normalizeOrderFileFolders(order.order_file_folders);
  const allFiles = Array.isArray(order.file_urls) ? order.file_urls.filter(Boolean) : [];
  const invoices = Array.isArray(order.invoice_files) ? order.invoice_files : [];
  const products = Array.isArray(order.products) ? order.products : [];
  const printedAt = new Date().toLocaleString();
  const completedPayments = (Array.isArray(payments) ? payments : []).filter((payment) => payment.status === "completed");
  const mockupFiles = allFiles.filter((url) => metadata.fileFolders?.[url] === "mockups");
  const imageFiles = allFiles.filter(isPrintableImage);
  const filesForMockups = mockupFiles.length ? mockupFiles : imageFiles;
  const title = type === "invoices"
    ? "Invoice Printout"
    : type === "mockups"
      ? "Mockup Printout"
      : "Order Summary";

  const productRows = products.length ? products : [{ name: order.notes || "Order setup", quantity: "", size: "", color: "" }];

  return (
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
        }
      `}</style>
      <div className="order-quick-print mx-auto flex max-h-[92vh] max-w-4xl flex-col overflow-hidden rounded-2xl bg-card shadow-apple-xl print:max-h-none print:overflow-visible print:rounded-none">
        <div className="order-quick-print-actions flex items-center justify-between border-b border-border p-4">
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">A4-friendly browser print for production use.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => window.print()} className="rounded-xl">
              <Printer className="mr-2 h-4 w-4" />
              Print
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

          {type !== "invoices" && (
            <OrderPrintSection title="Mockups / Production Images">
              {filesForMockups.length ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {filesForMockups.map((url, index) => (
                    <div key={url} className="order-print-card rounded-xl border border-zinc-200 p-3 print:p-2.5">
                      {isPrintableImage(url) ? (
                        <img src={url} alt="" className="h-64 w-full rounded-lg object-contain print:h-auto print:max-h-[180mm]" />
                      ) : (
                        <p className="break-words text-sm text-zinc-700">{printFileName(url)}</p>
                      )}
                      <p className="mt-2 break-words text-xs text-zinc-500">{index + 1}. {printFileName(url)}</p>
                    </div>
                  ))}
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

function isPrintableImage(url = "") {
  return /\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(String(url));
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
