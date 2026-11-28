-- Self check-in / check-out from the employee portal. Kept apart from 'manual' (HR corrections)
-- so reports and payroll can tell the two apart. Own file: a new enum value can't be used in the
-- transaction that adds it.
alter type public.record_source add value if not exists 'web';
