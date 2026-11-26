-- Scheduled jobs (Supabase: pg_cron + pg_net). Not part of local tests.
-- Before applying, store two secrets in Vault (Dashboard › Project Settings › Vault):
--   project_url  = https://<project-ref>.supabase.co
--   cron_secret  = same value as the Edge Function env CRON_SECRET
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Send queued emails every minute
select cron.schedule('send-notifications', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
$$);

-- AI leave review safety sweep (the insert trigger normally calls it immediately)
select cron.schedule('review-leaves', '*/5 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/review-leave',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
$$);

-- Payroll drafts for the previous month: runs daily 21:00 UTC (02:00 PKT) and acts only on the
-- organization's payroll_day. Emails HR that the draft is ready for review.
select cron.schedule('monthly-payroll', '0 21 * * *', $$
  with due as (
    select o.id as org,
           (date_trunc('month', now() at time zone 'Asia/Karachi') - interval '1 month')::date as period
    from public.organizations o
    left join public.payroll_policies p on p.organization_id = o.id
    where extract(day from now() at time zone 'Asia/Karachi') = coalesce(p.payroll_day, 1)
  ), gen as (
    select org, period, public.generate_payroll(org, period) as n from due
  )
  select public.enqueue_notification(g.org, 'payroll_draft_ready', a.email, a.full_name,
           format('Payroll draft for %s is ready (%s payslips)', to_char(g.period, 'FMMonth YYYY'), g.n),
           jsonb_build_object('period', g.period, 'count', g.n))
  from gen g
  join public.profiles pr on pr.organization_id = g.org and pr.role in ('super_admin', 'admin')
  join public.employees a on a.id = pr.employee_id
  where g.n > 0;
$$);
