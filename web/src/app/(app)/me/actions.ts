"use server";

import { revalidatePath } from "next/cache";
import { fail, requireRole, type ActionResult } from "@/lib/auth";
import { storeFacePhotos } from "@/lib/faces";
import { createAdminClient } from "@/lib/supabase/admin";

/** Employee uploads their own enrollment photos (HR approves them before the cameras use them). */
export async function uploadMyFaces(form: FormData): Promise<ActionResult> {
  try {
    const v = await requireRole(() => true, "enroll a face");
    if (!v.employeeId) return { ok: false, message: "Your login is not linked to an employee record." };
    const admin = createAdminClient();
    const { count } = await admin.from("face_photos").select("id", { count: "exact", head: true }).eq("employee_id", v.employeeId);
    if ((count ?? 0) >= 15) return { ok: false, message: "You already have 15 photos. Ask HR to remove old ones first." };
    const n = await storeFacePhotos(v.orgId, v.employeeId, form.getAll("photos") as File[], v.userId);
    await admin.from("employees").update({ consent_at: new Date().toISOString() }).eq("id", v.employeeId).is("consent_at", null);
    revalidatePath("/me");
    return { ok: true, message: `${n} photo${n === 1 ? "" : "s"} uploaded. HR will approve them.` };
  } catch (e) {
    return fail(e);
  }
}
