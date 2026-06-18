import { useMemo, useState } from "react";
import { CheckCircle2, Download, RefreshCw, RotateCcw, Settings2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createInvoiceExportRecord,
  getApprovedInvoicesForExport,
  listInvoiceExports,
  listInvoices,
  markInvoiceExported,
  markInvoiceImportedToZoho,
} from "@/api/invoices";
import { buildZohoInvoiceCsv, getZohoInvoiceExportFileName } from "./zohoInvoiceCsv";
import { ZOHO_INVOICE_CSV_COLUMNS } from "./zohoInvoiceExportConfig";
import { buildZohoCustomerCsv, getZohoCustomerExportFileName } from "./zohoCustomerCsv";
import { ZOHO_CUSTOMER_CSV_COLUMNS } from "./zohoCustomerExportConfig";

function downloadCsv(fileName, csv) {
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function InvoiceExportCenter({ active = true }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState(null);
  const [customerPreview, setCustomerPreview] = useState(null);
  const [invoiceColumns, setInvoiceColumns] = useState(ZOHO_INVOICE_CSV_COLUMNS);
  const [customerColumns, setCustomerColumns] = useState(ZOHO_CUSTOMER_CSV_COLUMNS);

  const candidatesQuery = useQuery({
    queryKey: ["invoiceExportCandidates"],
    queryFn: () => getApprovedInvoicesForExport({ includeItems: true, limit: 100 }),
    enabled: active,
  });

  const exportedQuery = useQuery({
    queryKey: ["invoiceExportedWaitingImport"],
    queryFn: () => listInvoices({ status: "exported", pageSize: 100 }),
    enabled: active,
    select: (result) => result.data || [],
  });

  const historyQuery = useQuery({
    queryKey: ["invoiceExportHistory"],
    queryFn: () => listInvoiceExports({ limit: 10 }),
    enabled: active,
  });

  const candidates = candidatesQuery.data || [];
  const exportedInvoices = exportedQuery.data || [];

  const exportPreview = useMemo(() => {
    if (!preview) return null;
    return preview.rows.slice(0, 8);
  }, [preview]);

  const customerRows = useMemo(() => {
    if (!customerPreview) return null;
    return customerPreview.rows.slice(0, 8);
  }, [customerPreview]);

  const exportMutation = useMutation({
    mutationFn: async () => {
      const result = buildZohoInvoiceCsv(candidates, { columns: invoiceColumns });
      const fileName = getZohoInvoiceExportFileName();
      downloadCsv(fileName, result.csv);
      const invoiceIds = candidates.map((invoice) => invoice.id);
      await createInvoiceExportRecord({
        invoice_count: result.invoiceCount,
        row_count: result.rowCount,
        file_name: fileName,
        template_version: result.templateVersion,
        export_filters: { status: "approved", zoho_exported_at: null },
      });
      await markInvoiceExported(invoiceIds);
      return result;
    },
    onSuccess: () => {
      toast.success("Zoho CSV downloaded and invoices marked exported");
      queryClient.invalidateQueries({ queryKey: ["invoiceExportCandidates"] });
      queryClient.invalidateQueries({ queryKey: ["invoiceExportedWaitingImport"] });
      queryClient.invalidateQueries({ queryKey: ["invoiceExportHistory"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setPreview(null);
    },
    onError: (error) => toast.error(error?.message || "Export failed"),
  });

  const importMutation = useMutation({
    mutationFn: async () => markInvoiceImportedToZoho(exportedInvoices.map((invoice) => invoice.id)),
    onSuccess: () => {
      toast.success("Invoices marked imported to Zoho");
      queryClient.invalidateQueries({ queryKey: ["invoiceExportedWaitingImport"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (error) => toast.error(error?.message || "Could not mark imported"),
  });

  const buildPreview = () => {
    const result = buildZohoInvoiceCsv(candidates, { columns: invoiceColumns });
    setPreview(result);
  };

  const buildCustomerPreview = () => {
    const result = buildZohoCustomerCsv(candidates, { columns: customerColumns });
    setCustomerPreview(result);
  };

  const downloadCustomers = () => {
    const result = buildZohoCustomerCsv(candidates, { columns: customerColumns });
    downloadCsv(getZohoCustomerExportFileName(), result.csv);
    setCustomerPreview(result);
    toast.success("Customer CSV downloaded");
  };

  const renameHeader = (type, key, header) => {
    const setter = type === "invoice" ? setInvoiceColumns : setCustomerColumns;
    setter((columns) => columns.map((column) => (
      column.key === key ? { ...column, header } : column
    )));
  };

  const resetHeaders = () => {
    setInvoiceColumns(ZOHO_INVOICE_CSV_COLUMNS);
    setCustomerColumns(ZOHO_CUSTOMER_CSV_COLUMNS);
    toast.success("CSV headers reset");
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Export invoices for Zoho Books</h2>
        <p className="mt-1 text-sm text-muted-foreground">OPPS creates CSV files only. Upload them manually in Zoho Books, then mark them imported here for tracking.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StepCard label="Step 1" text="Export customers if Zoho needs them" />
        <StepCard label="Step 2" text="Export approved invoices" />
        <StepCard label="Step 3" text="Upload CSV in Zoho Books" />
        <StepCard label="Step 4" text="Mark imported in OPPS" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Ready to export" value={candidates.length} />
        <Metric label="CSV rows" value={preview?.rowCount ?? "Preview"} />
        <Metric label="Waiting Zoho import" value={exportedInvoices.length} />
      </div>

      <Card className="rounded-2xl border-border shadow-apple-sm">
        <CardContent className="space-y-4 p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="font-semibold text-foreground">Step 1: Export customers if Zoho needs them</p>
              <p className="mt-1 text-sm text-muted-foreground">Use this if Zoho Books needs customers imported before invoice import.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={buildCustomerPreview} disabled={candidates.length === 0} className="rounded-xl">
                <RefreshCw className="h-4 w-4" /> Preview customers
              </Button>
              <Button onClick={downloadCustomers} disabled={candidates.length === 0} className="rounded-xl">
                <Download className="h-4 w-4" /> Download customers
              </Button>
            </div>
          </div>
          {customerRows && (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="p-2">Customer</th>
                    <th className="p-2">Email</th>
                    <th className="p-2">Phone</th>
                    <th className="p-2">Currency</th>
                  </tr>
                </thead>
                <tbody>
                  {customerRows.map((row) => (
                    <tr key={`${row.email || row.customer_name}-${row.opps_customer_id}`} className="border-t border-border">
                      <td className="max-w-[240px] truncate p-2">{row.customer_name}</td>
                      <td className="p-2">{row.email || "Missing"}</td>
                      <td className="p-2">{row.phone || "-"}</td>
                      <td className="p-2">{row.currency_code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border shadow-apple-sm">
        <CardContent className="space-y-4 p-4 md:p-5">
          <div>
            <p className="font-semibold text-foreground">Step 2: Export approved invoices</p>
            <p className="mt-1 text-sm text-muted-foreground">Draft invoices are skipped. Export history is recorded before OPPS marks invoices exported.</p>
          </div>
          {candidatesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Checking approved invoices...</p>
          ) : candidates.length === 0 ? (
            <div className="rounded-2xl border border-border bg-secondary/30 p-5 text-sm text-muted-foreground">
              No approved invoices are ready for export. Approve an invoice first.
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {candidates.map((invoice) => (
                  <div key={invoice.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{invoice.invoice_number}</p>
                      <p className="text-sm text-muted-foreground">{invoice.customer_name} / {invoice.items?.length || 0} line rows</p>
                    </div>
                    <p className="text-sm font-semibold text-foreground">R{Number(invoice.total || 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" onClick={buildPreview} className="rounded-xl">
                  <RefreshCw className="h-4 w-4" /> Preview rows
                </Button>
                <Button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending} className="rounded-xl">
                  <Download className="h-4 w-4" /> Download Zoho CSV
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {exportPreview && (
        <Card className="rounded-2xl border-border shadow-apple-sm">
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-semibold text-foreground">Export preview</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="p-2">Invoice</th>
                    <th className="p-2">Customer</th>
                    <th className="p-2">Item</th>
                    <th className="p-2">Qty</th>
                    <th className="p-2">Rate</th>
                    <th className="p-2">Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {exportPreview.map((row, index) => (
                    <tr key={`${row.opps_invoice_id}-${index}`} className="border-t border-border">
                      <td className="p-2">{row.invoice_number}</td>
                      <td className="p-2">{row.customer_name}</td>
                      <td className="p-2">{row.item_name}</td>
                      <td className="p-2">{row.quantity}</td>
                      <td className="p-2">{row.rate}</td>
                      <td className="p-2">{row.tax_percentage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-border bg-primary/5 shadow-apple-sm">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-semibold text-foreground">Step 4: Mark imported in OPPS</p>
            <p className="text-sm text-muted-foreground">This is a manual OPPS tracking action after you upload the CSV. It is not a Zoho sync.</p>
          </div>
          <Button
            onClick={() => importMutation.mutate()}
            disabled={exportedInvoices.length === 0 || importMutation.isPending}
            className="rounded-xl"
          >
            <CheckCircle2 className="h-4 w-4" /> Mark imported to Zoho
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border shadow-apple-sm">
        <CardContent className="space-y-4 p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="flex items-center gap-2 font-semibold text-foreground">
                <Settings2 className="h-4 w-4" /> Zoho CSV settings
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Adjust headers locally after comparing with your Zoho Books sample file. These settings are not saved yet.</p>
            </div>
            <Button variant="outline" onClick={resetHeaders} className="rounded-xl">
              <RotateCcw className="h-4 w-4" /> Reset headers
            </Button>
          </div>
          <HeaderEditor
            title="Invoice CSV headers"
            columns={invoiceColumns}
            onRename={(key, header) => renameHeader("invoice", key, header)}
          />
          <HeaderEditor
            title="Customer CSV headers"
            columns={customerColumns}
            onRename={(key, header) => renameHeader("customer", key, header)}
          />
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border shadow-apple-sm">
        <CardContent className="p-4">
          <p className="mb-3 text-sm font-semibold text-foreground">Export history</p>
          {(historyQuery.data || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No export history yet.</p>
          ) : (
            <div className="space-y-2">
              {historyQuery.data.map((record) => (
                <div key={record.id} className="flex flex-col gap-1 rounded-xl bg-secondary/40 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-medium text-foreground">{record.file_name || "Zoho CSV export"}</span>
                  <span className="text-muted-foreground">{record.invoice_count} invoices / {record.row_count} rows</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-apple-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function StepCard({ label, text }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-apple-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">{label}</p>
      <p className="mt-2 text-sm font-medium text-foreground">{text}</p>
    </div>
  );
}

function HeaderEditor({ title, columns, onRename }) {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-secondary/20 p-3">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div className="grid gap-2 md:grid-cols-2">
        {columns.map((column) => (
          <label key={column.key} className="space-y-1">
            <span className="block truncate text-xs font-medium text-muted-foreground">{column.key}</span>
            <Input
              value={column.header}
              onChange={(event) => onRename(column.key, event.target.value)}
              className="h-9 rounded-xl bg-card"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
