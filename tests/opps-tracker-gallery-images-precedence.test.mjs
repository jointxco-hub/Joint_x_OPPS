import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

function withoutComments(s) {
  return s.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
}

const MIGRATION = "supabase/migrations/20260917091000_tracker_gallery_images_precedence.sql";

// MULTI-PICTURE PRODUCT ITEM LINE — surfaces a real multi-image gallery
// on the public tracker from the order line's own frozen 'image_gallery'
// (written by X LAB migration 20260917090000), instead of the
// always-0-or-1-entry placeholder this repo shipped previously.

test("gallery_images comes from the line's own frozen image_gallery when present, falling back to the existing single-entry derivation only when absent/empty", async () => {
  const sql = withoutComments(await src(MIGRATION));
  assert.match(sql, /'gallery_images', coalesce\(gallery\.gallery_images, case/);
});

test("reference-role images are filtered out before they reach the gallery projection — internal pictures stay staff-only by default", async () => {
  const sql = withoutComments(await src(MIGRATION));
  const galleryLateralStart = sql.indexOf("left join lateral (\n        select\n          jsonb_agg");
  const galleryLateralEnd = sql.indexOf(") gallery on true", galleryLateralStart);
  const block = sql.slice(galleryLateralStart, galleryLateralEnd);
  assert.match(block, /where coalesce\(g ->> 'role', ''\) <> 'reference'/);
});

test("a private-upload gallery entry is exposed ONLY as an opaque thumbnail_ref — never a raw resolvable safe_url, matching the existing single-image precedent", async () => {
  const sql = withoutComments(await src(MIGRATION));
  const galleryLateralStart = sql.indexOf("left join lateral (\n        select\n          jsonb_agg");
  const galleryLateralEnd = sql.indexOf(") gallery on true", galleryLateralStart);
  const block = sql.slice(galleryLateralStart, galleryLateralEnd);
  assert.match(block, /'safe_url', case when \(g ->> 'image_ref'\) ~\* '\^https:\/\/' then g ->> 'image_ref' else null end/);
  assert.match(block, /'thumbnail_ref', case when \(g ->> 'image_ref'\) ~\* '\^private-upload:\/\/uploads\/' then g ->> 'image_ref' else null end/);
});

test("line_id is exposed when either the primary OR any gallery entry is a private ref — a viewer always has what it needs to resolve every private thumbnail on that line", async () => {
  const sql = withoutComments(await src(MIGRATION));
  assert.match(sql, /'line_id', case when resolved\.thumbnail_ref is not null or gallery\.has_private_entries then item ->> 'line_id' else null end/);
});

test("verify_public_tracker_visible_thumbnail_ref authorizes a ref against the line's own image_url OR any non-reference entry in its image_gallery — same trust boundary, no new resolution mechanism", async () => {
  const sql = withoutComments(await src(MIGRATION));
  const start = sql.indexOf("create or replace function public.verify_public_tracker_visible_thumbnail_ref");
  const end = sql.indexOf("$function$;", start + 20);
  const body = sql.slice(start, end);
  assert.match(body, /item ->> 'image_url' = input\.clean_ref/);
  assert.match(body, /g ->> 'image_ref' = input\.clean_ref\s*\n\s*and coalesce\(g ->> 'role', ''\) <> 'reference'/);
});

test("does not touch client_product_artwork, order_line_component_snapshots, Phase 2 readiness, PayFast, or invoice-payment objects", async () => {
  const sql = await src(MIGRATION);
  assert.doesNotMatch(sql, /(insert into|update|alter table)\s+public\.client_product_artwork/i);
  assert.doesNotMatch(sql, /(insert into|update|alter table)\s+public\.order_line_component_snapshots/i);
  assert.doesNotMatch(sql, /(create or replace|drop|alter)\s+function\s+public\.(get_order_line_production_readiness|_compute_order_line_production_readiness|record_manual_invoice_payment|apply_invoice_payfast_payment)/);
});

test("migration is wrapped in a single begin/commit transaction and documents a rollback path", async () => {
  const sql = await src(MIGRATION);
  const trimmed = sql.trim();
  assert.match(trimmed, /^--/, "starts with a header comment");
  assert.match(sql, /\nbegin;\n/);
  assert.match(trimmed, /commit;$/);
  assert.equal((sql.match(/\nbegin;\n/g) || []).length, 1);
  assert.equal((sql.match(/\ncommit;/g) || []).length, 1);
  assert.match(sql, /Rollback:/);
});
