import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "super_admin" | "admin" | "manager" | "employee";

export type Viewer = {
  userId: string;
  email: string;
  orgId: string;
  role: AppRole;
  employeeId: string | null;
  managedDepartmentId: string | null;
};

export const isAdminRole = (r: AppRole) => r === "super_admin" || r === "admin";
export const isApproverRole = (r: AppRole) => isAdminRole(r) || r === "manager";

/** Signed-in user + profile. Redirects to /login when there is no session or profile. */
export async function getViewer(): Promise<Viewer> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: p } = await supabase
    .from("profiles")
    .select("organization_id, role, employee_id, managed_department_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!p) redirect("/login?error=profile");
  return {
    userId: user.id,
    email: user.email ?? "",
    orgId: p.organization_id,
    role: p.role as AppRole,
    employeeId: p.employee_id,
    managedDepartmentId: p.managed_department_id,
  };
}

/** For server actions: throws (instead of redirecting) when the caller lacks the role. */
export async function requireRole(allowed: (r: AppRole) => boolean, what = "do this"): Promise<Viewer> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again.");
  const { data: p } = await supabase
    .from("profiles")
    .select("organization_id, role, employee_id, managed_department_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!p || !allowed(p.role as AppRole)) throw new Error(`You don't have permission to ${what}.`);
  return {
    userId: user.id,
    email: user.email ?? "",
    orgId: p.organization_id,
    role: p.role as AppRole,
    employeeId: p.employee_id,
    managedDepartmentId: p.managed_department_id,
  };
}

export type ActionResult = { ok: boolean; message: string; id?: string };

export const fail = (e: unknown): ActionResult => ({ ok: false, message: friendlyError(e) });

/** Turns Postgres / Supabase errors into messages people can act on. */
export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/duplicate key.*email/i.test(msg)) return "An employee with this email already exists.";
  if (/duplicate key.*employee_code/i.test(msg)) return "This employee code is already used.";
  if (/duplicate key.*name/i.test(msg)) return "That name is already used.";
  if (/already been registered|already registered/i.test(msg)) return "This email already has an account.";
  return msg.replace(/^.*?ERROR:\s*/, "");
}
