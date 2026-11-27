import { notFound, redirect } from "next/navigation";
import { getViewer, isAdminRole, type AppRole } from "@/lib/auth";
import type { EmployeeFormData, EmployeeInput } from "@/lib/employees";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function requireAdminPage() {
  const v = await getViewer();
  if (!isAdminRole(v.role)) redirect("/me");
  return v;
}

export async function formOptions(): Promise<Omit<EmployeeFormData, "initial">> {
  const v = await requireAdminPage();
  const supabase = await createClient();
  const [{ data: departments }, { data: branches }] = await Promise.all([
    supabase.from("departments").select("id, name").eq("active", true).order("name"),
    supabase.from("branches").select("id, name").order("name"),
  ]);
  return { departments: departments ?? [], branches: branches ?? [], canAssignAdmin: v.role === "super_admin" };
}

export type EmployeeRow = {
  id: string;
  full_name: string;
  employee_code: string | null;
  email: string | null;
  designation: string | null;
  status: string;
  department: string | null;
  role: AppRole | null;
  schedule: string | null;
  faces: number;
};

export async function listEmployees(): Promise<EmployeeRow[]> {
  await requireAdminPage();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: emps }, { data: profiles }, { data: shifts }, { data: faces }] = await Promise.all([
    supabase.from("employees")
      .select("id, full_name, employee_code, email, designation, status, departments(name)")
      .order("full_name"),
    supabase.from("profiles").select("employee_id, role"),
    supabase.from("employee_shifts")
      .select("employee_id, effective_from, effective_to, shifts(kind, start_time, end_time, required_minutes)")
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`),
    supabase.from("face_embeddings").select("employee_id").eq("approved", true),
  ]);
  const role = new Map((profiles ?? []).map((p) => [p.employee_id, p.role as AppRole]));
  const sched = new Map(
    (shifts ?? []).map((s) => {
      const sh = s.shifts as unknown as { kind: string; start_time: string; end_time: string; required_minutes: number | null } | null;
      const label = !sh ? null : sh.kind === "flexible" ? `Flexible ${(sh.required_minutes ?? 0) / 60}h` : `${sh.start_time.slice(0, 5)}–${sh.end_time.slice(0, 5)}`;
      return [s.employee_id, label];
    }),
  );
  const faceCount = new Map<string, number>();
  for (const f of faces ?? []) faceCount.set(f.employee_id, (faceCount.get(f.employee_id) ?? 0) + 1);

  return (emps ?? []).map((e) => ({
    id: e.id,
    full_name: e.full_name,
    employee_code: e.employee_code,
    email: e.email,
    designation: e.designation,
    status: e.status,
    department: (e.departments as unknown as { name: string } | null)?.name ?? null,
    role: role.get(e.id) ?? null,
    schedule: sched.get(e.id) ?? null,
    faces: faceCount.get(e.id) ?? 0,
  }));
}

export async function loadEmployee(id: string) {
  await requireAdminPage();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: e } = await supabase.from("employees").select("*").eq("id", id).maybeSingle();
  if (!e) notFound();

  const admin = createAdminClient();
  const [{ data: prof }, { data: asg }, { data: comp }] = await Promise.all([
    admin.from("profiles").select("id, role, managed_department_id").eq("employee_id", id).maybeSingle(),
    supabase.from("employee_shifts").select("effective_from, effective_to, shifts(*)").eq("employee_id", id)
      .order("effective_from", { ascending: false }),
    supabase.from("employee_compensation").select("*").eq("employee_id", id).order("effective_from", { ascending: false }),
  ]);
  const user = prof ? (await admin.auth.admin.getUserById(prof.id)).data.user : null;
  const s = (asg?.[0]?.shifts ?? null) as unknown as {
    kind: "fixed" | "flexible"; start_time: string; end_time: string; required_minutes: number | null;
    working_days: number[]; break_minutes: number; break_mode: "deduct" | "paid"; grace_in_minutes: number;
    grace_out_minutes: number; overtime_after_minutes: number;
  } | null;
  const c = comp?.[0];

  const initial: Partial<EmployeeInput> & { id: string; hasAccount: boolean; status: string } = {
    id: e.id,
    status: e.status,
    hasAccount: Boolean(user?.last_sign_in_at),
    fullName: e.full_name,
    employeeCode: e.employee_code ?? "",
    email: e.email ?? "",
    phone: e.phone ?? "",
    designation: e.designation ?? "",
    joinedOn: e.joined_on,
    departmentId: e.department_id ?? "",
    branchId: e.branch_id ?? "",
    role: (prof?.role as AppRole) ?? "employee",
    managesDepartment: Boolean(prof?.managed_department_id),
    ...(s && {
      kind: s.kind,
      start: s.start_time.slice(0, 5),
      end: s.end_time.slice(0, 5),
      requiredHours: (s.required_minutes ?? 480) / 60,
      workingDays: s.working_days,
      breakMinutes: s.break_minutes,
      breakMode: "paid",
      graceIn: s.grace_in_minutes,
      graceOut: s.grace_out_minutes,
      overtimeAfter: s.overtime_after_minutes,
    }),
    ...(c && {
      basicSalary: Number(c.basic_salary),
      allowances: (c.allowances as { name: string; amount: number }[]) ?? [],
      lateDeduction: c.late_deduction_enabled,
      overtimeEnabled: c.overtime_enabled,
    }),
  };

  return {
    employee: e,
    initial,
    account: user
      ? { invitedAt: user.invited_at ?? null, lastSignIn: user.last_sign_in_at ?? null, banned: Boolean(user.banned_until) }
      : null,
    scheduleHistory: (asg ?? []).map((a) => {
      const sh = a.shifts as unknown as { kind: string; start_time: string; end_time: string; working_days: number[]; break_minutes: number };
      return { from: a.effective_from, to: a.effective_to, kind: sh?.kind, start: sh?.start_time, end: sh?.end_time, days: sh?.working_days, breakMinutes: sh?.break_minutes };
    }),
    salaryHistory: (comp ?? []).map((x) => ({ from: x.effective_from, basic: Number(x.basic_salary), allowances: x.allowances as { name: string; amount: number }[] })),
  };
}
