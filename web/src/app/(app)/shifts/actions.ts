"use server";

import { revalidatePath } from "next/cache";
import { fail, isAdminRole, isApproverRole, requireRole, type ActionResult } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const iso = /^\d{4}-\d{2}-\d{2}$/;
const hm = /^\d{2}:\d{2}$/;

/**
 * One-day change for one employee: day off, different hours, or back to normal.
 * Managers may change their own team (RLS on shift_overrides).
 */
export async function setOverride(input: {
  employeeId: string;
  date: string;
  mode: "normal" | "off" | "hours";
  start?: string;
  end?: string;
  reason: string;
}): Promise<ActionResult> {
  try {
    const v = await requireRole(isApproverRole, "change the roster");
    if (!iso.test(input.date)) return { ok: false, message: "Invalid date." };
    const supabase = await createClient();
    await supabase.from("shift_overrides").delete().eq("employee_id", input.employeeId).eq("work_date", input.date);
    if (input.mode === "normal") {
      revalidatePath("/shifts");
      return { ok: true, message: "Back to the normal schedule." };
    }

    let shiftId: string | null = null;
    if (input.mode === "hours") {
      if (!isAdminRole(v.role)) return { ok: false, message: "Only HR can set different hours. Managers can give a day off." };
      if (!input.start || !input.end || !hm.test(input.start) || !hm.test(input.end) || input.start === input.end) {
        return { ok: false, message: "Enter different start and end times." };
      }
      // copy the employee's normal rules (break, grace…) onto the one-day hours
      const { data: asg } = await supabase.from("employee_shifts")
        .select("shifts(break_minutes, grace_in_minutes, grace_out_minutes, overtime_after_minutes)")
        .eq("employee_id", input.employeeId).lte("effective_from", input.date)
        .order("effective_from", { ascending: false }).limit(1).maybeSingle();
      const b = (asg?.shifts ?? null) as unknown as Record<string, unknown> | null;
      const { data: s, error } = await supabase.from("shifts").insert({
        organization_id: v.orgId,
        employee_id: input.employeeId,
        name: `One-day ${input.date}`,
        kind: "fixed",
        start_time: input.start,
        end_time: input.end,
        working_days: [1, 2, 3, 4, 5, 6, 7],
        break_minutes: (b?.break_minutes as number) ?? 60,
        break_mode: "paid",
        grace_in_minutes: (b?.grace_in_minutes as number) ?? 15,
        grace_out_minutes: (b?.grace_out_minutes as number) ?? 10,
        overtime_after_minutes: (b?.overtime_after_minutes as number) ?? 30,
        active: false,
      }).select("id").single();
      if (error) throw error;
      shiftId = s.id;
    }
    const { error } = await supabase.from("shift_overrides").insert({
      employee_id: input.employeeId,
      work_date: input.date,
      shift_id: shiftId,
      reason: input.reason.trim() || null,
      created_by: v.userId,
    });
    if (error) throw error;
    revalidatePath("/shifts");
    return { ok: true, message: input.mode === "off" ? "Day off set." : "One-day hours set." };
  } catch (e) {
    return fail(e);
  }
}

export async function addHoliday(date: string, name: string): Promise<ActionResult> {
  try {
    const v = await requireRole(isAdminRole, "manage holidays");
    if (!iso.test(date) || !name.trim()) return { ok: false, message: "Enter a date and a name." };
    const supabase = await createClient();
    const { error } = await supabase.from("holidays").insert({ organization_id: v.orgId, holiday_date: date, name: name.trim() });
    if (error) throw error;
    revalidatePath("/shifts");
    return { ok: true, message: "Holiday added." };
  } catch (e) {
    return fail(e);
  }
}

export async function removeHoliday(id: string): Promise<ActionResult> {
  try {
    await requireRole(isAdminRole, "manage holidays");
    const supabase = await createClient();
    const { error } = await supabase.from("holidays").delete().eq("id", id);
    if (error) throw error;
    revalidatePath("/shifts");
    return { ok: true, message: "Holiday removed." };
  } catch (e) {
    return fail(e);
  }
}
