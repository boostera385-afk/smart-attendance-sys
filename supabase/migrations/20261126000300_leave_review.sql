-- Leave review: policy rules, automatic checks, AI recommendation, decisions, cancellation.
-- See docs/MASTER_PLAN.md §7C.

create type public.leave_review_mode as enum ('manual', 'policy_auto', 'ai_assist', 'ai_auto');
create type public.decision_source as enum ('manual', 'policy_auto', 'ai_auto');
create type public.ai_verdict as enum ('approve', 'reject', 'review');

-- Per leave type rules
alter table public.leave_types
  add column monthly_limit numeric(4,1),              -- max days of this type per calendar month (null = none)
  add column min_notice_days integer not null default 0,
  add column max_consecutive_days integer,
  add column document_required_after_days integer,    -- e.g. sick > 2 days needs a document
  add column probation_days integer not null default 0, -- not allowed in first N days after joining
  add column auto_approve_allowed boolean not null default true;

-- Company-wide review settings
create table public.leave_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  review_mode public.leave_review_mode not null default 'ai_assist',
  max_concurrent_per_department integer not null default 2, -- others already off the same day
  ai_auto_min_confidence real not null default 0.85,
  ai_provider text not null default 'openai',
  ai_model text not null default 'gpt-4.1-mini',
  ai_reject_allowed boolean not null default false,  -- AI may never auto-reject unless enabled
  updated_at timestamptz not null default now()
);
-- AI API key is stored in public.secrets (key = 'openai_api_key'): service role only, never sent to browsers.

alter table public.leaves
  add column policy_checks jsonb not null default '[]'::jsonb, -- [{key,label,passed,severity,detail}]
  add column policy_passed boolean,
  add column stats jsonb,                                     -- employee record snapshot used for review
  add column ai_verdict public.ai_verdict,
  add column ai_confidence real,
  add column ai_summary text,
  add column ai_reviewed_at timestamptz,
  add column decided_via public.decision_source,
  add column decision_note text,
  add column attachment_path text,
  add column cancel_requested boolean not null default false;

-- ---------------------------------------------------------------------------
-- Deterministic policy checks (run on every insert / change)
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_leave(
  p_leave_id uuid, p_employee uuid, p_type uuid, p_start date, p_end date,
  p_days numeric, p_half boolean, p_created date, p_attachment text
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees;
  lt public.leave_types;
  pol public.leave_policies;
  checks jsonb := '[]'::jsonb;
  m date;
  m_days numeric;
  m_used numeric;
  used_year numeric;
  overlap_max int;
  dd date;
  n int;
  stats jsonb;
begin
  select * into e from public.employees where id = p_employee;
  select * into lt from public.leave_types where id = p_type;
  select * into pol from public.leave_policies where organization_id = e.organization_id;

  -- 1. yearly balance
  if lt.yearly_quota is not null then
    select coalesce(sum(days), 0) into used_year from public.leaves
    where employee_id = p_employee and leave_type_id = p_type and id <> p_leave_id
      and status in ('pending', 'approved') and extract(year from start_date) = extract(year from p_start);
    checks := checks || jsonb_build_object('key', 'balance', 'label', 'Yearly balance', 'severity', 'hard',
      'passed', used_year + p_days <= lt.yearly_quota,
      'detail', format('%s of %s days left before this request', lt.yearly_quota - used_year, lt.yearly_quota));
  end if;

  -- 2. monthly limit (each month the leave touches)
  if lt.monthly_limit is not null then
    m := date_trunc('month', p_start)::date;
    while m <= p_end loop
      m_days := case when p_half then 0.5
                else public.scheduled_days(p_employee, greatest(p_start, m), least(p_end, (m + interval '1 month - 1 day')::date)) end;
      select coalesce(sum(case when l.half_day then 0.5 else
               public.scheduled_days(l.employee_id, greatest(l.start_date, m), least(l.end_date, (m + interval '1 month - 1 day')::date)) end), 0)
        into m_used
      from public.leaves l
      where l.employee_id = p_employee and l.leave_type_id = p_type and l.id <> p_leave_id
        and l.status in ('pending', 'approved')
        and l.start_date <= (m + interval '1 month - 1 day')::date and l.end_date >= m;
      checks := checks || jsonb_build_object('key', 'monthly_limit', 'label', format('Monthly limit (%s)', to_char(m, 'Mon YYYY')),
        'severity', 'hard', 'passed', m_used + m_days <= lt.monthly_limit,
        'detail', format('%s already used + %s requested, limit %s per month', m_used, m_days, lt.monthly_limit));
      m := (m + interval '1 month')::date;
    end loop;
  end if;

  -- 3. notice period
  if lt.min_notice_days > 0 then
    checks := checks || jsonb_build_object('key', 'notice', 'label', 'Advance notice', 'severity', 'soft',
      'passed', p_start - p_created >= lt.min_notice_days,
      'detail', format('applied %s day(s) before, policy %s', p_start - p_created, lt.min_notice_days));
  end if;

  -- 4. max consecutive days
  if lt.max_consecutive_days is not null then
    checks := checks || jsonb_build_object('key', 'consecutive', 'label', 'Maximum length', 'severity', 'hard',
      'passed', p_days <= lt.max_consecutive_days,
      'detail', format('%s day(s), maximum %s', p_days, lt.max_consecutive_days));
  end if;

  -- 5. probation
  if lt.probation_days > 0 then
    checks := checks || jsonb_build_object('key', 'probation', 'label', 'Probation period', 'severity', 'hard',
      'passed', p_start >= e.joined_on + lt.probation_days,
      'detail', format('joined %s, eligible from %s', e.joined_on, e.joined_on + lt.probation_days));
  end if;

  -- 6. supporting document
  if lt.document_required_after_days is not null and p_days > lt.document_required_after_days then
    checks := checks || jsonb_build_object('key', 'document', 'label', 'Supporting document', 'severity', 'hard',
      'passed', p_attachment is not null,
      'detail', format('required for more than %s day(s)', lt.document_required_after_days));
  end if;

  -- 7. team coverage (others in the same department off on the same day)
  if e.department_id is not null then
    overlap_max := 0;
    dd := p_start;
    while dd <= p_end loop
      select count(distinct l.employee_id) into n
      from public.leaves l join public.employees o on o.id = l.employee_id
      where o.department_id = e.department_id and l.employee_id <> p_employee
        and l.status = 'approved' and dd between l.start_date and l.end_date;
      overlap_max := greatest(overlap_max, n);
      dd := dd + 1;
    end loop;
    checks := checks || jsonb_build_object('key', 'coverage', 'label', 'Team coverage', 'severity', 'soft',
      'passed', overlap_max < coalesce(pol.max_concurrent_per_department, 2),
      'detail', format('%s colleague(s) from the same department already off, limit %s', overlap_max,
                       coalesce(pol.max_concurrent_per_department, 2)));
  end if;

  -- 8. backdated
  if p_start < p_created then
    checks := checks || jsonb_build_object('key', 'backdated', 'label', 'Backdated request', 'severity', 'soft',
      'passed', false, 'detail', format('starts %s day(s) before the request date', p_created - p_start));
  end if;

  return checks;
end $$;

-- Employee record snapshot used by reviewers and the AI (no names, no salary)
create or replace function public.leave_stats(p_employee uuid, p_start date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tenure_days', p_start - e.joined_on,
    'late_last_30', (select count(*) from public.attendance_days d where d.employee_id = e.id
                     and d.work_date >= p_start - 30 and d.work_date < p_start and d.late_minutes > 0),
    'absent_last_90', (select count(*) from public.attendance_days d where d.employee_id = e.id
                       and d.work_date >= p_start - 90 and d.work_date < p_start and d.status = 'absent'),
    'leaves_this_year', (select coalesce(jsonb_object_agg(t.name, x.days), '{}'::jsonb) from (
        select l.leave_type_id, sum(l.days) days from public.leaves l
        where l.employee_id = e.id and l.status = 'approved' and extract(year from l.start_date) = extract(year from p_start)
        group by l.leave_type_id) x join public.leave_types t on t.id = x.leave_type_id),
    'rejected_last_180', (select count(*) from public.leaves l where l.employee_id = e.id
                          and l.status = 'rejected' and l.created_at > now() - interval '180 days'),
    'last_leave_end', (select max(l.end_date) from public.leaves l where l.employee_id = e.id
                       and l.status = 'approved' and l.end_date < p_start)
  )
  from public.employees e where e.id = p_employee
$$;

create or replace function public.leaves_evaluate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- review/decision fields are only ever set by the system or decide_leave()
    new.ai_verdict := null; new.ai_confidence := null; new.ai_summary := null; new.ai_reviewed_at := null;
    new.decided_via := null; new.decided_by := null; new.decided_at := null; new.decision_note := null;
    new.cancel_requested := false;
  end if;
  if new.leave_type_id is null then return new; end if;
  new.policy_checks := public.evaluate_leave(new.id, new.employee_id, new.leave_type_id, new.start_date, new.end_date,
                                             new.days, new.half_day, coalesce(new.created_at, now())::date, new.attachment_path);
  new.policy_passed := not exists (select 1 from jsonb_array_elements(new.policy_checks) c where not (c ->> 'passed')::boolean);
  new.stats := public.leave_stats(new.employee_id, new.start_date);
  return new;
end $$;

-- name sorts after leaves_before_write, so `days` is already computed
create trigger leaves_evaluate before insert or update of start_date, end_date, half_day, leave_type_id, attachment_path
  on public.leaves for each row execute function public.leaves_evaluate();

-- The yearly balance is now a reviewable check (shown to the employee before submitting) instead of a hard error,
-- except that the request form blocks paid types with zero balance. Remove the old hard error:
create or replace function public.leaves_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.half_day then
    if new.end_date <> new.start_date then raise exception 'half-day leave must be a single date'; end if;
    new.days := 0.5;
  else
    new.days := public.scheduled_days(new.employee_id, new.start_date, new.end_date);
  end if;
  if new.days = 0 then raise exception 'selected dates have no working days'; end if;

  if new.status in ('pending', 'approved') and exists (
    select 1 from public.leaves l
    where l.employee_id = new.employee_id and l.id <> new.id
      and l.status in ('pending', 'approved')
      and daterange(l.start_date, l.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'overlaps an existing leave request';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- After insert: auto-approve (policy mode) or ask the AI reviewer
-- ---------------------------------------------------------------------------
create or replace function public.leaves_after_insert_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pol public.leave_policies;
  lt public.leave_types;
begin
  select * into pol from public.leave_policies p
  where p.organization_id = new.organization_id;
  select * into lt from public.leave_types where id = new.leave_type_id;

  if coalesce(pol.review_mode, 'ai_assist') = 'policy_auto'
     and new.policy_passed and coalesce(lt.auto_approve_allowed, false) then
    update public.leaves set status = 'approved', decided_via = 'policy_auto', decided_at = now(),
      decision_note = 'Automatically approved: all leave rules passed.'
    where id = new.id;
  elsif coalesce(pol.review_mode, 'ai_assist') in ('ai_assist', 'ai_auto')
        and exists (select 1 from pg_extension where extname = 'pg_net') then
    -- fire-and-forget call to Edge Function review-leave (cron also sweeps unreviewed requests)
    execute $q$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/review-leave',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        body := jsonb_build_object('leave_id', $1))
    $q$ using new.id;
  end if;
  return new;
end $$;

-- "zz" so it runs after leaves_notify (receipt email first, then any auto-decision email)
create trigger leaves_zz_review after insert on public.leaves
  for each row execute function public.leaves_after_insert_review();

-- Decisions only through decide_leave() (validates, requires reject reason, audits)
drop policy leaves_decide on public.leaves;

-- ---------------------------------------------------------------------------
-- Actions (RPC) — admin/manager decision, employee cancel
-- ---------------------------------------------------------------------------
create or replace function public.decide_leave(p_leave uuid, p_status public.leave_status, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leaves;
begin
  select * into l from public.leaves where id = p_leave for update;
  if l.id is null then raise exception 'leave not found'; end if;
  if not (public.current_app_role() in ('super_admin', 'admin', 'manager') and public.can_view_employee(l.employee_id)) then
    raise exception 'not allowed';
  end if;
  if l.employee_id = public.current_employee_id() then raise exception 'you cannot decide your own leave'; end if;
  if p_status not in ('approved', 'rejected', 'cancelled') then raise exception 'invalid status'; end if;
  if p_status = 'cancelled' and not l.cancel_requested then raise exception 'employee has not requested cancellation'; end if;
  if p_status = 'rejected' and coalesce(trim(p_note), '') = '' then raise exception 'a reason is required to reject'; end if;
  if l.status <> 'pending' and not (l.status = 'approved' and p_status in ('rejected', 'cancelled')) then
    raise exception 'leave is already %', l.status;
  end if;

  update public.leaves set status = p_status, decided_by = auth.uid(), decided_at = now(),
    decided_via = 'manual', decision_note = p_note, cancel_requested = false
  where id = p_leave;

  insert into public.audit_log (organization_id, actor_id, action, table_name, record_id, new_data)
  values (l.organization_id, auth.uid(), 'decide_leave', 'leaves', p_leave::text,
          jsonb_build_object('status', p_status, 'note', p_note, 'ai_verdict', l.ai_verdict));
end $$;

create or replace function public.cancel_leave(p_leave uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare l public.leaves;
begin
  select * into l from public.leaves where id = p_leave for update;
  if l.id is null or l.employee_id is distinct from public.current_employee_id() then raise exception 'not allowed'; end if;
  if l.status = 'pending' then
    update public.leaves set status = 'cancelled' where id = p_leave;
    return 'cancelled';
  elsif l.status = 'approved' and l.start_date > current_date then
    update public.leaves set cancel_requested = true where id = p_leave;
    perform public.enqueue_notification(l.organization_id, 'leave_cancel_requested', a.email, a.full_name,
      format('Cancellation request: %s · %s', e.full_name, to_char(l.start_date, 'DD Mon')),
      jsonb_build_object('employee', e.full_name, 'leave_id', l.id, 'start_date', l.start_date, 'end_date', l.end_date,
                         'days', l.days))
    from public.approvers_for(l.employee_id) a, public.employees e where e.id = l.employee_id;
    return 'cancel_requested';
  end if;
  raise exception 'this leave can no longer be cancelled';
end $$;

revoke execute on function public.decide_leave(uuid, public.leave_status, text) from public, anon;
revoke execute on function public.cancel_leave(uuid) from public, anon;
grant execute on function public.decide_leave(uuid, public.leave_status, text) to authenticated;
grant execute on function public.cancel_leave(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications: employee receipt + HR email (delayed so it includes the AI recommendation)
-- ---------------------------------------------------------------------------
create or replace function public.leaves_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees;
  lt_name text;
  a record;
  info jsonb;
  mode public.leave_review_mode;
begin
  select * into e from public.employees where id = new.employee_id;
  select name into lt_name from public.leave_types where id = new.leave_type_id;
  select review_mode into mode from public.leave_policies where organization_id = new.organization_id;
  info := jsonb_build_object('employee', e.full_name, 'leave_type', coalesce(lt_name, 'Leave'),
    'start_date', new.start_date, 'end_date', new.end_date, 'days', new.days, 'half_day', new.half_day,
    'reason', new.reason, 'status', new.status, 'leave_id', new.id, 'note', new.decision_note,
    'decided_via', new.decided_via);

  if tg_op = 'INSERT' then
    perform public.enqueue_notification(new.organization_id, 'leave_submitted', e.email, e.full_name,
      format('We received your %s request', coalesce(lt_name, 'leave')), info);
    for a in select * from public.approvers_for(new.employee_id) loop
      perform public.enqueue_notification(new.organization_id, 'leave_requested', a.email, a.full_name,
        format('Leave request: %s · %s · %s day%s', e.full_name, coalesce(lt_name, 'Leave'), new.days,
               case when new.days = 1 then '' else 's' end), info);
    end loop;
    if coalesce(mode, 'ai_assist') in ('ai_assist', 'ai_auto') then
      update public.notifications set send_after = now() + interval '2 minutes'
      where type = 'leave_requested' and status = 'pending' and (data ->> 'leave_id')::uuid = new.id;
    end if;
  elsif new.status is distinct from old.status and new.status in ('approved', 'rejected')
        or (new.status = 'cancelled' and old.status = 'approved') then
    perform public.enqueue_notification(new.organization_id, 'leave_decided', e.email, e.full_name,
      format('Your %s request was %s', coalesce(lt_name, 'leave'), new.status), info);
  end if;
  return new;
end $$;

alter table public.leave_policies enable row level security;
create policy leave_policies_read on public.leave_policies for select to authenticated
  using (organization_id = public.current_org_id());
create policy leave_policies_admin on public.leave_policies for all to authenticated
  using (organization_id = public.current_org_id() and public.current_app_role() = 'super_admin')
  with check (organization_id = public.current_org_id() and public.current_app_role() = 'super_admin');

-- leaves: realtime so the employee dashboard updates the status live
alter publication supabase_realtime add table public.leaves;
