-- AI Face Attendance System — initial schema
-- See docs/MASTER_PLAN.md §5

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('super_admin', 'admin', 'manager', 'employee');
create type public.employee_status as enum ('invited', 'pending_enrollment', 'active', 'inactive');
create type public.camera_connection as enum ('ezviz_cloud', 'lan_rtsp', 'custom_rtsp');
create type public.camera_role as enum ('entry', 'exit', 'both', 'presence', 'disabled');
create type public.camera_status as enum ('unknown', 'online', 'offline', 'error');
create type public.event_type as enum ('sighting', 'check_in', 'check_out', 'manual');
create type public.day_status as enum ('present', 'late', 'absent', 'leave', 'half_day', 'holiday');
create type public.record_source as enum ('camera', 'selfie', 'manual', 'auto');
create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.review_status as enum ('pending', 'assigned', 'ignored');

-- ---------------------------------------------------------------------------
-- Organization structure
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  timezone text not null default 'Asia/Karachi',
  latitude double precision,
  longitude double precision,
  geofence_radius_m integer not null default 100,
  created_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  ezviz_group_name text,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

-- Work schedules. See docs/MASTER_PLAN.md §7A.
-- employee_id set   => that employee's personal schedule (entered on the employee form — the normal case)
-- employee_id null  => optional preset used only to pre-fill the employee form
-- A shift whose end_time <= start_time crosses midnight (e.g. 18:00 → 02:00); its attendance
-- belongs to the date the shift STARTS.
create type public.break_mode as enum ('deduct', 'paid', 'tracked');
create type public.shift_kind as enum ('fixed', 'flexible');

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,                                   -- short label, e.g. "M", "E"
  color text not null default 'oklch(0.6 0.13 175)',
  kind public.shift_kind not null default 'fixed',
  start_time time not null default '09:00',    -- fixed: scheduled start; flexible: earliest allowed
  end_time time not null default '18:00',
  required_minutes integer,                    -- flexible: required net minutes per day
  working_days smallint[] not null default '{1,2,3,4,5,6}', -- ISO: 1=Mon … 7=Sun

  -- breaks (not tracked by default — no need to check out/in for breaks)
  break_mode public.break_mode not null default 'deduct',
  break_minutes integer not null default 60,
  break_start time,                            -- informational window, e.g. 13:00–14:00
  break_end time,

  -- rules
  grace_in_minutes integer not null default 15,      -- late after start + grace
  grace_out_minutes integer not null default 10,     -- early-leave before end - grace
  checkin_open_minutes integer not null default 120, -- earliest check-in = start - this
  checkout_close_minutes integer not null default 240, -- sightings after end + this are ignored
  half_day_minutes integer not null default 240,     -- net worked < this => half day
  absent_minutes integer not null default 60,        -- net worked < this => absent
  overtime_after_minutes integer not null default 30,-- overtime counted after end + this

  employee_id uuid,                            -- FK added after employees table; null = preset
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index shifts_preset_name on public.shifts (organization_id, name) where employee_id is null;

-- Which shift an employee works, with history (changing shift never rewrites past days).
create table public.employee_shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,                   -- FK added after employees table
  shift_id uuid not null references public.shifts(id) on delete restrict,
  effective_from date not null,
  effective_to date,                           -- null = open-ended
  days smallint[],                             -- optional: only these weekdays (split weeks)
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

-- One-off change for a single date (swap to evening, day off, etc.). Wins over employee_shifts.
create table public.shift_overrides (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,                   -- FK added after employees table
  work_date date not null,
  shift_id uuid references public.shifts(id) on delete cascade, -- null = day off
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade, -- null = all branches
  holiday_date date not null,
  name text not null,
  unique (organization_id, branch_id, holiday_date)
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  employee_code text,
  full_name text not null,
  email text,
  phone text,
  photo_path text,
  status public.employee_status not null default 'invited',
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_code),
  unique (organization_id, email)
);

alter table public.shifts
  add constraint shifts_employee_fk foreign key (employee_id) references public.employees(id) on delete cascade;
create index shifts_employee on public.shifts (employee_id);
alter table public.employee_shifts
  add constraint employee_shifts_employee_fk foreign key (employee_id) references public.employees(id) on delete cascade;
alter table public.shift_overrides
  add constraint shift_overrides_employee_fk foreign key (employee_id) references public.employees(id) on delete cascade;
create index employee_shifts_lookup on public.employee_shifts (employee_id, effective_from desc);

-- 1:1 with auth.users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid unique references public.employees(id) on delete set null,
  role public.app_role not null default 'employee',
  managed_department_id uuid references public.departments(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.face_embeddings (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  embedding extensions.vector(512) not null,
  model text not null default 'auraface-v1',
  quality real,
  image_path text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index face_embeddings_hnsw on public.face_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);
create index face_embeddings_employee on public.face_embeddings (employee_id);

-- ---------------------------------------------------------------------------
-- Cameras
-- ---------------------------------------------------------------------------
create table public.cameras (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  name text not null,
  model text,
  connection public.camera_connection not null default 'ezviz_cloud',
  ezviz_serial text,
  ezviz_channel integer not null default 1,
  rtsp_url text,                 -- only for lan_rtsp / custom_rtsp
  role public.camera_role not null default 'disabled',
  status public.camera_status not null default 'unknown',
  last_seen_at timestamptz,
  fps real not null default 2,
  match_threshold real,          -- null = use org default
  voice_enabled boolean not null default false,
  voice_volume smallint not null default 70,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, ezviz_serial, ezviz_channel)
);

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------
create table public.attendance_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  camera_id uuid references public.cameras(id) on delete set null,
  type public.event_type not null,
  occurred_at timestamptz not null default now(),
  confidence real,
  liveness real,
  snapshot_path text,
  source public.record_source not null default 'camera',
  created_at timestamptz not null default now()
);
create index attendance_events_emp_time on public.attendance_events (employee_id, occurred_at desc);
create index attendance_events_org_time on public.attendance_events (organization_id, occurred_at desc);

create table public.attendance_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,                     -- date the shift STARTS (night shifts)

  -- snapshot of the shift that applied that day (later shift changes don't alter history)
  shift_id uuid references public.shifts(id) on delete set null,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  break_mode public.break_mode,
  break_minutes integer not null default 0,

  check_in_at timestamptz,
  check_out_at timestamptz,
  last_seen_at timestamptz,
  check_in_camera_id uuid references public.cameras(id) on delete set null,
  check_out_camera_id uuid references public.cameras(id) on delete set null,
  status public.day_status not null default 'present',
  check_in_source public.record_source,
  check_out_source public.record_source,

  -- computed by public.recalc_attendance_day()
  gross_minutes integer,                       -- check_out - check_in
  net_minutes integer,                         -- gross - break (when break_mode = 'deduct')
  late_minutes integer not null default 0,
  early_leave_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  note text,
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index attendance_days_org_date on public.attendance_days (organization_id, work_date desc);

create table public.unknown_faces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  camera_id uuid references public.cameras(id) on delete set null,
  occurred_at timestamptz not null default now(),
  snapshot_path text,
  embedding extensions.vector(512),
  best_match_employee_id uuid references public.employees(id) on delete set null,
  best_match_score real,
  status public.review_status not null default 'pending',
  assigned_employee_id uuid references public.employees(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);

create table public.leaves (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  status public.leave_status not null default 'pending',
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

-- ---------------------------------------------------------------------------
-- Settings & audit
-- ---------------------------------------------------------------------------
create table public.settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, key)
);

-- Secrets (EZVIZ appSecret, SMTP etc.) — no RLS policies => only service role can read.
create table public.secrets (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, key)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  table_name text,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper functions for RLS (security definer avoids recursive RLS on profiles)
-- ---------------------------------------------------------------------------
create or replace function public.current_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select organization_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select employee_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('super_admin', 'admin') from public.profiles where id = auth.uid()), false)
$$;

-- Manager can see employees of the department they manage
create or replace function public.can_view_employee(emp uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join public.employees e on e.id = emp and e.organization_id = p.organization_id
    where p.id = auth.uid()
      and (
        p.role in ('super_admin', 'admin')
        or p.employee_id = emp
        or (p.role = 'manager' and p.managed_department_id = e.department_id)
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- Shift resolution & attendance calculation
-- ---------------------------------------------------------------------------

-- Shift for an employee on a date: override > dated assignment (weekday-filtered) > none.
create or replace function public.resolve_shift(p_employee uuid, p_date date)
returns public.shifts
language sql stable security definer set search_path = '' as $$
  with ov as (
    select o.shift_id, true as is_override
    from public.shift_overrides o
    where o.employee_id = p_employee and o.work_date = p_date
  ),
  asg as (
    select es.shift_id, false as is_override
    from public.employee_shifts es
    where es.employee_id = p_employee
      and es.effective_from <= p_date
      and (es.effective_to is null or es.effective_to >= p_date)
      and (es.days is null or extract(isodow from p_date)::smallint = any (es.days))
    order by es.effective_from desc
    limit 1
  ),
  pick as (
    select * from ov
    union all
    select * from asg where not exists (select 1 from ov)
  )
  select s.*
  from pick p
  join public.shifts s on s.id = p.shift_id
  where p.is_override or extract(isodow from p_date)::smallint = any (s.working_days)
$$;

-- Recompute derived minutes + status for one attendance day. Called by the worker after
-- every check-in/out and by admins after corrections.
create or replace function public.recalc_attendance_day(p_day uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.attendance_days;
  s public.shifts;
  tz text;
  v_gross int; v_net int; v_late int := 0; v_early int := 0; v_ot int := 0;
  v_status public.day_status;
begin
  -- service role (worker, cron) has no auth.uid(); signed-in callers must be admins
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not allowed';
  end if;

  select * into d from public.attendance_days where id = p_day for update;
  if not found then return; end if;
  if d.status in ('leave', 'holiday') then return; end if;

  select coalesce(b.timezone, 'Asia/Karachi') into tz
  from public.employees e left join public.branches b on b.id = e.branch_id
  where e.id = d.employee_id;

  -- snapshot the shift the first time
  if d.shift_id is null then
    s := public.resolve_shift(d.employee_id, d.work_date);
    if s.id is not null then
      d.shift_id := s.id;
      d.break_mode := s.break_mode;
      d.break_minutes := s.break_minutes;
      if s.kind = 'fixed' then
        d.scheduled_start := (d.work_date + s.start_time) at time zone tz;
        d.scheduled_end := (d.work_date + s.end_time
                            + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end)
                           at time zone tz;
      end if;
    end if;
  else
    select * into s from public.shifts where id = d.shift_id;
  end if;

  if d.check_in_at is not null and d.check_out_at is not null then
    v_gross := greatest(0, (extract(epoch from d.check_out_at - d.check_in_at) / 60)::int);
    v_net := case when d.break_mode = 'deduct' then greatest(0, v_gross - d.break_minutes) else v_gross end;
  end if;

  if s.id is not null and s.kind = 'fixed' and d.scheduled_start is not null then
    if d.check_in_at > d.scheduled_start + make_interval(mins => s.grace_in_minutes) then
      v_late := (extract(epoch from d.check_in_at - d.scheduled_start) / 60)::int;
    end if;
    if d.check_out_at is not null and d.check_out_at < d.scheduled_end - make_interval(mins => s.grace_out_minutes) then
      v_early := (extract(epoch from d.scheduled_end - d.check_out_at) / 60)::int;
    end if;
    if d.check_out_at is not null and d.check_out_at > d.scheduled_end + make_interval(mins => s.overtime_after_minutes) then
      v_ot := (extract(epoch from d.check_out_at - d.scheduled_end) / 60)::int;
    end if;
  elsif s.id is not null and s.kind = 'flexible' and v_net is not null and s.required_minutes is not null then
    v_ot := greatest(0, v_net - s.required_minutes - s.overtime_after_minutes);
  end if;

  v_status := case
    when d.check_in_at is null then 'absent'
    when v_net is not null and s.id is not null and v_net < s.absent_minutes then 'absent'
    when v_net is not null and s.id is not null and v_net < s.half_day_minutes then 'half_day'
    when v_late > 0 then 'late'
    else 'present'
  end;

  update public.attendance_days set
    shift_id = d.shift_id,
    break_mode = d.break_mode,
    break_minutes = d.break_minutes,
    scheduled_start = d.scheduled_start,
    scheduled_end = d.scheduled_end,
    gross_minutes = v_gross,
    net_minutes = v_net,
    late_minutes = v_late,
    early_leave_minutes = v_early,
    overtime_minutes = v_ot,
    status = v_status
  where id = p_day;
end $$;

-- Save an employee's working schedule from the employee form (create or change).
-- Creates a new personal schedule row and starts it on p_effective_from; the previous
-- assignment is closed the day before, so past attendance keeps its old schedule.
create or replace function public.set_employee_schedule(
  p_employee uuid,
  p_effective_from date,
  p_start time,
  p_end time,
  p_working_days smallint[],
  p_break_minutes integer default 60,
  p_break_mode public.break_mode default 'deduct',
  p_kind public.shift_kind default 'fixed',
  p_required_minutes integer default null,
  p_break_start time default null,
  p_break_end time default null,
  p_grace_in integer default 15,
  p_grace_out integer default 10,
  p_overtime_after integer default 30
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_name text;
  v_shift uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not allowed';
  end if;

  select organization_id, full_name into v_org, v_name from public.employees where id = p_employee;
  if v_org is null then raise exception 'employee not found'; end if;
  if auth.uid() is not null and v_org <> public.current_org_id() then raise exception 'not allowed'; end if;
  if p_kind = 'fixed' and p_start = p_end then raise exception 'start and end cannot be equal'; end if;
  if coalesce(array_length(p_working_days, 1), 0) = 0 then raise exception 'select at least one working day'; end if;

  insert into public.shifts (
    organization_id, employee_id, name, kind, start_time, end_time, required_minutes, working_days,
    break_mode, break_minutes, break_start, break_end, grace_in_minutes, grace_out_minutes, overtime_after_minutes
  ) values (
    v_org, p_employee, v_name || ' schedule', p_kind, p_start, p_end, p_required_minutes, p_working_days,
    p_break_mode, p_break_minutes, p_break_start, p_break_end, p_grace_in, p_grace_out, p_overtime_after
  ) returning id into v_shift;

  -- replace any assignment starting on/after the new date, close the one running before it
  delete from public.employee_shifts where employee_id = p_employee and effective_from >= p_effective_from;
  update public.employee_shifts set effective_to = p_effective_from - 1
  where employee_id = p_employee and (effective_to is null or effective_to >= p_effective_from);

  insert into public.employee_shifts (employee_id, shift_id, effective_from, created_by)
  values (p_employee, v_shift, p_effective_from, auth.uid());

  insert into public.audit_log (organization_id, actor_id, action, table_name, record_id, new_data)
  values (v_org, auth.uid(), 'set_schedule', 'employees', p_employee::text,
          jsonb_build_object('shift_id', v_shift, 'from', p_effective_from, 'start', p_start, 'end', p_end,
                             'days', p_working_days, 'break_minutes', p_break_minutes));
  return v_shift;
end $$;

revoke execute on function public.set_employee_schedule from public, anon;
grant execute on function public.set_employee_schedule to authenticated, service_role;

revoke execute on function public.recalc_attendance_day(uuid) from public, anon;
grant execute on function public.recalc_attendance_day(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();
create trigger cameras_touch before update on public.cameras
  for each row execute function public.touch_updated_at();
create trigger attendance_days_touch before update on public.attendance_days
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.organizations     enable row level security;
alter table public.branches          enable row level security;
alter table public.departments       enable row level security;
alter table public.shifts            enable row level security;
alter table public.employee_shifts   enable row level security;
alter table public.shift_overrides   enable row level security;
alter table public.holidays          enable row level security;
alter table public.employees         enable row level security;
alter table public.profiles          enable row level security;
alter table public.face_embeddings   enable row level security;
alter table public.cameras           enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_days   enable row level security;
alter table public.unknown_faces     enable row level security;
alter table public.leaves            enable row level security;
alter table public.settings          enable row level security;
alter table public.secrets           enable row level security;
alter table public.audit_log         enable row level security;

-- Org-wide readable reference data; admins write
create policy org_read on public.organizations for select to authenticated
  using (id = public.current_org_id());

create policy branches_read on public.branches for select to authenticated
  using (organization_id = public.current_org_id());
create policy branches_admin on public.branches for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy departments_read on public.departments for select to authenticated
  using (organization_id = public.current_org_id());
create policy departments_admin on public.departments for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy shifts_read on public.shifts for select to authenticated
  using (organization_id = public.current_org_id()
         and (employee_id is null or public.can_view_employee(employee_id)));
create policy shifts_admin on public.shifts for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

-- Shift assignments: employee sees own, manager sees team; admins assign.
create policy emp_shifts_read on public.employee_shifts for select to authenticated
  using (public.can_view_employee(employee_id));
create policy emp_shifts_admin on public.employee_shifts for all to authenticated
  using (public.is_admin() and public.can_view_employee(employee_id))
  with check (public.is_admin() and public.can_view_employee(employee_id));

-- One-day overrides: admins and the team's manager can set them.
create policy overrides_read on public.shift_overrides for select to authenticated
  using (public.can_view_employee(employee_id));
create policy overrides_write on public.shift_overrides for all to authenticated
  using (public.current_app_role() in ('super_admin', 'admin', 'manager') and public.can_view_employee(employee_id))
  with check (public.current_app_role() in ('super_admin', 'admin', 'manager') and public.can_view_employee(employee_id));

create policy holidays_read on public.holidays for select to authenticated
  using (organization_id = public.current_org_id());
create policy holidays_admin on public.holidays for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

-- Profiles: own row; admins see org
create policy profiles_self on public.profiles for select to authenticated
  using (id = auth.uid() or (organization_id = public.current_org_id() and public.is_admin()));
create policy profiles_admin on public.profiles for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

-- Employees
create policy employees_read on public.employees for select to authenticated
  using (public.can_view_employee(id));
create policy employees_admin on public.employees for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

-- Face embeddings: admins only (employees enroll via server API with service role)
create policy faces_admin on public.face_embeddings for all to authenticated
  using (public.is_admin() and public.can_view_employee(employee_id))
  with check (public.is_admin() and public.can_view_employee(employee_id));

-- Cameras: admins only
create policy cameras_admin on public.cameras for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

-- Attendance: viewable per can_view_employee; corrections by admins
create policy events_read on public.attendance_events for select to authenticated
  using (organization_id = public.current_org_id()
         and (employee_id is null and public.is_admin() or public.can_view_employee(employee_id)));
create policy events_admin on public.attendance_events for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy days_read on public.attendance_days for select to authenticated
  using (public.can_view_employee(employee_id));
create policy days_admin on public.attendance_days for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy unknown_admin on public.unknown_faces for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

-- Leaves: employee creates/reads own; manager/admin decide
create policy leaves_read on public.leaves for select to authenticated
  using (public.can_view_employee(employee_id));
create policy leaves_insert_own on public.leaves for insert to authenticated
  with check (employee_id = public.current_employee_id()
              and organization_id = public.current_org_id()
              and status = 'pending');
create policy leaves_decide on public.leaves for update to authenticated
  using (public.current_app_role() in ('super_admin', 'admin', 'manager')
         and public.can_view_employee(employee_id));

create policy settings_read on public.settings for select to authenticated
  using (organization_id = public.current_org_id());
create policy settings_admin on public.settings for all to authenticated
  using (organization_id = public.current_org_id() and public.current_app_role() = 'super_admin')
  with check (organization_id = public.current_org_id() and public.current_app_role() = 'super_admin');

-- secrets: no policies (service role only)

create policy audit_read on public.audit_log for select to authenticated
  using (organization_id = public.current_org_id() and public.is_admin());

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.attendance_events, public.attendance_days;

-- ---------------------------------------------------------------------------
-- Storage buckets (private)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('faces', 'faces', false),
  ('snapshots', 'snapshots', false)
on conflict (id) do nothing;

create policy snapshots_admin_read on storage.objects for select to authenticated
  using (bucket_id in ('faces', 'snapshots') and public.is_admin());
