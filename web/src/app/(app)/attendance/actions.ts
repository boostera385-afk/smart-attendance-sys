"use server";

import { revalidatePath } from "next/cache";
import { fail, isAdminRole, requireRole, type ActionResult } from "@/lib/auth";
import { localToIso, addDays } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * HR correction for one employee-day: set check-in / check-out times (office time, HH:MM).
 * A check-out earlier than the check-in is treated as the next day (night shifts). Audited.
 */
export async function correctDay(input: {
  employeeId: string;
  date: string;
  checkIn: string;
  checkOut: string;
  note: string;
}): Promise<ActionResult> {
  try {
    const v = await requireRole(isAdminRole, "correct attendance");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, message: "Invalid date." };
    if (!input.note.trim()) return { ok: false, message: "Add a reason for the correction." };
    const time = /^\d{2}:\d{2}$/;
    if (input.checkIn && !time.test(input.checkIn)) return { ok: false, message: "Invalid check-in time." };
    if (input.checkOut && !time.test(input.checkOut)) return { ok: false, message: "Invalid check-out time." };
    if (input.checkOut && !input.checkIn) return { ok: false, message: "Set a check-in time first." };

    const supabase = await createClient();
    const { data: emp } = await supabase.from("employees").select("id").eq("id", input.employeeId).maybeSingle();
    if (!emp) return { ok: false, message: "Employee not found." };

    const inAt = input.checkIn ? localToIso(input.date, input.checkIn) : null;
    let outAt = input.checkOut ? localToIso(input.date, input.checkOut) : null;
    if (inAt && outAt && outAt <= inAt) outAt = localToIso(addDays(input.date, 1), input.checkOut);

    const { data: old } = await supabase.from("attendance_days").select("*")
      .eq("employee_id", input.employeeId).eq("work_date", input.date).maybeSingle();
    const patch = {
      check_in_at: inAt,
      check_out_at: outAt,
      check_in_source: inAt ? (old?.check_in_at === inAt ? old.check_in_source : "manual") : null,
      check_out_source: outAt ? (old?.check_out_at === outAt ? old.check_out_source : "manual") : null,
      last_seen_at: outAt ?? inAt,
      status: "present" as const, // recalc sets the real status
      note: input.note.trim(),
    };
    let dayId = old?.id as string | undefined;
    if (dayId) {
      const { error } = await supabase.from("attendance_days").update(patch).eq("id", dayId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("attendance_days")
        .insert({ ...patch, organization_id: v.orgId, employee_id: input.employeeId, work_date: input.date })
        .select("id").single();
      if (error) throw error;
      dayId = data.id;
    }
    const { error: rErr } = await supabase.rpc("recalc_attendance_day", { p_day: dayId });
    if (rErr) throw rErr;

    await createAdminClient().from("audit_log").insert({
      organization_id: v.orgId,
      actor_id: v.userId,
      action: "correct_attendance",
      table_name: "attendance_days",
      record_id: dayId,
      old_data: old ? { check_in_at: old.check_in_at, check_out_at: old.check_out_at, status: old.status } : null,
      new_data: { check_in_at: inAt, check_out_at: outAt, note: input.note.trim() },
    });
    revalidatePath("/attendance");
    return { ok: true, message: "Attendance corrected." };
  } catch (e) {
    return fail(e);
  }
}
