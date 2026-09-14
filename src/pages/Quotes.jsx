import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileText, Plus, Shield, Inbox } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { dataClient } from "@/api/dataClient";
import { canAccessInvoices } from "@/lib/financeAccess";
import {
  listQuotes, getQuote, listQuoteRevisions, listQuoteEvents, getQuoteDocument,
  saveQuoteWithItems, quoteDraftFromClientRequest, markQuoteSent,
  issueQuoteShare, rotateQuoteShareToken, revokeQuoteShare,
  convertQuoteToOrder,
} from "@/api/quotes";
import { listClientRequests } from "@/api/clientRequests";
import QuoteList from "@/features/quotes/QuoteList";
import QuoteEditor from "@/features/quotes/QuoteEditor";
import QuoteDetailDrawer from "@/features/quotes/QuoteDetailDrawer";

function emptyFilters() {
  return { search: "", quoteNumber: "", status: "all", dateFrom: "", dateTo: "" };
}

export default function Quotes() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState("list"); // list | create
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [editingQuote, setEditingQuote] = useState(null);
  const [sourceRequest, setSourceRequest] = useState(null);
  const [requestPickerOpen, setRequestPickerOpen] = useState(false);
  const pageSize = 20;

  const userQuery = useQuery({
    queryKey: ["currentUser", "quotes"],
    queryFn: () => dataClient.auth.me(),
    staleTime: 300_000,
  });
  const canAccess = canAccessInvoices(userQuery.data);
  const linkedQuoteId = searchParams.get("open");

  // Deep-link from another record's "View Quote" (e.g. an order's Quote
  // link). Mirrors Invoices.jsx's `?invoice=<id>` pattern — no need to wait
  // for a pre-loaded list, the detail query fetches by id directly.
  useEffect(() => {
    if (!canAccess || !linkedQuoteId) return;
    setSelectedQuote((current) => (
      current?.id === linkedQuoteId ? current : { id: linkedQuoteId }
    ));
  }, [canAccess, linkedQuoteId]);

  const listOptions = useMemo(() => ({
    page, pageSize,
    status: filters.status,
    search: filters.search || undefined,
    quoteNumber: filters.quoteNumber || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  }), [filters, page]);

  const quotesQuery = useQuery({
    queryKey: ["quotes", listOptions],
    queryFn: () => listQuotes(listOptions),
    enabled: canAccess && view === "list",
  });

  const detailQuery = useQuery({
    queryKey: ["quote", selectedQuote?.id],
    queryFn: () => getQuote(selectedQuote.id, { includeItems: true }),
    enabled: canAccess && Boolean(selectedQuote?.id),
  });
  const revisionsQuery = useQuery({
    queryKey: ["quoteRevisions", selectedQuote?.id],
    queryFn: () => listQuoteRevisions(selectedQuote.id),
    enabled: canAccess && Boolean(selectedQuote?.id),
  });
  const eventsQuery = useQuery({
    queryKey: ["quoteEvents", selectedQuote?.id],
    queryFn: () => listQuoteEvents(selectedQuote.id),
    enabled: canAccess && Boolean(selectedQuote?.id),
  });
  const publishedDocumentQuery = useQuery({
    queryKey: ["quoteDocument", selectedQuote?.id, "published"],
    queryFn: () => getQuoteDocument(selectedQuote.id, { variant: "published" }),
    enabled: canAccess && Boolean(selectedQuote?.id),
  });
  const draftDocumentQuery = useQuery({
    queryKey: ["quoteDocument", selectedQuote?.id, "draft"],
    queryFn: () => getQuoteDocument(selectedQuote.id, { variant: "draft" }),
    enabled: canAccess && Boolean(selectedQuote?.id),
  });

  const requestsQuery = useQuery({
    queryKey: ["quoteableClientRequests"],
    queryFn: () => listClientRequests({ type: "quote_request", status: "all", limit: 50 }),
    enabled: canAccess && requestPickerOpen,
  });

  const saveMutation = useMutation({
    mutationFn: (input) => saveQuoteWithItems(input),
    onSuccess: (saved) => {
      toast.success(saved?.quote_number ? `Quote ${saved.quote_number} saved (revision #${saved.current_revision_number})` : "Quote saved");
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      queryClient.invalidateQueries({ queryKey: ["quote", saved.id] });
      queryClient.invalidateQueries({ queryKey: ["quoteRevisions", saved.id] });
      queryClient.invalidateQueries({ queryKey: ["quoteEvents", saved.id] });
      queryClient.invalidateQueries({ queryKey: ["quoteDocument", saved.id] });
      setEditingQuote(null);
      setSourceRequest(null);
      setView("list");
      setSelectedQuote(saved);
    },
    onError: (error) => toast.error(error?.message || "Could not save the quote"),
  });

  const sendMutation = useMutation({
    mutationFn: (quote) => markQuoteSent(quote.id),
    onSuccess: (result, quote) => {
      toast.success(
        result?.no_change
          ? "Nothing new to send — the customer already has this revision."
          : result?.resend
            ? `Resent — customer now sees revision #${result.revision_number}`
            : `Quote sent — revision #${result.revision_number} is now the live offer`,
      );
      for (const key of [["quotes"], ["quote", quote.id], ["quoteRevisions", quote.id],
                         ["quoteEvents", quote.id], ["quoteDocument", quote.id]]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (error) => toast.error(error?.message || "Could not send the quote"),
  });

  const invalidateQuote = (quoteId) => {
    for (const key of [["quotes"], ["quote", quoteId], ["quoteEvents", quoteId], ["quoteDocument", quoteId]]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const issueShareMutation = useMutation({
    mutationFn: (quote) => issueQuoteShare(quote.id),
    onSuccess: (_result, quote) => { toast.success("Public link created"); invalidateQuote(quote.id); },
    onError: (error) => toast.error(error?.message || "Could not create the public link"),
  });
  const rotateShareMutation = useMutation({
    mutationFn: (quote) => rotateQuoteShareToken(quote.id),
    onSuccess: (_result, quote) => { toast.success("Public link rotated — the old link no longer works"); invalidateQuote(quote.id); },
    onError: (error) => toast.error(error?.message || "Could not rotate the public link"),
  });
  const revokeShareMutation = useMutation({
    mutationFn: (quote) => revokeQuoteShare(quote.id),
    onSuccess: (_result, quote) => { toast.success("Public link revoked"); invalidateQuote(quote.id); },
    onError: (error) => toast.error(error?.message || "Could not revoke the public link"),
  });

  const convertToOrderMutation = useMutation({
    // useMutation infers TVariables as void without an explicit generic
    // (same gap every sibling mutation above already has) — annotate the
    // callback params locally rather than adding generics file-wide.
    mutationFn: (/** @type {{ id: string }} */ quote) => convertQuoteToOrder(quote.id),
    onSuccess: (result, /** @type {{ id: string }} */ quote) => {
      toast.success(
        result?.replayed
          ? `This quote was already converted — order ${result.order_number}`
          : `Order ${result.order_number} created from ${result.quote_number}`,
      );
      invalidateQuote(quote.id);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error) => toast.error(error?.message || "Could not convert this quote into an order"),
  });

  if (userQuery.isLoading) {
    return <div className="min-h-screen bg-background p-8 text-sm text-muted-foreground">Checking quote access...</div>;
  }
  if (!canAccess) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
          <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-secondary">
            <Shield className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Quotes are restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">Ask an admin or finance lead for access to OPPS quoting.</p>
        </div>
      </div>
    );
  }

  if (view === "create") {
    return (
      <QuoteEditor
        initialQuote={editingQuote || {}}
        sourceRequest={sourceRequest}
        onCancel={() => { setEditingQuote(null); setSourceRequest(null); setView("list"); }}
        onSave={(input) => saveMutation.mutate(input)}
        isSaving={saveMutation.isPending}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6 md:py-8">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
              <FileText className="h-4 w-4" /> OPPS quoting
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Quotes</h1>
            <p className="mt-1 text-sm text-muted-foreground">Build priced quotes for clients. Each save keeps an immutable revision.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setRequestPickerOpen(true)} className="h-10 rounded-xl">
              <Inbox className="h-4 w-4" /> From client request
            </Button>
            <Button onClick={() => { setEditingQuote({}); setSourceRequest(null); setView("create"); }} className="h-10 rounded-xl">
              <Plus className="h-4 w-4" /> Create quote
            </Button>
          </div>
        </div>

        <QuoteList
          quotes={quotesQuery.data?.data || []}
          count={quotesQuery.data?.count || 0}
          page={page}
          pageSize={pageSize}
          isLoading={quotesQuery.isLoading}
          isError={quotesQuery.isError}
          error={quotesQuery.error}
          filters={filters}
          onFiltersChange={(next) => { setFilters(next); setPage(1); }}
          onPageChange={setPage}
          onCreate={() => { setEditingQuote({}); setSourceRequest(null); setView("create"); }}
          onSelect={setSelectedQuote}
        />
      </div>

      <QuoteDetailDrawer
        open={Boolean(selectedQuote)}
        quote={detailQuery.data || null}
        summaryQuote={selectedQuote}
        revisions={revisionsQuery.data || []}
        events={eventsQuery.data || []}
        publishedDocument={publishedDocumentQuery.data || null}
        draftDocument={draftDocumentQuery.data || null}
        isLoading={detailQuery.isLoading}
        isRevisionsLoading={revisionsQuery.isLoading}
        isSending={sendMutation.isPending}
        isIssuingShare={issueShareMutation.isPending}
        isRotatingShare={rotateShareMutation.isPending}
        isRevokingShare={revokeShareMutation.isPending}
        isConvertingToOrder={convertToOrderMutation.isPending}
        loadError={detailQuery.error}
        onOpenChange={(open) => {
          if (open) return;
          setSelectedQuote(null);
          if (linkedQuoteId) {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.delete("open");
            setSearchParams(nextParams, { replace: true });
          }
        }}
        onEdit={(quote) => { setEditingQuote(quote); setSelectedQuote(null); setView("create"); }}
        onRevise={(quote) => { setEditingQuote(quote); setSelectedQuote(null); setView("create"); }}
        onSend={(quote) => sendMutation.mutate(quote)}
        onIssueShare={(quote) => issueShareMutation.mutate(quote)}
        onRotateShare={(quote) => rotateShareMutation.mutate(quote)}
        onRevokeShare={(quote) => revokeShareMutation.mutate(quote)}
        onConvertToOrder={(quote) => convertToOrderMutation.mutate(quote)}
        onViewOrder={(orderId) => navigate(`/Orders?open=${orderId}`)}
      />

      <Dialog open={requestPickerOpen} onOpenChange={setRequestPickerOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Start a quote from a client request</DialogTitle>
            <DialogDescription>Opening the editor does not action the request or create an order. The link is written only when the quote saves.</DialogDescription>
          </DialogHeader>
          {requestsQuery.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading requests...</p>
          ) : (requestsQuery.data?.data || []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No open client quote requests.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(requestsQuery.data?.data || []).map((request) => (
                <li key={request.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingQuote(quoteDraftFromClientRequest(request));
                      setSourceRequest(request);
                      setRequestPickerOpen(false);
                      setView("create");
                    }}
                    className="w-full px-1 py-3 text-left hover:bg-secondary/50"
                  >
                    <p className="text-sm font-semibold text-foreground">{request.client_name || request.client_email}</p>
                    <p className="truncate text-xs text-muted-foreground">{request.preview || request.payload?.project_name || "Quote request"}</p>
                    <p className="text-[11px] text-muted-foreground">{request.status} · {String(request.created_at || "").slice(0, 10)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
