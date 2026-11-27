"use server";

import { revalidatePath } from "next/cache";
import { fail, isAdminRole, requireRole, type ActionResult } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const requireAdmin = () => requireRole(isAdminRole, "manage payroll");
const monthStart = (p: string) => (/^\d{4}-\d{2}/.test(p) ? `${p.slice(0, 7)}-01` : null);

async function audit(orgId: string, userId: string, action: string, data: Record<string, unknown>) {
  await createAdminClient().from("audit_log").insert({ organization_id: orgId, actor_id: userId, action, table_name: "payroll_runs", new_data: data });
}

/** (Re)builds draft payslips for everyone with a salary. Approved months are locked by the database. */
export async function generatePayroll(period: string): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const p = monthStart(period);
    if (!p) return { ok: false, message: "Choose a month." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("generate_payroll", { p_org: v.orgId, p_period: p });
    if (error) throw error;
    await audit(v.orgId, v.userId, "generate_payroll", { period: p, count: data });
    revalidatePath("/payroll");
    return { ok: true, message: data ? `${data} payslip${data === 1 ? "" : "s"} drafted.` : "No employees with a salary for this month." };
  } catch (e) {
    return fail(e);
  }
}

export async function setRunStatus(runId: string, status: "approved" | "paid"): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const supabase = await createClient();
    const { data: run } = await supabase.from("payroll_runs").select("status, period").eq("id", runId).single();
    if (!run) return { ok: false, message: "Payroll not found." };
    if (status === "approved" && run.status !== "draft") return { ok: false, message: "Only drafts can be approved." };
    if (status === "paid" && run.status !== "approved") return { ok: false, message: "Approve the payroll first." };
    const patch = status === "approved"
      ? { status, approved_by: v.userId, approved_at: new Date().toISOString() }
      : { status, paid_at: new Date().toISOString() };
    const { error } = await supabase.from("payroll_runs").update(patch).eq("id", runId);
    if (error) throw error;
    await audit(v.orgId, v.userId, `payroll_${status}`, { run_id: runId, period: run.period });
    revalidatePath("/payroll");
    return { ok: true, message: status === "approved" ? "Approved. Payslips are being emailed." : "Marked as paid." };
  } catch (e) {
    return fail(e);
  }
}

export async function addAdjustment(input: {
  employeeId: string;
  period: string;
  kind: "bonus" | "allowance" | "reimbursement" | "deduction" | "advance";
  amount: number;
  reason: string;
}): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const p = monthStart(input.period);
    if (!p) return { ok: false, message: "Choose a month." };
    if (!(input.amount > 0)) return { ok: false, message: "Amount must be more than 0." };
    if (!input.reason.trim()) return { ok: false, message: "Add a reason." };
    const supabase = await createClient();
    const { data: run } = await supabase.from("payroll_runs").select("status").eq("period", p).maybeSingle();
    if (run && run.status !== "draft") return { ok: false, message: "This month is already approved and locked." };
    const { error } = await supabase.from("salary_adjustments").insert({
      organization_id: v.orgId,
      employee_id: input.employeeId,
      period: p,
      kind: input.kind,
      amount: input.amount,
      reason: input.reason.trim(),
      created_by: v.userId,
    });
    if (error) throw error;
    if (run) await supabase.rpc("generate_payslip", { p_employee: input.employeeId, p_period: p });
    revalidatePath("/payroll");
    return { ok: true, message: run ? "Added and payslip recalculated." : "Added. It will be included when the draft is generated." };
  } catch (e) {
    return fail(e);
  }
}

export async function removeAdjustment(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { data: adj } = await supabase.from("salary_adjustments").select("employee_id, period").eq("id", id).single();
    if (!adj) return { ok: false, message: "Not found." };
    const { data: run } = await supabase.from("payroll_runs").select("status").eq("period", adj.period).maybeSingle();
    if (run && run.status !== "draft") return { ok: false, message: "This month is locked." };
    await supabase.from("salary_adjustments").delete().eq("id", id);
    if (run) await supabase.rpc("generate_payslip", { p_employee: adj.employee_id, p_period: adj.period });
    revalidatePath("/payroll");
    return { ok: true, message: "Removed." };
  } catch (e) {
    return fail(e);
  }
}
