import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getDemoCafeWorkQueue, demoCafeWorkCardCount } from "../src/features/cafeWorkQueue/demoWorkQueue.js";

const page = await readFile(new URL("../src/pages/CafeWorkQueue.jsx", import.meta.url), "utf8");

test("synthetic Cafe data includes linked paid, partial, void and standalone invoices", () => {
  const first = getDemoCafeWorkQueue({ limit: 15 });
  const order = first.items.find(item => item.number === "DEMO-QS-001");
  assert.ok(order);
  assert.equal(order.balanceDue, null);
  assert.deepEqual(order.invoices.map(item => item.balanceDue), [0, 145, null]);
  assert.equal(order.invoices[2].reviewRequired, true);
  assert.ok(first.items.some(item => item.type === "invoice" && item.sourceOrderId === null));
  assert.ok(first.items.some(item => item.type === "invoice" && item.sourceOrderId === "demo-missing-order"));
  assert.ok(first.items.every(item => item.number.startsWith("DEMO-")));
});

test("synthetic pagination delivers every card once across multiple pages", () => {
  let cursor = null;
  const seen = new Set();
  for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
    const result = getDemoCafeWorkQueue({ cursor, limit: 7 });
    for (const item of result.items) {
      assert.ok(!seen.has(item.key), "duplicate card across demo pages");
      seen.add(item.key);
    }
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  assert.equal(seen.size, demoCafeWorkCardCount);
  assert.equal(cursor, null);
});

test("synthetic data rejects malformed or unsafe cursors", () => {
  assert.throws(() => getDemoCafeWorkQueue({ cursor: "not-a-demo-cursor" }));
  assert.throws(() => getDemoCafeWorkQueue({ cursor: "demo:-1" }));
  assert.throws(() => getDemoCafeWorkQueue({ cursor: "demo:9999" }));
  assert.throws(() => getDemoCafeWorkQueue({ limit: 51 }));
});

test("demo mode is explicitly limited to localhost development and visibly marked", () => {
  assert.match(page, /import\.meta\.env\.DEV/);
  assert.match(page, /\["localhost", "127\.0\.0\.1", "::1", "\[::1\]"\]/);
  assert.match(page, /get\("demo"\) === "1"/);
  assert.match(page, /DEMO DATA · Local preview only/);
  assert.match(page, /localDemoMode\s*\? Promise\.resolve\(\)\.then\(\(\) => getDemoCafeWorkQueue/);
  assert.match(page, /: getCafeWorkQueue\(\{ cursor, limit: PAGE_SIZE \}\)/);
});
