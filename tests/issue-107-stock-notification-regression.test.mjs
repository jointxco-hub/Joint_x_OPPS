import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const file = new URL("../src/components/common/NotificationsPanel.jsx", import.meta.url);
const source = readFileSync(file, "utf8");

test("notification panel never presents OS notifications from passive snapshot data",()=>{
  assert.doesNotMatch(source,/new Notification\s*\(/);
  assert.doesNotMatch(source,/\.showNotification\s*\(/);
  assert.doesNotMatch(source,/jx_last_notification/);
  assert.doesNotMatch(source,/lastNotifiedRef/);
});
test("low-stock conditions remain in the in-app bell, not silently discarded",()=>{
  assert.match(source,/id:\s*`stock_\$\{item\.id\}`/);
  assert.match(source,/title:\s*`Low stock:/);
  assert.match(source,/notifications\.map\(n\s*=>/);
});
test("notification panel no longer depends on browser notification permission on mount",()=>{
  assert.doesNotMatch(source,/Notification\.permission/);
  assert.doesNotMatch(source,/serviceWorker\.ready/);
});
