import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, ClipboardList, RefreshCw, ShieldCheck } from "lucide-react";
import { getCafeWorkQueue } from "@/api/cafeWorkQueue";
import { useWorkspace } from "@/lib/WorkspaceContext";

const PAGE_SIZE = 15;

function rand(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return "Not available";
  return new Intl.NumberFormat("en-ZA", {
    style: "currency", currency: "ZAR", maximumFractionDigits: 2,
  }).format(number);
}

function InvoiceLine({ invoice }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background/70 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{invoice.number || "Invoice"}</p>
        <p className="text-xs text-muted-foreground capitalize">{invoice.status || "Unknown"}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-foreground">
          {invoice.reviewRequired ? "Review required" : invoice.balanceDue === 0 ? "Settled" : rand(invoice.balanceDue)}
        </p>
        <p className="text-xs text-muted-foreground">Invoice outstanding · read-only</p>
      </div>
    </div>
  );
}

function WorkCard({ item }) {
  const invoices = Array.isArray(item.invoices) ? item.invoices : [];
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-apple-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {item.type === "order" ? "OPPS order" : "Standalone invoice"}
          </p>
          <h2 className="mt-1 break-all text-base font-semibold text-foreground">{item.number || "Unnumbered record"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{item.customerName || "Customer not specified"}</p>
        </div>
        <span className="rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium capitalize text-secondary-foreground">
          {item.status || "Unknown"}
        </span>
      </div>
      {item.type === "order" ? (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Linked invoices ({invoices.length})</span>
            <span className="text-xs text-muted-foreground">Order balance not inferred</span>
          </div>
          {invoices.length ? invoices.map((invoice) => <InvoiceLine key={invoice.id} invoice={invoice} />) : (
            <p className="rounded-xl bg-secondary/50 px-3 py-3 text-sm text-muted-foreground">
              No linked invoice. Payment status requires review in the original record.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-4 border-t border-border pt-3">
          <InvoiceLine invoice={item} />
          {item.sourceOrderId && <p className="mt-2 text-xs text-muted-foreground">
            Linked order is not in this queue. Check the original record before acting.
          </p>}
        </div>
      )}
    </article>
  );
}

export default function CafeWorkQueue() {
  const { currentWorkspace } = useWorkspace();
  const isCafeWorkspace = currentWorkspace?.slug === "quick-solution";
  const [pageCursors, setPageCursors] = useState([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);

  const cursor = pageCursors[pageIndex];
  useEffect(() => {
    if (!isCafeWorkspace) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    setResult(null);
    getCafeWorkQueue({ cursor, limit: PAGE_SIZE })
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch(() => {
        if (!cancelled) setError("The Café Work Queue is unavailable. No records were changed. Check your access or contact an administrator.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isCafeWorkspace, cursor, revision]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const next = () => {
    if (!result?.nextCursor || loading) return;
    setPageCursors((previous) => [...previous.slice(0, pageIndex + 1), result.nextCursor]);
    setPageIndex((index) => index + 1);
  };
  const previous = () => {
    if (!loading) setPageIndex((index) => Math.max(index - 1, 0));
  };

  if (!isCafeWorkspace) {
    return <section className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Café Work Queue</h1>
      <p className="mt-2 text-sm text-muted-foreground">Select your authorized Quick Solution Café workspace to access this view.</p>
    </section>;
  }

  return (
    <section className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.17em] text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-[#1a7a5e]" /> Quick Solution Café
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Work Queue</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            A read-only overview of Café OPPS orders and linked invoice information. Counter Orders and payments are managed separately.
          </p>
        </div>
        <button type="button" onClick={refresh} disabled={loading}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium hover:bg-secondary disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="rounded-xl border border-[#c0a4e0]/30 bg-[#c0a4e0]/10 px-4 py-3 text-sm text-foreground">
        View only · No payment requests, status changes, or fulfilment actions are available here.
      </div>

      {loading && <div role="status" className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Loading work queue…</div>}

      {!loading && error && (
        <div role="alert" className="rounded-2xl border border-border bg-card p-6">
          <AlertCircle className="mb-3 h-5 w-5 text-destructive" />
          <p className="text-sm text-foreground">{error}</p>
          <button type="button" onClick={refresh} className="mt-4 rounded-lg bg-secondary px-4 py-2 text-sm font-medium">Try again</button>
        </div>
      )}

      {!loading && !error && result?.items?.length === 0 && (
        <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center">
          <ClipboardList className="mx-auto h-7 w-7 text-muted-foreground" />
          <p className="mt-3 font-medium text-foreground">No work cards on this page</p>
          <p className="mt-1 text-sm text-muted-foreground">No matching orders or standalone invoices were returned.</p>
        </div>
      )}

      {!loading && !error && result?.items?.length > 0 && (
        <div className="space-y-3" aria-label="Café work cards">
          {result.items.map((item) => <WorkCard key={item.key} item={item} />)}
        </div>
      )}

      {!loading && !error && result && (
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">Page {pageIndex + 1} · {result.items.length} cards</p>
          <div className="flex gap-2">
            <button type="button" onClick={previous} disabled={pageIndex === 0}
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-sm disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <button type="button" onClick={next} disabled={!result.nextCursor}
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-sm disabled:opacity-40">
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
