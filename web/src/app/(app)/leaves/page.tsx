import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/form-bits";
import { getViewer, isApproverRole } from "@/lib/auth";
import { todayLocal } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { LeaveRequestForm, MyLeaves, ReviewQueue, type LeaveRow } from "./leave-ui";

export const metadata: Metadata = { title: "Leaves" };

const LEAVE_COLS =
  "id, employee_id, start_date, end_date, days, half_day, reason, status, created_at, decision_note, decided_via, policy_checks, policy_passed, ai_verdict, ai_confidence, ai_summary, attachment_path, cancel_requested, leave_types(name, paid), employees(full_name, departments(name))";

function toRow(l: Record<string, unknown>): LeaveRow {
  const t = l.leave_types as { name: string; paid: boolean } | null;
  const e = l.employees as { full_name: string; departments: { name: string } | null } | null;
  return {
    id: l.id as string,
    employee: e?.full_name ?? "",
    department: e?.departments?.name ?? null,
    type: t?.name ?? "Leave",
    paid: t?.paid ?? true,
    start: l.start_date as string,
    end: l.end_date as string,
    days: Number(l.days ?? 0),
    halfDay: Boolean(l.half_day),
    reason: (l.reason as string) ?? "",
    status: l.status as string,
    createdAt: l.created_at as string,
    note: (l.decision_note as string) ?? null,
    via: (l.decided_via as string) ?? null,
    checks: (l.policy_checks as LeaveRow["checks"]) ?? [],
    aiVerdict: (l.ai_verdict as string) ?? null,
    aiConfidence: (l.ai_confidence as number) ?? null,
    aiSummary: (l.ai_summary as string) ?? null,
    hasDocument: Boolean(l.attachment_path),
    cancelRequested: Boolean(l.cancel_requested),
  };
}

async function Leaves() {
  const v = await getViewer();
  const supabase = await createClient();
  const year = Number(todayLocal().slice(0, 4));
  const approver = isApproverRole(v.role);

  const [{ data: types }, { data: mine }, { data: balances }, queue] = await Promise.all([
    supabase.from("leave_types").select("id, name, paid, yearly_quota, monthly_limit, document_required_after_days").eq("active", true).order("name"),
    v.employeeId
      ? supabase.from("leaves").select(LEAVE_COLS).eq("employee_id", v.employeeId).order("start_date", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] }),
    v.employeeId
      ? supabase.from("leave_balances").select("leave_type_id, used_days, pending_days").eq("employee_id", v.employeeId).eq("year", year)
      : Promise.resolve({ data: [] }),
    approver
      ? supabase.from("leaves").select(LEAVE_COLS).or("status.eq.pending,cancel_requested.eq.true").order("start_date").limit(100)
      : Promise.resolve({ data: [] }),
  ]);
  const recent = approver
    ? (await supabase.from("leaves").select(LEAVE_COLS).in("status", ["approved", "rejected", "cancelled"])
        .order("decided_at", { ascending: false, nullsFirst: false }).limit(15)).data ?? []
    : [];

  const bal = new Map((balances ?? []).map((b) => [b.leave_type_id, b]));
  const typeRows = (types ?? []).map((t) => {
    const b = bal.get(t.id);
    const used = Number(b?.used_days ?? 0);
    const pending = Number(b?.pending_days ?? 0);
    return {
      id: t.id,
      name: t.name,
      paid: t.paid,
      quota: t.yearly_quota == null ? null : Number(t.yearly_quota),
      monthlyLimit: t.monthly_limit == null ? null : Number(t.monthly_limit),
      docAfter: t.document_required_after_days,
      used,
      pending,
    };
  });

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="flex flex-col gap-6 lg:col-span-2">
        {v.employeeId && (
          <Card>
            <CardHeader>
              <CardTitle>Request leave</CardTitle>
              <CardDescription>Working days are counted from your own schedule. Holidays and days off are skipped.</CardDescription>
            </CardHeader>
            <CardContent>
              <LeaveRequestForm types={typeRows} today={todayLocal()} />
            </CardContent>
          </Card>
        )}
        {v.employeeId && (
          <Card>
            <CardHeader>
              <CardTitle>My balance {year}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {typeRows.map((t) => (
                <div key={t.id} className="rounded-xl border p-3">
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="font-mono text-2xl">{t.quota == null ? "∞" : Math.max(0, t.quota - t.used - t.pending)}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.quota == null ? `${t.used} used` : `left of ${t.quota} · ${t.used} used${t.pending ? ` · ${t.pending} pending` : ""}`}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
      <div className="flex flex-col gap-6 lg:col-span-3">
        {approver && (
          <Card>
            <CardHeader>
              <CardTitle>To review</CardTitle>
              <CardDescription>Rule checks run automatically. You can&apos;t decide your own requests.</CardDescription>
            </CardHeader>
            <CardContent>
              <ReviewQueue rows={((queue.data ?? []) as Record<string, unknown>[]).map(toRow)} recent={(recent as Record<string, unknown>[]).map(toRow)} />
            </CardContent>
          </Card>
        )}
        {v.employeeId && (
          <Card>
            <CardHeader>
              <CardTitle>My requests</CardTitle>
            </CardHeader>
            <CardContent>
              <MyLeaves rows={((mine ?? []) as Record<string, unknown>[]).map(toRow)} today={todayLocal()} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function LeavesPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader title="Leaves" description="Requests, balances and approvals. Decisions are emailed automatically." />
      <Suspense fallback={<Skeleton className="h-[32rem] rounded-xl" />}>
        <Leaves />
      </Suspense>
    </div>
  );
}
