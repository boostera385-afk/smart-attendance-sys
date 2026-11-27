"use server";

import { revalidatePath } from "next/cache";
import { fail, isAdminRole, requireRole, type ActionResult } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * "This is X": marks the face reviewed and adds it as an approved face sample for X, so the camera
 * recognises them next time. "Ignore": deletes the snapshot.
 */
export async function reviewUnknown(id: string, employeeId: string | null): Promise<ActionResult> {
  try {
    const v = await requireRole(isAdminRole, "review unknown faces");
    const admin = createAdminClient();
    const { data: u } = await admin.from("unknown_faces").select("id, embedding, snapshot_path, status")
      .eq("id", id).eq("organization_id", v.orgId).maybeSingle();
    if (!u) return { ok: false, message: "Not found." };

    if (employeeId) {
      const { data: emp } = await admin.from("employees").select("id, status").eq("id", employeeId).eq("organization_id", v.orgId).maybeSingle();
      if (!emp) return { ok: false, message: "Employee not found." };
      if (u.embedding) {
        await admin.from("face_embeddings").insert({ employee_id: employeeId, embedding: u.embedding, approved: true, quality: null });
      }
    } else if (u.snapshot_path) {
      await admin.storage.from("snapshots").remove([u.snapshot_path]);
    }
    await admin.from("unknown_faces").update({
      status: employeeId ? "assigned" : "ignored",
      assigned_employee_id: employeeId,
      reviewed_by: v.userId,
      reviewed_at: new Date().toISOString(),
      ...(employeeId ? {} : { snapshot_path: null }),
    }).eq("id", id);
    await admin.from("audit_log").insert({
      organization_id: v.orgId, actor_id: v.userId, action: "review_unknown_face", table_name: "unknown_faces", record_id: id,
      new_data: { employee_id: employeeId },
    });
    revalidatePath("/unknown");
    return { ok: true, message: employeeId ? "Saved — added as a face sample." : "Ignored." };
  } catch (e) {
    return fail(e);
  }
}
