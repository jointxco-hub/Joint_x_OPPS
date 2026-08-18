import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildClientDefaultsUpdate, hydrateOrderClientDefaults } from '../src/features/orders/clientDefaults.js';
import { getAlreadyLinkedElsewhereInvoices, getLinkableInvoiceCandidates } from '../src/features/invoices/orderInvoiceCandidates.js';

const migrationUrl = new URL('../supabase/migrations/20260817173710_request_assets_order_identity.sql', import.meta.url);
const dataClientUrl = new URL('../src/api/dataClient.js', import.meta.url);

test('request assets reuse client_file_links with one cover and tenant-scoped staff RPCs', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /linked_quote_request_id uuid references public\.client_quote_requests/);
  assert.match(sql, /idx_client_file_links_quote_request_primary_unique/);
  assert.match(sql, /where linked_quote_request_id is not null and is_request_primary = true/);
  assert.match(sql, /can_manage_internal_client_requests\(\)/);
  assert.match(sql, /current_user_tenant_ids\(\)/);
  assert.match(sql, /linked_xlab_order_id=new_order\.id/);
  assert.match(sql, /'file_urls',to_jsonb\(request_file_urls\)/);
  assert.match(sql, /revoke all on function public\.get_internal_client_request_assets\(uuid\) from public, anon/);
});

test('clear cover is a distinct flag from set-primary so plain role updates cannot accidentally clear the cover', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /p_clear_primary boolean default false/);
  assert.match(sql, /if p_set_primary and p_clear_primary then raise exception/);
  assert.match(sql, /is_request_primary=case when p_set_primary then true when p_clear_primary then false else is_request_primary end/);
  assert.match(sql, /revoke all on function public\.update_internal_client_request_asset\(uuid,uuid,text,boolean,boolean\) from public, anon/);
  assert.match(sql, /grant execute on function public\.update_internal_client_request_asset\(uuid,uuid,text,boolean,boolean\) to authenticated/);
  const wrapperSource = await readFile(new URL('../src/api/clientRequests.js', import.meta.url), 'utf8');
  assert.match(wrapperSource, /p_clear_primary: Boolean\(clearPrimary\)/);
});

test('Mike invoice-first scenario links one existing draft without creating another invoice', () => {
  const mikeOrder = { id: 'order-mike', client_id: 'client-mike' };
  const invoices = [
    { id: 'invoice-mike', customer_id: 'client-mike', status: 'draft', source_order_id: null, invoice_date: '2026-08-10' },
    { id: 'invoice-issued', customer_id: 'client-mike', status: 'approved', source_order_id: null, invoice_date: '2026-08-11' },
    { id: 'invoice-other', customer_id: 'client-other', status: 'draft', source_order_id: null, invoice_date: '2026-08-12' },
  ];
  // Eligibility now extends beyond draft (any non-void status) - the
  // approved same-client invoice is a legitimate candidate too, sorted
  // newest-first alongside the draft. Cross-client stays excluded either way.
  const candidates = getLinkableInvoiceCandidates(invoices, mikeOrder);
  assert.deepEqual(candidates.map((invoice) => invoice.id), ['invoice-issued', 'invoice-mike']);
  const beforeCount = invoices.length;
  const linked = { ...candidates[1], source_order_id: mikeOrder.id };
  assert.equal(linked.source_order_id, mikeOrder.id);
  assert.equal(invoices.length, beforeCount);
  assert.equal(getLinkableInvoiceCandidates([linked], mikeOrder).length, 0);
});

test('void invoices are never linkable candidates regardless of client match', () => {
  const order = { id: 'order-1', client_id: 'client-a' };
  const invoices = [
    { id: 'invoice-void', customer_id: 'client-a', status: 'void', source_order_id: null, invoice_date: '2026-08-10' },
    { id: 'invoice-paid', customer_id: 'client-a', status: 'paid', source_order_id: null, invoice_date: '2026-08-09' },
  ];
  const candidates = getLinkableInvoiceCandidates(invoices, order);
  assert.deepEqual(candidates.map((invoice) => invoice.id), ['invoice-paid']);
});

test('an invoice already linked to a different order is surfaced separately, never silently reassignable', () => {
  const order = { id: 'order-2', client_id: 'client-a' };
  const invoices = [
    { id: 'invoice-elsewhere', customer_id: 'client-a', status: 'approved', source_order_id: 'order-other', invoice_date: '2026-08-10' },
    { id: 'invoice-self', customer_id: 'client-a', status: 'approved', source_order_id: 'order-2', invoice_date: '2026-08-11' },
    { id: 'invoice-free', customer_id: 'client-a', status: 'approved', source_order_id: null, invoice_date: '2026-08-12' },
  ];
  assert.deepEqual(getLinkableInvoiceCandidates(invoices, order).map((i) => i.id), ['invoice-free']);
  assert.deepEqual(getAlreadyLinkedElsewhereInvoices(invoices, order).map((i) => i.id), ['invoice-elsewhere']);
});

test('preferred courier and contact defaults hydrate while historical order snapshots remain unchanged', () => {
  const client = {
    id: 'client-mike', name: 'Mike', email: 'mike@example.test', phone: '0710000000',
    whatsapp_name: 'Mike WA', saved_contact_name: 'Mike Tees', preferred_courier: 'PAXI',
  };
  const orderA = { ...hydrateOrderClientDefaults(client) };
  const update = buildClientDefaultsUpdate({
    ...orderA, courier: 'Courier Guy', whatsapp_name: 'Mike Orders', saved_contact_name: 'Mike Tees',
  });
  Object.assign(client, {
    preferred_courier: update.preferred_courier,
    whatsapp_name: update.whatsapp_name,
  });
  const orderB = { ...hydrateOrderClientDefaults(client) };
  assert.equal(orderA.courier, 'PAXI');
  assert.equal(orderA.whatsapp_name, 'Mike WA');
  assert.equal(orderB.courier, 'Courier Guy');
  assert.equal(orderB.whatsapp_name, 'Mike Orders');
});

test('intentional blank reusable values serialize as null while order snapshot aliases are retained', async () => {
  const update = buildClientDefaultsUpdate({ client_name: 'Mike', client_email: '', client_phone: ' ', courier: '' });
  assert.equal(update.email, null);
  assert.equal(update.phone, null);
  assert.equal(update.preferred_courier, null);
  const source = await readFile(dataClientUrl, 'utf8');
  assert.match(source, /whatsapp_name: payload\.whatsapp_name/);
  assert.match(source, /saved_contact_name: payload\.saved_contact_name/);
  assert.match(source, /display_name: payload\.display_name/);
});

test('invoice FK is additive and uses history-safe delete semantics', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /opps_invoices_source_order_id_fkey/);
  assert.match(sql, /foreign key \(source_order_id\) references public\.orders\(id\) on delete set null not valid/);
  assert.match(sql, /validate constraint opps_invoices_source_order_id_fkey/);
});
