import { createAdminClient } from "@/lib/supabase/admin";

const MAX_BYTES = 6 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Stores enrollment photos in the private `faces` bucket and queues them for the recognition
 * worker, which turns each one into a face embedding (or marks it failed with a reason).
 * Caller must already have checked that the signed-in user may enroll this employee.
 */
export async function storeFacePhotos(orgId: string, employeeId: string, files: File[], uploadedBy: string) {
  const usable = files.filter((f) => f && f.size > 0);
  if (!usable.length) throw new Error("Choose at least one photo.");
  if (usable.length > 10) throw new Error("Upload at most 10 photos at a time.");
  for (const f of usable) {
    if (!TYPES.includes(f.type)) throw new Error(`${f.name}: use a JPG, PNG or WebP photo.`);
    if (f.size > MAX_BYTES) throw new Error(`${f.name}: photo is larger than 6 MB.`);
  }

  const admin = createAdminClient();
  let stored = 0;
  for (const f of usable) {
    const id = crypto.randomUUID();
    const ext = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
    const path = `${orgId}/${employeeId}/${id}.${ext}`;
    const { error: upErr } = await admin.storage.from("faces").upload(path, f, { contentType: f.type, upsert: false });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    const { error } = await admin.from("face_photos").insert({
      id,
      organization_id: orgId,
      employee_id: employeeId,
      path,
      uploaded_by: uploadedBy,
    });
    if (error) {
      await admin.storage.from("faces").remove([path]);
      throw new Error(error.message);
    }
    stored++;
  }
  const { data: emp } = await admin.from("employees").select("status").eq("id", employeeId).single();
  if (emp?.status === "invited") {
    await admin.from("employees").update({ status: "pending_enrollment" }).eq("id", employeeId);
  }
  return stored;
}

/** Removes every face photo, embedding and stored image of an employee (exit / privacy request). */
export async function deleteAllFaceData(employeeId: string) {
  const admin = createAdminClient();
  const { data: photos } = await admin.from("face_photos").select("path").eq("employee_id", employeeId);
  const paths = (photos ?? []).map((p) => p.path);
  if (paths.length) await admin.storage.from("faces").remove(paths);
  await admin.from("face_embeddings").delete().eq("employee_id", employeeId);
  await admin.from("face_photos").delete().eq("employee_id", employeeId);
}

export type FacePhoto = {
  id: string;
  status: "pending" | "processed" | "failed";
  error: string | null;
  url: string | null;
  createdAt: string;
};

/** Photos with short-lived signed URLs (5 min). */
export async function listFacePhotos(employeeId: string): Promise<{ photos: FacePhoto[]; approved: number; embeddings: number }> {
  const admin = createAdminClient();
  const [{ data: photos }, { data: emb }] = await Promise.all([
    admin.from("face_photos").select("id, path, status, error, created_at").eq("employee_id", employeeId)
      .order("created_at", { ascending: false }).limit(20),
    admin.from("face_embeddings").select("approved").eq("employee_id", employeeId),
  ]);
  const paths = (photos ?? []).map((p) => p.path);
  const signed = paths.length ? (await admin.storage.from("faces").createSignedUrls(paths, 300)).data ?? [] : [];
  const byPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return {
    photos: (photos ?? []).map((p) => ({
      id: p.id,
      status: p.status,
      error: p.error,
      url: byPath.get(p.path) ?? null,
      createdAt: p.created_at,
    })),
    approved: (emb ?? []).filter((e) => e.approved).length,
    embeddings: (emb ?? []).length,
  };
}
