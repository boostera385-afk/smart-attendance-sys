# Go-live checklist

Three parts: **database** (Supabase), **web app** (Vercel project `smart-attendance-sys`, root `web/`),
**recognition worker** (second Vercel project with a Daemon, or any Docker host).

## 1. Database migration

New in `supabase/migrations/20261127000000_enrollment_recognition.sql`: face photo uploads, camera
sightings → check-in/out (`record_sighting`), auto check-out + absent marking every 15 min, a private
`documents` bucket, and a `channel` column on notifications (email now; WhatsApp/Slack later).

The remote migration history has different version numbers from the files (the earlier ones were applied
by another tool), so apply this one file directly:

```powershell
cd "C:\Users\Admin\Documents\Kashif\Ai Attendance system"
npx supabase link --project-ref sphllsmxahuaapxpbvmk
npx supabase db query --remote -f supabase/migrations/20261127000000_enrollment_recognition.sql
```

Then redeploy the email function (it now sends only `channel = email` rows):

```powershell
npx supabase functions deploy send-notifications
```

## 2. Web app (Vercel)

Environment variables (Production): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `EZVIZ_APP_KEY`, `EZVIZ_APP_SECRET`,
`NEXT_PUBLIC_APP_URL=https://smart-attendance-sys-eight.vercel.app`.

Supabase › Authentication › URL configuration: Site URL = the app URL; Redirect URLs include
`https://smart-attendance-sys-eight.vercel.app/auth/callback`. Invite emails link there.

```powershell
cd web
npm run build        # must pass
vercel --prod
```

## 3. Recognition worker

The worker reads the cameras (HLS stream, EZVIZ snapshots as fallback), matches faces and writes
attendance. Models: YuNet (MIT) + AuraFace v1 (Apache-2.0), downloaded at image build.

**Vercel Daemon (Public Beta).** Daemons can't run in a project whose root directory is a subfolder, so
create a **second Vercel project** from the same repo with root directory = repository root. It uses
`/vercel.json` (one `recognizer` daemon in `sin1`, next to EZVIZ Singapore). Give it the same
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `EZVIZ_APP_KEY`, `EZVIZ_APP_SECRET`, then deploy to
production (daemons don't run on previews). Logs: project › Logs, source `daemon`.

**Or any Docker host** (office PC, VPS):

```powershell
docker build -t presence-worker worker
docker run -d --restart unless-stopped --env-file web/.env.local presence-worker
```

Optional tuning env vars: `MATCH_THRESHOLD` (0.42), `MATCH_VOTES` (2), `MIN_FACE_PX` (60),
`SIGHTING_INTERVAL_SECONDS` (60), `SNAPSHOT_INTERVAL_SECONDS` (3). A camera's own threshold
(Cameras page) wins.

## 4. First run

1. **Cameras** › *Import from EZVIZ* → set **Outdoor** to *Check-in & out* (any camera can be switched later).
   Video encryption must be off on every camera used (EZVIZ app › camera › Settings).
2. **Departments** › check names. **Shifts** › add holidays.
3. **Employees** › *Add employee* → profile, hours, salary → invite email.
4. Employee opens the invite, sets a password, **My attendance** › *Take photos* (5 angles).
5. HR › employee › *Approve faces*. The employee is **Active** and the worker picks the faces up within a minute.
6. Walk past the camera: check-in appears on the dashboard live feed and a receipt email is sent.

## Known limits

- Recognition needs faces ≥ ~60 px wide in the camera image. The current Outdoor view is wide; move it
  closer or zoom for reliable matches.
- No liveness model yet: 2 agreeing frames are required, but a printed photo could fool it.
- Camera voice greeting: the EZVIZ voice API is unverified, so the switch is stored but not used yet.
- WhatsApp (HR / leave) and Slack (reports) are planned; the notifications table already has a `channel` column.
