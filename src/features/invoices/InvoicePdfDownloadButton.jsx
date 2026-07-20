import { useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ClientInvoiceView from "./ClientInvoiceView";

function safeFileName(value) {
  return String(value || "invoice").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "invoice";
}

async function waitForImages(element) {
  const images = Array.from(element?.querySelectorAll("img") || []);
  await Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
      window.setTimeout(resolve, 5000);
    });
  }));
}

export default function InvoicePdfDownloadButton({ invoice, order, template, disabled = false, className = "" }) {
  const captureRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (!invoice || !captureRef.current) return;
    setDownloading(true);
    try {
      await waitForImages(captureRef.current);
      const canvas = await html2canvas(captureRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        logging: false,
        width: 794,
        windowWidth: 1200,
      });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const pageWidth = 190;
      const pageHeight = 277;
      const imageHeight = (canvas.height * pageWidth) / canvas.width;
      const imageData = canvas.toDataURL("image/jpeg", 0.94);
      const pageCount = Math.max(1, Math.ceil(imageHeight / pageHeight));
      for (let page = 0; page < pageCount; page += 1) {
        if (page > 0) pdf.addPage("a4", "portrait");
        pdf.addImage(imageData, "JPEG", 10, 10 - page * pageHeight, pageWidth, imageHeight, undefined, "FAST");
      }
      pdf.save(`${safeFileName(invoice.invoice_number || invoice.customer_name || "draft-invoice")}.pdf`);
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
