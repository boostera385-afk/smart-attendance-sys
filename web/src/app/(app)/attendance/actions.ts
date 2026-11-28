"use server";

import { revalidatePath } from "next/cache";
import { fail, isAdminRole, isApproverRole, requireRole, type ActionResult } from "@/lib/auth";
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
      needs_review: false, // HR has now confirmed the hours
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

export type Evidence = {
  id: number;
  type: "check_in" | "check_out";
  at: string;
  source: string;
  shadow: boolean;
  camera: string | null;
  confidence: number | null;
  imageUrl: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  distance: number | null;
  office: string | null;
  ip: string | null;
};

/** Selfies, camera snapshots and GPS for one employee-day (portal + camera, including test mode). */
export async function getDayEvidence(
  employeeId: string,
  date: string,
): Promise<{ ok: true; items: Evidence[] } | { ok: false; message: string }> {
  try {
    await requireRole(isApproverRole, "view attendance proof");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Invalid date." };
    const supabase = await createClient(); // RLS: managers only see their own team
    const { data, error } = await supabase.from("attendance_events")
      .select("id, type, occurred_at, source, shadow, confidence, snapshot_path, latitude, longitude, accuracy_m, distance_m, ip, cameras(name), branches(name)")
      .eq("employee_id", employeeId).in("type", ["check_in", "check_out"])
      .gte("occurred_at", localToIso(date, "00:00")).lt("occurred_at", localToIso(addDays(date, 1), "12:00"))
      .order("occurred_at").limit(20);
    if (error) throw error;
    const paths = (data ?? []).map((e) => e.snapshot_path).filter(Boolean) as string[];
    const signed = paths.length ? (await createAdminClient().storage.from("snapshots").createSignedUrls(paths, 600)).data ?? [] : [];
    const url = new Map(signed.map((s) => [s.path, s.signedUrl]));
    return {
      ok: true,
      items: (data ?? []).map((e) => ({
        id: e.id,
        type: e.type as Evidence["type"],
        at: e.occurred_at,
        source: e.source,
        shadow: e.shadow,
        camera: (e.cameras as unknown as { name: string } | null)?.name ?? null,
        confidence: e.confidence,
        imageUrl: e.snapshot_path ? url.get(e.snapshot_path) ?? null : null,
        lat: e.latitude,
        lng: e.longitude,
        accuracy: e.accuracy_m,
        distance: e.distance_m,
        office: (e.branches as unknown as { name: string } | null)?.name ?? null,
        ip: e.ip,
      })),
    };
  } catch (e) {
    return { ok: false, message: fail(e).message };
  }
}
