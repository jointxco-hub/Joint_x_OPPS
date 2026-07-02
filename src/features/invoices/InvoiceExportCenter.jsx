import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, RefreshCw, RotateCcw, Save, Settings2, Upload } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dataClient } from "@/api/dataClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  createInvoiceExportRecord,
  getApprovedInvoicesForExport,
  listInvoiceExports,
  listInvoices,
  markInvoiceExported,
  markInvoiceImportedToZoho,
  getInvoiceSetting,
  resetInvoiceSetting,
  saveInvoiceSetting,
} from "@/api/invoices";
import { buildZohoInvoiceCsv, getZohoInvoiceExportFileName } from "./zohoInvoiceCsv";
import { ZOHO_INVOICE_CSV_COLUMNS } from "./zohoInvoiceExportConfig";
import { buildZohoCustomerCsv, getZohoCustomerExportFileName } from "./zohoCustomerCsv";
import { ZOHO_CUSTOMER_CSV_COLUMNS } from "./zohoCustomerExportConfig";
import {
  INVOICE_SETTING_KEYS,
  defaultCustomerMappingSetting,
  defaultInvoiceMappingSetting,
  normalizeInvoiceDefaultsSetting,
  normalizeClientTemplateSetting,
  normalizeColumns,
} from "./invoiceSettings";
import { buildZohoCustomerImportPreview, importableCustomerRows } from "./zohoCustomerImport";

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
  const [invoiceDefaults, setInvoiceDefaults] = useState(normalizeInvoiceDefaultsSetting());
  const [clientTemplate, setClientTemplate] = useState(normalizeClientTemplateSetting());
  const [customerImportPreview, setCustomerImportPreview] = useState(null);
  const [customerImportFileName, setCustomerImportFileName] = useState("");
  const [customerImportOpen, setCustomerImportOpen] = useState(false);

  const invoiceSettingsQuery = useQuery({
    queryKey: ["invoiceSetting", INVOICE_SETTING_KEYS.invoiceMapping],
    queryFn: () => getInvoiceSetting(INVOICE_SETTING_KEYS.invoiceMapping),
    enabled: active,
  });

  const customerSettingsQuery = useQuery({
    queryKey: ["invoiceSetting", INVOICE_SETTING_KEYS.customerMapping],
    queryFn: () => getInvoiceSetting(INVOICE_SETTING_KEYS.customerMapping),
    enabled: active,
  });

  const clientTemplateQuery = useQuery({
    queryKey: ["invoiceSetting", INVOICE_SETTING_KEYS.clientTemplate],
    queryFn: () => getInvoiceSetting(INVOICE_SETTING_KEYS.clientTemplate),
    enabled: active,
  });

  const invoiceDefaultsQuery = useQuery({
    queryKey: ["invoiceSetting", INVOICE_SETTING_KEYS.invoiceDefaults],
    queryFn: () => getInvoiceSetting(INVOICE_SETTING_KEYS.invoiceDefaults),
    enabled: active,
  });

  const candidatesQuery = useQuery({
    queryKey: ["invoiceExportCandidates"],
    queryFn: () => getApprovedInvoicesForExport({ includeItems: true, limit: 100 }),
    enabled: active,
  });

  const clientsQuery = useQuery({
    queryKey: ["clients", "zoho-customer-import"],
    queryFn: () => dataClient.entities.Client.list("name", 500),
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

  useEffect(() => {
    if (invoiceSettingsQuery.data) {
      setInvoiceColumns(normalizeColumns(invoiceSettingsQuery.data.columns, ZOHO_INVOICE_CSV_COLUMNS));
    }
  }, [invoiceSettingsQuery.data]);

  useEffect(() => {
    if (customerSettingsQuery.data) {
      setCustomerColumns(normalizeColumns(customerSettingsQuery.data.columns, ZOHO_CUSTOMER_CSV_COLUMNS));
    }
  }, [customerSettingsQuery.data]);

  useEffect(() => {
    if (clientTemplateQuery.data) {
      setClientTemplate(normalizeClientTemplateSetting(clientTemplateQuery.data));
    }
  }, [clientTemplateQuery.data]);

  useEffect(() => {
    if (invoiceDefaultsQuery.data) {
      setInvoiceDefaults(normalizeInvoiceDefaultsSetting(invoiceDefaultsQuery.data));
    }
  }, [invoiceDefaultsQuery.data]);

  const exportPreview = useMemo(() => {
    if (!preview) return null;
    return preview.rows.slice(0, 8);
  }, [preview]);

  const customerRows = useMemo(() => {
    if (!customerPreview) return null;
    return customerPreview.rows.slice(0, 8);
  }, [customerPreview]);

  const customerImportRows = useMemo(() => importableCustomerRows(customerImportPreview), [customerImportPreview]);

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

  const saveSettingMutation = useMutation({
    mutationFn: ({ key, value }) => saveInvoiceSetting(key, value),
    onSuccess: (_data, variables) => {
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["invoiceSetting", variables.key] });
    },
    onError: (error) => toast.error(error?.message || "Could not save settings"),
  });

  const resetSettingMutation = useMutation({
    mutationFn: (key) => resetInvoiceSetting(key),
    onSuccess: (_data, key) => {
      toast.success("Settings reset to defaults");
      queryClient.invalidateQueries({ queryKey: ["invoiceSetting", key] });
    },
    onError: (error) => toast.error(error?.message || "Could not reset settings"),
  });

  const customerImportMutation = useMutation({
    mutationFn: async () => {
      const rows = importableCustomerRows(customerImportPreview);
      const results = await Promise.allSettled(rows.map((row) => (
        row.action === "update"
          ? dataClient.entities.Client.update(row.client.id, row.payload)
          : dataClient.entities.Client.create(row.payload)
      )));
      return {
        imported: results.filter((result) => result.status === "fulfilled").length,
        failed: results.filter((result) => result.status === "rejected").length,
      };
    },
    onSuccess: ({ imported, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setCustomerImportOpen(false);
      if (failed) toast.error(`${imported} clients imported, ${failed} could not be imported`);
      else toast.success(`${imported} clients imported from Zoho CSV`);
    },
    onError: (error) => toast.error(error?.message || "Could not import customers"),
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

  const selectCustomerImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Choose a Zoho customer CSV file");
      return;
    }
    try {
      const previewResult = buildZohoCustomerImportPreview(
        await file.text(),
        clientsQuery.data || [],
      );
      if (previewResult.rows.length === 0) {
        toast.error("The CSV has no customer rows to preview");
        return;
      }
      setCustomerImportFileName(file.name);
      setCustomerImportPreview(previewResult);
    } catch (error) {
      toast.error(error?.message || "Could not read customer CSV");
    }
  };

  const renameHeader = (type, key, header) => {
    const setter = type === "invoice" ? setInvoiceColumns : setCustomerColumns;
    setter((columns) => columns.map((column) => (
      column.key === key ? { ...column, header } : column
    )));
  };

  const saveInvoiceHeaders = () => {
    saveSettingMutation.mutate({
      key: INVOICE_SETTING_KEYS.invoiceMapping,
      value: { columns: invoiceColumns },
    });
  };

  const saveCustomerHeaders = () => {
    saveSettingMutation.mutate({
      key: INVOICE_SETTING_KEYS.customerMapping,
      value: { columns: customerColumns },
    });
  };

  const resetInvoiceHeaders = () => {
    setInvoiceColumns(defaultInvoiceMappingSetting().columns);
    resetSettingMutation.mutate(INVOICE_SETTING_KEYS.invoiceMapping);
  };

  const resetCustomerHeaders = () => {
    setCustomerColumns(defaultCustomerMappingSetting().columns);
    resetSettingMutation.mutate(INVOICE_SETTING_KEYS.customerMapping);
  };

  const saveClientTemplate = () => {
    saveSettingMutation.mutate({
      key: INVOICE_SETTING_KEYS.clientTemplate,
      value: normalizeClientTemplateSetting(clientTemplate),
    });
  };

  const resetClientTemplate = () => {
    const defaults = normalizeClientTemplateSetting();
    setClientTemplate(defaults);
    resetSettingMutation.mutate(INVOICE_SETTING_KEYS.clientTemplate);
  };

  const saveInvoiceDefaults = () => {
    saveSettingMutation.mutate({
      key: INVOICE_SETTING_KEYS.invoiceDefaults,
      value: normalizeInvoiceDefaultsSetting(invoiceDefaults),
    });
  };

  const resetInvoiceDefaults = () => {
    const defaults = normalizeInvoiceDefaultsSetting();
    setInvoiceDefaults(defaults);
    resetSettingMutation.mutate(INVOICE_SETTING_KEYS.invoiceDefaults);
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
              <p className="mt-1 text-sm text-muted-foreground">Download your Zoho customer sample file and match these headers before importing.</p>
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
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="font-semibold text-foreground">Import customers from Zoho CSV</p>
              <p className="mt-1 text-sm text-muted-foreground">Matches an existing client by email, then by an unambiguous exact name. Blank fields do not erase OPPS data.</p>
            </div>
            <Button variant="outline" asChild className="rounded-xl">
              <label>
                <Upload className="h-4 w-4" /> Choose customer CSV
                <Input className="sr-only" type="file" accept=".csv,text/csv" onChange={selectCustomerImportFile} />
              </label>
            </Button>
          </div>

          {customerImportPreview && (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <p className="font-medium text-foreground">{customerImportFileName}</p>
                <p className="text-muted-foreground">
                  {customerImportRows.filter((row) => row.action === "create").length} new / {customerImportRows.filter((row) => row.action === "update").length} updates / {customerImportPreview.invalidCount} skipped
                </p>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-secondary/50 text-muted-foreground">
                    <tr>
                      <th className="p-2">Customer</th>
                      <th className="p-2">Email</th>
                      <th className="p-2">Phone</th>
                      <th className="p-2">Action</th>
                      <th className="p-2">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerImportPreview.rows.slice(0, 12).map((row) => (
                      <tr key={row.rowNumber} className="border-t border-border">
                        <td className="max-w-[220px] truncate p-2">{row.customer.customer_name || "Missing"}</td>
                        <td className="max-w-[220px] truncate p-2">{row.customer.email || "-"}</td>
                        <td className="p-2">{row.customer.phone || "-"}</td>
                        <td className="p-2 capitalize">{row.action}</td>
                        <td className="p-2">{row.client?.name || row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {customerImportPreview.rows.length > 12 && (
                <p className="text-xs text-muted-foreground">Showing the first 12 of {customerImportPreview.rows.length} rows.</p>
              )}
              <Button onClick={() => setCustomerImportOpen(true)} disabled={customerImportRows.length === 0 || clientsQuery.isLoading} className="rounded-xl">
                <Upload className="h-4 w-4" /> Import {customerImportRows.length} clients
              </Button>
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

      <AlertDialog open={customerImportOpen} onOpenChange={setCustomerImportOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import Zoho customer CSV?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create {customerImportRows.filter((row) => row.action === "create").length} clients and update {customerImportRows.filter((row) => row.action === "update").length} matched clients. Skipped rows will not be changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={customerImportMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => customerImportMutation.mutate()} disabled={customerImportMutation.isPending}>
              {customerImportMutation.isPending ? "Importing..." : "Import clients"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              <p className="mt-1 text-sm text-muted-foreground">Saved settings only rename exported labels. Internal OPPS keys and invoice calculations stay unchanged.</p>
            </div>
          </div>
          <HeaderEditor
            title="Invoice CSV headers"
            columns={invoiceColumns}
            onRename={(key, header) => renameHeader("invoice", key, header)}
            onSave={saveInvoiceHeaders}
            onReset={resetInvoiceHeaders}
            isSaving={saveSettingMutation.isPending}
          />
          <HeaderEditor
            title="Customer CSV headers"
            columns={customerColumns}
            onRename={(key, header) => renameHeader("customer", key, header)}
            onSave={saveCustomerHeaders}
            onReset={resetCustomerHeaders}
            isSaving={saveSettingMutation.isPending}
          />
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border shadow-apple-sm">
        <CardContent className="space-y-4 p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="flex items-center gap-2 font-semibold text-foreground">
                <Settings2 className="h-4 w-4" /> Invoice defaults
              </p>
              <p className="mt-1 text-sm text-muted-foreground">These values are auto-included when creating invoices manually or from orders.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={resetInvoiceDefaults} className="rounded-xl">
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
              <Button onClick={saveInvoiceDefaults} disabled={saveSettingMutation.isPending} className="rounded-xl">
                <Save className="h-4 w-4" /> Save defaults
              </Button>
            </div>
          </div>
          <InvoiceDefaultsEditor defaults={invoiceDefaults} onChange={setInvoiceDefaults} />
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border shadow-apple-sm">
        <CardContent className="space-y-4 p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="flex items-center gap-2 font-semibold text-foreground">
                <Settings2 className="h-4 w-4" /> Client invoice template
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Controls the browser print/PDF view. Payment instructions stay hidden until configured.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={resetClientTemplate} className="rounded-xl">
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
              <Button onClick={saveClientTemplate} disabled={saveSettingMutation.isPending} className="rounded-xl">
                <Save className="h-4 w-4" /> Save template
              </Button>
            </div>
          </div>
          <TemplateEditor template={clientTemplate} onChange={setClientTemplate} />
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

function HeaderEditor({ title, columns, onRename, onSave, onReset, isSaving }) {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-secondary/20 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onReset} className="h-8 rounded-xl">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={isSaving} className="h-8 rounded-xl">
            <Save className="h-3.5 w-3.5" /> Save
          </Button>
        </div>
      </div>
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

function TemplateEditor({ template, onChange }) {
  const setField = (key, value) => onChange((current) => ({ ...current, [key]: value }));

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TemplateInput label="Business display name" value={template.businessDisplayName} onChange={(value) => setField("businessDisplayName", value)} />
      <TemplateInput label="Logo URL" value={template.logoUrl} onChange={(value) => setField("logoUrl", value)} />
      <TemplateInput label="Contact email" value={template.contactEmail} onChange={(value) => setField("contactEmail", value)} />
      <TemplateInput label="Contact phone" value={template.contactPhone} onChange={(value) => setField("contactPhone", value)} />
      <TemplateInput label="WhatsApp" value={template.contactWhatsapp} onChange={(value) => setField("contactWhatsapp", value)} />
      <TemplateInput label="Primary site" value={template.primarySite} onChange={(value) => setField("primarySite", value)} />
      <TemplateInput label="Sample packs site" value={template.samplePacksSite} onChange={(value) => setField("samplePacksSite", value)} />
      <TemplateInput label="Thank-you message" value={template.thankYouMessage} onChange={(value) => setField("thankYouMessage", value)} />
      <label className="space-y-1 md:col-span-2">
        <span className="block text-xs font-medium text-muted-foreground">Payment/banking instructions</span>
        <Input
          value={template.paymentInstructions || ""}
          onChange={(event) => setField("paymentInstructions", event.target.value)}
          placeholder="Leave blank until business details are confirmed"
          className="h-9 rounded-xl bg-card"
        />
      </label>
      <label className="space-y-1 md:col-span-2">
        <span className="block text-xs font-medium text-muted-foreground">Footer note</span>
        <Input value={template.footerNote || ""} onChange={(event) => setField("footerNote", event.target.value)} className="h-9 rounded-xl bg-card" />
      </label>
      <div className="flex flex-wrap gap-3 md:col-span-2">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={template.showProductThumbnails !== false} onChange={(event) => setField("showProductThumbnails", event.target.checked)} />
          Show product thumbnails
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={template.showPaidBalanceBlock !== false} onChange={(event) => setField("showPaidBalanceBlock", event.target.checked)} />
          Show paid/balance block
        </label>
      </div>
    </div>
  );
}

function InvoiceDefaultsEditor({ defaults, onChange }) {
  const setField = (key, value) => onChange((current) => ({ ...current, [key]: value }));

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_160px]">
      <TemplateInput label="Payment terms" value={defaults.paymentTerms} onChange={(value) => setField("paymentTerms", value)} />
      <label className="space-y-1">
        <span className="block text-xs font-medium text-muted-foreground">Due after days</span>
        <Input
          value={defaults.dueDays ?? 0}
          onChange={(event) => setField("dueDays", event.target.value)}
          type="number"
          min="0"
          step="1"
          className="h-9 rounded-xl bg-card"
        />
      </label>
      <label className="space-y-1 md:col-span-2">
        <span className="block text-xs font-medium text-muted-foreground">Invoice terms</span>
        <Textarea
          value={defaults.terms || ""}
          onChange={(event) => setField("terms", event.target.value)}
          className="min-h-24 rounded-xl bg-card"
        />
      </label>
    </div>
  );
}

function TemplateInput({ label, value, onChange }) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <Input value={value || ""} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-xl bg-card" />
    </label>
  );
}
