"use server";

import { revalidatePath } from "next/cache";
import { fail, isAdminRole, requireRole, type ActionResult, type AppRole, type Viewer } from "@/lib/auth";
import { validateEmployee, type EmployeeInput } from "@/lib/employees";
import { deleteAllFaceData, deleteFacePhotoById, demoteIfNoApprovedFace, storeFacePhotos } from "@/lib/faces";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const ROLES: AppRole[] = ["employee", "manager", "admin", "super_admin"];
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const requireAdmin = () => requireRole(isAdminRole, "manage employees");

function checkRole(viewer: Viewer, role: AppRole) {
  if (!ROLES.includes(role)) throw new Error("Invalid role.");
  if ((role === "admin" || role === "super_admin") && viewer.role !== "super_admin") {
    throw new Error("Only a super admin can give admin access.");
  }
}

async function resolveDepartment(orgId: string, input: EmployeeInput): Promise<string> {
  if (input.departmentId) return input.departmentId;
  const supabase = await createClient();
  const name = input.newDepartment.trim();
  const { data: existing } = await supabase.from("departments").select("id").eq("organization_id", orgId).ilike("name", name).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await supabase.from("departments").insert({ organization_id: orgId, name }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function saveSchedule(employeeId: string, i: EmployeeInput) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_employee_schedule", {
    p_employee: employeeId,
    p_effective_from: i.scheduleFrom,
    p_start: i.kind === "fixed" ? i.start : i.start || "09:00",
    p_end: i.kind === "fixed" ? i.end : i.end || "18:00",
    p_working_days: [...new Set(i.workingDays)].sort(),
    p_break_minutes: Math.round(i.breakMinutes),
    p_break_mode: "paid",
    p_kind: i.kind,
    p_required_minutes: i.kind === "flexible" ? Math.round(i.requiredHours * 60) : null,
    p_grace_in: Math.round(i.graceIn),
    p_grace_out: Math.round(i.graceOut),
    p_overtime_after: Math.round(i.overtimeAfter),
  });
  if (error) throw error;
}

async function saveSalary(employeeId: string, i: EmployeeInput, userId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("employee_compensation").upsert(
    {
      employee_id: employeeId,
      effective_from: i.salaryFrom,
      basic_salary: i.basicSalary,
      allowances: i.allowances.map((a) => ({ name: a.name.trim(), amount: Number(a.amount) })),
      late_deduction_enabled: i.lateDeduction,
      overtime_enabled: i.overtimeEnabled,
      created_by: userId,
    },
    { onConflict: "employee_id,effective_from" },
  );
  if (error) throw error;
}

async function audit(v: Viewer, action: string, recordId: string, data: Record<string, unknown>) {
  await createAdminClient().from("audit_log").insert({
    organization_id: v.orgId,
    actor_id: v.userId,
    action,
    table_name: "employees",
    record_id: recordId,
    new_data: data,
  });
}

/** Add employee → schedule → salary → login invite email. Rolls back if any step fails. */
export async function createEmployee(input: EmployeeInput): Promise<ActionResult> {
  let employeeId: string | null = null;
  let authUserId: string | null = null;
  const admin = createAdminClient();
  try {
    const v = await requireAdmin();
    const err = validateEmployee(input, true);
    if (err) return { ok: false, message: err };
    checkRole(v, input.role);

    const email = input.email.trim().toLowerCase();
    const departmentId = await resolveDepartment(v.orgId, input);
    const supabase = await createClient();
    const { data: emp, error } = await supabase
      .from("employees")
      .insert({
        organization_id: v.orgId,
        full_name: input.fullName.trim(),
        employee_code: input.employeeCode.trim() || null,
        email,
        phone: input.phone.replace(/[\s-]/g, "") || null,
        designation: input.designation.trim() || null,
        joined_on: input.joinedOn,
        department_id: departmentId,
        branch_id: input.branchId || null,
        status: "invited",
      })
      .select("id")
      .single();
    if (error) throw error;
    employeeId = emp.id;

    await saveSchedule(emp.id, { ...input, scheduleChanged: true });
    if (input.salaryChanged) await saveSalary(emp.id, input, v.userId);

    const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appUrl()}/auth/callback`,
      data: { full_name: input.fullName.trim() },
    });
    if (invErr) throw invErr;
    authUserId = invited.user.id;

    const { error: profErr } = await admin.from("profiles").insert({
      id: invited.user.id,
      organization_id: v.orgId,
      employee_id: emp.id,
      role: input.role,
      managed_department_id: input.role === "manager" && input.managesDepartment ? departmentId : null,
    });
    if (profErr) throw profErr;

    await audit(v, "create_employee", emp.id, { email, role: input.role, department_id: departmentId });
    revalidatePath("/employees");
    return { ok: true, message: `${input.fullName.trim()} added. Invite sent to ${email}.`, id: emp.id };
  } catch (e) {
    if (authUserId) await admin.auth.admin.deleteUser(authUserId).catch(() => {});
    if (employeeId) await admin.from("employees").delete().eq("id", employeeId);
    return fail(e);
  }
}

export async function updateEmployee(id: string, input: EmployeeInput): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const err = validateEmployee(input, false);
    if (err) return { ok: false, message: err };

    const supabase = await createClient();
    const admin = createAdminClient();
    const { data: existingProf } = await admin.from("profiles").select("role").eq("employee_id", id).maybeSingle();
    if (existingProf?.role !== input.role) checkRole(v, input.role);
    const { data: current } = await supabase.from("employees").select("email").eq("id", id).single();
    if (!current) return { ok: false, message: "Employee not found." };
    const email = input.email.trim().toLowerCase();
    const departmentId = await resolveDepartment(v.orgId, input);

    const { error } = await supabase
      .from("employees")
      .update({
        full_name: input.fullName.trim(),
        employee_code: input.employeeCode.trim() || null,
        email,
        phone: input.phone.replace(/[\s-]/g, "") || null,
        designation: input.designation.trim() || null,
        joined_on: input.joinedOn,
        department_id: departmentId,
        branch_id: input.branchId || null,
      })
      .eq("id", id);
    if (error) throw error;

    const { data: prof } = await admin.from("profiles").select("id, role").eq("employee_id", id).maybeSingle();
    if (prof) {
      if (prof.id === v.userId && prof.role !== input.role) throw new Error("You can't change your own role.");
      if ((prof.role === "admin" || prof.role === "super_admin") && v.role !== "super_admin" && prof.role !== input.role) {
        throw new Error("Only a super admin can change an admin's role.");
      }
      await admin
        .from("profiles")
        .update({
          role: input.role,
          managed_department_id: input.role === "manager" && input.managesDepartment ? departmentId : null,
        })
        .eq("id", prof.id);
      if (email !== current.email) await admin.auth.admin.updateUserById(prof.id, { email, email_confirm: true });
    }

    if (input.scheduleChanged) await saveSchedule(id, input);
    if (input.salaryChanged) await saveSalary(id, input, v.userId);

    await audit(v, "update_employee", id, { email, role: input.role, schedule: input.scheduleChanged, salary: input.salaryChanged });
    revalidatePath("/employees");
    revalidatePath(`/employees/${id}`);
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e);
  }
}

/** New invite for people who never set a password; password-reset email for everyone else. */
export async function resendInvite(id: string): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const admin = createAdminClient();
    const supabase = await createClient();
    const { data: emp } = await supabase.from("employees").select("email, full_name").eq("id", id).single();
    if (!emp?.email) return { ok: false, message: "This employee has no email address." };
    const { data: prof } = await admin.from("profiles").select("id, role, managed_department_id")
      .eq("employee_id", id).maybeSingle();

    if (prof) {
      const { data: u } = await admin.auth.admin.getUserById(prof.id);
      if (u.user?.last_sign_in_at || u.user?.email_confirmed_at) {
        const { error } = await supabase.auth.resetPasswordForEmail(emp.email, { redirectTo: `${appUrl()}/auth/callback` });
        if (error) throw error;
        return { ok: true, message: `Password reset link sent to ${emp.email}.` };
      }
      await admin.from("profiles").delete().eq("id", prof.id);
      await admin.auth.admin.deleteUser(prof.id);
    }
    const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(emp.email, {
      redirectTo: `${appUrl()}/auth/callback`,
      data: { full_name: emp.full_name },
    });
    if (error) throw error;
    await admin.from("profiles").upsert({
      id: invited.user.id,
      organization_id: v.orgId,
      employee_id: id,
      role: prof?.role ?? "employee",
      managed_department_id: prof?.managed_department_id ?? null,
    });
    await audit(v, "resend_invite", id, { email: emp.email });
    return { ok: true, message: `Invite sent again to ${emp.email}.` };
  } catch (e) {
    return fail(e);
  }
}

/** Deactivate: blocks sign-in, sets last day, deletes face data (privacy). Reactivate reverses access. */
export async function setEmployeeActive(id: string, active: boolean, leftOn?: string): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const admin = createAdminClient();
    const supabase = await createClient();
    const { data: emp } = await supabase.from("employees").select("id").eq("id", id).maybeSingle();
    if (!emp) return { ok: false, message: "Employee not found." };
    const { data: prof } = await admin.from("profiles").select("id").eq("employee_id", id).maybeSingle();
    if (prof?.id === v.userId) return { ok: false, message: "You can't deactivate yourself." };

    if (!active) {
      const { error } = await supabase.from("employees")
        .update({ status: "inactive", left_on: leftOn || new Date().toISOString().slice(0, 10) }).eq("id", id);
      if (error) throw error;
      if (prof) await admin.auth.admin.updateUserById(prof.id, { ban_duration: "876000h" });
      await deleteAllFaceData(id);
    } else {
      const { data: emb } = await admin.from("face_embeddings").select("id").eq("employee_id", id).eq("approved", true).limit(1);
      const { error } = await supabase.from("employees")
        .update({ status: emb?.length ? "active" : "pending_enrollment", left_on: null }).eq("id", id);
      if (error) throw error;
      if (prof) await admin.auth.admin.updateUserById(prof.id, { ban_duration: "none" });
    }
    await audit(v, active ? "reactivate_employee" : "deactivate_employee", id, { left_on: leftOn ?? null });
    revalidatePath("/employees");
    revalidatePath(`/employees/${id}`);
    return { ok: true, message: active ? "Employee reactivated." : "Employee deactivated, sign-in blocked and face data deleted." };
  } catch (e) {
    return fail(e);
  }
}

export async function uploadEmployeeFaces(id: string, form: FormData): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const supabase = await createClient();
    const { data: emp } = await supabase.from("employees").select("id").eq("id", id).single();
    if (!emp) return { ok: false, message: "Employee not found." };
    const n = await storeFacePhotos(v.orgId, id, form.getAll("photos") as File[], v.userId);
    revalidatePath(`/employees/${id}`);
    return { ok: true, message: `${n} photo${n === 1 ? "" : "s"} uploaded. Processing takes about a minute.` };
  } catch (e) {
    return fail(e);
  }
}

/** HR confirms the photos really show this person → embeddings are used for recognition. */
export async function approveFaces(id: string): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const supabase = await createClient();
    const { data: emb, error } = await supabase.from("face_embeddings").update({ approved: true })
      .eq("employee_id", id).select("id");
    if (error) throw error;
    if (!emb?.length) return { ok: false, message: "No processed photos yet. Upload photos and wait for processing." };
    await supabase.from("employees").update({ status: "active", consent_at: new Date().toISOString() })
      .eq("id", id).neq("status", "inactive");
    await audit(v, "approve_faces", id, { count: emb.length });
    revalidatePath(`/employees/${id}`);
    revalidatePath("/employees");
    return { ok: true, message: `${emb.length} face sample${emb.length === 1 ? "" : "s"} approved. Recognition is on.` };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteFacePhoto(employeeId: string, photoId: string): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    await deleteFacePhotoById(v.orgId, employeeId, photoId);
    await audit(v, "delete_face_photo", employeeId, { photo_id: photoId });
    revalidatePath(`/employees/${employeeId}`);
    revalidatePath("/employees");
    return { ok: true, message: "Photo deleted." };
  } catch (e) {
    return fail(e);
  }
}

/** Start enrollment over: removes every photo and face sample of this employee. */
export async function deleteAllFacePhotos(employeeId: string): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const supabase = await createClient();
    const { data: emp } = await supabase.from("employees").select("id").eq("id", employeeId).single();
    if (!emp) return { ok: false, message: "Employee not found." };
    const n = await deleteAllFaceData(employeeId);
    await demoteIfNoApprovedFace(employeeId);
    await audit(v, "delete_all_face_photos", employeeId, { count: n });
    revalidatePath(`/employees/${employeeId}`);
    revalidatePath("/employees");
    return { ok: true, message: n ? `${n} photo${n === 1 ? "" : "s"} and all face samples deleted.` : "No photos to delete." };
  } catch (e) {
    return fail(e);
  }
}

export type SelfieRule = "default" | "required" | "not_required";

/** Per-employee selfie rule for portal check-in. "default" follows Settings → Attendance. */
export async function setSelfieRule(id: string, rule: SelfieRule): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const value = { default: null, required: true, not_required: false }[rule];
    if (value === undefined) return { ok: false, message: "Invalid option." };
    const supabase = await createClient();
    const { data, error } = await supabase.from("employees").update({ selfie_required: value }).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, message: "Employee not found." };
    await audit(v, "set_selfie_rule", id, { selfie_required: value });
    revalidatePath(`/employees/${id}`);
    revalidatePath("/employees");
    return {
      ok: true,
      message: rule === "default" ? "Selfie follows the company setting." : rule === "required" ? "Selfie is always required for this employee." : "Selfie is not required for this employee.",
    };
  } catch (e) {
    return fail(e);
  }
}
