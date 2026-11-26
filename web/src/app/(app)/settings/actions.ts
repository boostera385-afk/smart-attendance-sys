"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_AI_SETTINGS,
  type ActionResult,
  type AiSettings,
  type ReviewMode,
} from "@/lib/ai-settings";

const DEMO: ActionResult = { ok: false, message: "Demo mode — connect Supabase to save settings." };
const MODES: ReviewMode[] = ["manual", "policy_auto", "ai_assist", "ai_auto"];
const KEY_NAME = "openai_api_key";

/** Only super admins may change AI settings or keys. Returns the caller's org + user id. */
async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again.");
  const [{ data: role }, { data: org }] = await Promise.all([
    supabase.rpc("current_app_role"),
    supabase.rpc("current_org_id"),
  ]);
  if (role !== "super_admin" || !org) throw new Error("Only a super admin can change AI settings.");
  return { orgId: org as string, userId: user.id };
}

async function audit(orgId: string, userId: string, action: string, data: Record<string, unknown>) {
  await createAdminClient().from("audit_log").insert({
    organization_id: orgId,
    actor_id: userId,
    action,
    table_name: "leave_policies",
    new_data: data,
  });
}

/** Calls OpenAI with the key; never returns or logs the key itself. */
async function checkOpenAI(key: string, model?: string): Promise<ActionResult> {
  const url = model
    ? `https://api.openai.com/v1/models/${encodeURIComponent(model)}`
    : "https://api.openai.com/v1/models";
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
    if (res.ok) return { ok: true, message: model ? `Key works and model “${model}” is available.` : "Key is valid." };
    if (res.status === 401) return { ok: false, message: "OpenAI rejected this key (invalid or revoked)." };
    if (res.status === 404 && model) return { ok: false, message: `Key works, but model “${model}” is not available on this account.` };
    if (res.status === 429) return { ok: false, message: "OpenAI rate limit or quota exceeded for this key." };
    return { ok: false, message: `OpenAI returned ${res.status}.` };
  } catch {
    return { ok: false, message: "Could not reach OpenAI. Check the server's internet access." };
  }
}

export async function getAiSettings(): Promise<AiSettings & { demo: boolean; canEdit: boolean }> {
  if (!isSupabaseConfigured) return { ...DEFAULT_AI_SETTINGS, demo: true, canEdit: true };
  try {
    const { orgId } = await requireSuperAdmin();
    const admin = createAdminClient();
    const [{ data: pol }, { data: secret }] = await Promise.all([
      admin.from("leave_policies").select("*").eq("organization_id", orgId).maybeSingle(),
      admin.from("secrets").select("value, updated_at").eq("organization_id", orgId).eq("key", KEY_NAME).maybeSingle(),
    ]);
    return {
      reviewMode: pol?.review_mode ?? DEFAULT_AI_SETTINGS.reviewMode,
      model: pol?.ai_model ?? DEFAULT_AI_SETTINGS.model,
      minConfidence: pol?.ai_auto_min_confidence ?? DEFAULT_AI_SETTINGS.minConfidence,
      rejectAllowed: pol?.ai_reject_allowed ?? false,
      keyLast4: secret?.value ? secret.value.slice(-4) : null,
      keyUpdatedAt: secret?.updated_at ?? null,
      demo: false,
      canEdit: true,
    };
  } catch {
    return { ...DEFAULT_AI_SETTINGS, demo: false, canEdit: false };
  }
}

export async function saveAiSettings(input: {
  reviewMode: ReviewMode;
  model: string;
  minConfidence: number;
  rejectAllowed: boolean;
}): Promise<ActionResult> {
  if (!isSupabaseConfigured) return DEMO;
  try {
    const { orgId, userId } = await requireSuperAdmin();
    if (!MODES.includes(input.reviewMode)) return { ok: false, message: "Invalid review mode." };
    const model = input.model.trim();
    if (!/^[\w.:-]{2,64}$/.test(model)) return { ok: false, message: "Enter a valid model name, e.g. gpt-4.1-mini." };
    const minConfidence = Math.min(0.99, Math.max(0.5, Number(input.minConfidence) || 0.85));

    const admin = createAdminClient();
    if (input.reviewMode === "ai_assist" || input.reviewMode === "ai_auto") {
      const { data: secret } = await admin.from("secrets").select("value")
        .eq("organization_id", orgId).eq("key", KEY_NAME).maybeSingle();
      if (!secret?.value) return { ok: false, message: "Add an OpenAI API key before turning AI review on." };
    }

    const row = {
      organization_id: orgId,
      review_mode: input.reviewMode,
      ai_provider: "openai",
      ai_model: model,
      ai_auto_min_confidence: minConfidence,
      ai_reject_allowed: input.rejectAllowed,
      updated_at: new Date().toISOString(),
    };
    const { error } = await admin.from("leave_policies").upsert(row);
    if (error) return { ok: false, message: error.message };
    await audit(orgId, userId, "update_ai_settings", { ...row, organization_id: undefined });
    revalidatePath("/settings");
    return { ok: true, message: "AI settings saved." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function saveApiKey(key: string, model: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return DEMO;
  try {
    const { orgId, userId } = await requireSuperAdmin();
    const clean = key.trim();
    if (!/^sk-[\w-]{20,}$/.test(clean)) return { ok: false, message: "That doesn't look like an OpenAI key (starts with sk-)." };

    const check = await checkOpenAI(clean);
    if (!check.ok) return check;

    const { error } = await createAdminClient().from("secrets").upsert({
      organization_id: orgId,
      key: KEY_NAME,
      value: clean,
      updated_at: new Date().toISOString(),
    });
    if (error) return { ok: false, message: error.message };
    await audit(orgId, userId, "update_openai_key", { last4: clean.slice(-4) });

    const modelCheck = await checkOpenAI(clean, model);
    revalidatePath("/settings");
    return modelCheck.ok
      ? { ok: true, message: `Key saved (…${clean.slice(-4)}). ${modelCheck.message}` }
      : { ok: true, message: `Key saved (…${clean.slice(-4)}), but: ${modelCheck.message}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function testApiKey(model: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return DEMO;
  try {
    const { orgId } = await requireSuperAdmin();
    const { data } = await createAdminClient().from("secrets").select("value")
      .eq("organization_id", orgId).eq("key", KEY_NAME).maybeSingle();
    if (!data?.value) return { ok: false, message: "No API key saved yet." };
    return await checkOpenAI(data.value, model.trim() || undefined);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** HR admins and super admins. */
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again.");
  const [{ data: isAdmin }, { data: org }] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase.rpc("current_org_id"),
  ]);
  if (!isAdmin || !org) throw new Error("Only admins can change payroll settings.");
  return { orgId: org as string, userId: user.id };
}

export async function getPayrollSettings(): Promise<{
  overtimePaid: boolean;
  multiplier: number;
  demo: boolean;
  canEdit: boolean;
}> {
  if (!isSupabaseConfigured) return { overtimePaid: false, multiplier: 1.5, demo: true, canEdit: true };
  try {
    const { orgId } = await requireAdmin();
    const { data } = await createAdminClient()
      .from("payroll_policies")
      .select("overtime_paid, overtime_multiplier")
      .eq("organization_id", orgId)
      .maybeSingle();
    return {
      overtimePaid: data?.overtime_paid ?? false,
      multiplier: Number(data?.overtime_multiplier ?? 1.5),
      demo: false,
      canEdit: true,
    };
  } catch {
    return { overtimePaid: false, multiplier: 1.5, demo: false, canEdit: false };
  }
}

export async function saveOvertimePaid(on: boolean): Promise<ActionResult> {
  if (!isSupabaseConfigured) return DEMO;
  try {
    const { orgId, userId } = await requireAdmin();
    const { error } = await createAdminClient()
      .from("payroll_policies")
      .upsert({ organization_id: orgId, overtime_paid: on, updated_at: new Date().toISOString() });
    if (error) return { ok: false, message: error.message };
    await audit(orgId, userId, "update_overtime_paid", { overtime_paid: on });
    revalidatePath("/settings");
    return {
      ok: true,
      message: on
        ? "Overtime will be paid on the next payroll."
        : "Overtime pay is off. Extra time is still recorded and shown.",
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function removeApiKey(): Promise<ActionResult> {
  if (!isSupabaseConfigured) return DEMO;
  try {
    const { orgId, userId } = await requireSuperAdmin();
    const admin = createAdminClient();
    await admin.from("secrets").delete().eq("organization_id", orgId).eq("key", KEY_NAME);
    // Without a key AI review can't run: fall back to manual review so requests never get stuck.
    await admin.from("leave_policies")
      .update({ review_mode: "manual", updated_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .in("review_mode", ["ai_assist", "ai_auto"]);
    await audit(orgId, userId, "remove_openai_key", {});
    revalidatePath("/settings");
    return { ok: true, message: "Key removed. AI review is off (manual review)." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
