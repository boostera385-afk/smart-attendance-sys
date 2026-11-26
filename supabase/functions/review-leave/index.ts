// AI review of pending leave requests.
// Called by a database trigger (pg_net) right after a request is created, and by cron every 5 minutes
// as a safety sweep. Body: { "leave_id": "<uuid>" } or {} to process all unreviewed pending requests.
//
// Safety rules (best practice):
//  - Deterministic policy checks (DB function evaluate_leave) are the source of truth; the AI only adds a
//    recommendation + human-readable summary for the reviewer.
//  - The AI receives NO names, emails or salary — only the request, policy checks and attendance statistics.
//  - Auto-approve only when: mode = ai_auto, every policy check passed, the leave type allows auto-approval,
//    verdict = approve and confidence >= threshold. The AI never auto-rejects unless ai_reject_allowed = true.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto), CRON_SECRET. OpenAI key: secrets table (openai_api_key)
// or env OPENAI_API_KEY.
import { createClient } from "jsr:@supabase/supabase-js@2";

type Verdict = "approve" | "reject" | "review";
type Review = { verdict: Verdict; confidence: number; summary: string };

const SYSTEM_PROMPT = `You review employee leave requests for an office HR team.
You receive one request with: leave type rules, automatic policy check results, and the employee's recent
attendance statistics. Recommend "approve", "reject" or "review" (needs a human).
Rules:
- Failed checks with severity "hard" mean the request breaks company policy: recommend "reject" or "review", never "approve".
- Failed "soft" checks (notice, coverage, backdated) usually mean "review"; explain the trade-off.
- Consider the reason text and attendance pattern (frequent absences/lates near weekends) but do not speculate
  about health or personal matters, and never discriminate.
- summary: 1–2 short, neutral sentences for HR (max 300 characters). Mention which rules matter.
- confidence: 0–1, how clear-cut the recommendation is.`;

const SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["approve", "reject", "review"] },
    confidence: { type: "number" },
    summary: { type: "string" },
  },
  required: ["verdict", "confidence", "summary"],
  additionalProperties: false,
};

async function askOpenAI(apiKey: string, model: string, payload: unknown): Promise<Review> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "leave_review", strict: true, schema: SCHEMA } },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const out = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Review;
  if (!["approve", "reject", "review"].includes(out.verdict)) throw new Error("invalid verdict");
  out.confidence = Math.max(0, Math.min(1, Number(out.confidence) || 0));
  out.summary = String(out.summary ?? "").slice(0, 400);
  return out;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { leave_id } = (await req.json().catch(() => ({}))) as { leave_id?: string };

  let query = db
    .from("leaves")
    .select("id, organization_id, start_date, end_date, days, half_day, reason, created_at, policy_checks, policy_passed, stats, leave_type_id, leave_types(name, paid, yearly_quota, monthly_limit, min_notice_days, max_consecutive_days, auto_approve_allowed)")
    .eq("status", "pending")
    .is("ai_reviewed_at", null)
    .limit(10);
  if (leave_id) query = query.eq("id", leave_id);
  const { data: leaves, error } = await query;
  if (error) return new Response(error.message, { status: 500 });

  const results: unknown[] = [];
  for (const l of leaves ?? []) {
    const { data: pol } = await db.from("leave_policies").select("*").eq("organization_id", l.organization_id).maybeSingle();
    const mode = pol?.review_mode ?? "ai_assist";
    if (mode !== "ai_assist" && mode !== "ai_auto") continue;

    const { data: keyRow } = await db.from("secrets").select("value")
      .eq("organization_id", l.organization_id).eq("key", "openai_api_key").maybeSingle();
    const apiKey = keyRow?.value ?? Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      results.push({ id: l.id, skipped: "no OpenAI API key configured" });
      continue;
    }

    try {
      const review = await askOpenAI(apiKey, pol?.ai_model ?? "gpt-4.1-mini", {
        request: {
          leave_type: l.leave_types, start_date: l.start_date, end_date: l.end_date, working_days: l.days,
          half_day: l.half_day, reason: l.reason, submitted_on: String(l.created_at).slice(0, 10),
        },
        policy_checks: l.policy_checks,
        all_checks_passed: l.policy_passed,
        employee_stats: l.stats,
      });

      // Guardrail: AI may not approve something that failed a check.
      if (!l.policy_passed && review.verdict === "approve") review.verdict = "review";

      const update: Record<string, unknown> = {
        ai_verdict: review.verdict, ai_confidence: review.confidence, ai_summary: review.summary,
        ai_reviewed_at: new Date().toISOString(),
      };
      const lt = l.leave_types as unknown as { auto_approve_allowed?: boolean } | null;
      const minConf = pol?.ai_auto_min_confidence ?? 0.85;
      if (mode === "ai_auto" && review.confidence >= minConf) {
        if (review.verdict === "approve" && l.policy_passed && lt?.auto_approve_allowed) {
          Object.assign(update, { status: "approved", decided_via: "ai_auto", decided_at: new Date().toISOString(),
            decision_note: `Approved automatically. ${review.summary}` });
        } else if (review.verdict === "reject" && pol?.ai_reject_allowed) {
          Object.assign(update, { status: "rejected", decided_via: "ai_auto", decided_at: new Date().toISOString(),
            decision_note: review.summary });
        }
      }
      const { error: upErr } = await db.from("leaves").update(update).eq("id", l.id).eq("status", "pending");
      if (upErr) throw upErr;
      results.push({ id: l.id, ...review, auto: update.status ?? null });
    } catch (e) {
      results.push({ id: l.id, error: String(e) });
    }
  }
  return Response.json({ reviewed: results.length, results });
});
