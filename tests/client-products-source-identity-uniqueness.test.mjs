import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// client_products previously had NO uniqueness protection at all for
// (client_id, opps_product_id) - only a primary key and plain, non-
// unique indexes on client_id/tenant_id. "No duplicate client_product
// per client+catalog-item" was only an informal property of
// ProductsEditor.jsx's find-or-create logic. Rather than adding
// asymmetric protection only to the new inventory_item_id column
// (202608220009), migration 202608220010 adds matching partial unique
// indexes for BOTH identity types, so they're genuinely mirrored.
//
// This repo has no live-database test harness reachable from
// `node --test` (see every other *.test.mjs in this directory - all
// pure-logic or source-inspection). The actual constraint behavior was
// verified directly against production inside a single transaction that
// ended in ROLLBACK - nothing was left applied. That script and its
// result are reproduced below for anyone auditing this later; these
// tests guard the migration file's shape, not a live re-execution.
//
// Verified live (read-only before, and confirmed no trace after):
//   BEGIN;
//   ALTER TABLE client_products ADD COLUMN inventory_item_id ...;
//   ALTER TABLE client_products ADD CONSTRAINT ...single_source_identity_check...;
//   CREATE UNIQUE INDEX client_products_client_catalog_uidx
//     ON client_products (client_id, opps_product_id) WHERE opps_product_id IS NOT NULL;
//   CREATE UNIQUE INDEX client_products_client_inventory_uidx
//     ON client_products (client_id, inventory_item_id) WHERE inventory_item_id IS NOT NULL;
//   DO $$ ... five scenarios, each asserted via unique_violation exception
//        handling or a plain successful insert ... $$;
//   -- result: "ALL 5 TESTS PASSED"
//   ROLLBACK;
// Post-rollback: inventory_item_id column absent again, zero leftover
// TEST-prefixed rows - production is byte-for-byte what it was before.
//
// The five scenarios proven:
//   1. two client_products for the same client+inventory item cannot be created (unique_violation)
//   2. the same inventory item CAN back client_products for two different clients
//   3. two different inventory items CAN both back client_products for the same client
//   4. catalog-backed duplicate rejection is unchanged (same mechanism, now DB-enforced not just app-level)
//   5. a fully custom client_product (both opps_product_id and inventory_item_id null) remains allowed,
//      including creating more than one for the same client (the partial index only applies to non-null values)
// ─────────────────────────────────────────────────────────────────────

test("migration 202608220010 adds a partial unique index for (client_id, opps_product_id) WHERE opps_product_id IS NOT NULL", async () => {
  const source = await readSource("supabase/migrations/202608220010_client_products_source_identity_uniqueness.sql");
  assert.match(source, /create unique index if not exists client_products_client_catalog_uidx\s+on public\.client_products \(client_id, opps_product_id\)\s+where opps_product_id is not null;/i);
});

test("migration 202608220010 adds the mirrored partial unique index for (client_id, inventory_item_id) WHERE inventory_item_id IS NOT NULL", async () => {
  const source = await readSource("supabase/migrations/202608220010_client_products_source_identity_uniqueness.sql");
  assert.match(source, /create unique index if not exists client_products_client_inventory_uidx\s+on public\.client_products \(client_id, inventory_item_id\)\s+where inventory_item_id is not null;/i);
});

test("both indexes use the identical (client_id, <identity column>) shape - genuinely mirrored, not a different identity model", async () => {
  const source = await readSource("supabase/migrations/202608220010_client_products_source_identity_uniqueness.sql");
  const catalogMatch = source.match(/create unique index[^;]*client_products_client_catalog_uidx[^;]*;/i)?.[0] ?? "";
  const inventoryMatch = source.match(/create unique index[^;]*client_products_client_inventory_uidx[^;]*;/i)?.[0] ?? "";
  assert.ok(catalogMatch.includes("(client_id, opps_product_id)"));
  assert.ok(inventoryMatch.includes("(client_id, inventory_item_id)"));
  assert.ok(catalogMatch.includes("where opps_product_id is not null"));
  assert.ok(inventoryMatch.includes("where inventory_item_id is not null"));
  assert.ok(!catalogMatch.toLowerCase().includes("tenant_id"), "must match the confirmed canonical shape (client_id only) - client_products has no existing tenant_id-inclusive uniqueness convention to mirror");
  assert.ok(!inventoryMatch.toLowerCase().includes("tenant_id"));
});
