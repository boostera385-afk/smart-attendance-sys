"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { fail, requireRole, type ActionResult } from "@/lib/auth";
import { deleteFacePhotoById, sniffType, storeFacePhotos } from "@/lib/faces";
import { todayLocal } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

/** Self-service limit; HR can add more from the employee page. Keep in sync with `maxPhotos` on /me. */
const MY_FACE_LIMIT = 15;

/** Employee uploads their own enrollment photos (HR approves them before the cameras use them). */
export async function uploadMyFaces(form: FormData): Promise<ActionResult> {
  try {
    const v = await requireRole(() => true, "enroll a face");
    if (!v.employeeId) return { ok: false, message: "Your login is not linked to an employee record." };
    const n = await storeFacePhotos(v.orgId, v.employeeId, form.getAll("photos") as File[], v.userId, MY_FACE_LIMIT);
    await createAdminClient().from("employees").update({ consent_at: new Date().toISOString() }).eq("id", v.employeeId).is("consent_at", null);
    revalidatePath("/me");
    return { ok: true, message: `${n} photo${n === 1 ? "" : "s"} uploaded. HR will approve them.` };
  } catch (e) {
    return fail(e);
  }
}

/** Employees may remove their own photos until HR approves them. */
export async function deleteMyFacePhoto(photoId: string): Promise<ActionResult> {
  try {
    const v = await requireRole(() => true, "remove a face photo");
    if (!v.employeeId) return { ok: false, message: "Your login is not linked to an employee record." };
    await deleteFacePhotoById(v.orgId, v.employeeId, photoId, { onlyUnapproved: true });
    revalidatePath("/me");
    return { ok: true, message: "Photo deleted." };
  } catch (e) {
    return fail(e);
  }
}

const SELFIE_MAX_BYTES = 1.5 * 1024 * 1024;
const num = (v: FormDataEntryValue | null) => {
  if (typeof v !== "string" || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type CheckResult = ActionResult & {
  action?: "check_in" | "check_out";
  at?: string;
  lateMinutes?: number;
  netMinutes?: number | null;
  overtimeMinutes?: number;
  extraMinutes?: number;
  office?: string | null;
  distanceM?: number | null;
};

/**
 * Portal check-in / check-out. The server is the trust boundary: it authenticates the user, stores
 * the selfie, and passes request IP / user agent to public.self_check, which uses the database
 * clock, verifies the office geofence and all attendance rules.
 */
export async function portalCheck(form: FormData): Promise<CheckResult> {
  let selfiePath: string | null = null;
  const admin = createAdminClient();
  try {
    const v = await requireRole(() => true, "check in");
    if (!v.employeeId) return { ok: false, message: "Your login is not linked to an employee record." };
    const action = form.get("action");
    if (action !== "check_in" && action !== "check_out") return { ok: false, message: "Invalid action." };

    const lat = num(form.get("lat"));
    const lng = num(form.get("lng"));
    const accuracy = num(form.get("accuracy"));
    if ((lat !== null && (lat < -90 || lat > 90)) || (lng !== null && (lng < -180 || lng > 180))) {
      return { ok: false, message: "Invalid location." };
    }

    const selfie = form.get("selfie");
    if (selfie instanceof File && selfie.size > 0) {
      if (selfie.size > SELFIE_MAX_BYTES) return { ok: false, message: "Selfie is too large. Please retake it." };
      const type = sniffType(new Uint8Array(await selfie.slice(0, 12).arrayBuffer()));
      if (type !== "image/jpeg") return { ok: false, message: "Selfie must be a JPEG photo." };
      // same bucket + 30-day retention as camera snapshots
      selfiePath = `${v.orgId}/selfies/${todayLocal().replaceAll("-", "/")}/${crypto.randomUUID()}.jpg`;
      const { error } = await admin.storage.from("snapshots").upload(selfiePath, selfie, { contentType: type, upsert: false });
      if (error) {
        selfiePath = null;
        return { ok: false, message: `Could not save the selfie: ${error.message}` };
      }
    }

    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    const { data, error } = await admin.rpc("self_check", {
      p_employee: v.employeeId,
      p_action: action,
      p_lat: lat,
      p_lng: lng,
      p_accuracy: accuracy,
      p_selfie: selfiePath,
      p_ip: ip,
      p_user_agent: h.get("user-agent"),
    });
    if (error) throw error;

    revalidatePath("/me");
    revalidatePath("/attendance");
    revalidatePath("/dashboard");
    const r = data as {
      action: "check_in" | "check_out"; at: string; late_minutes: number; net_minutes: number | null;
      overtime_minutes: number; extra_minutes: number; office: string | null; distance_m: number | null;
    };
    return {
      ok: true,
      message: r.action === "check_in" ? "Checked in" : "Checked out",
      action: r.action,
      at: r.at,
      lateMinutes: r.late_minutes,
      netMinutes: r.net_minutes,
      overtimeMinutes: r.overtime_minutes,
      extraMinutes: r.extra_minutes,
      office: r.office,
      distanceM: r.distance_m,
    };
  } catch (e) {
    if (selfiePath) await admin.storage.from("snapshots").remove([selfiePath]);
    return fail(e);
  }
}
