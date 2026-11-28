-- Portal attendance: employees check in / out themselves from /me (selfie + office GPS geofence).
-- Admin picks the attendance mode in Settings:
--   portal : portal is the official record; cameras run in TEST mode (they log what they would
--            have done, never touch attendance_days, payroll or emails)
--   hybrid : portal and cameras both live, whichever comes first
--   camera : cameras only, portal buttons hidden
-- Forgotten check-out: reminder email after shift end; if still open when the day closes, the day
-- is flagged needs_review and counts NO hours until HR corrects it.
-- Selfie: company setting, overridable per employee (employees.selfie_required).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.attendance_events
  add column shadow boolean not null default false,   -- camera TEST mode: not part of attendance
  add column latitude double precision,
  add column longitude double precision,
  add column accuracy_m real,
  add column distance_m real,                         -- distance to the matched office
  add column branch_id uuid references public.branches(id) on delete set null,
  add column ip text,
  add column user_agent text;

create index attendance_events_shadow on public.attendance_events (organization_id, occurred_at desc) where shadow;

alter table public.attendance_days
  add column needs_review boolean not null default false,  -- missing check-out: HR must confirm hours
  add column checkout_reminder_at timestamptz;

create index attendance_days_review on public.attendance_days (organization_id, work_date desc) where needs_review;

-- Per-employee selfie rule set by admins: null = follow the company setting, true = always, false = never
alter table public.employees add column selfie_required boolean;

-- ---------------------------------------------------------------------------
-- Config (settings key 'attendance'), merged over defaults
-- ---------------------------------------------------------------------------
create or replace function public.attendance_config(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select '{"mode": "portal", "require_selfie": true, "require_location": true, "max_accuracy_m": 100}'::jsonb
         || coalesce((select value from public.settings where organization_id = p_org and key = 'attendance'), '{}'::jsonb)
$$;

insert into public.settings (organization_id, key, value)
select id, 'attendance', '{"mode": "portal", "require_selfie": true, "require_location": true, "max_accuracy_m": 100}'::jsonb
from public.organizations
on conflict (organization_id, key) do nothing;

-- Great-circle distance in metres
create or replace function public.distance_m(lat1 double precision, lng1 double precision,
                                             lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Offices an employee may check in at: their own branch if it has a location, else every
-- located branch of the organization.
create or replace function public.employee_offices(p_employee uuid)
returns setof public.branches
language sql stable security definer set search_path = '' as $$
  with e as (select organization_id, branch_id from public.employees where id = p_employee),
  own as (
    select b.* from public.branches b, e
    where b.id = e.branch_id and b.latitude is not null and b.longitude is not null
  )
  select * from own
  union all
  select b.* from public.branches b, e
  where b.organization_id = e.organization_id and b.latitude is not null and b.longitude is not null
    and not exists (select 1 from own)
$$;

-- ---------------------------------------------------------------------------
-- What the portal "Today" card needs. Service role only (called by the server after auth).
-- ---------------------------------------------------------------------------
create or replace function public.portal_today(p_employee uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e public.employees;
  cfg jsonb;
  tz text;
  v_date date;
  s public.shifts;
  d public.attendance_days;
  v_start timestamptz;
  v_end timestamptz;
  v_ot boolean;
  v_leave boolean;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  select * into e from public.employees where id = p_employee;
  if e.id is null then raise exception 'employee not found'; end if;

  cfg := public.attendance_config(e.organization_id);
  select coalesce(b.timezone, 'Asia/Karachi') into tz
  from public.employees x left join public.branches b on b.id = x.branch_id where x.id = p_employee;
  v_date := public.work_date_for(p_employee, now());
  s := public.resolve_shift(p_employee, v_date);
  select * into d from public.attendance_days where employee_id = p_employee and work_date = v_date;

  v_start := d.scheduled_start;
  v_end := d.scheduled_end;
  if v_start is null and s.id is not null and s.kind = 'fixed' then
    v_start := (v_date + s.start_time) at time zone tz;
    v_end := (v_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end)
             at time zone tz;
  end if;

  select coalesce(pp.overtime_paid, false) and coalesce(ec.overtime_enabled, false) into v_ot
  from (select 1) one
  left join public.payroll_policies pp on pp.organization_id = e.organization_id
  left join public.employee_compensation ec on ec.employee_id = p_employee;

  select exists (select 1 from public.leaves l where l.employee_id = p_employee and l.status = 'approved'
                 and v_date between l.start_date and l.end_date) into v_leave;

  return jsonb_build_object(
    'now', now(),
    'work_date', v_date,
    'mode', cfg ->> 'mode',
    'require_selfie', coalesce(e.selfie_required, (cfg ->> 'require_selfie')::boolean),
    'require_location', (cfg ->> 'require_location')::boolean,
    'max_accuracy_m', (cfg ->> 'max_accuracy_m')::int,
    'employee_status', e.status,
    'on_leave', v_leave or coalesce(d.status = 'leave', false),
    'holiday', public.is_holiday(p_employee, v_date) or coalesce(d.status = 'holiday', false),
    'overtime_paid', coalesce(v_ot, false),
    'shift', case when s.id is null then null else jsonb_build_object(
      'kind', s.kind, 'start_time', s.start_time, 'end_time', s.end_time, 'required_minutes', s.required_minutes,
      'break_minutes', s.break_minutes, 'grace_in_minutes', s.grace_in_minutes, 'grace_out_minutes', s.grace_out_minutes,
      'overtime_after_minutes', s.overtime_after_minutes, 'checkin_open_minutes', s.checkin_open_minutes,
      'working_days', s.working_days) end,
    'scheduled_start', v_start,
    'scheduled_end', v_end,
    'day', case when d.id is null then null else jsonb_build_object(
      'check_in_at', d.check_in_at, 'check_out_at', d.check_out_at, 'status', d.status,
      'check_in_source', d.check_in_source, 'check_out_source', d.check_out_source,
      'late_minutes', d.late_minutes, 'early_leave_minutes', d.early_leave_minutes,
      'overtime_minutes', d.overtime_minutes, 'extra_minutes', d.extra_minutes, 'net_minutes', d.net_minutes,
      'needs_review', d.needs_review) end,
    'offices', coalesce((select jsonb_agg(jsonb_build_object('name', o.name, 'lat', o.latitude, 'lng', o.longitude,
                                                             'radius_m', o.geofence_radius_m))
                         from public.employee_offices(p_employee) o), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Portal check-in / check-out. Service role only: the Next.js server action authenticates the
-- user, stores the selfie, and passes the request IP / user agent. Time is always the server's.
-- ---------------------------------------------------------------------------
create or replace function public.self_check(
  p_employee uuid,
  p_action text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy real default null,
  p_selfie text default null,
  p_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees;
  cfg jsonb;
  tz text;
  v_now timestamptz := now();
  v_date date;
  s public.shifts;
  d public.attendance_days;
  o record;
  v_office uuid;
  v_office_name text;
  v_dist double precision;
  v_max_acc int;
  v_start timestamptz;
  v_event public.event_type;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  if p_action not in ('check_in', 'check_out') then raise exception 'Invalid action.'; end if;

  select * into e from public.employees where id = p_employee;
  if e.id is null then raise exception 'Employee not found.'; end if;
  if e.status not in ('active', 'pending_enrollment') then
    raise exception 'Your account is not active. Please contact HR.';
  end if;

  cfg := public.attendance_config(e.organization_id);
  if cfg ->> 'mode' = 'camera' then
    raise exception 'Portal check-in is turned off. Please use the office camera.';
  end if;
  if coalesce(e.selfie_required, (cfg ->> 'require_selfie')::boolean) and p_selfie is null then
    raise exception 'A selfie is required to %.', replace(p_action, '_', ' ');
  end if;

  -- Office geofence
  if (cfg ->> 'require_location')::boolean then
    if p_lat is null or p_lng is null then
      raise exception 'Location is required. Allow location access in your browser and try again.';
    end if;
    v_max_acc := coalesce((cfg ->> 'max_accuracy_m')::int, 100);
    if p_accuracy is not null and p_accuracy > v_max_acc then
      raise exception 'Your location is not precise enough (±% m, need ±% m). Turn on precise location or move near a window and retry.',
        round(p_accuracy), v_max_acc;
    end if;
    select x.*, public.distance_m(p_lat, p_lng, x.latitude, x.longitude) as dist into o
    from public.employee_offices(p_employee) x
    order by public.distance_m(p_lat, p_lng, x.latitude, x.longitude)
    limit 1;
    if o.id is null then
      raise exception 'The office location has not been set up yet. Please ask HR.';
    end if;
    -- allow for GPS error, but never more than 50 m of slack
    if o.dist > o.geofence_radius_m + least(coalesce(p_accuracy, 0), 50) then
      raise exception 'You are % m from %. Check-in works within % m of the office.',
        round(o.dist), o.name, o.geofence_radius_m;
    end if;
    v_office := o.id; v_office_name := o.name; v_dist := o.dist;
  end if;

  select coalesce(b.timezone, 'Asia/Karachi') into tz
  from public.employees x left join public.branches b on b.id = x.branch_id where x.id = p_employee;
  v_date := public.work_date_for(p_employee, v_now);
  if e.joined_on is not null and v_date < e.joined_on or e.left_on is not null and v_date > e.left_on then
    raise exception 'You are not on the payroll for today. Please contact HR.';
  end if;

  select * into d from public.attendance_days where employee_id = p_employee and work_date = v_date for update;

  if p_action = 'check_in' then
    if d.check_in_at is not null then
      raise exception 'You already checked in at %.', to_char(d.check_in_at at time zone tz, 'HH24:MI');
    end if;
    if d.status = 'leave' or exists (select 1 from public.leaves l where l.employee_id = p_employee
                                     and l.status = 'approved' and v_date between l.start_date and l.end_date) then
      raise exception 'You are on approved leave today. Ask HR to cancel the leave before checking in.';
    end if;
    s := public.resolve_shift(p_employee, v_date);
    if s.id is not null and s.kind = 'fixed' then
      v_start := (v_date + s.start_time) at time zone tz;
      if v_now < v_start - make_interval(mins => s.checkin_open_minutes) then
        raise exception 'Check-in opens at %.',
          to_char((v_start - make_interval(mins => s.checkin_open_minutes)) at time zone tz, 'HH24:MI');
      end if;
    end if;

    if d.id is null then
      insert into public.attendance_days (organization_id, employee_id, work_date, check_in_at, last_seen_at, check_in_source)
      values (e.organization_id, p_employee, v_date, v_now, v_now, 'web')
      returning * into d;
    else
      update public.attendance_days set check_in_at = v_now, last_seen_at = v_now, check_in_source = 'web',
        status = case when status = 'holiday' then status else 'present' end
      where id = d.id returning * into d;
    end if;
    v_event := 'check_in';
  else
    if d.id is null or d.check_in_at is null then
      raise exception 'You have not checked in today.';
    end if;
    if d.check_out_at is not null then
      raise exception 'You already checked out at %.', to_char(d.check_out_at at time zone tz, 'HH24:MI');
    end if;
    if v_now < d.check_in_at + interval '1 minute' then
      raise exception 'You just checked in. Wait a minute before checking out.';
    end if;
    update public.attendance_days set check_out_at = v_now, last_seen_at = v_now, check_out_source = 'web',
      needs_review = false
    where id = d.id returning * into d;
    v_event := 'check_out';
  end if;

  insert into public.attendance_events (organization_id, employee_id, type, occurred_at, snapshot_path, source,
                                        latitude, longitude, accuracy_m, distance_m, branch_id, ip, user_agent)
  values (e.organization_id, p_employee, v_event, v_now, p_selfie, 'web',
          p_lat, p_lng, p_accuracy, v_dist, v_office, left(p_ip, 64), left(p_user_agent, 400));

  perform public.recalc_attendance_day(d.id);
  select * into d from public.attendance_days where id = d.id;

  perform public.enqueue_notification(e.organization_id, 'check_in_receipt', e.email, e.full_name,
    format('%s at %s', case when v_event = 'check_in' then 'Checked in' else 'Checked out' end,
           to_char(v_now at time zone tz, 'HH24:MI')),
    jsonb_build_object('kind', v_event::text, 'via', 'portal', 'employee', e.full_name,
      'camera', coalesce(v_office_name, 'Employee portal'),
      'time', to_char(v_now at time zone tz, 'HH24:MI'),
      'late', v_event = 'check_in' and d.late_minutes > 0,
      'late_minutes', case when v_event = 'check_in' then d.late_minutes else 0 end,
      'worked', case when v_event = 'check_out' and d.net_minutes is not null
                     then format('%sh %sm', d.net_minutes / 60, lpad((d.net_minutes % 60)::text, 2, '0')) end));

  return jsonb_build_object('action', v_event, 'at', v_now, 'work_date', v_date, 'status', d.status,
    'late_minutes', coalesce(d.late_minutes, 0), 'net_minutes', d.net_minutes,
    'overtime_minutes', d.overtime_minutes, 'extra_minutes', d.extra_minutes,
    'office', v_office_name, 'distance_m', round(v_dist));
end $$;

-- ---------------------------------------------------------------------------
-- Camera sightings. In 'portal' mode the camera is in TEST mode: the first entry-camera sighting
-- of the day is logged as a shadow check-in (snapshot kept, for the accuracy report); everything
-- else is a shadow sighting. attendance_days, payroll and emails are never touched.
-- ---------------------------------------------------------------------------
create or replace function public.record_sighting(
  p_camera uuid,
  p_employee uuid,
  p_at timestamptz default now(),
  p_confidence real default null,
  p_snapshot text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cam public.cameras;
  e public.employees;
  d public.attendance_days;
  tz text;
  v_date date;
  v_action text := 'seen';
  v_min_gap int;
  v_event public.event_type := 'sighting';
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;

  select * into cam from public.cameras where id = p_camera;
  select * into e from public.employees where id = p_employee;
  if cam.id is null or e.id is null or cam.organization_id <> e.organization_id then
    raise exception 'camera or employee not found';
  end if;
  if cam.role = 'disabled' or e.status <> 'active' then
    return jsonb_build_object('action', 'ignored');
  end if;

  select coalesce(b.timezone, 'Asia/Karachi') into tz
  from public.employees x left join public.branches b on b.id = x.branch_id where x.id = p_employee;
  v_date := public.work_date_for(p_employee, p_at);

  if public.attendance_config(e.organization_id) ->> 'mode' = 'portal' then
    if cam.role in ('entry', 'both') and not exists (
      select 1 from public.attendance_events
      where employee_id = p_employee and shadow and type = 'check_in'
        and occurred_at >= (v_date::timestamp at time zone tz)
    ) then
      v_action := 'shadow_check_in';
      v_event := 'check_in';
    else
      v_action := 'shadow_seen';
    end if;
    insert into public.attendance_events (organization_id, employee_id, camera_id, type, occurred_at, confidence,
                                          snapshot_path, source, shadow)
    values (e.organization_id, p_employee, p_camera, v_event, p_at, p_confidence,
            case when v_event = 'check_in' then p_snapshot end, 'camera', true);
    return jsonb_build_object('action', v_action, 'work_date', v_date);
  end if;

  v_min_gap := coalesce((select (value ->> 'checkout_min_gap_minutes')::int from public.settings
                         where organization_id = e.organization_id and key = 'recognition'), 10);

  select * into d from public.attendance_days where employee_id = p_employee and work_date = v_date for update;

  if cam.role in ('entry', 'both') and (d.id is null or d.check_in_at is null) then
    if d.id is null then
      insert into public.attendance_days (organization_id, employee_id, work_date, check_in_at, last_seen_at,
                                          check_in_camera_id, check_in_source)
      values (e.organization_id, p_employee, v_date, p_at, p_at, p_camera, 'camera')
      returning * into d;
    else
      update public.attendance_days set check_in_at = p_at, last_seen_at = p_at, check_in_camera_id = p_camera,
        check_in_source = 'camera', status = case when status in ('leave', 'holiday') then status else 'present' end
      where id = d.id returning * into d;
    end if;
    v_action := 'check_in';
    v_event := 'check_in';
  elsif d.id is not null and d.check_in_at is not null and cam.role in ('exit', 'both')
        and p_at >= d.check_in_at + make_interval(mins => v_min_gap)
        and (d.check_out_at is null or p_at > d.check_out_at)
        and coalesce(d.check_out_source::text, '') not in ('web', 'manual') then
    -- (a portal or HR check-out is final; the camera never moves it)
    update public.attendance_days set check_out_at = p_at, last_seen_at = p_at, check_out_camera_id = p_camera,
      check_out_source = 'camera', needs_review = false
    where id = d.id returning * into d;
    v_action := 'check_out';
    v_event := 'check_out';
  elsif d.id is not null then
    update public.attendance_days set last_seen_at = greatest(coalesce(last_seen_at, p_at), p_at) where id = d.id;
  end if;

  insert into public.attendance_events (organization_id, employee_id, camera_id, type, occurred_at, confidence, snapshot_path, source)
  values (e.organization_id, p_employee, p_camera, v_event, p_at, p_confidence,
          case when v_event = 'sighting' then null else p_snapshot end, 'camera');

  if v_action in ('check_in', 'check_out') then
    perform public.recalc_attendance_day(d.id);
    select * into d from public.attendance_days where id = d.id;
  end if;

  if v_action = 'check_in' then
    perform public.enqueue_notification(e.organization_id, 'check_in_receipt', e.email, e.full_name,
      format('Checked in at %s', to_char(p_at at time zone tz, 'HH24:MI')),
      jsonb_build_object('kind', 'check_in', 'employee', e.full_name, 'camera', cam.name,
        'time', to_char(p_at at time zone tz, 'HH24:MI'), 'late', d.late_minutes > 0, 'late_minutes', d.late_minutes));
  end if;

  if v_action = 'check_out' then
    perform public.enqueue_notification(e.organization_id, 'check_in_receipt', e.email, e.full_name,
      format('Checked out at %s', to_char(p_at at time zone tz, 'HH24:MI')),
      jsonb_build_object('kind', 'check_out', 'employee', e.full_name, 'camera', cam.name,
        'time', to_char(p_at at time zone tz, 'HH24:MI'), 'late', false, 'late_minutes', 0,
        'worked', case when d.net_minutes is null then null
                       else format('%sh %sm', d.net_minutes / 60, lpad((d.net_minutes % 60)::text, 2, '0')) end));
  end if;

  return jsonb_build_object('action', v_action, 'day_id', d.id, 'work_date', v_date,
                            'status', d.status, 'late_minutes', coalesce(d.late_minutes, 0));
end $$;

-- ---------------------------------------------------------------------------
-- Every 15 min: check-out reminders, close open days, mark absentees.
-- A day closed without a check-out counts NO hours and is flagged for HR (needs_review).
-- ---------------------------------------------------------------------------
create or replace function public.close_attendance_days() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
  v_yesterday date := (now() at time zone 'Asia/Karachi')::date - 1;
  s public.shifts;
  v_leave boolean;
  v_id uuid;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;

  -- 1. Reminder 30 min after the shift should have ended (portal check-ins only, once per day)
  for r in
    select d.id, d.organization_id, d.check_in_at, e.email, e.full_name
    from public.attendance_days d
    join public.employees e on e.id = d.employee_id
    left join public.shifts sh on sh.id = d.shift_id
    where d.check_in_at is not null and d.check_out_at is null and d.checkout_reminder_at is null
      and d.check_in_source = 'web' and d.work_date >= current_date - 2
      and now() > coalesce(d.scheduled_end, d.check_in_at + make_interval(mins => coalesce(sh.required_minutes, 480)))
                  + interval '30 minutes'
  loop
    perform public.enqueue_notification(r.organization_id, 'checkout_reminder', r.email, r.full_name,
      'Don''t forget to check out',
      jsonb_build_object('employee', r.full_name,
        'check_in', to_char(r.check_in_at at time zone 'Asia/Karachi', 'HH24:MI')));
    update public.attendance_days set checkout_reminder_at = now() where id = r.id;
  end loop;

  -- 2. Close days still open after the close window
  for r in
    select d.id, d.check_in_at, d.last_seen_at, d.check_in_source
    from public.attendance_days d
    left join public.shifts sh on sh.id = d.shift_id
    where d.check_in_at is not null and d.check_out_at is null and not d.needs_review
      and d.work_date >= current_date - 7
      and now() > coalesce(d.scheduled_end + make_interval(mins => coalesce(sh.checkout_close_minutes, 240)),
                           (d.work_date + 1)::timestamp at time zone 'Asia/Karachi' + interval '6 hours')
  loop
    if r.last_seen_at > r.check_in_at + interval '1 minute' then
      -- a camera saw them later: use that as the check-out
      update public.attendance_days set check_out_at = r.last_seen_at, check_out_source = 'auto',
        note = coalesce(note || ' · ', '') || 'Auto check-out (last seen by camera)'
      where id = r.id;
    else
      update public.attendance_days set check_out_source = 'auto', needs_review = true,
        note = coalesce(note || ' · ', '') || 'Missing check-out: no hours counted until HR confirms'
      where id = r.id;
    end if;
    perform public.recalc_attendance_day(r.id);
    n := n + 1;
  end loop;

  -- 3. Absent rows for yesterday (pending-enrollment employees count too unless the camera is the only way in)
  for r in
    select e.id, e.organization_id from public.employees e
    where (e.status = 'active'
           or e.status = 'pending_enrollment' and public.attendance_config(e.organization_id) ->> 'mode' <> 'camera')
      and e.joined_on <= v_yesterday and (e.left_on is null or e.left_on >= v_yesterday)
      and not exists (select 1 from public.attendance_days d where d.employee_id = e.id and d.work_date = v_yesterday)
  loop
    s := public.resolve_shift(r.id, v_yesterday);
    continue when s.id is null;
    select exists (select 1 from public.leaves l where l.employee_id = r.id and l.status = 'approved'
                   and v_yesterday between l.start_date and l.end_date) into v_leave;
    insert into public.attendance_days (organization_id, employee_id, work_date, shift_id, status, break_minutes)
    values (r.organization_id, r.id, v_yesterday, s.id,
            case when public.is_holiday(r.id, v_yesterday) then 'holiday'
                 when v_leave then 'leave' else 'absent' end, 0)
    returning id into v_id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: everything here is server-side only
-- ---------------------------------------------------------------------------
revoke execute on function public.attendance_config(uuid) from public, anon, authenticated;
revoke execute on function public.employee_offices(uuid) from public, anon, authenticated;
revoke execute on function public.portal_today(uuid) from public, anon, authenticated;
revoke execute on function public.self_check(uuid, text, double precision, double precision, real, text, text, text)
  from public, anon, authenticated;
grant execute on function public.attendance_config(uuid) to service_role;
grant execute on function public.employee_offices(uuid) to service_role;
grant execute on function public.portal_today(uuid) to service_role;
grant execute on function public.self_check(uuid, text, double precision, double precision, real, text, text, text) to service_role;
grant execute on function public.distance_m(double precision, double precision, double precision, double precision)
  to authenticated, service_role;
