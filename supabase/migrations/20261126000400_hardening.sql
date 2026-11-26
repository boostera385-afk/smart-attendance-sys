-- Security hardening (from Supabase security advisor):
-- 1. SECURITY DEFINER functions must not be callable by anon, and internal helpers must not be
--    callable by signed-in users via /rest/v1/rpc. Trigger functions need no EXECUTE grant.
-- 2. pg_net belongs in the extensions schema, not public.

-- Nothing in public is executable by default
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Helpers used inside RLS policies (evaluated as the signed-in user)
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_view_employee(uuid) to authenticated;

-- App actions (each one checks the caller's role itself)
grant execute on function public.set_employee_schedule(uuid, date, time, time, smallint[], integer, public.break_mode,
  public.shift_kind, integer, time, time, integer, integer, integer) to authenticated;
grant execute on function public.recalc_attendance_day(uuid) to authenticated;
grant execute on function public.generate_payslip(uuid, date) to authenticated;
grant execute on function public.generate_payroll(uuid, date) to authenticated;
grant execute on function public.decide_leave(uuid, public.leave_status, text) to authenticated;
grant execute on function public.cancel_leave(uuid) to authenticated;

-- Server-side code (Edge Functions, cron) uses service_role / postgres
grant execute on all functions in schema public to service_role;

-- pg_net: recreate in the extensions schema (its API stays in schema "net")
drop extension if exists pg_net;
create extension pg_net with schema extensions;
