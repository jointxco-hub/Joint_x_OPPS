import { useRef, useState } from "react";
import { Copy, Download, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ClientInvoiceView from "./ClientInvoiceView";
import { buildInvoicePdf, invoiceShareSummaryText, safeInvoiceFileName } from "./invoicePdfBuilder";

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function InvoiceSharePdfButton({ invoice, order, template, disabled = false, className = "" }) {
  const captureRef = useRef(null);
  const [sharing, setSharing] = useState(false);
  const [fallback, setFallback] = useState(null);

  const handleShare = async () => {
    if (!invoice || !captureRef.current) return;
    setSharing(true);
    try {
      const pdf = await buildInvoicePdf(captureRef.current);
      const blob = pdf.output("blob");
      const fileName = `${safeInvoiceFileName(invoice.invoice_number || invoice.customer_name || "draft-invoice")}.pdf`;
      const file = new File([blob], fileName, { type: "application/pdf" });
      const shareData = {
        files: [file],
        title: invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : "Invoice",
        text: invoiceShareSummaryText(invoice),
      };

      if (navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        toast.success("Invoice PDF shared");
      } else {
        setFallback({ blob, fileName });
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        toast.error(error?.message || "Could not share invoice PDF");
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={handleShare} disabled={disabled || sharing} className={`h-9 rounded-xl ${className}`}>
        {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
        {sharing ? "Preparing PDF" : "Share PDF"}
      </Button>
      <div aria-hidden="true" className="pointer-events-none fixed left-[-100000px] top-0 z-[-1] w-[794px] bg-white">
        <div ref={captureRef} className="w-[794px] bg-white">
          <ClientInvoiceView invoice={invoice} order={order} template={template} documentMode />
        </div>
      </div>

      <Dialog open={Boolean(fallback)} onOpenChange={(open) => !open && setFallback(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Sharing files isn't supported here</DialogTitle>
            <DialogDescription>
              This device or browser can't share a PDF file directly. Download the PDF to share it yourself, or copy
              a text summary instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                navigator.clipboard?.writeText(invoiceShareSummaryText(invoice));
                toast.success("Invoice summary copied");
                setFallback(null);
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy invoice summary
            </Button>
            <Button
              className="rounded-xl"
              onClick={() => {
                if (fallback) downloadBlob(fallback.blob, fallback.fileName);
                setFallback(null);
              }}
            >
              <Download className="h-3.5 w-3.5" /> Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
