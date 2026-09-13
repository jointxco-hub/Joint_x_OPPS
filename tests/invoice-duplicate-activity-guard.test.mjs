import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const API = "src/api/invoices.js";
const DRAWER = "src/features/invoices/InvoiceDetailDrawer.jsx";
const PAGE = "src/pages/Invoices.jsx";

// Bug: two rapid Approve clicks on the same draft invoice produced two
// identical "Invoice approved" activity rows at the same timestamp. Root
// cause: updateInvoice() reads currentInvoice.status with no row lock, so
// two near-simultaneous calls both see status='draft' before either write
// lands, and each independently concludes a transition happened. Fixed two
// ways: (1) a UI-level pending guard so a double-click can't fire the
// mutation twice in practice, and (2) a short-window duplicate check in
// createInvoiceActivity as defence in depth for any other near-simultaneous
// caller (retry, etc).

test("createInvoiceActivity checks for a just-inserted identical row before writing a new one", async () => {
  const s = await src(API);
  const start = s.indexOf("async function createInvoiceActivity");
  const body = s.slice(start, s.indexOf("\nexport async function nextInvoiceNumber", start));
  assert.match(body, /RECENT_DUPLICATE_ACTIVITY_WINDOW_MS/);
  assert.match(body, /\.eq\("invoice_id", invoiceId\)/);
  assert.match(body, /\.eq\("activity_type", type\)/);
  assert.match(body, /\.gte\("created_at", sinceIso\)/);
  assert.match(body, /if \(recent && recent\[0\]\) return recent\[0\];/, "an existing recent match is reused instead of inserting a duplicate");
});

test("the duplicate guard matches on from_status/to_status too, not just invoice_id + type", async () => {
  const s = await src(API);
  const start = s.indexOf("async function createInvoiceActivity");
  const body = s.slice(start, s.indexOf("\nexport async function nextInvoiceNumber", start));
  assert.match(body, /is\("from_status", null\)|eq\("from_status", fromStatus\)/);
  assert.match(body, /is\("to_status", null\)|eq\("to_status", toStatus\)/);
});

test("InvoiceDetailDrawer disables Approve while the mutation is pending — both call sites", async () => {
  const s = await src(DRAWER);
  assert.match(s, /isApprovePending = false/, "prop exists with a safe default");
  assert.match(s, /if \(isApprovePending\) return;/, "handleApproveClick bails synchronously while already pending");
  assert.match(s, /onClick=\{handleApproveClick\} disabled=\{isApprovePending\}/, "the primary Approve button is disabled while pending");
  // "Approve anyway" also appears in an explanatory comment earlier in the
  // file — anchor on the button text's LAST occurrence, not the first.
  const approveAnywayButtonIdx = s.lastIndexOf("Approve anyway");
  const dialogSection = s.slice(Math.max(approveAnywayButtonIdx - 300, 0), approveAnywayButtonIdx);
  assert.match(dialogSection, /disabled=\{isApprovePending\}/, "the 'Approve anyway' confirm button is also guarded");
  assert.match(dialogSection, /if \(isApprovePending\) return;/, "the confirm dialog's onClick also bails while pending");
});

test("Invoices.jsx wires isApprovePending from the real mutation state", async () => {
  const s = await src(PAGE);
  assert.match(s, /isApprovePending=\{approveMutation\.isPending\}/);
});
