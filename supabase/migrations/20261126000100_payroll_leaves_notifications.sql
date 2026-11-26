-- Payroll, leave types/balances, automatic notifications, department details.
-- See docs/MASTER_PLAN.md §7B (payroll), §7C (leaves), §7D (notifications).

-- ---------------------------------------------------------------------------
-- Employees & departments
-- ---------------------------------------------------------------------------
alter table public.employees
  add column designation text,
  add column joined_on date not null default current_date,
  add column left_on date;

alter table public.departments
  add column color text,
  add column active boolean not null default true;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.pay_basis as enum ('scheduled_days', 'calendar_30', 'fixed_26');
create type public.adjustment_kind as enum ('bonus', 'allowance', 'reimbursement', 'deduction', 'advance');
create type public.payroll_status as enum ('draft', 'approved', 'paid');
create type public.notify_status as enum ('pending', 'sent', 'failed', 'skipped');

-- ---------------------------------------------------------------------------
-- Payroll policy (one row per organization; company-wide rules)
-- ---------------------------------------------------------------------------
create table public.payroll_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  currency text not null default 'PKR',
  day_basis public.pay_basis not null default 'scheduled_days', -- per-day rate = basic / this
  standard_hours_per_day numeric(4,2) not null default 8,       -- for hourly overtime rate
  deduct_absent boolean not null default true,
  half_day_deduct_days numeric(3,2) not null default 0.5,
  late_every integer not null default 3,           -- every N late days …
  late_deduct_days numeric(3,2) not null default 0.5,  -- … deduct this many days (0 = off)
  early_every integer not null default 3,
  early_deduct_days numeric(3,2) not null default 0.5,
  overtime_multiplier numeric(4,2) not null default 1.5,
  overtime_min_minutes integer not null default 30,  -- daily overtime below this is ignored
  payroll_day smallint not null default 1 check (payroll_day between 1 and 28), -- draft for previous month
  auto_email_payslips boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Salary history (changing salary never rewrites past payslips)
create table public.employee_compensation (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  effective_from date not null,
  basic_salary numeric(12,2) not null check (basic_salary >= 0),
  allowances jsonb not null default '[]'::jsonb,   -- [{"name":"Transport","amount":5000}]
  overtime_enabled boolean not null default false,
  late_deduction_enabled boolean not null default true,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (employee_id, effective_from)
);

-- One-off items for a month: bonus, advance, deduction…
create table public.salary_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  period date not null check (period = date_trunc('month', period)::date),
  kind public.adjustment_kind not null,
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index salary_adjustments_emp_period on public.salary_adjustments (employee_id, period);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period date not null check (period = date_trunc('month', period)::date),
  status public.payroll_status not null default 'draft',
  generated_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  paid_at timestamptz,
  unique (organization_id, period)
);

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  period date not null,
  currency text not null,
  per_day_rate numeric(12,2) not null,
  basic numeric(12,2) not null,
  allowances numeric(12,2) not null default 0,
  overtime_pay numeric(12,2) not null default 0,
  additions numeric(12,2) not null default 0,     -- bonus/allowance/reimbursement adjustments
  gross numeric(12,2) not null,
  deductions numeric(12,2) not null default 0,
  net numeric(12,2) not null,
  scheduled_days numeric(5,1) not null default 0,
  worked_days numeric(5,1) not null default 0,
  absent_days numeric(5,1) not null default 0,
  paid_leave_days numeric(5,1) not null default 0,
  unpaid_leave_days numeric(5,1) not null default 0,
  half_days numeric(5,1) not null default 0,
  late_days integer not null default 0,
  early_days integer not null default 0,
  overtime_minutes integer not null default 0,
  lines jsonb not null default '[]'::jsonb,       -- [{"label","amount","type":"earning|deduction","detail"}]
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payroll_run_id, employee_id)
);

-- ---------------------------------------------------------------------------
-- Leave types & leave details
-- ---------------------------------------------------------------------------
create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  paid boolean not null default true,
  yearly_quota numeric(5,1),                       -- null = unlimited
  color text,
  active boolean not null default true,
  unique (organization_id, name)
);

alter table public.leaves
  add column leave_type_id uuid references public.leave_types(id) on delete restrict,
  add column half_day boolean not null default false,
  add column days numeric(5,1);

-- ---------------------------------------------------------------------------
-- Notification outbox (sent by Edge Function `send-notifications`)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  type text not null,
  to_email text not null,
  to_name text,
  subject text not null,
  data jsonb not null default '{}'::jsonb,
  status public.notify_status not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_pending on public.notifications (send_after) where status = 'pending';

-- Per-organization on/off switches for each notification type
insert into public.settings (organization_id, key, value)
select id, 'notifications', '{
  "leave_requested": true, "leave_decided": true, "schedule_changed": true,
  "payslip_ready": true, "payroll_draft_ready": true, "late_alert": false, "absent_alert": true, "missing_checkout": true,
  "check_in_receipt": true, "daily_summary_hr": true
}'::jsonb
from public.organizations
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.notification_enabled(p_org uuid, p_type text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value ->> p_type)::boolean from public.settings
                   where organization_id = p_org and key = 'notifications'),
                  p_type <> 'late_alert') -- default: everything on except late alerts
$$;

create or replace function public.enqueue_notification(
  p_org uuid, p_type text, p_email text, p_name text, p_subject text, p_data jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_email is null or p_email = '' then return; end if;
  if not public.notification_enabled(p_org, p_type) then return; end if;
  insert into public.notifications (organization_id, type, to_email, to_name, subject, data)
  values (p_org, p_type, p_email, p_name, p_subject, coalesce(p_data, '{}'::jsonb));
end $$;

-- HR/admins + the manager of the employee's department
create or replace function public.approvers_for(p_employee uuid)
returns table (email text, full_name text)
language sql stable security definer set search_path = '' as $$
  select distinct a.email, a.full_name
  from public.employees e
  join public.profiles p on p.organization_id = e.organization_id
  join public.employees a on a.id = p.employee_id
  where e.id = p_employee
    and a.email is not null
    and (p.role in ('super_admin', 'admin')
         or (p.role = 'manager' and p.managed_department_id = e.department_id))
$$;

create or replace function public.is_holiday(p_employee uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.holidays h join public.employees e on e.organization_id = h.organization_id
    where e.id = p_employee and h.holiday_date = p_date
      and (h.branch_id is null or h.branch_id = e.branch_id)
  )
$$;

-- Scheduled working days for an employee in a date range (excludes days off and holidays)
create or replace function public.scheduled_days(p_employee uuid, p_from date, p_to date) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from generate_series(p_from, p_to, interval '1 day') g(d)
  where (public.resolve_shift(p_employee, g.d::date)).id is not null
    and not public.is_holiday(p_employee, g.d::date)
$$;

-- ---------------------------------------------------------------------------
-- Leaves: compute days, enforce balance, notify
-- ---------------------------------------------------------------------------
create or replace function public.leaves_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  lt public.leave_types;
  used numeric;
begin
  if new.half_day then
    if new.end_date <> new.start_date then raise exception 'half-day leave must be a single date'; end if;
    new.days := 0.5;
  else
    new.days := public.scheduled_days(new.employee_id, new.start_date, new.end_date);
  end if;
  if new.days = 0 then raise exception 'selected dates have no working days'; end if;

  -- overlapping leave
  if exists (
    select 1 from public.leaves l
    where l.employee_id = new.employee_id and l.id <> new.id
      and l.status in ('pending', 'approved')
      and daterange(l.start_date, l.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) and new.status in ('pending', 'approved') then
    raise exception 'overlaps an existing leave request';
  end if;

  -- paid leave balance
  if new.leave_type_id is not null and new.status in ('pending', 'approved') then
    select * into lt from public.leave_types where id = new.leave_type_id;
    if lt.paid and lt.yearly_quota is not null then
      select coalesce(sum(l.days), 0) into used
      from public.leaves l
      where l.employee_id = new.employee_id and l.leave_type_id = new.leave_type_id and l.id <> new.id
        and l.status in ('pending', 'approved')
        and extract(year from l.start_date) = extract(year from new.start_date);
      if used + new.days > lt.yearly_quota then
        raise exception 'not enough % balance: % of % days left', lt.name, lt.yearly_quota - used, lt.yearly_quota;
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger leaves_before_write before insert or update of start_date, end_date, half_day, leave_type_id, status
  on public.leaves for each row execute function public.leaves_before_write();

create or replace function public.leaves_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees;
  lt_name text;
  a record;
  info jsonb;
begin
  select * into e from public.employees where id = new.employee_id;
  select name into lt_name from public.leave_types where id = new.leave_type_id;
  info := jsonb_build_object('employee', e.full_name, 'leave_type', coalesce(lt_name, 'Leave'),
    'start_date', new.start_date, 'end_date', new.end_date, 'days', new.days,
    'reason', new.reason, 'status', new.status, 'leave_id', new.id);

  if tg_op = 'INSERT' then
    for a in select * from public.approvers_for(new.employee_id) loop
      perform public.enqueue_notification(new.organization_id, 'leave_requested', a.email, a.full_name,
        format('Leave request: %s (%s, %s day%s)', e.full_name, coalesce(lt_name, 'Leave'), new.days,
               case when new.days = 1 then '' else 's' end), info);
    end loop;
  elsif new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.enqueue_notification(new.organization_id, 'leave_decided', e.email, e.full_name,
      format('Your leave request was %s', new.status), info);
  end if;
  return new;
end $$;

create trigger leaves_notify after insert or update of status on public.leaves
  for each row execute function public.leaves_notify();

-- ---------------------------------------------------------------------------
-- Schedule change → notify employee
-- ---------------------------------------------------------------------------
create or replace function public.employee_shifts_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees;
  s public.shifts;
begin
  select * into e from public.employees where id = new.employee_id;
  select * into s from public.shifts where id = new.shift_id;
  perform public.enqueue_notification(e.organization_id, 'schedule_changed', e.email, e.full_name,
    format('Your working hours from %s', to_char(new.effective_from, 'DD Mon YYYY')),
    jsonb_build_object('employee', e.full_name, 'effective_from', new.effective_from,
      'start_time', s.start_time, 'end_time', s.end_time, 'working_days', s.working_days,
      'break_minutes', s.break_minutes, 'kind', s.kind, 'required_minutes', s.required_minutes));
  return new;
end $$;

create trigger employee_shifts_notify after insert on public.employee_shifts
  for each row execute function public.employee_shifts_notify();

-- ---------------------------------------------------------------------------
-- Payroll calculation
-- ---------------------------------------------------------------------------
create or replace function public.generate_payslip(p_employee uuid, p_period date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees;
  pol public.payroll_policies;
  comp public.employee_compensation;
  run public.payroll_runs;
  v_from date := date_trunc('month', p_period)::date;
  v_to date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  v_last date;          -- last day counted (not in the future)
  d date;
  s public.shifts;
  day public.attendance_days;
  has_leave boolean;
  lv_half boolean;
  lv_paid boolean;
  v_month_days int;     -- scheduled days in the full month
  v_basis numeric;
  v_rate numeric;
  sched numeric := 0; worked numeric := 0; absent numeric := 0; paid_lv numeric := 0; unpaid_lv numeric := 0;
  half numeric := 0; late int := 0; early int := 0; ot_min int := 0; not_employed numeric := 0;
  v_allow numeric := 0; v_ot_pay numeric := 0; v_add numeric := 0; v_ded numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  amt numeric;
  adj record;
  v_id uuid;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'not allowed'; end if;

  select * into e from public.employees where id = p_employee;
  if e.id is null then raise exception 'employee not found'; end if;

  select * into pol from public.payroll_policies where organization_id = e.organization_id;
  if pol.organization_id is null then
    insert into public.payroll_policies (organization_id) values (e.organization_id) returning * into pol;
  end if;

  select * into comp from public.employee_compensation
  where employee_id = p_employee and effective_from <= v_to
  order by effective_from desc limit 1;
  if comp.id is null then return null; end if; -- no salary set

  insert into public.payroll_runs (organization_id, period) values (e.organization_id, v_from)
  on conflict (organization_id, period) do update set generated_at = now()
  returning * into run;
  if run.status <> 'draft' then raise exception 'payroll for % is already %', to_char(v_from, 'Mon YYYY'), run.status; end if;

  v_last := least(v_to, current_date - 1);
  v_month_days := public.scheduled_days(p_employee, v_from, v_to);
  v_basis := case pol.day_basis when 'calendar_30' then 30 when 'fixed_26' then 26 else greatest(v_month_days, 1) end;
  v_rate := round(comp.basic_salary / v_basis, 2);

  d := v_from;
  while d <= v_to loop
    s := public.resolve_shift(p_employee, d);
    if s.id is not null and not public.is_holiday(p_employee, d) then
      if d < e.joined_on or (e.left_on is not null and d > e.left_on) then
        not_employed := not_employed + 1;
      elsif d <= v_last then
        sched := sched + 1;
        select l.half_day, coalesce(t.paid, false) into lv_half, lv_paid
        from public.leaves l left join public.leave_types t on t.id = l.leave_type_id
        where l.employee_id = p_employee and l.status = 'approved' and d between l.start_date and l.end_date
        limit 1;
        has_leave := found;
        select * into day from public.attendance_days where employee_id = p_employee and work_date = d;

        if has_leave then
          if lv_paid then paid_lv := paid_lv + case when lv_half then 0.5 else 1 end;
          else unpaid_lv := unpaid_lv + case when lv_half then 0.5 else 1 end; end if;
          if lv_half and day.id is not null and day.check_in_at is not null then worked := worked + 0.5; end if;
        elsif day.id is null or day.check_in_at is null or day.status = 'absent' then
          absent := absent + 1;
        else
          if day.status = 'half_day' then half := half + 1; worked := worked + 0.5;
          else worked := worked + 1; end if;
          if day.late_minutes > 0 then late := late + 1; end if;
          if day.early_leave_minutes > 0 then early := early + 1; end if;
          if day.overtime_minutes >= pol.overtime_min_minutes then ot_min := ot_min + day.overtime_minutes; end if;
        end if;
      end if;
    elsif d <= v_last then
      -- worked on a day off / holiday → all net time is overtime
      select * into day from public.attendance_days where employee_id = p_employee and work_date = d;
      if day.id is not null and coalesce(day.net_minutes, 0) >= pol.overtime_min_minutes then
        ot_min := ot_min + day.net_minutes;
      end if;
    end if;
    day := null;
    d := d + 1;
  end loop;

  -- earnings
  v_lines := v_lines || jsonb_build_object('label', 'Basic salary', 'amount', comp.basic_salary, 'type', 'earning');
  select coalesce(sum((x ->> 'amount')::numeric), 0) into v_allow from jsonb_array_elements(comp.allowances) x;
  for adj in select x ->> 'name' as name, (x ->> 'amount')::numeric as amount from jsonb_array_elements(comp.allowances) x loop
    v_lines := v_lines || jsonb_build_object('label', adj.name, 'amount', adj.amount, 'type', 'earning');
  end loop;
  if comp.overtime_enabled and ot_min > 0 then
    v_ot_pay := round(ot_min / 60.0 * (v_rate / pol.standard_hours_per_day) * pol.overtime_multiplier, 2);
    v_lines := v_lines || jsonb_build_object('label', 'Overtime', 'amount', v_ot_pay, 'type', 'earning',
      'detail', format('%s h × %s', round(ot_min / 60.0, 1), pol.overtime_multiplier));
  end if;
  for adj in select * from public.salary_adjustments where employee_id = p_employee and period = v_from loop
    if adj.kind in ('bonus', 'allowance', 'reimbursement') then
      v_add := v_add + adj.amount;
      v_lines := v_lines || jsonb_build_object('label', initcap(adj.kind::text) || ': ' || adj.reason, 'amount', adj.amount, 'type', 'earning');
    else
      v_ded := v_ded + adj.amount;
      v_lines := v_lines || jsonb_build_object('label', initcap(adj.kind::text) || ': ' || adj.reason, 'amount', adj.amount, 'type', 'deduction');
    end if;
  end loop;

  -- attendance deductions
  if not_employed > 0 then
    amt := round(not_employed * comp.basic_salary / greatest(v_month_days, 1), 2);
    v_ded := v_ded + amt;
    v_lines := v_lines || jsonb_build_object('label', 'Not employed (pro-rata)', 'amount', amt, 'type', 'deduction',
      'detail', format('%s day(s)', not_employed));
  end if;
  if pol.deduct_absent and absent > 0 then
    amt := round(absent * v_rate, 2); v_ded := v_ded + amt;
    v_lines := v_lines || jsonb_build_object('label', 'Absent', 'amount', amt, 'type', 'deduction', 'detail', format('%s day(s) × %s', absent, v_rate));
  end if;
  if unpaid_lv > 0 then
    amt := round(unpaid_lv * v_rate, 2); v_ded := v_ded + amt;
    v_lines := v_lines || jsonb_build_object('label', 'Unpaid leave', 'amount', amt, 'type', 'deduction', 'detail', format('%s day(s) × %s', unpaid_lv, v_rate));
  end if;
  if half > 0 and pol.half_day_deduct_days > 0 then
    amt := round(half * pol.half_day_deduct_days * v_rate, 2); v_ded := v_ded + amt;
    v_lines := v_lines || jsonb_build_object('label', 'Half days', 'amount', amt, 'type', 'deduction', 'detail', format('%s day(s)', half));
  end if;
  if comp.late_deduction_enabled and pol.late_every > 0 and pol.late_deduct_days > 0 and late >= pol.late_every then
    amt := round(floor(late::numeric / pol.late_every) * pol.late_deduct_days * v_rate, 2); v_ded := v_ded + amt;
    v_lines := v_lines || jsonb_build_object('label', 'Late arrivals', 'amount', amt, 'type', 'deduction',
      'detail', format('%s late → every %s = %s day', late, pol.late_every, pol.late_deduct_days));
  end if;
  if comp.late_deduction_enabled and pol.early_every > 0 and pol.early_deduct_days > 0 and early >= pol.early_every then
    amt := round(floor(early::numeric / pol.early_every) * pol.early_deduct_days * v_rate, 2); v_ded := v_ded + amt;
    v_lines := v_lines || jsonb_build_object('label', 'Early leaving', 'amount', amt, 'type', 'deduction',
      'detail', format('%s early → every %s = %s day', early, pol.early_every, pol.early_deduct_days));
  end if;

  insert into public.payslips (
    payroll_run_id, organization_id, employee_id, period, currency, per_day_rate,
    basic, allowances, overtime_pay, additions, gross, deductions, net,
    scheduled_days, worked_days, absent_days, paid_leave_days, unpaid_leave_days, half_days,
    late_days, early_days, overtime_minutes, lines
  ) values (
    run.id, e.organization_id, p_employee, v_from, pol.currency, v_rate,
    comp.basic_salary, v_allow, v_ot_pay, v_add,
    comp.basic_salary + v_allow + v_ot_pay + v_add, v_ded,
    greatest(0, comp.basic_salary + v_allow + v_ot_pay + v_add - v_ded),
    sched, worked, absent, paid_lv, unpaid_lv, half, late, early, ot_min, v_lines
  )
  on conflict (payroll_run_id, employee_id) do update set
    currency = excluded.currency, per_day_rate = excluded.per_day_rate, basic = excluded.basic,
    allowances = excluded.allowances, overtime_pay = excluded.overtime_pay, additions = excluded.additions,
    gross = excluded.gross, deductions = excluded.deductions, net = excluded.net,
    scheduled_days = excluded.scheduled_days, worked_days = excluded.worked_days, absent_days = excluded.absent_days,
    paid_leave_days = excluded.paid_leave_days, unpaid_leave_days = excluded.unpaid_leave_days,
    half_days = excluded.half_days, late_days = excluded.late_days, early_days = excluded.early_days,
    overtime_minutes = excluded.overtime_minutes, lines = excluded.lines, created_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- Generate drafts for every active employee with a salary
create or replace function public.generate_payroll(p_org uuid, p_period date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  emp record;
  n int := 0;
begin
  if auth.uid() is not null and (not public.is_admin() or p_org <> public.current_org_id()) then
    raise exception 'not allowed';
  end if;
  for emp in
    select e.id from public.employees e
    where e.organization_id = p_org and e.status <> 'invited'
      and e.joined_on <= (date_trunc('month', p_period) + interval '1 month - 1 day')::date
      and (e.left_on is null or e.left_on >= date_trunc('month', p_period)::date)
  loop
    if public.generate_payslip(emp.id, p_period) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Approving a run emails every payslip automatically
create or replace function public.payroll_runs_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p record;
  auto boolean;
begin
  if new.status = 'approved' and old.status = 'draft' then
    select auto_email_payslips into auto from public.payroll_policies where organization_id = new.organization_id;
    if coalesce(auto, true) then
      for p in
        select ps.id, ps.net, ps.currency, e.email, e.full_name
        from public.payslips ps join public.employees e on e.id = ps.employee_id
        where ps.payroll_run_id = new.id
      loop
        perform public.enqueue_notification(new.organization_id, 'payslip_ready', p.email, p.full_name,
          format('Your payslip for %s', to_char(new.period, 'FMMonth YYYY')),
          jsonb_build_object('payslip_id', p.id, 'period', new.period, 'net', p.net, 'currency', p.currency,
                             'employee', p.full_name));
      end loop;
    end if;
  end if;
  return new;
end $$;

create trigger payroll_runs_notify after update of status on public.payroll_runs
  for each row execute function public.payroll_runs_notify();

revoke execute on function public.generate_payslip(uuid, date) from public, anon;
revoke execute on function public.generate_payroll(uuid, date) from public, anon;
revoke execute on function public.enqueue_notification(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.generate_payslip(uuid, date) to authenticated, service_role;
grant execute on function public.generate_payroll(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS — salary data is HR/admin only; employees see only their own approved payslips.
-- Managers never see salaries.
-- ---------------------------------------------------------------------------
alter table public.payroll_policies      enable row level security;
alter table public.employee_compensation enable row level security;
alter table public.salary_adjustments    enable row level security;
alter table public.payroll_runs          enable row level security;
alter table public.payslips              enable row level security;
alter table public.leave_types           enable row level security;
alter table public.notifications         enable row level security;

create policy policy_admin on public.payroll_policies for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy comp_admin on public.employee_compensation for all to authenticated
  using (public.is_admin() and public.can_view_employee(employee_id))
  with check (public.is_admin() and public.can_view_employee(employee_id));
create policy comp_self on public.employee_compensation for select to authenticated
  using (employee_id = public.current_employee_id());

create policy adj_admin on public.salary_adjustments for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy runs_admin on public.payroll_runs for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy payslips_admin on public.payslips for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());
create policy payslips_self on public.payslips for select to authenticated
  using (employee_id = public.current_employee_id()
         and exists (select 1 from public.payroll_runs r where r.id = payroll_run_id and r.status <> 'draft'));

create policy leave_types_read on public.leave_types for select to authenticated
  using (organization_id = public.current_org_id());
create policy leave_types_admin on public.leave_types for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy notifications_admin_read on public.notifications for select to authenticated
  using (organization_id = public.current_org_id() and public.is_admin());

-- Leave balances per employee / type / year
create or replace view public.leave_balances with (security_invoker = true) as
select l.employee_id, t.id as leave_type_id, t.name as leave_type, t.paid,
       extract(year from l.start_date)::int as year,
       t.yearly_quota,
       sum(l.days) filter (where l.status = 'approved') as used_days,
       sum(l.days) filter (where l.status = 'pending') as pending_days,
       t.yearly_quota - coalesce(sum(l.days) filter (where l.status in ('approved', 'pending')), 0) as remaining_days
from public.leaves l
join public.leave_types t on t.id = l.leave_type_id
group by l.employee_id, t.id, t.name, t.paid, t.yearly_quota, extract(year from l.start_date);
