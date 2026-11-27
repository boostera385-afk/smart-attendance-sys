import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/form-bits";
import { getViewer, isAdminRole, isApproverRole } from "@/lib/auth";
import { addDays, todayLocal } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { Holidays, Roster, type Cell } from "./roster";

export const metadata: Metadata = { title: "Schedules & roster" };

type Shift = { id: string; kind: string; start_time: string; end_time: string; working_days: number[]; required_minutes: number | null };

function mondayOf(d: string) {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay() || 7;
  return addDays(d, 1 - day);
}
const isoDow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() || 7;
const label = (s: Shift) => (s.kind === "flexible" ? `Flex ${Math.round((s.required_minutes ?? 0) / 60)}h` : `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`);

async function RosterSection({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const v = await getViewer();
  if (!isApproverRole(v.role)) redirect("/me");
  const sp = await searchParams;
  const today = todayLocal();
  const week = mondayOf(typeof sp.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const end = dates[6];

  const supabase = await createClient();
  const [{ data: emps }, { data: asg }, { data: ov }, { data: hol }, { data: lv }] = await Promise.all([
    supabase.from("employees").select("id, full_name, departments(name)").in("status", ["active", "pending_enrollment", "invited"]).order("full_name"),
    supabase.from("employee_shifts").select("employee_id, effective_from, effective_to, days, shifts(id, kind, start_time, end_time, working_days, required_minutes)")
      .lte("effective_from", end).or(`effective_to.is.null,effective_to.gte.${week}`),
    supabase.from("shift_overrides").select("employee_id, work_date, reason, shifts(id, kind, start_time, end_time, working_days, required_minutes)")
      .gte("work_date", week).lte("work_date", end),
    supabase.from("holidays").select("id, holiday_date, name").gte("holiday_date", addDays(today, -31)).order("holiday_date"),
    supabase.from("leaves").select("employee_id, start_date, end_date").eq("status", "approved").lte("start_date", end).gte("end_date", week),
  ]);
  const holidayOn = new Map((hol ?? []).map((h) => [h.holiday_date, h.name]));

  const rows = (emps ?? []).map((e) => {
    const cells: Cell[] = dates.map((d) => {
      const o = (ov ?? []).find((x) => x.employee_id === e.id && x.work_date === d);
      if (o) {
        const s = o.shifts as unknown as Shift | null;
        return { date: d, kind: s ? "override" : "off_override", text: s ? label(s) : "Day off", reason: o.reason };
      }
      if (holidayOn.has(d)) return { date: d, kind: "holiday", text: holidayOn.get(d)! };
      if ((lv ?? []).some((l) => l.employee_id === e.id && l.start_date <= d && l.end_date >= d)) return { date: d, kind: "leave", text: "Leave" };
      const a = (asg ?? [])
        .filter((x) => x.employee_id === e.id && x.effective_from <= d && (!x.effective_to || x.effective_to >= d) && (!x.days || x.days.includes(isoDow(d))))
        .sort((x, y) => y.effective_from.localeCompare(x.effective_from))[0];
      const s = a?.shifts as unknown as Shift | undefined;
      if (!s) return { date: d, kind: "none", text: "—" };
      if (!s.working_days.includes(isoDow(d))) return { date: d, kind: "off", text: "Off" };
      return { date: d, kind: "work", text: label(s) };
    });
    return { id: e.id, name: e.full_name, department: (e.departments as unknown as { name: string } | null)?.name ?? null, cells };
  });

  return (
    <>
      <Card>
        <CardContent>
          <Roster rows={rows} dates={dates} week={week} today={today} canSetHours={isAdminRole(v.role)} />
        </CardContent>
      </Card>
      {isAdminRole(v.role) && (
        <Card>
          <CardHeader>
            <CardTitle>Holidays</CardTitle>
            <CardDescription>Nobody is marked absent on a holiday. Payroll skips them.</CardDescription>
          </CardHeader>
          <CardContent>
            <Holidays rows={(hol ?? []).map((h) => ({ id: h.id, date: h.holiday_date, name: h.name }))} />
          </CardContent>
        </Card>
      )}
    </>
  );
}

export default function ShiftsPage({ searchParams }: PageProps<"/shifts">) {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Schedules & roster"
        description="Everyone's hours this week. Click a day to give a day off or different hours for that day only. Regular hours are set on each employee."
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <RosterSection searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
