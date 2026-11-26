// Sends queued emails from public.notifications via Resend (HTML + plain text).
// Invoked every minute by pg_cron (see migration 20261126000200_cron.sql).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto), RESEND_API_KEY, MAIL_FROM, APP_URL, CRON_SECRET
import { createClient } from "jsr:@supabase/supabase-js@2";
import { renderEmail, templateFor } from "../_shared/email.ts";

const MAX_ATTEMPTS = 5;
const BATCH = 50;

type Notification = {
  id: number;
  type: string;
  to_email: string;
  to_name: string | null;
  subject: string;
  data: Record<string, unknown>;
  attempts: number;
};

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM") ?? "Presence <attendance@example.com>";
  const appUrl = Deno.env.get("APP_URL") ?? "";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: rows, error } = await db
    .from("notifications")
    .select("id,type,to_email,to_name,subject,data,attempts")
    .eq("status", "pending")
    .lte("send_after", new Date().toISOString())
    .order("id")
    .limit(BATCH);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  for (const n of (rows ?? []) as Notification[]) {
    if (!resendKey) {
      await db.from("notifications").update({ status: "skipped", last_error: "RESEND_API_KEY not set" }).eq("id", n.id);
      continue;
    }

    // Leave emails to HR are rendered with the latest state (AI recommendation, checks, auto-decision).
    let data = n.data;
    if (n.type === "leave_requested" && data.leave_id) {
      const { data: l } = await db.from("leaves")
        .select("status, decided_via, policy_checks, ai_verdict, ai_confidence, ai_summary")
        .eq("id", data.leave_id).maybeSingle();
      if (l?.status === "cancelled") {
        await db.from("notifications").update({ status: "skipped", last_error: "leave cancelled" }).eq("id", n.id);
        continue;
      }
      if (l) data = { ...data, ...l };
    }

    const { html, text } = renderEmail(templateFor({ type: n.type, toName: n.to_name, subject: n.subject, data, appUrl }));
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [n.to_email], subject: n.subject, html, text }),
    });
    if (res.ok) {
      sent++;
      await db.from("notifications").update({ status: "sent", sent_at: new Date().toISOString(), attempts: n.attempts + 1 }).eq("id", n.id);
    } else {
      const attempts = n.attempts + 1;
      await db.from("notifications").update({
        attempts,
        last_error: (await res.text()).slice(0, 500),
        status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        send_after: new Date(Date.now() + 2 ** attempts * 60_000).toISOString(), // exponential backoff
      }).eq("id", n.id);
    }
  }
  return Response.json({ processed: rows?.length ?? 0, sent });
});
