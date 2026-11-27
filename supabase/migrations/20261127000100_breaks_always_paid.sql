-- Company policy: breaks are always paid — break minutes are never deducted from worked time.
-- Enforced in the database so no form, RPC or one-day override can bring deduction back.
-- Also adds the "Development team" department.

alter table public.shifts alter column break_mode set default 'paid';
update public.shifts set break_mode = 'paid' where break_mode <> 'paid';

create or replace function public.force_paid_break()
returns trigger
language plpgsql set search_path = '' as $$
begin
  new.break_mode := 'paid';
  return new;
end $$;

drop trigger if exists shifts_force_paid_break on public.shifts;
create trigger shifts_force_paid_break before insert or update of break_mode on public.shifts
  for each row execute function public.force_paid_break();

drop trigger if exists attendance_days_force_paid_break on public.attendance_days;
create trigger attendance_days_force_paid_break before insert or update of break_mode on public.attendance_days
  for each row when (new.break_mode is not null)
  execute function public.force_paid_break();

-- re-total any day that was computed with a deducted break
do $$
declare r record;
begin
  for r in select id from public.attendance_days where break_mode = 'deduct' loop
    update public.attendance_days set break_mode = 'paid' where id = r.id;
    perform public.recalc_attendance_day(r.id);
  end loop;
end $$;

insert into public.departments (organization_id, name)
select o.id, 'Development team'
from public.organizations o
where not exists (
  select 1 from public.departments d where d.organization_id = o.id and lower(d.name) in ('development team', 'development')
);
