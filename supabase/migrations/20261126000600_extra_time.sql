-- Extra time: minutes worked before the scheduled start + after the scheduled end.
-- Shown to employees and HR as a record of commitment, but NEVER paid.
-- (Paid overtime stays separate and only applies when overtime_enabled is on for an employee.)

alter table public.attendance_days
  add column early_arrival_minutes integer not null default 0,
  add column extra_minutes integer not null default 0;

alter table public.payslips
  add column extra_minutes integer not null default 0;

-- Same as before, plus early_arrival_minutes and extra_minutes.
create or replace function public.recalc_attendance_day(p_day uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.attendance_days;
  s public.shifts;
  tz text;
  v_gross int; v_net int; v_late int := 0; v_early int := 0; v_ot int := 0;
  v_early_arrival int := 0; v_after int := 0;
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
    if d.check_in_at < d.scheduled_start then
      v_early_arrival := (extract(epoch from d.scheduled_start - d.check_in_at) / 60)::int;
    end if;
    if d.check_out_at is not null and d.check_out_at < d.scheduled_end - make_interval(mins => s.grace_out_minutes) then
      v_early := (extract(epoch from d.scheduled_end - d.check_out_at) / 60)::int;
    end if;
    if d.check_out_at is not null and d.check_out_at > d.scheduled_end then
      v_after := (extract(epoch from d.check_out_at - d.scheduled_end) / 60)::int;
    end if;
    if v_after > s.overtime_after_minutes then
      v_ot := v_after;
    end if;
  elsif s.id is not null and s.kind = 'flexible' and v_net is not null and s.required_minutes is not null then
    v_after := greatest(0, v_net - s.required_minutes);
    v_ot := greatest(0, v_net - s.required_minutes - s.overtime_after_minutes);
  elsif s.id is null and v_net is not null then
    v_after := v_net; -- worked on a day off: all of it is extra time
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
    early_arrival_minutes = v_early_arrival,
    extra_minutes = v_early_arrival + v_after,
    status = v_status
  where id = p_day;
end $$;

-- Payslips: record the month's extra time as an information line (amount 0, never added to pay).
create or replace function public.payslips_extra_time() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_extra int;
begin
  select coalesce(sum(extra_minutes), 0) into v_extra
  from public.attendance_days
  where employee_id = new.employee_id
    and work_date >= new.period
    and work_date < (new.period + interval '1 month')::date;

  new.extra_minutes := v_extra;
  new.lines := (
    select coalesce(jsonb_agg(l), '[]'::jsonb) from jsonb_array_elements(new.lines) l where l ->> 'type' <> 'info'
  );
  if v_extra > 0 then
    new.lines := new.lines || jsonb_build_object(
      'label', 'Extra time (recorded, not paid)', 'amount', 0, 'type', 'info',
      'detail', format('%sh %sm before start / after end of shift', v_extra / 60, v_extra % 60));
  end if;
  return new;
end $$;

create trigger payslips_extra_time before insert or update of lines on public.payslips
  for each row execute function public.payslips_extra_time();

revoke execute on function public.payslips_extra_time() from public, anon, authenticated;
