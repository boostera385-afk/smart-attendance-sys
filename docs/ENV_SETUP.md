# Environment setup — where to get every secret

Two secret files (both **git-ignored**, never committed):

| File | Used by | Fill in |
|---|---|---|
| `web/.env.local` | Next.js app (local) + copied to Vercel | Supabase, EZVIZ, app URL |
| `supabase/functions/.env` | Supabase Edge Functions (emails, AI review) | Resend, mail sender, app URL, cron secret |

The **OpenAI key is not in any file** — an admin pastes it in the app: **Settings › AI leave review**.

---

## 1. Supabase (database, login, storage)

1. Go to **supabase.com** → sign in → **New project**.
   Name `smart-attendance`, choose a strong DB password (save it), region closest to the office
   (e.g. *Singapore* or *Mumbai* for Pakistan).
2. When ready: **Project Settings › API Keys** (or the **Connect** button):
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **Publishable key** (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - **Secret key** (`sb_secret_…`, click *Reveal*) → `SUPABASE_SECRET_KEY` — server only, never share.
3. Apply the database (from the project folder):
   ```powershell
   npx supabase login
   npx supabase link --project-ref <project-ref>      # the abcdefgh part of the URL
   npx supabase db push                               # runs supabase/migrations/*
   ```
4. **Vault secrets** for scheduled jobs: Dashboard › **Project Settings › Vault** › *Add new secret*:
   - `project_url` = your Project URL
   - `cron_secret` = the same value as `CRON_SECRET` (step 4 below)
5. **Auth**: Authentication › Sign In / Providers › turn **off** "Allow new users to sign up" (invite-only).

## 2. EZVIZ cameras

1. Go to **open.ezviz.com** (international) → sign in with the **same EZVIZ account used in EZVIZ Studio**.
2. Developer / **My Application** → *Create application* → copy **AppKey** and **AppSecret**.
   - `EZVIZ_APP_KEY`, `EZVIZ_APP_SECRET`
3. Test the cameras:
   ```powershell
   $env:EZVIZ_APP_KEY="..."; $env:EZVIZ_APP_SECRET="..."
   python worker/ezviz_probe.py
   ```

## 3. Resend (sending emails)

1. **resend.com** → sign up → **API Keys** › *Create API key* (permission: Sending) → `RESEND_API_KEY` (`re_…`).
2. **Domains** › *Add domain* (e.g. `yourcompany.com`) → add the DNS records it shows → wait for *Verified*.
3. `MAIL_FROM` = `Presence <attendance@yourcompany.com>`.
   Before the domain is verified you can test with `Presence <onboarding@resend.dev>` (sends only to your own Resend email).

## 4. Cron secret

Any long random string. Generate:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Put it in `supabase/functions/.env` as `CRON_SECRET` **and** in Supabase Vault as `cron_secret`.

## 5. Upload Edge Function secrets & deploy functions

```powershell
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy send-notifications --no-verify-jwt
npx supabase functions deploy review-leave --no-verify-jwt
```
(`--no-verify-jwt` because they are called by cron and protected by `CRON_SECRET` instead.)

## 6. OpenAI (AI leave review) — in the app, not a file

1. **platform.openai.com** → *API keys* › *Create new secret key* (`sk-…`).
2. **Settings › Limits**: set a monthly budget (e.g. $10 — leave reviews cost fractions of a cent each).
3. In Presence: **Settings › AI leave review** → paste key → *Verify & save* → turn AI review on.

## 7. Vercel (hosting) — CLI is logged in as `boostera385-9959`

Recommended: import from GitHub so every push deploys automatically.

1. **vercel.com/new** → *Import* `boostera385-afk/smart-attendance-sys`.
2. **Root Directory: `web`** (important) · Framework: Next.js (auto).
3. Environment Variables: add the values from `web/.env.local`
   (set `NEXT_PUBLIC_APP_URL` to the Vercel URL). Deploy.

Or with the CLI (from the `web` folder):
```powershell
cd web
vercel link                                  # create/link the project (root = web)
# push every filled line of .env.local to Production:
Get-Content .env.local | Where-Object { $_ -match '^[A-Z_]+=.+' } | ForEach-Object {
  $k, $v = $_ -split '=', 2; $v | vercel env add $k production
}
vercel --prod
```

After deploying, put the Vercel URL into `APP_URL` (functions `.env`) and re-run step 5's `secrets set`.

## Checklist

- [ ] Supabase URL + publishable + secret key → `web/.env.local`
- [ ] Migrations pushed, Vault `project_url` + `cron_secret`, sign-ups disabled
- [ ] EZVIZ AppKey/Secret → `web/.env.local`, probe script run
- [ ] Resend key + verified domain → `supabase/functions/.env`
- [ ] `CRON_SECRET` in functions `.env` and Vault
- [ ] Function secrets uploaded, functions deployed
- [ ] Vercel project (root `web`) with env vars, deployed
- [ ] OpenAI key saved in Settings › AI leave review
