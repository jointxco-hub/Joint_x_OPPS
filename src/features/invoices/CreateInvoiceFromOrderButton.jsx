import { FileText } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createInvoice } from "@/api/invoices";

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveMoneyOrNull(value) {
  const parsed = numberOrZero(value);
  return parsed > 0 ? parsed : null;
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
  };
}

function invoiceFromOrder(order = {}, totalPaid = 0) {
  const products = Array.isArray(order.products) && order.products.length
    ? order.products
    : [{ name: order.blank_type || order.product_name || "Custom item", quantity: order.quantity || 1, price: order.total_amount || 0 }];
  const items = products.map(itemFromProduct);
  const shippingCharge = numberOrZero(order.shipping_charge ?? order.delivery_fee ?? order.delivery_cost ?? order.courier_fee);
  const amountPaid = resolveOrderAmountPaid(order, totalPaid);

  return {
    customer_id: order.client_id || "",
    customer_name: order.client_name || "Customer",
    customer_email: order.client_email || "",
    customer_phone: order.client_phone || "",
    customer_billing_address: order.delivery_note || "",
    source_order_id: order.id,
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: order.due_date || "",
    payment_terms: "",
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
    terms: "",
    internal_notes: `Created from OPPS order ${order.order_number || order.id || ""}`.trim(),
    items,
  };
}

export default function CreateInvoiceFromOrderButton({ order, totalPaid = 0, onCreated }) {
  const mutation = useMutation({
    mutationFn: () => createInvoice(invoiceFromOrder(order, totalPaid)),
    onSuccess: (invoice) => {
      toast.success(`OPPS invoice ${invoice.invoice_number} created`);
      onCreated?.(invoice);
    },
    onError: (error) => toast.error(error?.message || "Could not create invoice"),
  });

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="h-9 rounded-xl border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
    >
      <FileText className="h-4 w-4" />
      {mutation.isPending ? "Creating..." : "Create OPPS invoice"}
    </Button>
  );
}
