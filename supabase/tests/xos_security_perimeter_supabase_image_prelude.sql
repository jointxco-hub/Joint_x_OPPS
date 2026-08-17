\set ON_ERROR_STOP on
-- The Supabase Postgres image pre-creates API roles/schemas. Rename those
-- image-owned identities inside this disposable container so the focused
-- bootstrap can define and own its complete test surface deterministically.
alter role anon rename to image_anon;
alter role authenticated rename to image_authenticated;
alter role service_role rename to image_service_role;
alter schema auth rename to image_auth;
alter schema storage rename to image_storage;
