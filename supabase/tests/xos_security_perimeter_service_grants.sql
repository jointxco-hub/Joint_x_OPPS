\set ON_ERROR_STOP on
-- Supabase's platform bootstrap grants service_role full table access in
-- addition to BYPASSRLS. Reproduce that platform contract in the focused lab.
grant all privileges on all tables in schema public, storage to service_role;
