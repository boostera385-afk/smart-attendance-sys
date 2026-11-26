# Smart Attendance System (Presence)

Face-recognition office attendance using existing **EZVIZ** cameras — installable web app (PWA) on
**Vercel** + **Supabase**. Full plan: [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md).

## Structure

| Path | What |
|---|---|
| `web/` | Next.js PWA dashboard (Tailwind v4, shadcn/ui, Motion, Recharts, OKLCH theme) |
| `supabase/migrations/` | Database schema, RLS, schedules, payroll, leave review, cron jobs |
| `supabase/functions/` | Edge Functions: `send-notifications` (emails), `review-leave` (AI leave review), shared email templates |
| `worker/` | EZVIZ probe script (Phase 0); recognition worker comes in Phase 1 |
| `docs/` | Master plan |

## Run the dashboard locally

```bash
cd web
npm install
npm run dev        # http://localhost:3000 — demo data until Supabase keys are set
```

Copy `web/.env.example` to `web/.env.local` and fill in Supabase keys to go live.

## Test EZVIZ access (Phase 0)

```powershell
$env:EZVIZ_APP_KEY="..."; $env:EZVIZ_APP_SECRET="..."
python worker/ezviz_probe.py --voice test.wav
```
