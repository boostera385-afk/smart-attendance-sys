# AI Face Attendance System — Master Plan

Internal office attendance system that recognises employees from the existing **EZVIZ cameras**,
marks **check-in / check-out** automatically, and gives admins a web dashboard (installable PWA).

Runs entirely on **Vercel + Supabase + EZVIZ cameras** (no office server).

---

## 1. Decisions (locked)

| Topic | Decision |
|---|---|
| App type | **One web app, installable as PWA** (desktop, Android, iOS). No separate mobile apps. |
| Audience | Internal staff only, but reachable from the internet (no network/IP restriction). Access controlled by login. |
| Hosting | **Vercel** (web app + API + recognition worker as Vercel Daemon) |
| Backend | **Supabase cloud** (Postgres + pgvector, Auth, RLS, Realtime, Storage, Edge Functions, pg_cron) |
| Cameras | Existing **EZVIZ** cameras (mainly **H6c Pro**), all under one EZVIZ account (seen in EZVIZ Studio) |
| Camera connection | **EZVIZ Cloud (Open Platform API)** by default; **LAN RTSP** selectable as fallback per camera |
| Confirmation | **Camera voice** (H6c Pro speaker) + **email** + optional **PWA push** |
| Source of truth | Supabase database. Google Sheet / Excel are mirrors/exports. |

---

## 2. Architecture

```
EZVIZ cameras ──► EZVIZ Cloud (Open Platform API: token, devices, stream, capture, PTZ, voice)
                         │
                         ▼
          Vercel Daemon — Recognition Worker (Python, Docker, CPU)
            pull frames (2–3 fps / entrance camera)
            → detect face (YuNet/SCRFD) → quality filter → track (ByteTrack)
            → liveness → embedding (AuraFace, Apache-2.0) → match (pgvector)
            → 3+ frames agree → attendance event
                         │
                         ▼
                     Supabase
   ┌─────────────────────┼────────────────────────────────────────┐
   │ Postgres + pgvector │ Auth + RLS │ Realtime │ Storage │ pg_cron │
   └─────────────────────┼────────────────────────────────────────┘
          │              │                       │
          ▼              ▼                       ▼
  Edge Functions    Next.js PWA (Vercel)    Camera voice / Email / Push
  (Sheets sync,     dashboard + employee
   email, AI)       self-service
```

**No video is ever stored by this system** — frames are processed in memory and discarded. Only events,
embeddings and one small face-crop snapshot per check-in/out are stored in Supabase (see §12).

### Why these choices
- **EZVIZ Cloud API** — all cameras are on one EZVIZ account, so one appKey/appSecret imports everything; works
  without any office server. Endpoints: `/api/lapp/token/get`, `/api/lapp/device/list`, `/api/lapp/camera/list`,
  capture, live address, `/api/lapp/device/ptz/start|stop`, voice upload/send (to be verified in Phase 0).
- **LAN RTSP fallback** — `rtsp://admin:<sticker code>@<ip>:554/ch1/main` (enable "LAN Live View" in EZVIZ app).
  Some firmware disables RTSP; only usable if a machine on the LAN can reach the camera.
- **Model licensing** — InsightFace pretrained models are **non-commercial only**. Use YuNet (MIT) + AuraFace
  (Apache-2.0), or buy an InsightFace commercial licence. Verify weights licences before go-live.

---

## 3. Stack

| Layer | Tech |
|---|---|
| Web app | Next.js (App Router) + TypeScript + Tailwind CSS, PWA (web manifest + service worker) |
| UI | shadcn/ui components (added as needed) |
| Data | `@supabase/supabase-js` + `@supabase/ssr` |
| Database | Supabase Postgres 17 + `pgvector` (512-d embeddings, HNSW cosine index) |
| Auth | Supabase Auth (invite-only, email/password or Google), MFA for admins |
| Realtime | Supabase Realtime on `attendance_events` / `attendance_days` |
| Files | Supabase Storage private buckets: `faces`, `snapshots` (signed URLs only) |
| Scheduled jobs | `pg_cron`: mark absents, auto check-out, daily summaries |
| Worker | Python 3.12, OpenCV, ONNX Runtime, numpy, httpx — Vercel Daemon (Docker) |
| Email | Resend (or company SMTP) via Supabase Edge Function |
| Sheets | Google Sheets API (service account) via Edge Function |
| AI assistant | Claude via Edge Function ("Who was late 3+ times this month?") |

---

## 4. Roles & access

| Role | Permissions |
|---|---|
| **super_admin** | Everything incl. EZVIZ credentials, users, roles, system settings |
| **admin** (HR) | Employees, enrollment approval, attendance corrections, reports, unknown faces |
| **manager** (team lead, e.g. ND TEAM, Facebook team) | Own team attendance, leave approvals |
| **employee** | Own attendance, own face enrollment, leave requests |

Security: no public sign-up (invite only), MFA for admins, Row Level Security on every table, private storage
with signed URLs, audit log of every change, worker uses server-only service key (never in browser).

---

## 5. Data model (core tables)

| Table | Purpose |
|---|---|
| `organizations` | Company (multi-branch ready) |
| `branches` | Office locations, timezone, GPS geofence |
| `departments` | Teams / zones (imported from EZVIZ groups: ND TEAM, Facebook team…) |
| `profiles` | 1:1 with `auth.users`; role, organization |
| `employees` | Employee record (code, name, email, department, branch, status) |
| `face_embeddings` | `vector(512)` per enrolled photo, quality score, approved flag |
| `cameras` | name, EZVIZ serial/channel, connection type, RTSP url, role, branch, department, status, voice settings |
| `shifts` | Work schedules: **each employee's personal hours** (set on employee form) + optional presets; times, break, working days, grace, half-day/overtime rules (§7A) |
| `employee_shifts` | Which shift each employee works, **with effective dates** (history kept when shift changes) |
| `shift_overrides` | One-day change for one employee (swap shift / day off) |
| `holidays` | Public / company holidays (per branch or all) |
| `attendance_events` | Raw sightings (employee, camera, time, confidence, snapshot path, type) |
| `attendance_days` | One row per employee per shift-day: **shift snapshot**, check-in/out, gross/net minutes, late / early-leave / overtime minutes, status (present/late/half_day/absent/leave/holiday), source |
| `unknown_faces` | Unmatched faces for HR review |
| `leaves` | Leave requests + approval |
| `settings` | Per-organization key/value config (thresholds, cooldown, confirmation options…) |
| `audit_log` | Who changed what, when |

---

## 6. Camera settings page

```
Settings › Cameras
[ Import from EZVIZ account ]  [ + Add manually ]
┌──────────────┬───────────┬──────────┬───────────────┬────────┬────────┐
│ Camera       │ Group     │ Role ▼   │ Connection ▼  │ Status │ Test   │
├──────────────┼───────────┼──────────┼───────────────┼────────┼────────┤
│ OFFICE       │ —         │ Entry    │ EZVIZ Cloud   │ ● Live │ [Snap] │
│ H6C(B…)      │ ND TEAM   │ Both     │ EZVIZ Cloud   │ ● Live │ [Snap] │
│ Outdoor      │ —         │ Disabled │ —             │ ○ Off  │ [Snap] │
└──────────────┴───────────┴──────────┴───────────────┴────────┴────────┘
Role:       Entry / Exit / Both / Presence-only / Disabled
Connection: EZVIZ Cloud (default) / LAN RTSP / Custom RTSP
Extra:      voice greeting on/off, volume, recognition threshold override, fps
```

Presence-only cameras (inside team rooms) never create check-ins; they only update "last seen" to improve check-out accuracy.

Current cameras (from EZVIZ Studio): BD79…, DELIV…, FB RO…, H6C(B…) ×3, ND, OFFICE, Outdo…, SEO;
groups: ND TEAM, Facebook team. **Need: which cameras face entrance/exit doors at face height.**

---

## 7A. Shifts, breaks & schedules

There are **no fixed company shifts**. Each employee's **working hours, break and working days are set on the
employee form** when the user is created, and can be changed any time without breaking past reports.

### Employee form › Work schedule

```
Add employee
Name [            ]  Code [    ]  Email [            ]  Department [ND TEAM ▼]

Work schedule                                   Quick-fill: [ Preset ▼ ] (optional)
  Type          (•) Fixed hours   ( ) Flexible (required hours only)
  Start time    [09:00]     End time  [17:00]     → 8h 00m (crosses midnight auto-detected)
  Working days  [Mon][Tue][Wed][Thu][Fri][Sat][ Sun ]
  Break         [60] min    (always paid)     Window (optional) [13:00]–[14:00]
  Effective from [2026-12-01]
  ▸ Advanced: late grace [15] · early-leave grace [10] · overtime after [30] · half day < [4h] · absent < [1h]
                                                                     [ Save ]
```

- Advanced values default from **Settings › Attendance rules** (company defaults), so normally only start/end,
  days and break are filled in.
- **Presets** (e.g. "Morning 09–17", "Evening 18–02") are optional shortcuts that only pre-fill the form;
  editing a preset never changes existing employees.
- Saved via database function `set_employee_schedule()` → creates that employee's personal schedule,
  closes the previous one the day before the effective date, writes the audit log.
- Later option: different hours per weekday (e.g. Saturday half day) as a per-day table in the same form.

### Schedule fields

| Field | Example A | Example B | Meaning |
|---|---|---|---|
| Type | Fixed | Fixed | `fixed` = set start/end · `flexible` = only required hours count |
| Start → End | 09:00 → 17:00 | 18:00 → 02:00 | End ≤ start ⇒ **crosses midnight**; the day belongs to the **start date** |
| Working days | Mon–Sat | Mon–Sun | Days off are never marked absent |
| Break | 60 min, **paid** | 30 min, **paid** | see break modes below |
| Break window (info) | 13:00–14:00 | 22:00–22:30 | Shown to staff; not enforced |
| Late grace | 15 min | 15 min | Late if check-in > start + grace |
| Early-leave grace | 10 min | 10 min | Early leave if check-out < end − grace |
| Half day if net < | 4 h | 4 h | |
| Absent if net < | 1 h | 1 h | |
| Overtime after | end + 30 min | end + 30 min | Overtime minutes counted from scheduled end |
| Check-in opens | 2 h before start | 2 h before start | Earlier sightings ignored |

### Break modes (best practice: **don't track breaks**)
| Mode | Behaviour | When to use |
|---|---|---|
| ~~deduct~~ | Not used. **Company policy (2026-11-27): breaks are always paid**, enforced by a DB trigger on `shifts` / `attendance_days`. | — |
| **paid** (always) | Break counts as work time; nothing deducted. | This company |
| **tracked** (optional, later) | Time between an Exit sighting and the next Entry sighting during the shift counts as break; deducts actual time. | Only if management needs it |

Going out during the day **never** creates a check-out: only the **last** sighting of the shift-day is used,
and re-entering never creates a second check-in.

### Changing an employee's hours
- **Employee › Work schedule** tab: edit hours / days / break + **effective from** date → Save.
  Old schedule is closed, history preserved (schedule history list shown on the tab).
- **Bulk edit** (optional): select employees → apply the same hours from a date.
- **Roster view** (week grid): click a cell → one-day change (different hours that day, or day off).
  Managers can do this for their own team.
- Priority: **one-day change → employee's schedule for that date → day off**. Holidays ⇒ status `holiday`.
- Each attendance day stores a **snapshot** of the schedule used, so changes never rewrite history.
- All changes go to the audit log; employee gets an email ("Your working hours change to 18:00–02:00 from 1 Dec").

### How a sighting is assigned to a shift-day
```
Check-in time T for employee →
  find shift for today (and yesterday, for night shifts still running)
  T within [start − check-in-open, end + checkout-close]? → that shift-day
  else → ignored sighting (logged only)
```

### Calculations (Postgres function `recalc_attendance_day`, verified with test cases)
```
gross   = check_out − check_in
net     = gross                        (breaks are always paid)
late    = check_in − scheduled_start   (if > grace)
early   = scheduled_end − check_out    (if > grace)
overtime= check_out − scheduled_end    (if > overtime-after)
status  = absent | half_day | late | present   (leave/holiday set separately)
```
**Extra time (recorded, not paid):** `early arrival (before start) + time after scheduled end` per day
(all of it on a day off). Shown on the dashboard (live feed "+12m early", Extra time card with
today / week / top people), in reports and as an **information line on payslips (amount 0)**.
It is never added to salary. Paid overtime is a separate per-employee option, off by default.

**Dashboard colour meaning:** green = on time / good · amber = within grace / watch ·
red = late, absent, team below 85% ("Needs improvement") · blue = trends and leave.

Example: Morning 09:00–17:00, in 09:25, out 17:40 → gross 8h15, net 7h15, late 25 min, overtime 40 min, status **late**.
Example: Evening 18:00–02:00, in 17:55, out 02:45 (next day) → net 8h20, overtime 45 min, status **present**, date = start date.

---

## 7B. Employee form — department, salary & payroll

### Full "Add employee" form (one page, 4 sections)

```
1. Profile      Name · Employee code · Email · Phone · Designation · Joined on
                Department [ SEO ▼ ]  (+ New department inline)   Branch [ HQ ▼ ]   Role [ Employee ▼ ]
2. Schedule     Start/End · Working days · Break · Effective from   (§7A)
3. Salary       Basic salary [ 60,000 ] PKR / month     Effective from [2026-12-01]
                Allowances  [+ Add]  Transport 5,000 · Mobile 2,000          (paid every month)
                [✓] Overtime paid (rate from company policy)   [✓] Apply late/early deductions
4. Leave        Leave balances shown from company leave types (Annual 14, Sick 8, Casual 6, Unpaid ∞)
                [Save & send invite]
```

- **Department** is required: dropdown of departments (imported EZVIZ groups + manual), "+ New department"
  inline. Shown everywhere: employee list (filter/group), dashboard team chart, attendance table, payslips,
  reports. Department head = manager role with that department.
- **Salary is history-based** (`employee_compensation` with effective date) — raise from a date, old payslips unchanged.
- Salary visible **only to HR/admin and the employee themself**. Managers never see salaries.

### Company payroll policy (Settings › Payroll — set once)

| Rule | Default | Meaning |
|---|---|---|
| Currency | PKR | |
| Per-day rate basis | Scheduled working days in month | or fixed 30 / 26 days |
| Absent (no leave) | deduct 1 day | |
| Half day | deduct 0.5 day | |
| Late arrivals | every **3** lates = **0.5 day** deducted | 0 = off |
| Early leaving | every 3 = 0.5 day | |
| Overtime | hourly rate × **1.5**, only days with ≥ 30 min OT; days off/holidays worked = all overtime | per-employee on/off |
| Joined/left mid-month | pro-rata | |
| Payroll day | 1st of month → drafts for previous month | |
| Auto-email payslips | on approval | |

### Monthly payroll — automatic
```
1st of month 03:00 (pg_cron) → generate_payroll(org, last month)
  for each employee with a salary:
    per-day rate = basic ÷ scheduled working days (policy)
    walk every day: holiday / day off / leave (paid|unpaid) / present / late / half day / absent / overtime
    earnings  = basic + allowances + overtime + bonuses/reimbursements
    deductions= absent + unpaid leave + half days + late/early rule + advances/other deductions + pro-rata
    net       = earnings − deductions   (never below 0)
→ HR gets "Payroll draft ready" email → reviews in /payroll (edit adjustments, regenerate any employee)
→ Approve → each employee automatically emailed their payslip (+ visible in PWA › My payslips, PDF download)
→ Mark paid
```
Bonuses, advances, one-off deductions: **Payroll › Adjustments** (amount + reason) for a month, before approval.
Approved runs are **locked** (no recalculation).

Verified example (October 2026, Mon–Sat 09–17, 1 holiday → 26 scheduled days → 2,307.69/day):

| Earnings | | Deductions | |
|---|---|---|---|
| Basic | 60,000.00 | Absent 2 days | 4,615.38 |
| Transport allowance | 5,000.00 | Unpaid leave 1 day | 2,307.69 |
| Overtime 2 h × 1.5 | 865.38 | Half day 1 × 0.5 | 1,153.85 |
| Bonus (target) | 10,000.00 | Late 4 → 1 × 0.5 day | 1,153.85 |
| | | Advance | 5,000.00 |
| **Gross** | **75,865.38** | **Total** | **14,230.77** |

**Net 61,634.61.** 2 paid annual-leave days → no deduction (balance 12 of 14 left).

---

## 7C. Leaves — apply, automatic checks, AI recommendation, decision, emails

### Leave types & rules (Settings › Leave types)

| Rule | Example | Severity |
|---|---|---|
| Paid / unpaid | Annual = paid, Unpaid = unpaid | — |
| Yearly quota | Annual 14, Sick 8, Casual 6 | hard |
| **Monthly limit** | Annual: max **1 day per month** | hard |
| Advance notice | Annual: apply ≥ 3 days before | soft |
| Max consecutive days | Casual: max 2 | hard |
| Document required | Sick > 2 days needs a medical note (upload) | hard |
| Probation | No paid leave in first 90 days | hard |
| Team coverage (company) | Max 2 people from the same department off on the same day | soft |
| Backdated | Start date before request date | soft |
| Auto-approve allowed | Sick: yes · Annual: yes · Unpaid: no | — |

*hard* = breaks policy (blocks automatic approval) · *soft* = needs human judgement.

### Review mode (Settings › Leave review) — choose one

| Mode | What happens | Best for |
|---|---|---|
| **Manual** | HR/manager decides everything | Small teams |
| **Policy auto** | All rules pass → approved instantly; otherwise HR decides. No AI | Clear policies, no API key |
| **AI assist** *(default)* | Rules run + AI writes a recommendation & summary for HR; **HR decides** | Most offices |
| **AI auto** | Like AI assist, but auto-approves when **all rules pass + AI says approve + confidence ≥ 85%**. AI never auto-rejects (unless explicitly enabled) | High volume |

AI provider: **OpenAI** (API key stored server-side in Settings › Integrations, never sent to browsers; model configurable).
The AI receives **no names, emails or salary** — only the request, rule results and attendance statistics
(lates last 30 days, absences last 90 days, leave used this year, recent rejections, tenure).
Guardrail: if any rule failed, an AI "approve" is downgraded to "review".

### End-to-end flow

```
EMPLOYEE (PWA › Leaves › New request)
  type ▼ · dates · half-day ☐ · reason · attach document (if required)
  → live preview before submit: working days counted from MY schedule, balance after request,
    rule checks (e.g. "✗ Monthly limit: 1 Annual already used in December")
  → Submit
        │
        ▼
DATABASE (instant)
  days computed · overlap blocked · rules evaluated → policy_checks + record snapshot
  email → employee "Request received" (Pending)
        │
        ├─ Policy auto & all pass ─────────────► APPROVED (decided_via = policy_auto)
        │
        ├─ AI assist / AI auto ──► Edge Function review-leave (OpenAI, ~5 s)
        │        verdict approve/reject/review + confidence + 1–2 sentence summary
        │        AI auto & safe ──────────────► APPROVED (decided_via = ai_auto)
        │
        ▼
HR / MANAGER (email after ~2 min so it includes the AI recommendation; dashboard › Leaves)
  request · rule checks ✓/✗ · AI recommendation · employee stats · team calendar for those dates
  [Approve]  [Reject — reason required]   (cannot decide own leave; every decision audited)
        │
        ▼
EMPLOYEE
  status updates LIVE on dashboard (Realtime): Submitted → Under review → Approved / Not approved
  email with decision + note · balance updated · payroll uses it automatically (paid vs unpaid)
  Cancel: pending → cancelled instantly · approved & future → "cancellation requested" → HR approves → email
```

### Employee dashboard › My leaves
- Balance cards per type (used / pending / left this year, and this month for monthly-limited types).
- Request list with status timeline (Submitted → AI reviewed → Decided) and decision note.
- Team calendar (who's off) — names only, no reasons.

### Admin dashboard › Leaves
- Queue: Pending (with AI badge & failed-rule count), Cancellation requests, Upcoming, History.
- One-click approve; reject requires a reason; bulk approve for all-green requests.
- Filters: department, type, AI verdict, failed rules. Export CSV.

Implemented in DB: `evaluate_leave()`, `leave_stats()`, `decide_leave()`, `cancel_leave()`, triggers
(migration `20261126000300_leave_review.sql`) and Edge Function `review-leave` — scenarios verified:
auto-approve clean request · 2nd Annual in same month flagged · sick 3 days without document flagged ·
team coverage flagged · forged AI fields ignored · self-approval blocked · reject without reason blocked ·
cancel pending / request cancel of approved / HR approves cancellation.

### Email design (all automatic emails)
Built in `supabase/functions/_shared/email.ts`, following email best practices:
table layout (Outlook/Gmail safe), inline styles, 600 px, hidden preheader text, light + dark mode,
bulletproof buttons (VML for Outlook), 16 px readable text, status badge, details table, plain-text version,
no external images/fonts, clear footer. Templates: request received · new request for HR (with AI
recommendation + rule checks) · approved · not approved (with reason) · cancellation request · cancelled ·
working hours · payslip ready · payroll draft · check-in receipt.

---

## 7D. Automatic emails (notification outbox)

All emails are queued in the `notifications` table by database triggers/jobs and sent by Supabase Edge Function
`send-notifications` (runs every minute; Resend or company SMTP). Each type can be switched on/off in
Settings › Notifications. Retries up to 5 times; failures visible to admins.

| Event | To | Trigger |
|---|---|---|
| Account invite | Employee | Employee created (Supabase Auth invite) |
| Check-in / check-out receipt (with snapshot) | Employee | Worker records event |
| Late alert | Employee (+ manager optional) | Check-in after grace |
| "We haven't seen you" | Employee | Start + grace, no check-in, no leave |
| Missing check-out | Employee | Auto check-out applied |
| Leave request received (receipt) | Employee | Leave inserted |
| Leave requested (with rule checks + AI recommendation, sent ~2 min later) | HR + department manager | Leave inserted |
| Leave approved / not approved / cancelled | Employee | Leave status changes |
| Cancellation request | HR + department manager | Employee cancels an approved future leave |
| Working hours changed | Employee | New schedule saved |
| Payroll draft ready | HR | Monthly job |
| Payslip ready | Employee | Payroll run approved |
| Daily summary | HR | Every evening |
| Camera offline | Admins | Worker heartbeat missing 5 min |

---

## 7. Flows

### 7.1 One-time setup
1. Super admin logs in at https://isgpopen.ezviz.com/console/login.html (see docs/ENV_SETUP.md › EZVIZ developer links) with the same EZVIZ account → creates application → copies appKey/appSecret.
2. Dashboard › Settings › EZVIZ → paste keys → **Import cameras** (all devices + groups).
3. Set each camera's Role, Branch/Department, Enabled → **Test** (snapshot).
4. Settings › Attendance rules: company defaults for late grace, early-leave grace, overtime, half-day (§7A).
   Optional presets for quick-fill.
5. Settings: holidays, confirmation options, Google Sheet link.

### 7.2 Employee onboarding
1. Admin adds employee (name, code, email, department, **working hours, working days, break, effective date**) → invite email.
2. Employee opens PWA → sets password → **guided face capture**: 5 angles + liveness (blink/turn head).
   (Admin can also upload photos.)
3. Server computes embeddings → stored in `face_embeddings` (pending).
4. Admin approves → employee **Active**.

### 7.3 Arrival (check-in)
```
Entry camera sees person → worker pulls frames → detect → quality → liveness → embed → match
→ 3+ frames agree (cosine ≥ threshold)?
   YES → resolve employee's shift-day (§7A) → first entry of that shift-day? → CHECK-IN (time, camera, snapshot)
         → late if after that employee's shift start + grace
         → Realtime → dashboard updates instantly
         → confirmation: camera voice + email (+ push)
         → Google Sheet row
   NO  → unknown face → snapshot → Unknown Faces queue
```
Cooldown: repeated sightings within 5 min are ignored.

### 7.4 During the day (incl. breaks)
Presence-only / any camera sightings update `last_seen`. Breaks need no action (§7A break modes);
stepping out and back in does not create extra check-ins/outs.

### 7.5 Departure (check-out)
- Last sighting on an Exit camera within the shift-day = check-out → net hours, early-leave, overtime computed
  → "Goodbye, check-out done" + email. Later exit sightings (same shift-day) simply move the check-out later.
- No exit by shift end + checkout-close window → pg_cron sets check-out = last seen, flagged **Auto**
  (runs per shift, so evening shifts close after 02:00, not at midnight).

### 7.6 Not recognised (fallback)
```
Employee's own shift start + grace, no check-in, no leave
→ push/email: "We haven't seen you today — are you in the office?"
→ employee taps "I'm here" → selfie in PWA → liveness + face match + GPS inside geofence
→ "Manual check-in" flagged for HR review
```

### 7.7 End of shift-day (pg_cron, every 15 min)
- For each shift that ended (+ close window): scheduled employees with no record, no approved leave,
  not a holiday → **Absent**. Employees on a day off are skipped.
- Daily summary email to HR (present / late / absent / overtime) and to each employee.
- Weekly AI summary report.

---

## 8. Confirmation to employee

| Method | Speed | Notes |
|---|---|---|
| 🔊 Camera voice (H6c Pro speaker) | 2–5 s, at the door | "Thank you [name], check-in done". Pre-generated audio per employee. Uses EZVIZ voice upload/send API — **unofficially documented, verify in Phase 0**. Quiet hours + per-camera toggle. |
| 📧 Email | seconds–minutes | Check-in/out receipt with snapshot + end-of-day summary + problems (late, missing check-out). |
| 📱 PWA push | 2–5 s | Optional; iOS needs PWA added to home screen. |
| 🖥 Kiosk screen (optional) | instant | `/kiosk` page on any tablet/TV by the door: photo, name, time, green ✓. |

Not used: flash light (H6c Pro has no API-controllable light), PTZ "nod" (breaks framing, wears motor).

```
Settings › Confirmation
[✓] Camera voice     Message: [Thank you, check-in done]   [✓] Say name   Volume [■■■□]
[✓] Email on check-in/out
[✓] Daily summary email at [19:00]
[ ] PWA push notification
[✓] Selfie fallback after [15] min   GPS radius [100] m
```

---

## 9. App pages

| Page | Who | Content |
|---|---|---|
| `/login` | all | Email/password, Google, MFA |
| `/dashboard` | admin, manager | Live check-in feed (Realtime), today stats, camera health |
| `/attendance` | admin, manager | Daily/monthly table, filters, corrections (audited), export Excel/CSV |
| `/employees` | admin | List, add/invite, enrollment status, approve faces |
| `/unknown` | admin | Unknown-face review queue |
| `/cameras` | super_admin, admin | Camera settings (above) |
| `/shifts` | admin | **Weekly roster** of everyone's hours, one-day changes, bulk edit, optional presets, holidays (per-employee hours are set on `/employees`) |
| `/reports` | admin, manager | Late/absent/overtime, per team, AI assistant |
| `/leaves` | all | Requests (half-day option), balances, approvals |
| `/payroll` | admin | Monthly runs, payslips, adjustments (bonus/advance/deduction), approve → auto-email, export |
| `/departments` | admin | Departments, head (manager), color; employee counts |
| `/me` | employee | My today, history, enroll face, report issue |
| `/kiosk` | device | Welcome screen |
| `/settings` | super_admin | EZVIZ keys, shifts, thresholds, confirmation, Google Sheet, retention |

---

## 10. Roadmap

| Phase | Duration | Deliverables |
|---|---|---|
| **0. Foundation** | ~2 days | Repo scaffold (Next.js PWA + worker), Supabase schema + RLS migrations, **EZVIZ probe script** (token, devices, snapshot, PTZ capability, voice test), camera placement decision |
| **1. Recognition** | ~2 weeks | Worker: EZVIZ frames → detection/recognition → attendance events in Supabase; deploy as Vercel Daemon; live feed |
| **2. Dashboard** | ~2 weeks | Auth + roles, cameras page, employees + enrollment, **shifts + roster**, attendance, unknown faces |
| **3. Confirmation & reports** | ~1–2 weeks | Camera voice, automatic emails, push, Sheets sync, leaves + balances, reports, pg_cron jobs, kiosk |
| **3b. Payroll** | ~1 week | Salary on employee form, payroll policy, monthly auto-draft, adjustments, approve → payslip emails, PDF |
| **4. Hardening** | ongoing | Threshold auto-tune, anti-spoofing, AI assistant, monitoring, backups, retention policy |

---

## 11. Phase 0 checklist (owner: company)

- [x] Create EZVIZ Open Platform application (isgpopen.ezviz.com, same EZVIZ account) ✅ done 2026-11-26 → appKey + appSecret
- [ ] Note camera LAN IPs (EZVIZ Studio › Devices on LAN) for RTSP fallback test in VLC
- [ ] Decide which cameras face entrance/exit doors at face height (move an H6c Pro if needed)
- [ ] Employee consent for face recognition (biometric data)
- [ ] Supabase project (new) + Vercel login
- [ ] Email: Resend account or company SMTP

---

## 12. Media storage policy — NO video

The system **never records or stores video**. Frames are pulled, processed **in memory** and discarded within seconds.

| What is stored | When | Size | Kept for | Used for |
|---|---|---|---|---|
| **Face snapshot** (cropped face + small margin, JPEG) | Only on **check-in** and **check-out** (1 per event) | ~20–40 KB | 30 days (configurable) | Proof in email / push / dashboard ("Not me? Report") |
| **Unknown-face snapshot** (cropped face) | When an unrecognised face is seen (deduplicated, max 1 per person per 10 min) | ~20–40 KB | 7 days, or until HR reviews | Unknown Faces queue |
| **Enrollment photos** | At onboarding (5 angles) | ~50 KB each | While employee is active; deleted on exit | Re-computing embeddings if model changes |
| **Face embedding** (512 numbers, not an image) | From enrollment photos | 2 KB | While employee is active | Matching |
| Sighting events (no image) | Every recognition | tiny row | 90 days | Last-seen / check-out accuracy |

Rules:
- Snapshot is a **face crop only** (not the full camera frame) → other people / screens in the room are not stored.
- Private Storage bucket, viewable only by the employee themselves + admins via short-lived signed URLs.
- Nightly `pg_cron` job deletes expired snapshots.
- EZVIZ's own cloud recording (Video VIP plan) is separate and controlled in the EZVIZ app, not by this system.

## 13. Privacy & compliance

- Written employee consent; clear purpose (attendance only).
- No video stored (see §12); embeddings + short-lived face-crop snapshots only.
- Private buckets, signed URLs, RLS, audit log, admin MFA.
- Delete face data when an employee leaves.
- Check local data-protection law before go-live.

---

## 14. UI / UX

- **Theme "Presence"** — custom **OKLCH** color tokens (Tailwind v4 + shadcn/ui): teal primary (✓ attendance),
  amber = late, rose = absent, indigo = info; full **light + dark** mode (system default + toggle).
- Typography: Bricolage Grotesque (headings) + Geist (UI) + Geist Mono (times/numbers).
- **Animations** (Motion): animated counters, live check-in feed slide-in, staggered cards, scanning-face
  camera tiles, pulse on live status; respects `prefers-reduced-motion`.
- **Charts** (Recharts via shadcn charts): weekly attendance trend (area), arrivals by hour (bar),
  today's status (donut), department comparison, late-trend per employee.
- Mobile-first responsive layout; installable **PWA**; skeleton loaders; toast feedback; keyboard-accessible.

## 15. Risks

| Risk | Mitigation |
|---|---|
| EZVIZ cloud stream quotas/cost | Measure in Phase 0; snapshot-based capture fallback; small LAN box later if needed |
| EZVIZ voice API undocumented | Test in Phase 0; email/push remain primary fallback |
| Camera angle (pan/tilt cams covering rooms) | Dedicated entrance-facing camera at face height |
| CPU-only inference speed | 2–3 fps per entrance camera, light models (YuNet + AuraFace) |
| Model licensing | Permissive models only, or commercial InsightFace licence |
| Photo/screen spoofing | Multi-frame voting + liveness model |

## Sources
- EZVIZ LAN Live View: https://support.ezviz.com/faq/article/How-to-use-LAN-Live-View
- EZVIZ Open Platform device API: https://open.ys7.com/doc/en/HTTP/device_select.html
- EZVIZ PTZ API: https://open.ys7.com/doc/en/HTTP/device_ptz.html
- EZVIZ voice broadcast (third-party): https://clawhub.ai/ezviz-open/ezviz-open-camera-broadcast
- Home Assistant EZVIZ notes: https://www.home-assistant.io/integrations/ezviz/
- InsightFace licence: https://github.com/deepinsight/insightface
- H6c Pro: https://www.ezviz.com/sas/product/h6c-pro/347349
