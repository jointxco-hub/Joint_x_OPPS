import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataClient } from "@/api/dataClient";
import { getInvoice } from "@/api/invoices";

function firstImageFrom(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value.find(Boolean);
    return firstImageFrom(first);
  }
  return value.src || value.url || value.image_url || value.thumbnail_url || "";
}

function productImage(product = {}) {
  return firstImageFrom(
    product.image_url ||
    product.thumbnail_url ||
    product.thumbnail ||
    product.image ||
    product.cover_image_url ||
    product.primary_image ||
    product.images
  );
}

function matchOrderProduct(item = {}, products = []) {
  if (!products.length) return null;
  if (item.source_order_item_id) {
    const byId = products.find((product) =>
      product.id === item.source_order_item_id ||
      product.catalog_item_id === item.source_order_item_id ||
      product.inventory_item_id === item.source_order_item_id
    );
    if (byId) return byId;
  }

  const lineIndex = Number(item.line_number || 0) - 1;
  if (products[lineIndex]) return products[lineIndex];

  const itemName = String(item.item_name || "").trim().toLowerCase();
  return products.find((product) =>
    String(product.name || product.product_name || product.title || "").trim().toLowerCase() === itemName
  ) || null;
}

export function useClientInvoiceData(invoiceId) {
  const invoiceQuery = useQuery({
    queryKey: ["clientInvoice", invoiceId],
    queryFn: () => getInvoice(invoiceId, { includeItems: true }),
    enabled: Boolean(invoiceId),
  });

  const orderId = invoiceQuery.data?.source_order_id;
  const orderQuery = useQuery({
    queryKey: ["clientInvoiceOrder", orderId],
    queryFn: async () => {
      const rows = await dataClient.entities.Order.filter({ id: orderId }, undefined, 1);
      return rows?.[0] || null;
    },
    enabled: Boolean(orderId),
  });

  const data = useMemo(() => {
    const invoice = invoiceQuery.data;
    const order = orderQuery.data;
    const products = Array.isArray(order?.products) ? order.products : [];
    const items = Array.isArray(invoice?.items)
      ? invoice.items.map((item) => {
          const product = matchOrderProduct(item, products);
          return {
            ...item,
            thumbnail_url: productImage(product),
            variant_details: [
              product?.size,
              product?.color,
              product?.category,
            ].filter(Boolean).join(" / "),
          };
        })
      : [];

    return invoice ? { invoice: { ...invoice, items }, order } : null;
  }, [invoiceQuery.data, orderQuery.data]);

  return {
    data,
    isLoading: invoiceQuery.isLoading || orderQuery.isLoading,
    error: invoiceQuery.error || orderQuery.error,
  };
}
