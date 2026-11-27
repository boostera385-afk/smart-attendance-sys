"use server";

import { revalidatePath } from "next/cache";
import { fail, requireRole, type ActionResult } from "@/lib/auth";
import { deleteFacePhotoById, storeFacePhotos } from "@/lib/faces";
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
