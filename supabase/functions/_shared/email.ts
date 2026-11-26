// Email templates — best-practice HTML email:
// table layout (Outlook-safe), inline styles, 600px max, hidden preheader, light/dark color-scheme,
// bulletproof button, accessible 16px text, plain-text alternative. No external images or fonts.

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";
export type Row = [label: string, value: string];
export type CheckItem = { label: string; passed: boolean; detail?: string; severity?: string };

export type EmailContent = {
  preheader: string;
  heading: string;
  greeting?: string;
  intro: string;
  badge?: { label: string; tone: Tone };
  rows?: Row[];
  checks?: CheckItem[];
  ai?: { verdict: string; confidence?: number | null; summary?: string | null };
  callout?: { tone: Tone; text: string };
  cta?: { label: string; url: string };
  secondaryCta?: { label: string; url: string };
  footnote?: string;
};

// Pastry Marketing logo colours: navy buttons with lime text
const BRAND = "#1B1B5E";
const BRAND_TEXT = "#C5D92D";
const COMPANY = "Pastry Marketing";
const TONES: Record<Tone, { fg: string; bg: string; border: string }> = {
  success: { fg: "#0f7a55", bg: "#e6f6ef", border: "#b7e4d0" },
  warning: { fg: "#93600a", bg: "#fdf3dc", border: "#f1d79a" },
  danger: { fg: "#b42335", bg: "#fdeaec", border: "#f3c0c6" },
  info: { fg: "#3b4fc4", bg: "#ebeefc", border: "#c5ccf5" },
  neutral: { fg: "#475063", bg: "#f1f3f6", border: "#dde1e7" },
};

export const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function button(label: string, url: string, primary = true) {
  const bg = primary ? BRAND : "#ffffff";
  const fg = primary ? BRAND_TEXT : BRAND;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:4px 8px 4px 0"><tr>
    <td align="center" bgcolor="${bg}" style="border-radius:10px;border:1px solid ${BRAND}">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${esc(url)}" style="height:44px;v-text-anchor:middle;width:200px" arcsize="22%" fillcolor="${bg}" strokecolor="${BRAND}"><center style="color:${fg};font-family:Arial;font-size:15px;font-weight:bold">${esc(label)}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${esc(url)}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;color:${fg};text-decoration:none;border-radius:10px">${esc(label)}</a><!--<![endif]-->
    </td></tr></table>`;
}

function badge(label: string, tone: Tone) {
  const t = TONES[tone];
  return `<span class="badge-${tone}" style="display:inline-block;padding:4px 10px;border-radius:999px;background:${t.bg};color:${t.fg};border:1px solid ${t.border};font-size:13px;font-weight:600;line-height:18px">${esc(label)}</span>`;
}

export function renderEmail(c: EmailContent): { html: string; text: string } {
  const rows = c.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" style="margin:20px 0;border:1px solid #e4e8ee;border-radius:12px;border-collapse:separate;background:#fafbfc">
        ${c.rows.map(([k, v], i) => `<tr>
          <td class="muted rowline" style="padding:11px 16px;font-size:14px;color:#6b7486;${i ? "border-top:1px solid #e9edf2;" : ""}width:42%">${esc(k)}</td>
          <td class="strong rowline" style="padding:11px 16px;font-size:14px;color:#1d2433;font-weight:600;${i ? "border-top:1px solid #e9edf2;" : ""}">${esc(v)}</td></tr>`).join("")}
      </table>`
    : "";

  const checks = c.checks?.length
    ? `<p style="margin:20px 0 8px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6b7486" class="muted">Policy checks</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${c.checks.map((k) => `<tr>
          <td width="28" valign="top" style="padding:6px 0;font-size:15px;line-height:20px;color:${k.passed ? TONES.success.fg : k.severity === "soft" ? TONES.warning.fg : TONES.danger.fg}">${k.passed ? "&#10003;" : k.severity === "soft" ? "!" : "&#10007;"}</td>
          <td style="padding:6px 0;font-size:14px;line-height:20px;color:#1d2433" class="strong"><b>${esc(k.label)}</b>${k.detail ? ` <span class="muted" style="color:#6b7486">— ${esc(k.detail)}</span>` : ""}</td></tr>`).join("")}
       </table>`
    : "";

  const ai = c.ai
    ? (() => {
        const tone: Tone = c.ai.verdict === "approve" ? "success" : c.ai.verdict === "reject" ? "danger" : "warning";
        const t = TONES[tone];
        const conf = c.ai.confidence != null ? ` · ${Math.round(c.ai.confidence * 100)}% confidence` : "";
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;background:${t.bg};border:1px solid ${t.border};border-radius:12px">
          <tr><td style="padding:14px 16px;font-size:14px;line-height:21px;color:#1d2433">
            <div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${t.fg}">AI recommendation: ${esc(c.ai.verdict)}${esc(conf)}</div>
            ${c.ai.summary ? `<div style="margin-top:6px">${esc(c.ai.summary)}</div>` : ""}
            <div style="margin-top:6px;font-size:12px;color:#6b7486">Advisory only — the final decision is yours.</div>
          </td></tr></table>`;
      })()
    : "";

  const callout = c.callout
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0"><tr>
        <td style="border-left:4px solid ${TONES[c.callout.tone].fg};background:${TONES[c.callout.tone].bg};padding:12px 16px;border-radius:0 10px 10px 0;font-size:15px;line-height:22px;color:#1d2433">${esc(c.callout.text)}</td>
       </tr></table>`
    : "";

  const ctas = c.cta
    ? `<div style="margin:24px 0 8px">${button(c.cta.label, c.cta.url)}${c.secondaryCta ? button(c.secondaryCta.label, c.secondaryCta.url, false) : ""}</div>`
    : "";

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(c.heading)}</title>
<style>
  body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%}
  a{color:${BRAND}}
  @media (max-width:620px){.container{width:100%!important}.px{padding-left:20px!important;padding-right:20px!important}}
  @media (prefers-color-scheme:dark){
    .bg{background:#11151c!important}.card{background:#1a2029!important;border-color:#2a313c!important}
    .panel{background:#151a22!important;border-color:#2a313c!important}
    .rowline{border-color:#2a313c!important}
    .strong,h1{color:#eef1f5!important}.muted{color:#9aa3b2!important}.body{color:#d4d9e1!important}
  }
</style>
<!--[if mso]><style>table,td,div,p,a{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body class="bg" style="margin:0;padding:0;background:#f3f5f8">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${esc(c.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background:#f3f5f8">
<tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="container" style="width:600px;max-width:600px">
    <tr><td class="px" style="padding:0 8px 16px;font-family:${FONT}">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="32" height="32" align="center" valign="middle" bgcolor="${BRAND}" style="border-radius:9px;color:#fff;font-size:16px;font-weight:700;font-family:${FONT}">&#10003;</td>
        <td style="padding-left:10px;font-family:${FONT};font-size:18px;font-weight:700;color:#1d2433" class="strong">Presence</td>
        <td style="padding-left:8px;font-family:${FONT};font-size:12px;color:#6b7486" class="muted">by <b>${COMPANY}</b></td>
      </tr></table>
    </td></tr>
    <tr><td class="card px" style="background:#ffffff;border:1px solid #e4e8ee;border-radius:16px;padding:32px 36px;font-family:${FONT}">
      ${c.badge ? `<div style="margin-bottom:14px">${badge(c.badge.label, c.badge.tone)}</div>` : ""}
      <h1 style="margin:0 0 12px;font-size:22px;line-height:30px;font-weight:700;color:#1d2433">${esc(c.heading)}</h1>
      ${c.greeting ? `<p class="body" style="margin:0 0 8px;font-size:16px;line-height:24px;color:#2f3747">${esc(c.greeting)}</p>` : ""}
      <p class="body" style="margin:0;font-size:16px;line-height:24px;color:#2f3747">${esc(c.intro)}</p>
      ${callout}${rows}${ai}${checks}${ctas}
      ${c.footnote ? `<p class="muted" style="margin:20px 0 0;font-size:13px;line-height:20px;color:#6b7486">${esc(c.footnote)}</p>` : ""}
    </td></tr>
    <tr><td class="px" align="center" style="padding:20px 24px;font-family:${FONT};font-size:12px;line-height:18px;color:#8a93a3">
      <span class="muted">Automatic message from ${COMPANY}'s attendance system. You receive it because you have a Presence account.<br>
      Questions? Reply to HR or open the app.<br><br>
      &copy; 2026 ${COMPANY}. All rights reserved. This email and its contents are confidential and intended for ${COMPANY} staff only.</span>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    c.heading,
    "",
    c.greeting ?? "",
    c.intro,
    c.callout ? `\n> ${c.callout.text}` : "",
    ...(c.rows ?? []).map(([k, v]) => `${k}: ${v}`),
    c.ai ? `\nAI recommendation: ${c.ai.verdict}${c.ai.summary ? ` — ${c.ai.summary}` : ""} (advisory)` : "",
    ...(c.checks ?? []).map((k) => `${k.passed ? "[ok]" : "[!!]"} ${k.label}${k.detail ? ` — ${k.detail}` : ""}`),
    c.cta ? `\n${c.cta.label}: ${c.cta.url}` : "",
    c.footnote ? `\n${c.footnote}` : "",
    `\n—\n${COMPANY} · Presence attendance · automatic message\n© 2026 ${COMPANY}. Confidential — for ${COMPANY} staff only.`,
  ].filter((l) => l !== "").join("\n");

  return { html, text };
}

// ---------------------------------------------------------------------------
// Per-notification templates
// ---------------------------------------------------------------------------

type Data = Record<string, unknown>;
const fmtDate = (v: unknown) =>
  v ? new Date(String(v) + (String(v).length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "";
const range = (d: Data) => (d.start_date === d.end_date ? fmtDate(d.start_date) : `${fmtDate(d.start_date)} – ${fmtDate(d.end_date)}`);
const days = (d: Data) => (Number(d.days) === 0.5 ? "Half day" : `${Number(d.days)} day${Number(d.days) === 1 ? "" : "s"}`);
const money = (cur: unknown, n: unknown) => `${cur ?? ""} ${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const leaveName = (d: Data) => {
  const n = String(d.leave_type ?? "leave");
  return /leave/i.test(n) ? n : `${n} leave`;
};

export type TemplateInput = { type: string; toName?: string | null; subject: string; data: Data; appUrl: string };

export function templateFor(n: TemplateInput): EmailContent {
  const d = n.data;
  const hi = `Hi ${n.toName?.split(" ")[0] || "there"},`;
  const url = (p: string) => `${n.appUrl}${p}`;

  switch (n.type) {
    case "leave_submitted":
      return {
        preheader: `${d.leave_type} · ${range(d)} — we'll email you as soon as it's reviewed.`,
        heading: "Leave request received",
        greeting: hi,
        intro: "Your request has been submitted and is now being reviewed. You can follow its status live in the app.",
        badge: { label: "Pending review", tone: "warning" },
        rows: [["Type", String(d.leave_type)], ["Dates", range(d)], ["Duration", days(d)], ...(d.reason ? [["Reason", String(d.reason)] as Row] : [])],
        cta: { label: "Track my request", url: url("/leaves") },
        footnote: "Need to change it? You can cancel a pending request from the Leaves page.",
      };

    case "leave_requested": {
      const checks = (d.policy_checks as CheckItem[] | undefined) ?? [];
      const failed = checks.filter((c) => !c.passed).length;
      const auto = d.status === "approved" && d.decided_via && d.decided_via !== "manual";
      return {
        preheader: auto ? `Auto-approved · ${d.employee} · ${range(d)}` : `${d.employee} · ${d.leave_type} · ${range(d)} — ${failed ? `${failed} check(s) need attention` : "all checks passed"}`,
        heading: auto ? `${d.employee}'s leave was auto-approved` : `${d.employee} requested leave`,
        greeting: hi,
        intro: auto ? "For your information — this request met every leave rule and was approved automatically." : "A new leave request is waiting for your decision.",
        badge: auto ? { label: "Auto-approved", tone: "success" } : failed ? { label: failed === 1 ? "1 check needs attention" : `${failed} checks need attention`, tone: "warning" } : { label: "All checks passed", tone: "success" },
        rows: [["Employee", String(d.employee)], ["Type", String(d.leave_type)], ["Dates", range(d)], ["Duration", days(d)], ...(d.reason ? [["Reason", String(d.reason)] as Row] : [])],
        ai: d.ai_verdict ? { verdict: String(d.ai_verdict), confidence: d.ai_confidence as number, summary: d.ai_summary as string } : undefined,
        checks,
        cta: auto ? { label: "View in dashboard", url: url(`/leaves?id=${d.leave_id}`) } : { label: "Review & decide", url: url(`/leaves?id=${d.leave_id}`) },
      };
    }

    case "leave_cancel_requested":
      return {
        preheader: `${d.employee} wants to cancel approved leave on ${range(d)}`,
        heading: "Leave cancellation request",
        greeting: hi,
        intro: `${d.employee} asked to cancel their approved leave. Approve it to put them back on the schedule.`,
        badge: { label: "Action needed", tone: "warning" },
        rows: [["Employee", String(d.employee)], ["Dates", range(d)], ["Duration", days(d)]],
        cta: { label: "Review cancellation", url: url(`/leaves?id=${d.leave_id}`) },
      };

    case "leave_decided": {
      if (d.status === "cancelled") {
        return {
          preheader: `Your leave on ${range(d)} is cancelled — you're back on the schedule.`,
          heading: "Leave cancelled",
          greeting: hi,
          intro: `Your ${leaveName(d)} for ${range(d)} has been cancelled as requested. Your balance has been restored.`,
          badge: { label: "Cancelled", tone: "neutral" },
          rows: [["Type", String(d.leave_type)], ["Dates", range(d)], ["Duration", days(d)]],
          cta: { label: "View my leaves", url: url("/leaves") },
        };
      }
      const ok = d.status === "approved";
      return {
        preheader: ok ? `Approved · ${range(d)}. Enjoy your time off!` : `Not approved · ${range(d)}`,
        heading: ok ? "Your leave is approved" : "Your leave request was not approved",
        greeting: hi,
        intro: ok ? `Your ${leaveName(d)} for ${range(d)} has been approved.` : `Unfortunately your ${d.leave_type} request for ${range(d)} was not approved.`,
        badge: ok ? { label: "Approved", tone: "success" } : { label: "Not approved", tone: "danger" },
        callout: d.note ? { tone: ok ? "success" : "danger", text: String(d.note) } : undefined,
        rows: [["Type", String(d.leave_type)], ["Dates", range(d)], ["Duration", days(d)],
               ["Decided by", d.decided_via === "manual" ? "HR / manager" : "Automatic (policy)"]],
        cta: { label: ok ? "View my leaves" : "Apply for other dates", url: url("/leaves") },
        footnote: ok ? "Plans changed? You can request cancellation from the app before the leave starts." : "If you think this is a mistake, reply to HR.",
      };
    }

    case "schedule_changed": {
      const dayList = Array.isArray(d.working_days) ? d.working_days.map((x) => DAY_NAMES[Number(x)]).join(", ") : "";
      const hours = d.kind === "flexible" ? `${Math.round(Number(d.required_minutes ?? 0) / 60)} h/day (flexible)` : `${String(d.start_time).slice(0, 5)} – ${String(d.end_time).slice(0, 5)}`;
      return {
        preheader: `New working hours from ${fmtDate(d.effective_from)}: ${hours}`,
        heading: "Your working hours",
        greeting: hi,
        intro: `Here is your work schedule starting ${fmtDate(d.effective_from)}.`,
        badge: { label: "Schedule update", tone: "info" },
        rows: [["Hours", hours], ["Working days", dayList], ["Break", `${d.break_minutes} min (no check-out needed)`], ["Effective from", fmtDate(d.effective_from)]],
        cta: { label: "Open my schedule", url: url("/me") },
      };
    }

    case "payslip_ready":
      return {
        preheader: `Net pay ${money(d.currency, d.net)} — tap to see the full breakdown.`,
        heading: `Your payslip for ${new Date(String(d.period) + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`,
        greeting: hi,
        intro: "Your payslip is ready. Here's the summary — the full breakdown and PDF are in the app.",
        badge: { label: "Payslip", tone: "info" },
        rows: [["Net pay", money(d.currency, d.net)]],
        cta: { label: "View payslip", url: url("/me/payslips") },
        footnote: "Salary information is private. Never forward this email.",
      };

    case "payroll_draft_ready":
      return {
        preheader: `${d.count} payslip(s) ready for review`,
        heading: "Payroll draft ready",
        greeting: hi,
        intro: `The payroll draft for ${fmtDate(d.period)} has ${d.count} payslip(s). Add bonuses or adjustments, then approve to email every payslip automatically.`,
        badge: { label: "Action needed", tone: "warning" },
        cta: { label: "Review payroll", url: url("/payroll") },
      };

    case "check_in_receipt":
      return {
        preheader: `${d.kind === "check_out" ? "Checked out" : "Checked in"} at ${d.time}`,
        heading: d.kind === "check_out" ? "Checked out — see you tomorrow" : "Checked in — have a great day",
        greeting: hi,
        intro: `Recorded by the ${d.camera} camera.`,
        badge: d.late ? { label: `Late by ${d.late_minutes} min`, tone: "warning" } : { label: "On time", tone: "success" },
        rows: [["Time", String(d.time)], ["Camera", String(d.camera)], ...(d.worked ? [["Worked today", String(d.worked)] as Row] : [])],
        cta: { label: "Not me? Report", url: url("/me") },
      };

    default:
      return { preheader: n.subject, heading: n.subject, greeting: hi, intro: "", cta: { label: "Open Presence", url: url("/dashboard") } };
  }
}
