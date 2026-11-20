-- OPPS-106: READ-ONLY PRODUCTION SCHEMA PRECHECK.
-- Purpose: report dependencies; NEVER an authorization to enable payments.
-- Run ONLY after independently confirming the intended Supabase project.
-- No DDL, DML, credential reads, customer data, or payment effects.
WITH objects(name, exists) AS (
  VALUES
  ('commerce.service_orders', to_regclass('commerce.service_orders') IS NOT NULL),
  ('commerce.service_order_payments',to_regclass('commerce.service_order_payments') IS NOT NULL),
  ('public.transactions',to_regclass('public.transactions') IS NOT NULL),
  ('public.orders',to_regclass('public.orders') IS NOT NULL),
  ('qr_payments.payment_requests',to_regclass('qr_payments.payment_requests') IS NOT NULL),
  ('qr_payments.payment_exceptions',to_regclass('qr_payments.payment_exceptions') IS NOT NULL),
  ('qr_payments.issuance_controls',to_regclass('qr_payments.issuance_controls') IS NOT NULL),
  ('qr_payments.live_gateway_policy',to_regclass('qr_payments.live_gateway_policy') IS NOT NULL),
  ('public.qs_opps106_issue_counter_qr',to_regprocedure('public.qs_opps106_issue_counter_qr(uuid,text)') IS NOT NULL),
  ('public.qs_opps106_start_counter_qr_checkout_live_candidate',to_regprocedure('public.qs_opps106_start_counter_qr_checkout_live_candidate(uuid,text,text)') IS NOT NULL),
  ('public.qs_opps106_settle_counter_qr_live_candidate',to_regprocedure('public.qs_opps106_settle_counter_qr_live_candidate(uuid,uuid,uuid,bigint,text,jsonb)') IS NOT NULL),
  ('commerce.qs_project_manual_receipt',to_regprocedure('commerce.qs_project_manual_receipt(uuid)') IS NOT NULL)
), migrations AS (
  SELECT count(*)::integer AS applied
  FROM supabase_migrations.schema_migrations
  WHERE name LIKE 'opps106_%'
)
SELECT
  'PRE-RELEASE INVENTORY ONLY - NOT A GO-LIVE APPROVAL' AS result_type,
  current_setting('server_version') AS postgres_version,
  (select applied from migrations) AS recorded_opps106_migrations,
  jsonb_object_agg(name,exists ORDER BY name) AS dependency_presence,
  coalesce(bool_and(exists),false) AS all_named_dependencies_present,
  false AS approval_to_enable_payments
FROM objects;
