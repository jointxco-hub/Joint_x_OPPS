\set ON_ERROR_STOP on
-- Synthetic fixture ONLY. Never run on a restored/live Supabase database.
DO $$ BEGIN
 IF current_database() <> 'inv01_fixture' OR to_regclass('public.orders') IS NOT NULL THEN
  RAISE EXCEPTION 'Requires fresh disposable inv01_fixture database';
 END IF;
END $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION public.is_app_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.user_finance_level() RETURNS int LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.finance',true),'')::int $$;
CREATE FUNCTION public.can_access_tenant(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1 = nullif(current_setting('test.tenant',true),'')::uuid $$;
CREATE TABLE public.clients(id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
CREATE TABLE public.orders(id uuid PRIMARY KEY, tenant_id uuid NOT NULL, client_id uuid REFERENCES clients(id), source_quote_id uuid, order_number text);
CREATE TABLE public.opps_invoices(id uuid PRIMARY KEY, tenant_id uuid NOT NULL, customer_id uuid REFERENCES clients(id), source_order_id uuid REFERENCES orders(id), source_quote_id uuid, status text NOT NULL, updated_at timestamptz, updated_by uuid, amount_paid numeric DEFAULT 0);
CREATE TABLE public.opps_invoice_activity(invoice_id uuid,tenant_id uuid,activity_type text,activity_label text,activity_note text,metadata jsonb,created_by uuid);
CREATE FUNCTION public.link_invoice_to_order_relational(uuid,uuid) RETURNS public.opps_invoices LANGUAGE sql AS $$ SELECT * FROM public.opps_invoices WHERE id=$1 $$;
\ir ../../supabase/review-only/inv01a_invoice_first_linking.sql
BEGIN;
INSERT INTO clients VALUES ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001');
INSERT INTO orders VALUES ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001',null,null,'TEST-1'),('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012',null,'TEST-2'),('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000002',null,null,'TEST-3');
INSERT INTO opps_invoices(id,tenant_id,status,amount_paid) VALUES ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','paid',790),('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000001','void',0);
DO $$ DECLARE i uuid:='00000000-0000-0000-0000-000000000031'; o uuid:='00000000-0000-0000-0000-000000000021'; c uuid:='00000000-0000-0000-0000-000000000011'; BEGIN
 IF has_function_privilege('anon','public.link_invoice_to_order_relational(uuid,uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'anon grant'; END IF;
 BEGIN PERFORM public.link_invoice_to_order_relational(i,o,c); RAISE EXCEPTION 'missing auth accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('test.uid','00000000-0000-0000-0000-000000000099',true);
 PERFORM set_config('test.tenant','00000000-0000-0000-0000-000000000001',true);
 BEGIN PERFORM public.link_invoice_to_order_relational(i,o,c); RAISE EXCEPTION 'missing finance accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('test.finance','1',true);
 BEGIN PERFORM public.link_invoice_to_order_relational(i,'00000000-0000-0000-0000-000000000023',c); RAISE EXCEPTION 'cross tenant accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.link_invoice_to_order_relational(i,'00000000-0000-0000-0000-000000000022',c); RAISE EXCEPTION 'unexpected acceptance'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'ATTACH_CLIENT_ORDER_CONFLICT' THEN RAISE; END IF; END;
 BEGIN PERFORM public.link_invoice_to_order_relational('00000000-0000-0000-0000-000000000032',o,c); RAISE EXCEPTION 'unexpected acceptance'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'INVOICE_VOID' THEN RAISE; END IF; END;
 PERFORM public.link_invoice_to_order_relational(i,o,c);
 PERFORM public.link_invoice_to_order_relational(i,o);
 IF NOT EXISTS (SELECT 1 FROM opps_invoices WHERE id=i AND source_order_id=o AND customer_id=c AND amount_paid=790 AND status='paid') OR NOT EXISTS (SELECT 1 FROM orders WHERE id=o AND client_id=c) OR (SELECT count(*) FROM opps_invoice_activity WHERE invoice_id=i)<>1 THEN RAISE EXCEPTION 'link or replay mismatch'; END IF;
 BEGIN PERFORM public.link_invoice_to_order_relational(i,'00000000-0000-0000-0000-000000000022',c); RAISE EXCEPTION 'unexpected acceptance'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'INVOICE_ALREADY_LINKED' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS: synthetic permissions, tenant, conflicts, void, paid amount, link and replay';
END $$;
ROLLBACK;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM orders) OR EXISTS (SELECT 1 FROM opps_invoices) OR EXISTS (SELECT 1 FROM opps_invoice_activity) THEN RAISE EXCEPTION 'rollback failed'; END IF; RAISE NOTICE 'PASS: fixture rollback'; END $$;
