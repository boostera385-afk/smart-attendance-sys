"use server";

import { revalidatePath } from "next/cache";
import { fail, isAdminRole, requireRole, type ActionResult } from "@/lib/auth";
import { DEFAULT_ATTENDANCE_SETTINGS, type AttendanceMode, type AttendanceSettings } from "@/lib/portal";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";

export type OfficeRow = { id: string; name: string; lat: number | null; lng: number | null; radiusM: number; employees: number };

const MODES: AttendanceMode[] = ["portal", "hybrid", "camera"];
const DEMO: ActionResult = { ok: false, message: "Demo mode — connect Supabase to save settings." };

async function audit(orgId: string, userId: string, action: string, data: Record<string, unknown>) {
  await createAdminClient().from("audit_log").insert({
    organization_id: orgId, actor_id: userId, action, table_name: "settings", new_data: data,
  });
}

export async function getAttendanceSettings(): Promise<{
  settings: AttendanceSettings;
  offices: OfficeRow[];
  canEdit: boolean;
  demo: boolean;
}> {
  if (!isSupabaseConfigured) return { settings: DEFAULT_ATTENDANCE_SETTINGS, offices: [], canEdit: true, demo: true };
  try {
    const v = await requireRole(isAdminRole, "change attendance settings");
    const admin = createAdminClient();
    const [{ data: cfg }, { data: branches }, { data: emps }] = await Promise.all([
      admin.rpc("attendance_config", { p_org: v.orgId }),
      admin.from("branches").select("id, name, latitude, longitude, geofence_radius_m").eq("organization_id", v.orgId).order("created_at"),
      admin.from("employees").select("branch_id").eq("organization_id", v.orgId).neq("status", "inactive"),
    ]);
    const c = (cfg ?? {}) as Record<string, unknown>;
    return {
      settings: {
        mode: MODES.includes(c.mode as AttendanceMode) ? (c.mode as AttendanceMode) : DEFAULT_ATTENDANCE_SETTINGS.mode,
        requireSelfie: c.require_selfie !== false,
        requireLocation: c.require_location !== false,
        maxAccuracyM: Number(c.max_accuracy_m) || DEFAULT_ATTENDANCE_SETTINGS.maxAccuracyM,
      },
      offices: (branches ?? []).map((b) => ({
        id: b.id, name: b.name, lat: b.latitude, lng: b.longitude, radiusM: b.geofence_radius_m,
        employees: (emps ?? []).filter((e) => e.branch_id === b.id).length,
      })),
      canEdit: true,
      demo: false,
    };
  } catch {
    return { settings: DEFAULT_ATTENDANCE_SETTINGS, offices: [], canEdit: false, demo: false };
  }
}

export async function saveAttendanceSettings(input: AttendanceSettings): Promise<ActionResult> {
  if (!isSupabaseConfigured) return DEMO;
  try {
    const v = await requireRole(isAdminRole, "change attendance settings");
    if (!MODES.includes(input.mode)) return { ok: false, message: "Invalid attendance mode." };
    const maxAccuracy = Math.round(Number(input.maxAccuracyM));
    if (!(maxAccuracy >= 20 && maxAccuracy <= 500)) return { ok: false, message: "GPS accuracy must be between 20 and 500 m." };

    const admin = createAdminClient();
    if (input.mode !== "camera" && input.requireLocation) {
      const { count } = await admin.from("branches").select("id", { count: "exact", head: true })
        .eq("organization_id", v.orgId).not("latitude", "is", null).not("longitude", "is", null);
      if (!count) return { ok: false, message: "Set at least one office location before requiring GPS." };
    }
    const value = {
      mode: input.mode,
      require_selfie: !!input.requireSelfie,
      require_location: !!input.requireLocation,
      max_accuracy_m: maxAccuracy,
    };
    const { error } = await admin.from("settings")
      .upsert({ organization_id: v.orgId, key: "attendance", value, updated_at: new Date().toISOString() });
    if (error) throw error;
    await audit(v.orgId, v.userId, "update_attendance_settings", value);
    revalidatePath("/settings");
    revalidatePath("/me");
    return {
      ok: true,
      message: {
        portal: "Portal check-in is live. Cameras are in test mode.",
        hybrid: "Portal and cameras are both live.",
        camera: "Cameras only. Portal check-in is hidden.",
      }[input.mode],
    };
  } catch (e) {
    return fail(e);
  }
}

export async function saveOffice(input: { id?: string; name: string; lat: number; lng: number; radiusM: number }): Promise<ActionResult> {
  if (!isSupabaseConfigured) return DEMO;
  try {
    const v = await requireRole(isAdminRole, "change office locations");
    const name = input.name.trim();
    if (!name || name.length > 80) return { ok: false, message: "Enter an office name." };
    const lat = Number(input.lat), lng = Number(input.lng), radius = Math.round(Number(input.radiusM));
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { ok: false, message: "Enter a valid latitude and longitude." };
    }
    if (!(radius >= 30 && radius <= 2000)) return { ok: false, message: "Radius must be between 30 and 2000 m." };

    const admin = createAdminClient();
    const row = { name, latitude: lat, longitude: lng, geofence_radius_m: radius };
    let id = input.id;
    if (id) {
      const { data, error } = await admin.from("branches").update(row).eq("id", id).eq("organization_id", v.orgId).select("id").maybeSingle();
      if (error) throw error;
      if (!data) return { ok: false, message: "Office not found." };
    } else {
      const { data, error } = await admin.from("branches").insert({ ...row, organization_id: v.orgId }).select("id").single();
      if (error) throw error;
      id = data.id;
    }
    await audit(v.orgId, v.userId, "save_office", { id, ...row });
    revalidatePath("/settings");
    return { ok: true, message: "Office location saved.", id };
  } catch (e) {
    return fail(e);
  }
}
