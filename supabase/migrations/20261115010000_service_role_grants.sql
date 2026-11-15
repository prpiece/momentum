-- The server functions (inbound, the Digest) use the service role, which bypasses RLS but still
-- needs table privileges. A local stack grants them by default; the live project does not, so every
-- direct table read from a function failed with "permission denied" (a linked chat looked unlinked).
-- The service role key never leaves the server (PLAN D265), so it gets full access to `public`,
-- now and for tables later migrations create.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- D289: every migration bumps the schema version by one.
update public.server_meta set schema_version = 2;
