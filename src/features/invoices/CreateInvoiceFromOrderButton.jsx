import { FileText } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createInvoice, getInvoiceSetting, listInvoices } from "@/api/invoices";
import { INVOICE_SETTING_KEYS, normalizeInvoiceDefaultsSetting } from "./invoiceSettings";
import { invoiceFromOrder } from "./orderToInvoiceItems";

export default function CreateInvoiceFromOrderButton({
  order,
  totalPaid = 0,
  existingInvoice,
  onCreated,
  onOpenInvoice,
}) {
  const createFromOrder = async ({ allowDuplicate = false } = {}) => {
    if (!allowDuplicate && order?.id) {
      const linkedInvoices = await listInvoices({ sourceOrderId: order.id, pageSize: 1 });
      const foundInvoice = linkedInvoices.data?.[0];
      if (foundInvoice) {
        throw Object.assign(new Error("An OPPS invoice already exists for this order."), {
          code: "invoice_exists",
          invoice: foundInvoice,
        });
      }
    }

    const defaults = normalizeInvoiceDefaultsSetting(await getInvoiceSetting(INVOICE_SETTING_KEYS.invoiceDefaults));
    return createInvoice(invoiceFromOrder(order, totalPaid, defaults));
  };

  const mutation = useMutation({
    mutationFn: createFromOrder,
    onSuccess: (invoice) => {
      toast.success("OPPS invoice created.");
      onCreated?.(invoice);
    },
    onError: (error) => {
      if (error?.code === "invoice_exists") {
        toast.info("This order already has an OPPS invoice.");
        onCreated?.(error.invoice);
        return;
      }
      toast.error(error?.message || "Could not create invoice");
    },
  });

  const createAnother = () => {
    const confirmed = window.confirm("This order already has an OPPS invoice. Create another invoice anyway?");
    if (confirmed) mutation.mutate({ allowDuplicate: true });
  };

  if (existingInvoice) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenInvoice?.(existingInvoice)}
          className="h-9 rounded-xl border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
        >
          <FileText className="h-4 w-4" />
          Open OPPS invoice
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={createAnother}
          disabled={mutation.isPending}
          className="h-9 rounded-xl text-muted-foreground"
        >
          {mutation.isPending ? "Creating invoice..." : "Create another"}
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => mutation.mutate({ allowDuplicate: false })}
      disabled={mutation.isPending}
      className="h-9 rounded-xl border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
    >
      <FileText className="h-4 w-4" />
      {mutation.isPending ? "Creating invoice..." : "Create OPPS invoice"}
    </Button>
  );
}
