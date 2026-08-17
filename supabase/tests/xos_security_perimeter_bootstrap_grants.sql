\set ON_ERROR_STOP on
-- Supabase grants this in its platform bootstrap; the focused local schema
-- recreation must restore it explicitly.
grant usage on schema storage to anon, authenticated, service_role;
