"use server";

import { revalidatePath } from "next/cache";
import { fail, isAdminRole, requireRole, type ActionResult } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const requireAdmin = () => requireRole(isAdminRole, "manage departments");

export async function saveDepartment(id: string | null, name: string, color: string): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const clean = name.trim();
    if (clean.length < 2) return { ok: false, message: "Enter a department name." };
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) return { ok: false, message: "Invalid colour." };
    const supabase = await createClient();
    const { error } = id
      ? await supabase.from("departments").update({ name: clean, color: color || null }).eq("id", id)
      : await supabase.from("departments").insert({ organization_id: v.orgId, name: clean, color: color || null });
    if (error) throw error;
    revalidatePath("/departments");
    return { ok: true, message: id ? "Department saved." : `${clean} added.` };
  } catch (e) {
    return fail(e);
  }
}

/** Deletes an empty department; one that still has people is archived instead (history keeps its name). */
export async function removeDepartment(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { count } = await supabase.from("employees").select("id", { count: "exact", head: true }).eq("department_id", id);
    if (count) {
      const { error } = await supabase.from("departments").update({ active: false }).eq("id", id);
      if (error) throw error;
      revalidatePath("/departments");
      return { ok: true, message: `Archived (still has ${count} employee${count === 1 ? "" : "s"}). Move them to delete it.` };
    }
    const { error } = await supabase.from("departments").delete().eq("id", id);
    if (error) throw error;
    revalidatePath("/departments");
    return { ok: true, message: "Department deleted." };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreDepartment(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase.from("departments").update({ active: true }).eq("id", id);
    if (error) throw error;
    revalidatePath("/departments");
    return { ok: true, message: "Department restored." };
  } catch (e) {
    return fail(e);
  }
}
