import { createAdminClient } from "@/lib/supabase/admin";

const MAX_BYTES = 6 * 1024 * 1024;
/** Hard cap per employee: enough angles for good recognition, small enough to review by eye. */
export const MAX_FACE_PHOTOS = 20;

/** Detects the real image type from the file's first bytes (the browser-sent MIME type can lie). */
function sniffType(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/**
 * Stores enrollment photos in the private `faces` bucket and queues them for the recognition
 * worker, which turns each one into a face embedding (or marks it failed with a reason).
 * Caller must already have checked that the signed-in user may enroll this employee.
 */
export async function storeFacePhotos(orgId: string, employeeId: string, files: File[], uploadedBy: string, maxTotal = MAX_FACE_PHOTOS) {
  const usable = files.filter((f) => f && f.size > 0);
  if (!usable.length) throw new Error("Choose at least one photo.");
  if (usable.length > 10) throw new Error("Upload at most 10 photos at a time.");

  const typed: { file: File; type: string }[] = [];
  for (const f of usable) {
    if (f.size > MAX_BYTES) throw new Error(`${f.name}: photo is larger than 6 MB.`);
    const type = sniffType(new Uint8Array(await f.slice(0, 12).arrayBuffer()));
    if (!type) throw new Error(`${f.name}: use a JPG, PNG or WebP photo.`);
    typed.push({ file: f, type });
  }

  const admin = createAdminClient();
  const { count } = await admin.from("face_photos").select("id", { count: "exact", head: true }).eq("employee_id", employeeId);
  const room = maxTotal - (count ?? 0);
  if (room <= 0) throw new Error(`This employee already has ${count} photos (limit ${maxTotal}). Delete some first.`);
  if (typed.length > room) throw new Error(`Only ${room} more photo${room === 1 ? "" : "s"} allowed (limit ${maxTotal}). Delete some first.`);

  let stored = 0;
  for (const { file, type } of typed) {
    const id = crypto.randomUUID();
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const path = `${orgId}/${employeeId}/${id}.${ext}`;
    const { error: upErr } = await admin.storage.from("faces").upload(path, file, { contentType: type, upsert: false });
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

/**
 * Deletes one photo (its embedding cascades). If the employee has no approved face left, an
 * active employee drops back to "pending enrollment" so HR sees recognition is off.
 */
export async function deleteFacePhotoById(orgId: string, employeeId: string, photoId: string, opts: { onlyUnapproved?: boolean } = {}) {
  const admin = createAdminClient();
  const { data: p } = await admin.from("face_photos").select("path").eq("id", photoId)
    .eq("employee_id", employeeId).eq("organization_id", orgId).maybeSingle();
  if (!p) throw new Error("Photo not found.");
  if (opts.onlyUnapproved) {
    const { count } = await admin.from("face_embeddings").select("id", { count: "exact", head: true })
      .eq("photo_id", photoId).eq("approved", true);
    if (count) throw new Error("This photo is approved and in use. Ask HR to remove it.");
  }
  const { error } = await admin.from("face_photos").delete().eq("id", photoId);
  if (error) throw new Error(error.message);
  await admin.storage.from("faces").remove([p.path]);
  await demoteIfNoApprovedFace(employeeId);
}

/** Removes every face photo, embedding and stored image of an employee (exit / privacy request / re-enroll). */
export async function deleteAllFaceData(employeeId: string) {
  const admin = createAdminClient();
  const { data: photos } = await admin.from("face_photos").select("path").eq("employee_id", employeeId);
  const paths = (photos ?? []).map((p) => p.path);
  if (paths.length) await admin.storage.from("faces").remove(paths);
  await admin.from("face_embeddings").delete().eq("employee_id", employeeId);
  await admin.from("face_photos").delete().eq("employee_id", employeeId);
  return paths.length;
}

export async function demoteIfNoApprovedFace(employeeId: string) {
  const admin = createAdminClient();
  const { count } = await admin.from("face_embeddings").select("id", { count: "exact", head: true })
    .eq("employee_id", employeeId).eq("approved", true);
  if (!count) await admin.from("employees").update({ status: "pending_enrollment" }).eq("id", employeeId).eq("status", "active");
}

export type FacePhoto = {
  id: string;
  status: "pending" | "processed" | "failed";
  approved: boolean;
  error: string | null;
  url: string | null;
  createdAt: string;
};

/** Photos with short-lived signed URLs (5 min). */
export async function listFacePhotos(employeeId: string): Promise<{ photos: FacePhoto[]; approved: number; embeddings: number }> {
  const admin = createAdminClient();
  const [{ data: photos }, { data: emb }] = await Promise.all([
    admin.from("face_photos").select("id, path, status, error, created_at").eq("employee_id", employeeId)
      .order("created_at", { ascending: false }).limit(MAX_FACE_PHOTOS),
    admin.from("face_embeddings").select("approved, photo_id").eq("employee_id", employeeId),
  ]);
  const paths = (photos ?? []).map((p) => p.path);
  const signed = paths.length ? (await admin.storage.from("faces").createSignedUrls(paths, 300)).data ?? [] : [];
  const byPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const approvedPhotos = new Set((emb ?? []).filter((e) => e.approved && e.photo_id).map((e) => e.photo_id as string));
  return {
    photos: (photos ?? []).map((p) => ({
      id: p.id,
      status: p.status,
      approved: approvedPhotos.has(p.id),
      error: p.error,
      url: byPath.get(p.path) ?? null,
      createdAt: p.created_at,
    })),
    approved: (emb ?? []).filter((e) => e.approved).length,
    embeddings: (emb ?? []).length,
  };
}
