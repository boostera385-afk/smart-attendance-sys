-- Face enrollment photos, camera sightings → check-in / check-out, nightly close of attendance days.
-- See docs/MASTER_PLAN.md §7.2–7.7.

-- ---------------------------------------------------------------------------
-- Enrollment photos (uploaded by the employee or HR; the worker turns them into embeddings)
-- ---------------------------------------------------------------------------
create type public.face_photo_status as enum ('pending', 'processed', 'failed');

create table public.face_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  path text not null,                       -- storage: faces/<org>/<employee>/<id>.jpg
  status public.face_photo_status not null default 'pending',
  error text,
  quality real,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index face_photos_pending on public.face_photos (created_at) where status = 'pending';
create index face_photos_employee on public.face_photos (employee_id);

alter table public.face_embeddings
  add column photo_id uuid references public.face_photos(id) on delete cascade;

alter table public.face_photos enable row level security;
create policy face_photos_read on public.face_photos for select to authenticated
  using (public.can_view_employee(employee_id));
create policy face_photos_admin on public.face_photos for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

grant select, insert, update, delete on public.face_photos to authenticated;
grant all on public.face_photos to service_role;

-- Notification channels: email today; WhatsApp (HR / leave auto-replies) and Slack (reports) planned.
alter table public.notifications
  add column channel text not null default 'email' check (channel in ('email', 'whatsapp', 'slack')),
  add column to_phone text,
  alter column to_email drop not null;

-- Leave documents (medical notes etc.): private, read via short-lived signed URLs from the server
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Camera health written by the worker
alter table public.cameras add column last_error text;

-- ---------------------------------------------------------------------------
-- Work date for a moment in time: a night shift that started yesterday and is still open
-- owns the sighting; otherwise the local calendar date.
-- ---------------------------------------------------------------------------
create or replace function public.work_date_for(p_employee uuid, p_at timestamptz)
returns date
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text;
  v_local date;
  s public.shifts;
begin
  select coalesce(b.timezone, 'Asia/Karachi') into tz
  from public.employees e left join public.branches b on b.id = e.branch_id
  where e.id = p_employee;
  v_local := (p_at at time zone coalesce(tz, 'Asia/Karachi'))::date;

  s := public.resolve_shift(p_employee, v_local - 1);
  if s.id is not null and s.kind = 'fixed' and s.end_time <= s.start_time
     and p_at <= ((v_local + s.end_time) at time zone tz) + make_interval(mins => s.checkout_close_minutes) then
    -- yesterday's night shift is still within its close window, unless today's shift has opened
    if not exists (select 1 from public.attendance_days d where d.employee_id = p_employee and d.work_date = v_local) then
      return v_local - 1;
    end if;
  end if;
  return v_local;
end $$;

-- ---------------------------------------------------------------------------
-- Worker entry point: a recognised face on a camera. Service role only.
-- entry/both: first sighting of the work day = check-in
-- exit/both : later sightings (≥ min gap after check-in) move the check-out later
-- presence  : only last_seen
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
        and (d.check_out_at is null or p_at > d.check_out_at) then
    update public.attendance_days set check_out_at = p_at, last_seen_at = p_at, check_out_camera_id = p_camera,
      check_out_source = 'camera'
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

  return jsonb_build_object('action', v_action, 'day_id', d.id, 'work_date', v_date,
                            'status', d.status, 'late_minutes', coalesce(d.late_minutes, 0));
end $$;

-- ---------------------------------------------------------------------------
-- Close finished days (pg_cron, every 15 min):
--  • checked in, no check-out, shift + close window over → check-out = last seen (source auto)
--  • scheduled yesterday, nothing recorded → absent / leave / holiday row
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

  for r in
    select d.id, d.check_in_at, d.last_seen_at, d.scheduled_end, sh.checkout_close_minutes
    from public.attendance_days d
    left join public.shifts sh on sh.id = d.shift_id
    where d.check_in_at is not null and d.check_out_at is null
      and d.work_date >= current_date - 7
      and now() > coalesce(d.scheduled_end + make_interval(mins => coalesce(sh.checkout_close_minutes, 240)),
                           (d.work_date + 1)::timestamp at time zone 'Asia/Karachi' + interval '6 hours')
  loop
    update public.attendance_days set
      check_out_at = case when r.last_seen_at > r.check_in_at then r.last_seen_at end,
      check_out_source = 'auto',
      note = coalesce(note || ' · ', '') || 'Auto check-out (no exit seen)'
    where id = r.id;
    perform public.recalc_attendance_day(r.id);
    n := n + 1;
  end loop;

  for r in
    select e.id, e.organization_id from public.employees e
    where e.status = 'active' and e.joined_on <= v_yesterday and (e.left_on is null or e.left_on >= v_yesterday)
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

revoke execute on function public.work_date_for(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.record_sighting(uuid, uuid, timestamptz, real, text) from public, anon, authenticated;
revoke execute on function public.close_attendance_days() from public, anon, authenticated;
grant execute on function public.work_date_for(uuid, timestamptz) to service_role;
grant execute on function public.record_sighting(uuid, uuid, timestamptz, real, text) to service_role;
grant execute on function public.close_attendance_days() to service_role;

select cron.schedule('close-attendance-days', '*/15 * * * *', $$ select public.close_attendance_days(); $$);

-- Raw sightings (no images) are kept 90 days. Snapshot files and unknown faces are cleaned by the
-- worker (it deletes the storage object and the row together), see worker/recognizer/cleanup.py.
select cron.schedule('retention-sightings', '30 22 * * *', $$
  delete from public.attendance_events where type = 'sighting' and occurred_at < now() - interval '90 days';
$$);
