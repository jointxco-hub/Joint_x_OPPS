import test from "node:test";
import assert from "node:assert/strict";
import { documentDisplayName, documentPageSummary } from "../src/lib/documentDisplay.js";

test("generated upload names become readable without changing meaningful names", () => {
  assert.equal(documentDisplayName("1791286134068_aqtzdf4a0h.png"), "Document 1");
  assert.equal(documentDisplayName(null, 1), "Document 2");
  assert.equal(documentDisplayName("Invoice-2026.pdf"), "Invoice-2026.pdf");
});
test("print instructions preserve selected ranges and omit internal identifiers", () => {
  assert.equal(documentPageSummary({selection:"all", sourcePages:1, key:"private-key"}), "All pages · 1 page");
  assert.equal(documentPageSummary({selection:"specific", pagesSpec:"1-3, 5", selectedPages:4}), "Pages 1-3, 5 · 4 pages");
  assert.equal(documentPageSummary({selection:"all"}), "All pages");
});

test("Details loads shared readiness and document actions navigate to Files", async () => {
  const { readFile } = await import("node:fs/promises");
  const hook = await readFile(new URL("../src/hooks/useOrderDrawerData.js", import.meta.url), "utf8");
  assert.match(hook, /enabled: \["details", "readiness"\]\.includes\(activeTab\) && canLoadReadiness && !readinessAuthBlocked/);
  const drawer = await readFile(new URL("../src/components/orders/OrderDrawer.jsx", import.meta.url), "utf8");
  assert.match(drawer, /QuickSolutionServiceItems order=\{order\} onViewFiles=\{\(\) => setTab\("files"\)\}/);
});
