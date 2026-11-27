"use server";

import { revalidatePath } from "next/cache";
import { fail, isApproverRole, requireRole, type ActionResult } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/** Employee leave request. Days, balance, overlap and policy checks are computed by the database. */
export async function requestLeave(form: FormData): Promise<ActionResult> {
  let docPath: string | null = null;
  try {
    const v = await requireRole(() => true, "request leave");
    if (!v.employeeId) return { ok: false, message: "Your login is not linked to an employee record." };
    const typeId = String(form.get("type") ?? "");
    const start = String(form.get("start") ?? "");
    const halfDay = form.get("halfDay") === "on";
    const end = halfDay ? start : String(form.get("end") ?? "");
    const reason = String(form.get("reason") ?? "").trim();
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!typeId) return { ok: false, message: "Choose a leave type." };
    if (!iso.test(start) || !iso.test(end)) return { ok: false, message: "Choose the dates." };
    if (end < start) return { ok: false, message: "End date is before the start date." };
    if (reason.length < 3) return { ok: false, message: "Add a short reason." };

    const file = form.get("document");
    if (file instanceof File && file.size > 0) {
      if (!DOC_TYPES.includes(file.type)) return { ok: false, message: "Document must be a PDF or photo." };
      if (file.size > 3.5 * 1024 * 1024) return { ok: false, message: "Document must be smaller than 3.5 MB." };
      docPath = `${v.orgId}/${v.employeeId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_").slice(-60)}`;
      const { error } = await createAdminClient().storage.from("documents").upload(docPath, file, { contentType: file.type });
      if (error) throw error;
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leaves")
      .insert({
        organization_id: v.orgId,
        employee_id: v.employeeId,
        leave_type_id: typeId,
        start_date: start,
        end_date: end,
        half_day: halfDay,
        reason,
        attachment_path: docPath,
        status: "pending",
      })
      .select("status, days, policy_passed")
      .single();
    if (error) throw error;
    revalidatePath("/leaves");
    return {
      ok: true,
      message:
        data.status === "approved"
          ? `Approved automatically (${data.days} day${data.days === 1 ? "" : "s"}).`
          : `Request sent for ${data.days} day${data.days === 1 ? "" : "s"}. ${data.policy_passed === false ? "Some leave rules need HR review." : "You'll get an email when it's decided."}`,
    };
  } catch (e) {
    if (docPath) await createAdminClient().storage.from("documents").remove([docPath]).catch(() => {});
    return fail(e);
  }
}

export async function cancelLeave(id: string): Promise<ActionResult> {
  try {
    await requireRole(() => true, "cancel leave");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("cancel_leave", { p_leave: id });
    if (error) throw error;
    revalidatePath("/leaves");
    return { ok: true, message: data === "cancelled" ? "Request cancelled." : "Cancellation requested — HR will confirm." };
  } catch (e) {
    return fail(e);
  }
}

export async function decideLeave(id: string, status: "approved" | "rejected" | "cancelled", note: string): Promise<ActionResult> {
  try {
    await requireRole(isApproverRole, "decide leave");
    const supabase = await createClient();
    const { error } = await supabase.rpc("decide_leave", { p_leave: id, p_status: status, p_note: note.trim() || null });
    if (error) throw error;
    revalidatePath("/leaves");
    return { ok: true, message: status === "approved" ? "Approved — employee notified." : status === "rejected" ? "Not approved — employee notified." : "Cancellation approved." };
  } catch (e) {
    return fail(e);
  }
}

/** 2-minute link to a leave document, only for people who can see that leave (RLS). */
export async function documentUrl(id: string): Promise<ActionResult & { url?: string }> {
  try {
    await requireRole(() => true, "view documents");
    const supabase = await createClient();
    const { data: l } = await supabase.from("leaves").select("attachment_path").eq("id", id).maybeSingle();
    if (!l?.attachment_path) return { ok: false, message: "No document attached." };
    const { data, error } = await createAdminClient().storage.from("documents").createSignedUrl(l.attachment_path, 120);
    if (error) throw error;
    return { ok: true, message: "", url: data.signedUrl };
  } catch (e) {
    return fail(e);
  }
}
