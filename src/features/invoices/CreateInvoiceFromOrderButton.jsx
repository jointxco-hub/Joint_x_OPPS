import { FileText } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createInvoice, getInvoiceSetting, listInvoices } from "@/api/invoices";
import { INVOICE_SETTING_KEYS, normalizeInvoiceDefaultsSetting } from "./invoiceSettings";

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveMoneyOrNull(value) {
  const parsed = numberOrZero(value);
  return parsed > 0 ? parsed : null;
}

function uuidOrEmpty(value) {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

function addDaysIso(dateIso, days = 0) {
  const date = dateIso ? new Date(String(dateIso) + "T00:00:00") : new Date();
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function resolveOrderAmountPaid(order = {}, totalPaid = 0) {
  const candidates = [
    totalPaid,
    order.amount_paid,
    order.deposit_paid,
    order.deposit_amount,
    order.paid_amount,
  ];
  const paid = candidates.map(positiveMoneyOrNull).find((value) => value !== null);
  return paid || 0;
}

function itemFromProduct(product = {}, index = 0) {
  const name = product.name || product.product_name || product.title || "Custom item";
  const quantity = numberOrZero(product.quantity) > 0 ? numberOrZero(product.quantity) : 1;
  const unitRate = product.price ?? product.rate ?? product.unit_price;
  const rate = unitRate !== undefined && unitRate !== null && unitRate !== ""
    ? numberOrZero(unitRate)
    : numberOrZero(product.line_total) / quantity;

  return {
    line_number: index + 1,
    item_name: name,
    item_description: product.notes || product.description || product.size || product.color || "",
    item_type: "goods",
    quantity,
    unit: product.unit || "",
    rate,
    discount: numberOrZero(product.discount),
    tax_name: "",
    tax_percentage: 0,
    account_name: "",
    source_order_item_id: uuidOrEmpty(product.id || product.catalog_item_id || product.inventory_item_id) || null,
    catalog_item_id: uuidOrEmpty(product.catalog_item_id || product.product_id),
    inventory_item_id: uuidOrEmpty(product.inventory_item_id),
    source_metadata: {
      source: product.source || "order",
      category: product.category || product.product_category || "",
      image_url: product.image_url || product.thumbnail_url || product.cover_image_url || "",
      size: product.size || product.variant_size || "",
      color: product.color || product.colour || product.variant_color || "",
      selected_print_options: Array.isArray(product.selected_print_options) ? product.selected_print_options : [],
      selected_addons: Array.isArray(product.selected_addons) ? product.selected_addons : [],
    },
  };
}

function invoiceFromOrder(order = {}, totalPaid = 0, defaults = normalizeInvoiceDefaultsSetting()) {
  const products = Array.isArray(order.products) && order.products.length
    ? order.products
    : [{ name: order.blank_type || order.product_name || "Custom item", quantity: order.quantity || 1, price: order.total_amount || 0 }];
  const items = products.map(itemFromProduct);
  const shippingCharge = numberOrZero(order.shipping_charge ?? order.delivery_fee ?? order.delivery_cost ?? order.courier_fee ?? defaults.shippingCharge);
  const amountPaid = resolveOrderAmountPaid(order, totalPaid);
  const invoiceDate = new Date().toISOString().slice(0, 10);

  return {
    customer_id: order.client_id || "",
    customer_name: order.client_name || "Customer",
    customer_email: order.client_email || "",
    customer_phone: order.client_phone || "",
    customer_billing_address: order.delivery_note || "",
    source_order_id: order.id,
    invoice_date: invoiceDate,
    due_date: order.due_date || addDaysIso(invoiceDate, defaults.dueDays),
    payment_terms: defaults.paymentTerms,
    currency_code: "ZAR",
    status: "draft",
    reference_number: order.order_number || order.tracking_number || "",
    shipping_charge: shippingCharge,
    adjustment: 0,
    amount_paid: amountPaid,
    payment_data_warning: amountPaid === 0 && [
      totalPaid,
      order.amount_paid,
      order.deposit_paid,
      order.deposit_amount,
      order.paid_amount,
    ].some((value) => numberOrZero(value) < 0),
    notes: order.notes || order.special_instructions || "",
    terms: defaults.terms,
    internal_notes: `Created from OPPS order ${order.order_number || order.id || ""}`.trim(),
    items,
  };
}

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
