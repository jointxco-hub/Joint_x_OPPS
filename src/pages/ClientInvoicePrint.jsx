import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import ClientInvoiceView from "@/features/invoices/ClientInvoiceView";
import { useClientInvoiceData } from "@/features/invoices/useClientInvoiceData";

export default function ClientInvoicePrint() {
  const [searchParams] = useSearchParams();
  const invoiceId = searchParams.get("invoice");
  const shouldPrint = searchParams.get("print") === "1";
  const { data, isLoading, error } = useClientInvoiceData(invoiceId);

  const printInvoice = () => window.print();
  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.assign("/Invoices");
  };

  useEffect(() => {
    if (!shouldPrint || !data?.invoice) return;
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
  }, [data?.invoice, shouldPrint]);

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950 print:bg-white">
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          .print-controls { display: none !important; }
          body { background: white !important; }
          .client-invoice { padding: 0 !important; }
          .client-invoice section, .client-invoice article { break-inside: avoid; }
        }
      `}</style>
      <div className="print-controls sticky top-0 z-10 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-950"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={printInvoice} className="rounded-xl">
              <Printer className="h-4 w-4" /> Print client invoice
            </Button>
            <Button onClick={printInvoice} className="rounded-xl">
              <Download className="h-4 w-4" /> Save as PDF
            </Button>
          </div>
        </div>
      </div>

      <main className="px-4 py-8 print:p-0">
        {!invoiceId ? (
          <Message title="Missing invoice" body="Open this page from an OPPS invoice to print it." />
        ) : isLoading ? (
          <Message title="Preparing invoice" body="Loading the client invoice document..." />
        ) : error ? (
          <Message title="Could not load invoice" body={error.message || "Please try again."} />
        ) : data?.invoice ? (
          <ClientInvoiceView invoice={data.invoice} order={data.order} />
        ) : (
          <Message title="Invoice not found" body="The invoice could not be found or you do not have access." />
        )}
      </main>
    </div>
  );
}

function Message({ title, body }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-xl">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-zinc-500">{body}</p>
    </div>
  );
}
