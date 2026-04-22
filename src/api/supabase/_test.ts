/**
 * ─────────────────────────────────────────────────────────────
 *  SUPABASE CONNECTION TEST  —  Phase 1
 *  File: src/api/supabase/_test.ts
 *
 *  HOW TO USE:
 *    Import and call testSupabaseConnection() from a temporary
 *    button / page during development.  Remove before production.
 *
 *  This file is self-contained and does NOT touch Base44 at all.
 * ─────────────────────────────────────────────────────────────
 */

import { supabase } from '@/lib/supabaseClient';
import {
  createOrderSupabase,
  getOrdersSupabase,
  updateOrderStatusSupabase,
  archiveOrderSupabase,
} from './orders';

/**
 * Runs a full create → read → update → archive cycle against
 * your Supabase project.  Check the browser console for results.
 *
 * Call this from a dev-only button:
 *   <button onClick={testSupabaseConnection}>Test Supabase</button>
 */
export async function testSupabaseConnection(): Promise<void> {
  console.group('🧪 Supabase Phase 1 — Connection Test');

  // ── 1. Ping (verify env vars + network) ─────────────────────
  console.log('Step 1: Checking connection …');
  const { error: pingError } = await supabase
    .from('orders')
    .select('id')
    .limit(1);

  if (pingError) {
    console.error('❌ Connection failed:', pingError.message);
    console.groupEnd();
    return;
  }
  console.log('✅ Connected to Supabase');

  // ── 2. CREATE ────────────────────────────────────────────────
  console.log('\nStep 2: Creating test order …');
  const testOrderNumber = `TEST-${Date.now()}`;

  const { data: created, error: createError } = await createOrderSupabase({
    client_name:   'Phase 1 Test Client',
    client_email:  'test@example.com',
    order_number:  testOrderNumber,
    total_amount:  999,
    deposit_paid:  500,
    print_type:    'dtf',
    priority:      'normal',
    products: [
      { name: 'Test T-Shirt', quantity: 10, price: 99.90, size: 'M', color: 'Black' },
    ],
    source: 'opps',
  });

  if (createError || !created) {
    console.error('❌ Create failed:', createError);
    console.groupEnd();
    return;
  }
  console.log('✅ Order created:', created.id, created.order_number);

  // ── 3. READ ──────────────────────────────────────────────────
  console.log('\nStep 3: Fetching all active orders …');
  const { data: orders, error: fetchError } = await getOrdersSupabase({ limit: 5 });

  if (fetchError) {
    console.error('❌ Fetch failed:', fetchError);
  } else {
    console.log(`✅ Fetched ${orders?.length} order(s)`);
    console.table(
      orders?.map(o => ({
        id:     o.id?.slice(0, 8) + '…',
        number: o.order_number,
        status: o.status,
        client: o.client_name,
      }))
    );
  }

  // ── 4. UPDATE STATUS ─────────────────────────────────────────
  console.log('\nStep 4: Updating status to in_production …');
  const { data: updated, error: updateError } = await updateOrderStatusSupabase(
    created.id!,
    'in_production'
  );

  if (updateError) {
    console.error('❌ Update failed:', updateError);
  } else {
    console.log('✅ Status updated to:', updated?.status);
  }

  // ── 5. ARCHIVE (soft-delete) ─────────────────────────────────
  console.log('\nStep 5: Archiving test order …');
  const { data: archived, error: archiveError } = await archiveOrderSupabase(
    created.id!,
    'test@developer.com'
  );

  if (archiveError) {
    console.error('❌ Archive failed:', archiveError);
  } else {
    console.log('✅ Order archived:', archived?.is_archived, 'at', archived?.archived_at);
  }

  // ── Done ─────────────────────────────────────────────────────
  console.log('\n🎉 Phase 1 test complete — Supabase is ready!');
  console.log('   Next step: run the SQL schema, then try the live tables.');
  console.groupEnd();
}
