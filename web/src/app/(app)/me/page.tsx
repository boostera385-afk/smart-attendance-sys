import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FaceEnroll } from "@/components/face-enroll";
import { EmptyState, Notice, PageHeader, StatusPill } from "@/components/form-bits";
import { getViewer } from "@/lib/auth";
import { listFacePhotos } from "@/lib/faces";
import { addDays, fmtDate, fmtDays, fmtMinutes, fmtMoney, fmtMonth, fmtTime, todayLocal } from "@/lib/format";
import type { PortalToday } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { deleteMyFacePhoto, uploadMyFaces } from "./actions";
import { TodayCard } from "./today-card";

export const metadata: Metadata = { title: "My attendance" };

async function Me() {
  const v = await getViewer();
  if (!v.employeeId) {
    return <Notice>Your login isn&apos;t linked to an employee record, so there is no personal attendance to show.</Notice>;
  }
  const supabase = await createClient();
  const today = todayLocal();
  const [{ data: emp }, { data: days }, { data: asg }, { data: slips }, faces, { data: portal }] = await Promise.all([
    supabase.from("employees").select("full_name, status, departments(name)").eq("id", v.employeeId).single(),
    supabase.from("attendance_days")
      .select("work_date, check_in_at, check_out_at, net_minutes, late_minutes, extra_minutes, overtime_minutes, status, check_in_source, check_out_source, needs_review")
      .eq("employee_id", v.employeeId).gte("work_date", addDays(today, -31)).order("work_date", { ascending: false }),
    supabase.from("employee_shifts").select("effective_from, shifts(kind, start_time, end_time, working_days, break_minutes, required_minutes)")
      .eq("employee_id", v.employeeId).lte("effective_from", today).order("effective_from", { ascending: false }).limit(1),
    supabase.from("payslips").select("id, period, currency, gross, deductions, net, lines").eq("employee_id", v.employeeId)
      .order("period", { ascending: false }).limit(6),
    listFacePhotos(v.employeeId),
    // own employee id only (from the session), service role because self-check RPCs are server-only
    createAdminClient().rpc("portal_today", { p_employee: v.employeeId }),
  ]);
  const today$ = portal as PortalToday | null;
  const todayRow = days?.find((d) => d.work_date === today);
  const s = asg?.[0]?.shifts as unknown as { kind: string; start_time: string; end_time: string; working_days: number[]; break_minutes: number; required_minutes: number | null } | undefined;
  const month = (days ?? []).filter((d) => d.work_date.startsWith(today.slice(0, 7)));
  const lates = month.filter((d) => d.late_minutes > 0).length;
  const extra = month.reduce((a, d) => a + (d.extra_minutes ?? 0), 0);
  const overtime = month.reduce((a, d) => a + (d.overtime_minutes ?? 0), 0);
  const worked = month.reduce((a, d) => a + (d.net_minutes ?? 0), 0);
  const present = month.filter((d) => d.check_in_at).length;
  const absent = month.filter((d) => d.status === "absent").length;

  return (
    <div className="flex flex-col gap-6">
      {today$ && <TodayCard initial={today$} />}
      {emp?.status !== "active" && today$?.mode !== "portal" && (
        <Notice>
          {faces.photos.length
            ? "Your face photos are waiting for HR approval. Until then the cameras can't check you in."
            : "Add your face photos below so the door camera can check you in automatically."}
        </Notice>
      )}
      <div className="grid gap-4 md:grid-cols-4">
        {today$ ? (
          <>
            <Card>
              <CardHeader>
                <CardDescription>Present this month</CardDescription>
                <CardTitle className="font-mono text-2xl">{present}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{absent} absent · {month.length} days recorded</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Hours this month</CardDescription>
                <CardTitle className="font-mono text-2xl">{fmtMinutes(worked)}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {overtime ? `${fmtMinutes(overtime)} overtime` : "No overtime"}
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardDescription>Today</CardDescription>
                <CardTitle className="font-mono text-2xl">{todayRow?.check_in_at ? fmtTime(todayRow.check_in_at) : "Not in"}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {todayRow?.check_in_at ? (
                  <>
                    <StatusPill status={todayRow.status} /> {todayRow.check_out_at ? `· out ${fmtTime(todayRow.check_out_at)}` : ""}
                  </>
                ) : (
                  "No check-in yet"
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>My hours</CardDescription>
                <CardTitle className="font-mono text-2xl">
                  {s ? (s.kind === "flexible" ? fmtMinutes(s.required_minutes) : `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`) : "—"}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{s ? `${fmtDays(s.working_days)} · ${s.break_minutes} min paid break` : "Not set"}</CardContent>
            </Card>
          </>
        )}
        <Card>
          <CardHeader>
            <CardDescription>Late this month</CardDescription>
            <CardTitle className="font-mono text-2xl">{lates}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{month.length} days recorded</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Extra time this month</CardDescription>
            <CardTitle className="font-mono text-2xl">{fmtMinutes(extra)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Before start + after end</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          {!days?.length ? (
            <EmptyState title="No attendance recorded yet" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>In</TableHead>
                    <TableHead>Out</TableHead>
                    <TableHead>Worked</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.map((d) => (
                    <TableRow key={d.work_date}>
                      <TableCell>{fmtDate(d.work_date)}</TableCell>
                      <TableCell className="font-mono">{fmtTime(d.check_in_at)}</TableCell>
                      <TableCell className="font-mono">
                        {fmtTime(d.check_out_at)}
                        {d.needs_review ? (
                          <span className="ml-1 text-xs text-warning">missing · HR to confirm</span>
                        ) : d.check_out_source === "auto" && <span className="ml-1 text-xs text-muted-foreground">auto</span>}
                      </TableCell>
                      <TableCell className="font-mono">{fmtMinutes(d.net_minutes)}</TableCell>
                      <TableCell>
                        <StatusPill status={d.status} label={d.late_minutes ? `Late ${d.late_minutes}m` : undefined} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Something wrong? Tell HR — they can correct any day.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My face for the camera</CardTitle>
          <CardDescription>
            Used only to recognise you at the door. Photos are private (HR and you). No video is recorded. Uploading means you agree to this use.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FaceEnroll
            photos={faces.photos}
            approved={faces.approved}
            upload={uploadMyFaces}
            remove={deleteMyFacePhoto}
            maxPhotos={15}
            canRemoveApproved={false}
          />
        </CardContent>
      </Card>

      {(slips?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My payslips</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {slips!.map((p) => (
              <details key={p.id} className="rounded-xl border p-3">
                <summary className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="font-medium">{fmtMonth(p.period)}</span>
                  <span className="font-mono">{fmtMoney(p.net, p.currency)}</span>
                </summary>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {(p.lines as { label: string; amount: number; type: string; detail?: string }[]).map((l, i) => (
                    <li key={i} className="flex justify-between gap-4">
                      <span>{l.label}</span>
                      <span className={`font-mono ${l.type === "deduction" ? "text-danger" : ""}`}>
                        {l.type === "info" ? l.detail : `${l.type === "deduction" ? "−" : ""}${fmtMoney(l.amount, p.currency)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function MePage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title="My attendance" description="Your check-ins, working hours, face enrollment and payslips." />
      <Suspense fallback={<Skeleton className="h-[36rem] rounded-xl" />}>
        <Me />
      </Suspense>
    </div>
  );
}
