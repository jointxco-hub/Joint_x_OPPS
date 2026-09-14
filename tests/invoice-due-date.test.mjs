import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { addDaysIso } from "../src/features/invoices/orderToInvoiceItems.js";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

// Bug: "Due on receipt" (dueDays=0) produced due_date one calendar day
// BEFORE invoice_date. Root cause: addDaysIso parsed "YYYY-MM-DD" as local
// time (`new Date(iso + "T00:00:00")`) then round-tripped through
// .toISOString(), which shifts the date backward a day in any timezone
// ahead of UTC (e.g. South Africa, UTC+2) — even at days=0. Fixed by doing
// the arithmetic entirely in UTC calendar components, which is
// timezone-independent by construction (these assertions hold regardless
// of the process's local TZ).

test("addDaysIso(date, 0) === date — Due on receipt invariant", () => {
  assert.equal(addDaysIso("2026-09-13", 0), "2026-09-13");
});

test("addDaysIso never shifts backward across a South-Africa-style UTC+ offset", () => {
  // the historically-broken implementation returned 2026-09-12 here
  assert.notEqual(addDaysIso("2026-09-13", 0), "2026-09-12");
});

test("addDaysIso adds forward correctly, including a month boundary", () => {
  assert.equal(addDaysIso("2026-09-13", 7), "2026-09-20");
  assert.equal(addDaysIso("2026-09-28", 5), "2026-10-03");
});

test("addDaysIso handles a year boundary and leap-day-adjacent dates", () => {
  assert.equal(addDaysIso("2026-12-30", 5), "2027-01-04");
  assert.equal(addDaysIso("2028-02-28", 1), "2028-02-29"); // 2028 is a leap year
});

test("addDaysIso falls back to today (UTC) when dateIso is falsy, still 0-day stable", () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(addDaysIso(null, 0), today);
});

// InvoiceCreateFlow.jsx keeps its own copy (a plain .jsx, not importable by
// node --test) — locked to the same UTC-safe pattern by source assertion so
// the two implementations can't silently re-diverge.
test("InvoiceCreateFlow.jsx's addDaysIso uses the same UTC-safe arithmetic, not the local-time round trip", async () => {
  const s = await src("src/features/invoices/InvoiceCreateFlow.jsx");
  const start = s.indexOf("function addDaysIso");
  const end = s.indexOf("\n}", start);
  const body = s.slice(start, end);
  assert.match(body, /Date\.UTC\(/, "builds the Date from UTC calendar components");
  assert.match(body, /setUTCDate\(/, "advances the day in UTC, not local time");
  assert.doesNotMatch(body, /new Date\(String\(dateIso\) \+ "T00:00:00"\)/, "no local-time parse of the date string");
});
