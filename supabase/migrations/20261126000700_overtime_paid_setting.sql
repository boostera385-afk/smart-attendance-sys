-- Company-wide "pay overtime" switch (Settings › Payroll, admins only). OFF by default:
-- extra/overtime minutes are still recorded and shown, but nothing is paid unless an admin turns this on.

alter table public.payroll_policies
  add column overtime_paid boolean not null default false;

-- generate_payslip: overtime pay now depends on the company switch only.
do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.generate_payslip(uuid,date)'::regprocedure);
  if position('pol.overtime_paid' in def) = 0 then
    def := replace(def,
      'if comp.overtime_enabled and ot_min > 0 then',
      'if pol.overtime_paid and ot_min > 0 then');
    if position('pol.overtime_paid' in def) = 0 then
      raise exception 'generate_payslip: overtime condition not found';
    end if;
    execute def;
  end if;
end $$;
