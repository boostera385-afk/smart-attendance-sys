import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/form-bits";
import { getViewer, isAdminRole, isApproverRole } from "@/lib/auth";
import { todayLocal } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { AttendanceTable, type DayRow } from "./attendance-table";

export const metadata: Metadata = { title: "Attendance" };

async function Attendance({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const v = await getViewer();
  if (!isApproverRole(v.role)) redirect("/me");
  const sp = await searchParams;
  const today = todayLocal();
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;

  const supabase = await createClient();
  const [{ data: emps }, { data: days }] = await Promise.all([
    supabase.from("employees").select("id, full_name, employee_code, joined_on, left_on, status, departments(name)")
      .neq("status", "invited").order("full_name"),
    supabase.from("attendance_days")
      .select("employee_id, check_in_at, check_out_at, net_minutes, late_minutes, early_leave_minutes, extra_minutes, status, check_in_source, check_out_source, needs_review, note, scheduled_start, scheduled_end")
      .eq("work_date", date),
  ]);
  const byEmp = new Map((days ?? []).map((d) => [d.employee_id, d]));
  const rows: DayRow[] = (emps ?? [])
    .filter((e) => e.joined_on <= date && (!e.left_on || e.left_on >= date) && (e.status !== "inactive" || byEmp.has(e.id)))
    .map((e) => {
      const d = byEmp.get(e.id);
      return {
        employeeId: e.id,
        name: e.full_name,
        code: e.employee_code,
        department: (e.departments as unknown as { name: string } | null)?.name ?? null,
        checkIn: d?.check_in_at ?? null,
        checkOut: d?.check_out_at ?? null,
        net: d?.net_minutes ?? null,
        late: d?.late_minutes ?? 0,
        early: d?.early_leave_minutes ?? 0,
        extra: d?.extra_minutes ?? 0,
        status: d?.status ?? (date >= today ? "not_in" : "no_record"),
        source: [d?.check_in_source, d?.check_out_source].includes("manual") ? "manual" : d?.check_out_source === "auto" ? "auto" : d ? "camera" : null,
        inSource: d?.check_in_source ?? null,
        outSource: d?.check_out_source ?? null,
        needsReview: d?.needs_review ?? false,
        note: d?.note ?? null,
        scheduledStart: d?.scheduled_start ?? null,
      };
    });

  return <AttendanceTable rows={rows} date={date} today={today} canCorrect={isAdminRole(v.role)} />;
}

export default function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader title="Attendance" description="Daily check-ins and check-outs (portal or camera) with selfie and location proof, and HR corrections." />
      <Card>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
            <Attendance searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
