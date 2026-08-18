import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ClientInvoiceView from "./ClientInvoiceView";
import { buildInvoicePdf, safeInvoiceFileName } from "./invoicePdfBuilder";

export default function InvoicePdfDownloadButton({ invoice, order, template, disabled = false, className = "" }) {
  const captureRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (!invoice || !captureRef.current) return;
    setDownloading(true);
    try {
      const pdf = await buildInvoicePdf(captureRef.current);
      pdf.save(`${safeInvoiceFileName(invoice.invoice_number || invoice.customer_name || "draft-invoice")}.pdf`);
      toast.success("Invoice PDF downloaded");
    } catch (error) {
      toast.error(error?.message || "Could not create invoice PDF");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={download} disabled={disabled || downloading} className={`h-9 rounded-xl ${className}`}>
        {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        {downloading ? "Building PDF" : "Download PDF"}
      </Button>
      <div aria-hidden="true" className="pointer-events-none fixed left-[-100000px] top-0 z-[-1] w-[794px] bg-white">
        <div ref={captureRef} className="w-[794px] bg-white">
          <ClientInvoiceView invoice={invoice} order={order} template={template} documentMode />
        </div>
      </div>
    </>
  );
}
