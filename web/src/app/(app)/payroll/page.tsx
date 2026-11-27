import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/form-bits";
import { getViewer, isAdminRole } from "@/lib/auth";
import { todayLocal } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PayrollView } from "./payroll-view";

export const metadata: Metadata = { title: "Payroll" };

function previousMonth(today: string) {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

async function Payroll({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const v = await getViewer();
  if (!isAdminRole(v.role)) redirect("/me");
  const sp = await searchParams;
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : previousMonth(todayLocal());
  const period = `${month}-01`;
  const supabase = await createClient();

  const [{ data: run }, { data: runs }, { data: emps }, { data: adjustments }] = await Promise.all([
    supabase.from("payroll_runs").select("id, status, generated_at, approved_at, paid_at").eq("period", period).maybeSingle(),
    supabase.from("payroll_runs").select("period, status").order("period", { ascending: false }).limit(12),
    supabase.from("employees").select("id, full_name").neq("status", "invited").order("full_name"),
    supabase.from("salary_adjustments").select("id, employee_id, kind, amount, reason").eq("period", period).order("created_at"),
  ]);
  const { data: slips } = run
    ? await supabase.from("payslips")
        .select("id, employee_id, currency, basic, allowances, overtime_pay, additions, gross, deductions, net, scheduled_days, worked_days, absent_days, paid_leave_days, unpaid_leave_days, late_days, extra_minutes, lines, emailed_at, employees(full_name, departments(name))")
        .eq("payroll_run_id", run.id)
    : { data: [] };

  const names = new Map((emps ?? []).map((e) => [e.id, e.full_name]));
  return (
    <PayrollView
      month={month}
      run={run}
      history={runs ?? []}
      employees={emps ?? []}
      adjustments={(adjustments ?? []).map((a) => ({ ...a, amount: Number(a.amount), employee: names.get(a.employee_id) ?? "" }))}
      slips={(slips ?? []).map((s) => {
        const e = s.employees as unknown as { full_name: string; departments: { name: string } | null } | null;
        return {
          id: s.id,
          employee: e?.full_name ?? "",
          department: e?.departments?.name ?? null,
          currency: s.currency,
          gross: Number(s.gross),
          deductions: Number(s.deductions),
          net: Number(s.net),
          worked: Number(s.worked_days),
          scheduled: Number(s.scheduled_days),
          absent: Number(s.absent_days),
          late: s.late_days,
          lines: s.lines as { label: string; amount: number; type: string; detail?: string }[],
          emailedAt: s.emailed_at,
        };
      }).sort((a, b) => a.employee.localeCompare(b.employee))}
    />
  );
}

export default function PayrollPage({ searchParams }: PageProps<"/payroll">) {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader title="Payroll" description="Monthly drafts from attendance, leave and salary. Approve to email every payslip." />
      <Card>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
            <Payroll searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
