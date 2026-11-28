"use server";

import { requireRole } from "@/lib/auth";
import { addDays, localToIso } from "@/lib/format";
import type { PortalToday } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type AlertSchedule = {
  now: string;
  workDate: string;
  checkedIn: boolean;
  checkedOut: boolean;
  breakStart: string | null;
  breakEnd: string | null;
  shiftEnd: string | null;
};

/** Today's break start / shift end for the signed-in employee (drives the in-app alerts). */
export async function getAlertSchedule(): Promise<AlertSchedule | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const v = await requireRole(() => true);
    if (!v.employeeId) return null;
    const admin = createAdminClient();
    const { data } = await admin.rpc("portal_today", { p_employee: v.employeeId });
    const t = data as PortalToday | null;
    if (!t) return null;

    let breakStart: string | null = null;
    let breakEnd: string | null = null;
    if (t.shift) {
      const { data: s } = await admin.rpc("resolve_shift", { p_employee: v.employeeId, p_date: t.work_date });
      const sh = (Array.isArray(s) ? s[0] : s) as { start_time: string; break_start: string | null; break_end: string | null } | null;
      // a break earlier in the clock than the shift start belongs to the next day (night shifts)
      const at = (time: string) => localToIso(time < (sh?.start_time ?? "00:00") ? addDays(t.work_date, 1) : t.work_date, time.slice(0, 5));
      if (sh?.break_start) breakStart = at(sh.break_start);
      if (sh?.break_end) breakEnd = at(sh.break_end);
    }

    const inAt = t.day?.check_in_at ?? null;
    const shiftEnd = t.scheduled_end
      ?? (inAt && t.shift?.kind === "flexible" && t.shift.required_minutes
        ? new Date(new Date(inAt).getTime() + t.shift.required_minutes * 60_000).toISOString()
        : null);

    return {
      now: t.now,
      workDate: t.work_date,
      checkedIn: !!inAt,
      checkedOut: !!t.day?.check_out_at,
      breakStart,
      breakEnd,
      shiftEnd,
    };
  } catch {
    return null;
  }
}
