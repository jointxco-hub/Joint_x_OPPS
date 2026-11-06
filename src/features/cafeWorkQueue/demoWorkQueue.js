// Synthetic sample data for local UI review only. No Supabase requests or writes.
// Use exclusively behind the localhost + Vite DEV guard in CafeWorkQueue.jsx.
import { normalizeWorkQueue } from "./normalizeWorkQueue.js";

const demoCards = [
  {
    type: "order", id: "demo-order-001", number: "DEMO-QS-001",
    customerName: "Sample Customer A", status: "processing", balanceDue: null,
    invoices: [
      { id: "demo-invoice-001", number: "DEMO-INV-001", sourceOrderId: "demo-order-001", status: "paid", balanceDue: 0, reviewRequired: false },
      { id: "demo-invoice-002", number: "DEMO-INV-002", sourceOrderId: "demo-order-001", status: "sent", balanceDue: 145, reviewRequired: false },
      { id: "demo-invoice-003", number: "DEMO-INV-003", sourceOrderId: "demo-order-001", status: "void", balanceDue: null, reviewRequired: true },
    ],
  },
  {
    type: "order", id: "demo-order-002", number: "DEMO-QS-002",
    customerName: "Sample Customer B", status: "awaiting_collection", balanceDue: null,
    invoices: [{ id: "demo-invoice-004", number: "DEMO-INV-004", sourceOrderId: "demo-order-002", status: "paid", balanceDue: 0, reviewRequired: false }],
  },
  {
    type: "order", id: "demo-order-003", number: "DEMO-QS-003",
    customerName: "Sample Customer C", status: "artwork_check", balanceDue: null, invoices: [],
  },
  {
    type: "invoice", id: "demo-invoice-005", number: "DEMO-INV-005",
    customerName: "Sample Customer D", status: "draft", balanceDue: null, reviewRequired: true, sourceOrderId: null,
  },
  {
    type: "invoice", id: "demo-invoice-006", number: "DEMO-INV-006",
    customerName: "Sample Customer E", status: "sent", balanceDue: 385.50, reviewRequired: false, sourceOrderId: null,
  },
  {
    type: "invoice", id: "demo-invoice-007", number: "DEMO-INV-007",
    customerName: "Sample Customer F", status: "sent", balanceDue: 75, reviewRequired: false,
    sourceOrderId: "demo-missing-order",
  },
  ...Array.from({ length: 13 }, (_, i) => ({
    type: "order",
    id: `demo-order-${String(i + 4).padStart(3, "0")}`,
    number: `DEMO-QS-${String(i + 4).padStart(3, "0")}`,
    customerName: `Sample Customer ${i + 7}`,
    status: i % 2 ? "processing" : "received",
    balanceDue: null, invoices: [],
  })),
];

export function getDemoCafeWorkQueue({ cursor = null, limit = 15 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid demo page size.");
  let start = 0;
  if (cursor !== null) {
    if (typeof cursor !== "string" || !/^demo:\d+$/.test(cursor)) throw new Error("Invalid demo cursor.");
    start = Number(cursor.slice(5));
    if (!Number.isSafeInteger(start) || start < 0 || start > demoCards.length) throw new Error("Invalid demo cursor.");
  }
  const next = start + limit < demoCards.length ? `demo:${start + limit}` : null;
  return normalizeWorkQueue({ items: demoCards.slice(start, start + limit), nextCursor: next });
}

export const demoCafeWorkCardCount = demoCards.length;
