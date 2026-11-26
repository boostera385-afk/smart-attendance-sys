-- Explicit Data API grants. New Supabase projects don't grant table privileges to API roles for
-- tables created by migrations, so access is declared here. Row Level Security still decides
-- which rows each signed-in user can see or change.

-- anon (not signed in): no table access at all
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- authenticated: CRUD, filtered by RLS policies; never TRUNCATE (bypasses RLS)
revoke truncate, trigger, references on all tables in schema public from authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- secrets: server only (service role), never readable by signed-in users
revoke all on public.secrets from authenticated;
-- notifications outbox: admins may read (RLS), only the server writes
revoke insert, update, delete on public.notifications from authenticated;
-- audit log: read via RLS, written only by SECURITY DEFINER functions / server
revoke insert, update, delete on public.audit_log from authenticated;

-- service_role (Edge Functions, server actions): full access
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Same rules for tables created later by the postgres role
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges for role postgres in schema public grant usage, select on sequences to authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
