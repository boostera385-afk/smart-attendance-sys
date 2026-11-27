"use server";

import { revalidatePath } from "next/cache";
import { fail, isAdminRole, requireRole, type ActionResult } from "@/lib/auth";
import { capture, liveCheck, listDevices } from "@/lib/ezviz";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const ROLES = ["entry", "exit", "both", "presence", "disabled"] as const;
type CameraRole = (typeof ROLES)[number];

const requireAdmin = () => requireRole(isAdminRole, "manage cameras");

/** Imports every camera on the EZVIZ account. Existing cameras keep their role and settings. */
export async function importCameras(): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const { devices, channels } = await listDevices();
    const supabase = await createClient();
    const { data: existing } = await supabase.from("cameras").select("id, ezviz_serial, ezviz_channel");
    const key = (s: string, c: number) => `${s}:${c}`;
    const have = new Map((existing ?? []).map((c) => [key(c.ezviz_serial ?? "", c.ezviz_channel), c.id]));

    const rows = devices.flatMap((d) => {
      const chans = channels.filter((c) => c.deviceSerial === d.deviceSerial);
      const list = chans.length ? chans : [{ channelNo: 1, channelName: d.deviceName, status: d.status }];
      return list.map((c) => ({
        serial: d.deviceSerial,
        channel: c.channelNo,
        name: (list.length > 1 ? c.channelName : d.deviceName) || d.deviceSerial,
        model: d.model,
        online: d.status === 1,
      }));
    });

    let added = 0;
    for (const r of rows) {
      const id = have.get(key(r.serial, r.channel));
      const status = r.online ? "online" : "offline";
      if (id) {
        await supabase.from("cameras").update({ model: r.model, status }).eq("id", id);
      } else {
        const { error } = await supabase.from("cameras").insert({
          organization_id: v.orgId,
          name: r.name.replace(/^\((.*)\)$/, "$1"),
          model: r.model,
          ezviz_serial: r.serial,
          ezviz_channel: r.channel,
          connection: "ezviz_cloud",
          role: "disabled",
          status,
        });
        if (error) throw error;
        added++;
      }
    }
    revalidatePath("/cameras");
    return { ok: true, message: `${rows.length} camera${rows.length === 1 ? "" : "s"} found, ${added} new.` };
  } catch (e) {
    return fail(e);
  }
}

export async function updateCamera(
  id: string,
  patch: Partial<{ role: CameraRole; name: string; department_id: string | null; voice_enabled: boolean; match_threshold: number | null }>,
): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    if (patch.role && !ROLES.includes(patch.role)) return { ok: false, message: "Invalid role." };
    if (patch.match_threshold != null && !(patch.match_threshold >= 0.3 && patch.match_threshold <= 0.9)) {
      return { ok: false, message: "Match threshold must be between 0.30 and 0.90." };
    }
    if (patch.name != null && !patch.name.trim()) return { ok: false, message: "Name can't be empty." };
    const supabase = await createClient();
    const { data, error } = await supabase.from("cameras").update(patch).eq("id", id).select("name, role").single();
    if (error) throw error;
    await createAdminClient().from("audit_log").insert({
      organization_id: v.orgId,
      actor_id: v.userId,
      action: "update_camera",
      table_name: "cameras",
      record_id: id,
      new_data: patch,
    });
    revalidatePath("/cameras");
    return { ok: true, message: `${data.name} saved.` };
  } catch (e) {
    return fail(e);
  }
}

/** Snapshot + live-stream check. The image URL is EZVIZ-hosted and expires on its own. */
export async function testCamera(id: string): Promise<ActionResult & { picUrl?: string; live?: string }> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { data: cam } = await supabase.from("cameras").select("ezviz_serial, ezviz_channel").eq("id", id).single();
    if (!cam?.ezviz_serial) return { ok: false, message: "This camera has no EZVIZ serial." };
    const picUrl = await capture(cam.ezviz_serial, cam.ezviz_channel);
    let live = "Live video available";
    try {
      await liveCheck(cam.ezviz_serial, cam.ezviz_channel);
    } catch (e) {
      live = (e as Error).message;
    }
    await supabase.from("cameras").update({ status: "online", last_seen_at: new Date().toISOString(), last_error: null }).eq("id", id);
    return { ok: true, message: "Snapshot taken.", picUrl, live };
  } catch (e) {
    return fail(e);
  }
}
