-- Confirmation email on camera check-out too (check-in already had one). Same 'check_in_receipt'
-- type and on/off switch; the email template shows "Checked out" and hours worked when kind = check_out.

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
