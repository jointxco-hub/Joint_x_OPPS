import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileText, Plus, Shield } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dataClient } from "@/api/dataClient";
import {
  approveInvoice,
  createInvoice,
  createInvoiceExportRecord,
  duplicateInvoiceAsDraft,
  getInvoice,
  issueInvoiceShare,
  linkInvoiceToOrder,
  linkInvoiceToOrderRelational,
  listInvoiceActivity,
  listSiblingInvoicesForOrder,
  listInvoices,
  attachProofToPayment,
  getInvoicePaymentSummary,
  listInvoicePaymentsWithProof,
  markInvoiceExported,
  markInvoiceImportedToZoho,
  markInvoiceVoid,
  recordInvoicePayment,
  supersedePaymentAttachment,
  refreshInvoiceContactDetails,
  reopenInvoice,
  revokeInvoiceShare,
  rotateInvoiceShareToken,
  syncInvoiceItemsFromOrder,
  syncOrderItemsFromInvoice,
  unlinkInvoiceFromOrder,
  updateInvoice,
} from "@/api/invoices";
import { convertQuoteToOrder } from "@/api/quotes";
import { canAccessInvoices, canReopenInvoices } from "@/lib/financeAccess";
import NewOrderDrawer from "@/components/orders/NewOrderDrawer";
import InvoiceList from "@/features/invoices/InvoiceList";
import InvoiceCreateFlow from "@/features/invoices/InvoiceCreateFlow";
import InvoiceDetailDrawer from "@/features/invoices/InvoiceDetailDrawer";
import InvoiceExportCenter from "@/features/invoices/InvoiceExportCenter";
import InvoiceItemTemplateManager from "@/features/invoices/InvoiceItemTemplateManager";
import {
  assertConfirmedItemCount,
  invoiceDiagnostic,
  isCompleteInvoiceDetail,
} from "@/features/invoices/invoiceReliability";

// Legacy/untyped boundary, same local-cast convention as OrderLinkPanel.jsx -
// dataClient.entities has no static shape under checkJs.
const orderEntity = /** @type {any} */ (dataClient.entities).Order;

function emptyFilters() {
  return {
    search: "",
    status: "all",
    dateFrom: "",
    dateTo: "",
  };
}

// Prefill for the invoice-first "Create Order" flow: customer/contact
// details, fulfilment context, and a reference note - deliberately no
// products/items (NewOrderDrawer's own product picker stays the entry
// point for that, same as any other new order). client_id is only set
// when the invoice already has one, so the created order's client_id
// matches it exactly and the canonical linker resolves identity
// automatically afterwards - no attach step needed in the common case.
function orderInitialValuesFromInvoice(invoice) {
  if (!invoice) return undefined;
  const reference = `Created from invoice ${invoice.invoice_number || invoice.id}`;
  return {
    client_id: invoice.customer_id || "",
    client_name: invoice.customer_name || "",
    client_email: invoice.customer_email || "",
    client_phone: invoice.customer_phone || "",
    saved_contact_name: invoice.contact_person || "",
    delivery_note: invoice.shipping_address || invoice.customer_billing_address || "",
    courier: invoice.shipping_courier || "",
    pep_code: invoice.shipping_courier_code || "",
    // Omitted entirely (rather than set to undefined) when the invoice has
    // no fulfilment type, so NewOrderDrawer's own workspace-specific
    // default (e.g. 'collection' for Quick Solution) is left alone instead
    // of being spread over with undefined.
    ...(invoice.fulfillment_type ? { fulfillment_type: invoice.fulfillment_type } : {}),
    notes: invoice.notes ? `${reference} — ${invoice.notes}` : reference,
  };
}

export default function Invoices() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState("list");
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [createOrderForInvoice, setCreateOrderForInvoice] = useState(/** @type {any} */ (null));
  const pageSize = 20;

  const userQuery = useQuery({
    queryKey: ["currentUser", "invoices"],
    queryFn: () => dataClient.auth.me(),
    staleTime: 300_000,
  });

  const canAccess = canAccessInvoices(userQuery.data);
  const canReopen = canReopenInvoices(userQuery.data);
  const linkedInvoiceId = searchParams.get("invoice");

  useEffect(() => {
    if (!canAccess || !linkedInvoiceId) return;
    setSelectedInvoice((current) => (
      current?.id === linkedInvoiceId ? current : { id: linkedInvoiceId }
    ));
  }, [canAccess, linkedInvoiceId]);

  const listOptions = useMemo(() => ({
    page,
    pageSize,
    status: filters.status === "all" ? undefined : filters.status,
    search: filters.search || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  }), [filters, page]);

  const invoicesQuery = useQuery({
    queryKey: ["invoices", listOptions],
    queryFn: () => listInvoices(listOptions),
    enabled: canAccess && activeTab === "list",
  });

  const detailQuery = useQuery({
    queryKey: ["invoice", selectedInvoice?.id],
    queryFn: () => getInvoice(selectedInvoice.id, { includeItems: true }),
    enabled: canAccess && Boolean(selectedInvoice?.id),
  });

  const activityQuery = useQuery({
    queryKey: ["invoiceActivity", selectedInvoice?.id],
    queryFn: () => listInvoiceActivity(selectedInvoice.id),
    enabled: canAccess && Boolean(selectedInvoice?.id),
  });

  const paymentSummaryQuery = useQuery({
    queryKey: ["invoicePaymentSummary", selectedInvoice?.id],
    queryFn: () => getInvoicePaymentSummary(selectedInvoice.id),
    enabled: canAccess && Boolean(selectedInvoice?.id),
  });

  const paymentsQuery = useQuery({
    queryKey: ["invoicePayments", selectedInvoice?.id],
    queryFn: () => listInvoicePaymentsWithProof(selectedInvoice.id),
    enabled: canAccess && Boolean(selectedInvoice?.id),
  });

  const duplicateQuery = useQuery({
    queryKey: ["invoiceSiblings", detailQuery.data?.source_order_id],
    queryFn: () => listSiblingInvoicesForOrder(detailQuery.data.source_order_id),
    enabled: canAccess && Boolean(detailQuery.data?.source_order_id),
  });

  useEffect(() => {
    if (!detailQuery.error || !selectedInvoice?.id) return;
    invoiceDiagnostic("invoice-detail-view-failed", {
      invoiceId: selectedInvoice.id,
      error: detailQuery.error,
    });
    toast.error("Invoice details could not be loaded. Retry before editing or saving.");
  }, [detailQuery.error, selectedInvoice?.id]);

  const saveMutation = useMutation({
    mutationFn: async (invoice) => {
      const saved = invoice.id
        ? await updateInvoice(invoice.id, invoice)
        : await createInvoice(invoice);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice", saved.id] }),
        queryClient.invalidateQueries({ queryKey: ["invoiceExportCandidates"] }),
        // A total correction changes the canonical balance the P1A ledger
        // summary is derived from — without this, InvoicePaymentModal (fed
        // straight from this cached query) keeps showing the pre-correction
        // outstanding amount until something else happens to invalidate it.
        queryClient.invalidateQueries({ queryKey: ["invoicePaymentSummary", saved.id] }),
        saved.source_order_id
          ? queryClient.invalidateQueries({ queryKey: ["orderOppsInvoices", saved.source_order_id] })
          : Promise.resolve(),
      ]);

      const confirmed = await queryClient.fetchQuery({
        queryKey: ["invoice", saved.id],
        queryFn: () => getInvoice(saved.id, { includeItems: true }),
        staleTime: 0,
      });

      try {
        return assertConfirmedItemCount(saved, confirmed);
      } catch (error) {
        invoiceDiagnostic("item-count-mismatch-after-save", {
          invoiceId: saved.id,
          error,
          expectedCount: saved.items?.length,
          actualCount: confirmed?.items?.length,
        });
        throw error;
      }
    },
    onSuccess: (invoice) => {
      toast.success(invoice.status === "approved" ? "Invoice approved" : "Invoice saved");
      queryClient.setQueryData(["invoice", invoice.id], invoice);
      setEditingInvoice(null);
      setActiveTab("list");
      setSelectedInvoice(invoice);
    },
    onError: (error) => {
      const firstError = error?.validation?.errors?.[0]?.message;
      toast.error(firstError || error?.message || "Could not save invoice");
    },
  });

  const approveMutation = useMutation({
    mutationFn: (invoice) => approveInvoice(invoice.id),
    onSuccess: () => {
      toast.success("Invoice approved");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceActivity", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceExportCandidates"] });
      queryClient.invalidateQueries({ queryKey: ["invoicePaymentSummary", selectedInvoice?.id] });
      if (selectedInvoice?.source_order_id) {
        queryClient.invalidateQueries({ queryKey: ["orderOppsInvoices", selectedInvoice.source_order_id] });
      }
    },
    onError: (error) => toast.error(error?.message || "Could not approve invoice"),
  });

  const reopenMutation = useMutation({
    mutationFn: ({ invoice, reason }) => reopenInvoice(invoice.id, reason),
    onSuccess: () => {
      toast.success("Invoice reopened for correction");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceActivity", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoicePaymentSummary", selectedInvoice?.id] });
      if (selectedInvoice?.source_order_id) {
        queryClient.invalidateQueries({ queryKey: ["orderOppsInvoices", selectedInvoice.source_order_id] });
      }
    },
    onError: (error) => toast.error(error?.message || "Could not reopen invoice"),
  });

  const issueShareMutation = useMutation({
    mutationFn: (invoice) => issueInvoiceShare(invoice.id),
    onSuccess: () => {
      toast.success("Public link created");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice?.id] });
    },
    onError: (error) => toast.error(error?.message || "Could not create a public link"),
  });

  const revokeShareMutation = useMutation({
    mutationFn: (invoice) => revokeInvoiceShare(invoice.id),
    onSuccess: () => {
      toast.success("Public link revoked");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice?.id] });
    },
    onError: (error) => toast.error(error?.message || "Could not revoke the public link"),
  });

  const rotateShareMutation = useMutation({
    mutationFn: (invoice) => rotateInvoiceShareToken(invoice.id),
    onSuccess: () => {
      toast.success("Public link rotated — the old link no longer works");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice?.id] });
    },
    onError: (error) => toast.error(error?.message || "Could not rotate the public link"),
  });

  const refreshContactMutation = useMutation({
    mutationFn: ({ invoice, fields }) => refreshInvoiceContactDetails(invoice.id, fields),
    onSuccess: () => {
      toast.success("Contact & shipping details refreshed");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceActivity", selectedInvoice?.id] });
    },
    onError: (error) => toast.error(error?.message || "Could not refresh contact details"),
  });

  const markExportedMutation = useMutation({
    mutationFn: async ({ invoice, result }) => {
      await createInvoiceExportRecord({
        invoice_count: 1,
        row_count: result?.rowCount || invoice.items?.length || 0,
        file_name: "single-invoice-export.csv",
        export_filters: { invoice_id: invoice.id, re_export: Boolean(invoice.zoho_exported_at) },
        template_version: result?.templateVersion,
      });
      await markInvoiceExported([invoice.id]);
    },
    onSuccess: () => {
      toast.success("Invoice marked exported");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceActivity", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceExportHistory"] });
    },
    onError: (error) => toast.error(error?.message || "Could not mark exported"),
  });

  const importedMutation = useMutation({
    mutationFn: (invoice) => markInvoiceImportedToZoho([invoice.id]),
    onSuccess: () => {
      toast.success("Invoice marked imported to Zoho");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceActivity", selectedInvoice?.id] });
    },
    onError: (error) => toast.error(error?.message || "Could not mark imported"),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: ({ invoice, amount, method, reference, paidAt, note, mode, operationKey }) =>
      recordInvoicePayment({ invoice, amount, method, reference, paidAt, note, mode, operationKey }),
    onSuccess: (result) => {
      toast.success(result?.replayed ? "That payment was already recorded" : "Payment recorded");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceActivity", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoicePaymentSummary", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoicePayments", selectedInvoice?.id] });
      // A payment recorded here also moves the linked order's own payments
      // tab / balance and its Invoices-tab card — without this, an
      // already-open order drawer keeps showing pre-payment figures until
      // it's closed and reopened.
      if (selectedInvoice?.source_order_id) {
        queryClient.invalidateQueries({ queryKey: ["payments", selectedInvoice.source_order_id] });
        queryClient.invalidateQueries({ queryKey: ["orderOppsInvoices", selectedInvoice.source_order_id] });
      }
    },
    onError: (error) => toast.error(error?.message || "Could not record the payment"),
  });

  const addPaymentProofMutation = useMutation({
    mutationFn: ({ payment, file }) => attachProofToPayment({ paymentId: payment.id, file }),
    onSuccess: () => {
      toast.success("Proof of payment added");
      queryClient.invalidateQueries({ queryKey: ["invoicePayments", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceActivity", selectedInvoice?.id] });
    },
    onError: (error) => toast.error(error?.message || "Could not add the proof of payment"),
  });

  const retirePaymentProofMutation = useMutation({
    mutationFn: ({ attachment, reason }) => supersedePaymentAttachment(attachment.id, reason),
    onSuccess: () => {
      toast.success("Proof of payment retired");
      queryClient.invalidateQueries({ queryKey: ["invoicePayments", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceActivity", selectedInvoice?.id] });
    },
    onError: (error) => toast.error(error?.message || "Could not retire the proof of payment"),
  });

  const voidMutation = useMutation({
    mutationFn: (invoice) => markInvoiceVoid(invoice.id),
    onSuccess: () => {
      toast.success("Invoice marked void");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceActivity", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceSiblings", detailQuery.data?.source_order_id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceExportCandidates"] });
    },
    onError: (error) => toast.error(error?.message || "Could not void invoice"),
  });

  const duplicateMutation = useMutation({
    mutationFn: (invoice) => duplicateInvoiceAsDraft(invoice.id),
    onSuccess: (invoice) => {
      toast.success(`Draft ${invoice.invoice_number} created`);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setSelectedInvoice(invoice);
    },
    onError: (error) => toast.error(error?.message || "Could not duplicate invoice"),
  });

  const invalidateAfterOrderLinkChange = (invoice) => {
    queryClient.invalidateQueries({ queryKey: ["invoice", invoice.id] });
    queryClient.invalidateQueries({ queryKey: ["invoiceActivity", invoice.id] });
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    if (invoice.source_order_id) {
      queryClient.invalidateQueries({ queryKey: ["orderOppsInvoices", invoice.source_order_id] });
    }
  };

  // Invoice -> Order (Phase 1, second path): a direct quote invoice with no
  // order yet exposes "Create Order" on its OrderLinkPanel. Reuses the
  // SAME convert_quote_to_order() RPC the quote drawer's own "Create
  // Order" calls — idempotent, so this is safe even if an order was
  // created from the quote in another tab in the meantime.
  const createOrderFromQuoteMutation = useMutation({
    mutationFn: (quoteId) => convertQuoteToOrder(quoteId),
    onSuccess: (result) => {
      toast.success(
        result?.replayed
          ? `This quote already has an order — ${result.order_number}`
          : `Order ${result.order_number} created`,
      );
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      if (selectedInvoice?.id) queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice.id] });
      navigate(`/Orders?open=${result.order_id}`);
    },
    onError: (error) => toast.error(error?.message || "Could not create an order from this quote"),
  });

  // Invoice-first "Create Order": NewOrderDrawer is rendered below,
  // prefilled from createOrderForInvoice via orderInitialValuesFromInvoice.
  // Plain async handler (not a useMutation) to match exactly how
  // Orders.jsx's own onCreate works - NewOrderDrawer awaits this and
  // shows its own error toast on rejection, so wrapping it in a second
  // mutation would just double that toast.
  const handleCreateOrderFromInvoice = async (orderData) => {
    const invoice = createOrderForInvoice;
    const createdOrder = await orderEntity.create(orderData);
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    setCreateOrderForInvoice(null);
    try {
      // No attach here: only reached when this invoice already had a
      // client (locked into the order form via initialValues.client_id,
      // so the created order's client_id necessarily matches). If the
      // invoice had no client, this plain link falls through to
      // CLIENT_MISMATCH by design - staff finishes that case explicitly
      // via "Link Existing Order", which is the one place this workflow
      // ever attaches a client.
      await linkInvoiceToOrderRelational(invoice.id, createdOrder);
      toast.success(`Order ${createdOrder.order_number} created and linked to this invoice`);
    } catch (error) {
      toast.warning(
        `Order ${createdOrder.order_number} created, but couldn't be linked automatically (${error?.message || "client mismatch"}). Use "Link Existing Order" on this invoice to finish.`
      );
    }
    invalidateAfterOrderLinkChange(invoice);
    navigate(`/Orders?open=${createdOrder.id}`);
  };

  const linkExistingOrderMutation = useMutation({
    mutationFn: ({ invoice, order, options }) => linkInvoiceToOrderRelational(invoice.id, order, options),
    onSuccess: (saved, { order }) => {
      toast.success(`Linked to order ${order.order_number || order.id}`);
      invalidateAfterOrderLinkChange(saved);
    },
    onError: (error) => toast.error(error?.message || "Could not link this order"),
  });

  /**
   * @typedef {{
   *   invoice: any,
   *   order: any
   * }} OrderInvoiceMutationVariables
   */

  const linkOrderMutation = useMutation({
    mutationFn: (
      /** @type {OrderInvoiceMutationVariables} */
      { invoice, order }
    ) => linkInvoiceToOrder(invoice, order),
    onSuccess: (saved, { order }) => {
      toast.success(`Linked to order ${order.order_number || order.id}`);
      invalidateAfterOrderLinkChange(saved);
    },
    onError: (error) => toast.error(error?.message || "Could not link this order"),
  });

  const unlinkOrderMutation = useMutation({
    mutationFn: (invoice) => unlinkInvoiceFromOrder(invoice),
    onSuccess: (saved) => {
      toast.success("Invoice unlinked from order");
      invalidateAfterOrderLinkChange(saved);
    },
    onError: (error) => toast.error(error?.message || "Could not unlink this order"),
  });

  const syncOrderMutation = useMutation({
    mutationFn: (
      /** @type {OrderInvoiceMutationVariables} */
      { invoice, order }
    ) => syncInvoiceItemsFromOrder(invoice, order),
    onSuccess: (saved) => {
      toast.success("Invoice items synced from order");
      invalidateAfterOrderLinkChange(saved);
    },
    onError: (error) => toast.error(error?.message || "Could not sync from this order"),
  });

  const syncOrderFromInvoiceMutation = useMutation({
    mutationFn: ({ order, invoice, options }) => syncOrderItemsFromInvoice(order, invoice, options),
    onSuccess: (savedOrder, variables) => {
      toast.success("Order synced from invoice");
      queryClient.invalidateQueries({ queryKey: ["invoiceLinkedOrder", variables.invoice.source_order_id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      if (savedOrder?.id) queryClient.invalidateQueries({ queryKey: ["order", savedOrder.id] });
    },
    onError: (error) => {
      const messages = {
        PAID_INVOICE_SYNC_BLOCKED: "This invoice is paid - sync into the order is blocked.",
        VOID_INVOICE_SYNC_BLOCKED: "This invoice is void - sync into the order is blocked.",
        ORDER_PRODUCTS_LOCKED: "This order's products are locked - unlock it first.",
      };
      toast.error(messages[error?.message] || error?.message || "Could not sync from this invoice");
    },
  });

  if (userQuery.isLoading) {
    return <div className="min-h-screen bg-background p-8 text-sm text-muted-foreground">Checking invoice access...</div>;
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
          <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-secondary">
            <Shield className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Invoices are restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">Ask an admin or finance lead for access to OPPS invoicing.</p>
        </div>
      </div>
    );
  }

  if (activeTab === "create") {
    return (
      <InvoiceCreateFlow
        initialInvoice={editingInvoice}
        onCancel={() => { setEditingInvoice(null); setActiveTab("list"); }}
        onSave={(invoice) => saveMutation.mutate(invoice)}
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
              <FileText className="h-4 w-4" /> OPPS invoicing
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Invoices</h1>
            <p className="mt-1 text-sm text-muted-foreground">Create invoices in OPPS, then export CSV files for Zoho Books.</p>
          </div>
          <Button onClick={() => { setEditingInvoice(null); setActiveTab("create"); }} className="h-10 rounded-xl">
            <Plus className="h-4 w-4" /> Create invoice
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 rounded-2xl bg-secondary/60 p-1">
            <TabsTrigger value="list" className="rounded-xl">Overview</TabsTrigger>
            <TabsTrigger value="items" className="rounded-xl">Saved items</TabsTrigger>
            <TabsTrigger value="export" className="rounded-xl">Export center</TabsTrigger>
          </TabsList>
          <TabsContent value="list">
            <InvoiceList
              invoices={invoicesQuery.data?.data || []}
              count={invoicesQuery.data?.count || 0}
              page={page}
              pageSize={pageSize}
              isLoading={invoicesQuery.isLoading}
              isError={invoicesQuery.isError}
              error={invoicesQuery.error}
              filters={filters}
              onFiltersChange={(next) => { setFilters(next); setPage(1); }}
              onPageChange={setPage}
              onCreate={() => { setEditingInvoice(null); setActiveTab("create"); }}
              onSelect={setSelectedInvoice}
            />
          </TabsContent>
          <TabsContent value="items">
            <InvoiceItemTemplateManager active={activeTab === "items"} />
          </TabsContent>
          <TabsContent value="export">
            <InvoiceExportCenter active={activeTab === "export"} />
          </TabsContent>
        </Tabs>
      </div>

      <InvoiceDetailDrawer
        open={Boolean(selectedInvoice)}
        invoice={detailQuery.data || null}
        summaryInvoice={selectedInvoice}
        activity={activityQuery.data || []}
        duplicateInvoices={(duplicateQuery.data || []).filter((invoice) => invoice.id !== selectedInvoice?.id)}
        isActivityLoading={activityQuery.isLoading}
        isLoading={detailQuery.isLoading || (detailQuery.isFetching && !detailQuery.data)}
        loadError={detailQuery.error}
        onRetry={async () => {
          const result = await detailQuery.refetch();
          if (result.isSuccess) toast.success("Invoice details reloaded");
        }}
        onOpenChange={(open) => {
          if (open) return;
          setSelectedInvoice(null);
          if (linkedInvoiceId) {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.delete("invoice");
            setSearchParams(nextParams, { replace: true });
          }
        }}
        onApprove={(invoice) => approveMutation.mutate(invoice)}
        isApprovePending={approveMutation.isPending}
        canReopen={canReopen}
        onReopen={(invoice, reason) => reopenMutation.mutate({ invoice, reason })}
        isReopenPending={reopenMutation.isPending}
        onRefreshContact={(invoice, fields) => refreshContactMutation.mutate({ invoice, fields })}
        isRefreshContactPending={refreshContactMutation.isPending}
        onIssueShare={(invoice) => issueShareMutation.mutate(invoice)}
        isIssueSharePending={issueShareMutation.isPending}
        onRevokeShare={(invoice) => revokeShareMutation.mutate(invoice)}
        isRevokeSharePending={revokeShareMutation.isPending}
        onRotateShare={(invoice) => rotateShareMutation.mutate(invoice)}
        isRotateSharePending={rotateShareMutation.isPending}
        onEditDraft={(invoice) => {
          if (!isCompleteInvoiceDetail(detailQuery.data || invoice)) {
            toast.error("Invoice details must load completely before editing.");
            return;
          }
          setEditingInvoice(detailQuery.data);
          setSelectedInvoice(null);
          setActiveTab("create");
        }}
        onMarkExported={(invoice, result) => markExportedMutation.mutate({ invoice, result })}
        onMarkImported={(invoice) => importedMutation.mutate(invoice)}
        onRecordPayment={(invoice, payload) => recordPaymentMutation.mutateAsync({ invoice, ...payload })}
        isRecordPaymentPending={recordPaymentMutation.isPending}
        payments={paymentsQuery.data || []}
        canRetireProof={canReopen}
        isProofBusy={addPaymentProofMutation.isPending || retirePaymentProofMutation.isPending}
        onAddPaymentProof={(payment, file) => addPaymentProofMutation.mutateAsync({ payment, file })}
        onRetirePaymentProof={(attachment, reason) => retirePaymentProofMutation.mutate({ attachment, reason })}
        ledgerSummary={paymentSummaryQuery.data}
        onMarkVoid={(invoice) => voidMutation.mutate(invoice)}
        onVoidDuplicate={(invoice) => voidMutation.mutate(invoice)}
        onDuplicateDraft={(invoice) => duplicateMutation.mutate(invoice)}
        onLinkOrder={(invoice, order) => linkOrderMutation.mutate({ invoice, order })}
        onUnlinkOrder={(invoice) => unlinkOrderMutation.mutate(invoice)}
        onSyncFromOrder={(invoice, order) => syncOrderMutation.mutate({ invoice, order })}
        onSyncFromInvoice={(order, invoice, options) => syncOrderFromInvoiceMutation.mutate({ order, invoice, options })}
        onCreateOrderFromQuote={(quoteId) => createOrderFromQuoteMutation.mutate(quoteId)}
        isCreatingOrderFromQuote={createOrderFromQuoteMutation.isPending}
        onCreateOrderFromInvoice={(invoice) => setCreateOrderForInvoice(invoice)}
        onLinkExistingOrder={(invoice, order, options) => linkExistingOrderMutation.mutate({ invoice, order, options })}
        isLinkingExistingOrder={linkExistingOrderMutation.isPending}
        isOrderLinkPending={linkOrderMutation.isPending || unlinkOrderMutation.isPending || syncOrderMutation.isPending || syncOrderFromInvoiceMutation.isPending}
      />

      {createOrderForInvoice && (
        <NewOrderDrawer
          onClose={() => setCreateOrderForInvoice(null)}
          onCreate={handleCreateOrderFromInvoice}
          initialValues={orderInitialValuesFromInvoice(createOrderForInvoice)}
        />
      )}
    </div>
  );
}
