import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/form-bits";
import { getViewer, isApproverRole } from "@/lib/auth";
import { addDays, fmtMinutes, fmtMonth, todayLocal } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { MonthPicker } from "./month-picker";

export const metadata: Metadata = { title: "Reports" };

/** Score: share of scheduled days attended on time. Same rule the planned Slack digest will use. */
function score(r: { present: number; late: number; absent: number; half: number }) {
  const total = r.present + r.late + r.absent + r.half;
  return total ? Math.round(((r.present + r.late * 0.5 + r.half * 0.5) / total) * 100) : null;
}

async function Report({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const v = await getViewer();
  if (!isApproverRole(v.role)) redirect("/me");
  const sp = await searchParams;
  const today = todayLocal();
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const from = `${month}-01`;
  const nextMonth = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString().slice(0, 10);
  const to = addDays(nextMonth, -1);
  const until = to < today ? to : today;

  const supabase = await createClient();
  const [{ data: emps }, { data: days }] = await Promise.all([
    supabase.from("employees").select("id, full_name, departments(name)").neq("status", "invited").order("full_name"),
    supabase.from("attendance_days").select("employee_id, status, net_minutes, late_minutes, extra_minutes, overtime_minutes")
      .gte("work_date", from).lte("work_date", until),
  ]);

  const rows = (emps ?? []).map((e) => {
    const mine = (days ?? []).filter((d) => d.employee_id === e.id);
    const c = (s: string) => mine.filter((d) => d.status === s).length;
    const r = {
      id: e.id,
      name: e.full_name,
      department: (e.departments as unknown as { name: string } | null)?.name ?? "—",
      present: c("present"),
      late: c("late"),
      half: c("half_day"),
      absent: c("absent"),
      leave: c("leave"),
      lateMinutes: mine.reduce((a, d) => a + (d.late_minutes ?? 0), 0),
      worked: mine.reduce((a, d) => a + (d.net_minutes ?? 0), 0),
      extra: mine.reduce((a, d) => a + (d.extra_minutes ?? 0), 0),
    };
    return { ...r, score: score(r) };
  }).filter((r) => r.present + r.late + r.half + r.absent + r.leave > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker month={month} />
        <span className="text-sm text-muted-foreground">{fmtMonth(from)} · up to {until.slice(8)}</span>
        <Button variant="outline" className="ml-auto" render={<a href={`/attendance/export?from=${from}&to=${until}`} />}>
          <DownloadIcon /> Daily detail (CSV)
        </Button>
      </div>
      {!rows.length ? (
        <EmptyState title="No attendance recorded in this month" />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">On time</TableHead>
                <TableHead className="text-right">Late</TableHead>
                <TableHead className="text-right">Half</TableHead>
                <TableHead className="text-right">Absent</TableHead>
                <TableHead className="text-right">Leave</TableHead>
                <TableHead className="text-right">Worked</TableHead>
                <TableHead className="text-right">Extra</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="font-medium">{r.name}</span>
                    <span className="block text-xs text-muted-foreground">{r.department}</span>
                  </TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${r.score == null ? "" : r.score >= 90 ? "text-success" : r.score >= 75 ? "text-warning" : "text-danger"}`}>
                    {r.score == null ? "—" : `${r.score}%`}
                  </TableCell>
                  <TableCell className="text-right font-mono">{r.present}</TableCell>
                  <TableCell className="text-right font-mono">
                    {r.late}
                    {r.lateMinutes > 0 && <span className="block text-xs text-muted-foreground">{fmtMinutes(r.lateMinutes)}</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono">{r.half}</TableCell>
                  <TableCell className="text-right font-mono">{r.absent}</TableCell>
                  <TableCell className="text-right font-mono">{r.leave}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMinutes(r.worked)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{fmtMinutes(r.extra)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Score = on-time days + half credit for late or half days, out of recorded working days. Lowest first.{" "}
        <Link href="/attendance" className="underline">
          Open daily attendance
        </Link>
      </p>
    </div>
  );
}

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader title="Reports" description="Monthly attendance performance per employee." />
      <Card>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
            <Report searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
