import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  listInvoiceActivity,
  listSiblingInvoicesForOrder,
  listInvoices,
  markInvoiceExported,
  markInvoiceImportedToZoho,
  markInvoicePaid,
  markInvoicePartiallyPaid,
  markInvoiceVoid,
  updateInvoice,
} from "@/api/invoices";
import { getFinanceLevel } from "@/lib/financeAccess";
import InvoiceList from "@/features/invoices/InvoiceList";
import InvoiceCreateFlow from "@/features/invoices/InvoiceCreateFlow";
import InvoiceDetailDrawer from "@/features/invoices/InvoiceDetailDrawer";
import InvoiceExportCenter from "@/features/invoices/InvoiceExportCenter";

function emptyFilters() {
  return {
    search: "",
    status: "all",
    dateFrom: "",
    dateTo: "",
  };
}

export default function Invoices() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState("list");
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const pageSize = 20;

  const userQuery = useQuery({
    queryKey: ["currentUser", "invoices"],
    queryFn: () => dataClient.auth.me(),
    staleTime: 300_000,
  });

  const canAccess = getFinanceLevel(userQuery.data) > 0;
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

  const duplicateQuery = useQuery({
    queryKey: ["invoiceSiblings", detailQuery.data?.source_order_id],
    queryFn: () => listSiblingInvoicesForOrder(detailQuery.data.source_order_id),
    enabled: canAccess && Boolean(detailQuery.data?.source_order_id),
  });

  const saveMutation = useMutation({
    mutationFn: (invoice) => invoice.id
      ? updateInvoice(invoice.id, invoice)
      : createInvoice(invoice),
    onSuccess: (invoice) => {
      toast.success(invoice.status === "approved" ? "Invoice approved" : "Invoice saved");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoiceExportCandidates"] });
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
    },
    onError: (error) => toast.error(error?.message || "Could not approve invoice"),
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

  const paidMutation = useMutation({
    mutationFn: (invoice) => markInvoicePaid(invoice.id),
    onSuccess: () => {
      toast.success("Invoice marked paid");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceActivity", selectedInvoice?.id] });
    },
    onError: (error) => toast.error(error?.message || "Could not mark paid"),
  });

  const partialPaymentMutation = useMutation({
    mutationFn: ({ invoice, amountPaid, note }) => markInvoicePartiallyPaid(invoice.id, amountPaid, note),
    onSuccess: () => {
      toast.success("Payment status updated");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoice?.id] });
      queryClient.invalidateQueries({ queryKey: ["invoiceActivity", selectedInvoice?.id] });
    },
    onError: (error) => toast.error(error?.message || "Could not update payment"),
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
            <TabsTrigger value="export" className="rounded-xl">Export center</TabsTrigger>
          </TabsList>
          <TabsContent value="list">
            <InvoiceList
              invoices={invoicesQuery.data?.data || []}
              count={invoicesQuery.data?.count || 0}
              page={page}
              pageSize={pageSize}
              isLoading={invoicesQuery.isLoading}
              filters={filters}
              onFiltersChange={(next) => { setFilters(next); setPage(1); }}
              onPageChange={setPage}
              onCreate={() => { setEditingInvoice(null); setActiveTab("create"); }}
              onSelect={setSelectedInvoice}
            />
          </TabsContent>
          <TabsContent value="export">
            <InvoiceExportCenter active={activeTab === "export"} />
          </TabsContent>
        </Tabs>
      </div>

      <InvoiceDetailDrawer
        open={Boolean(selectedInvoice)}
        invoice={detailQuery.data || selectedInvoice}
        activity={activityQuery.data || []}
        duplicateInvoices={(duplicateQuery.data || []).filter((invoice) => invoice.id !== selectedInvoice?.id)}
        isActivityLoading={activityQuery.isLoading}
        isLoading={detailQuery.isLoading}
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
        onEditDraft={(invoice) => { setEditingInvoice(detailQuery.data || invoice); setSelectedInvoice(null); setActiveTab("create"); }}
        onMarkExported={(invoice, result) => markExportedMutation.mutate({ invoice, result })}
        onMarkImported={(invoice) => importedMutation.mutate(invoice)}
        onMarkPaid={(invoice) => paidMutation.mutate(invoice)}
        onMarkPartiallyPaid={(invoice, amountPaid, note) => partialPaymentMutation.mutate({ invoice, amountPaid, note })}
        onMarkVoid={(invoice) => voidMutation.mutate(invoice)}
        onVoidDuplicate={(invoice) => voidMutation.mutate(invoice)}
        onDuplicateDraft={(invoice) => duplicateMutation.mutate(invoice)}
      />
    </div>
  );
}
