# Ledger — what to do next, in order

State as of now: `main` has the milestone-1 scaffold. `feature/exit-forecast` is committed locally in `C:\Github\ledger` and not yet pushed. Nothing is deployed; no Supabase or EAS project exists yet.

Each step ends with a check. Don't move on until the check passes.

---

## Step 1 — Merge the exit-forecast branch

```powershell
cd C:\Github\ledger
git checkout feature/exit-forecast
git push -u origin feature/exit-forecast
```

Open a PR on GitHub from `feature/exit-forecast` into `main`. Wait for the `ci` check to go green. Merge it. Then:

```powershell
git checkout main
git pull
```

**Check:** `git log --oneline -3` shows the "Add the exit forecast" commit on `main`.

---

## Step 2 — Create the Supabase project

1. Go to https://supabase.com → New project. Free tier. Name it `ledger`. Pick the region closest to you. Save the database password you set — you need it in step 4.
2. Wait for the project to finish provisioning (a couple of minutes).

**Check:** the project dashboard loads.

---

## Step 3 — Create the API database role on Supabase

1. In the Supabase dashboard, open **SQL Editor**.
2. Open `packages\api\src\db\rls\000_roles.sql` from the repo in a text editor.
3. **Change** `PASSWORD 'ledger_api'` to a real password. Write it down — you need it in step 4.
4. Paste the whole file into the SQL editor and run it.

**Check:** the editor reports success and this query returns one row:

```sql
select rolname, rolbypassrls from pg_roles where rolname = 'ledger_api';
```

`rolbypassrls` must be `false`.

---

## Step 4 — Collect the values for `.env`

From the Supabase dashboard:

| Where | Value | Goes in |
| --- | --- | --- |
| Project Settings → Database → Connection string → URI (direct, port 5432) | `postgresql://postgres.[ref]:[password]@...:5432/postgres` | `DATABASE_MIGRATE_URL` |
| Same URI, but replace the user with `ledger_api` and the password with the one from step 3 | `postgresql://ledger_api:[password]@...:5432/postgres` | `DATABASE_URL` |
| Project Settings → API → Project URL | `https://[ref].supabase.co` | `SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_URL` |
| Project Settings → API → anon public key | long string | `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| Project Settings → API → JWT Settings | If it shows a JWKS/asymmetric key: use `https://[ref].supabase.co/auth/v1/.well-known/jwks.json` as `SUPABASE_JWKS_URL`. If it only shows a JWT Secret: put that in `SUPABASE_JWT_SECRET` instead. **Set one, not both.** | |

Note: on the direct URI the user is `postgres.[ref]` (with the project ref). For `DATABASE_URL`, use `ledger_api` on its own if the direct host is `db.[ref].supabase.co`, or `ledger_api.[ref]` if you're using the pooler host. Try the direct host first.

Then enable email sign-in: **Authentication → Providers → Email** → enabled. Under **Authentication → Email Templates**, confirm the "Magic Link" template contains `{{ .Token }}` (the 6-digit code) — the app uses codes, not links.

**Check:** you have every value in the table written down.

---

## Step 5 — Create `.env`

```powershell
cd C:\Github\ledger
copy .env.example .env
```

Open `.env` and fill in:

- `DATABASE_URL`, `DATABASE_MIGRATE_URL`, `SUPABASE_URL`, and either `SUPABASE_JWKS_URL` or `SUPABASE_JWT_SECRET` (from step 4)
- `FIELD_ENCRYPTION_KEY` — generate it:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
  Paste the output. **Back this key up somewhere safe.** If it's lost, every encrypted field in the database is unreadable forever.
- `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (from step 4)
- `EXPO_PUBLIC_API_URL` — leave as `http://localhost:8080` for now; step 9 changes it.

Leave blank: `ANTHROPIC_API_KEY`, `SENTRY_DSN`, `EXPO_ACCESS_TOKEN`, `DATABASE_CA_CERT`, `EXPO_PUBLIC_EAS_PROJECT_ID` (step 8 fills this one).

There is only ever **one** `.env`, at the repo root. The API, the migration script, and the Expo config each walk up from wherever they were launched until they find `pnpm-workspace.yaml`, and load the `.env` next to it — so `pnpm dev:api` from the root and `tsx src/db/migrate.ts` from `packages/api` see the same file. A variable already set in the real environment always wins over the file, which is how CI runs with no `.env` at all.

**Check:** `.env` exists, is not tracked by git (`git status` doesn't show it), and has no empty value for the required fields listed above.

---

## Step 6 — Install and migrate

```powershell
corepack enable
pnpm install
pnpm --filter @ledger/shared build
pnpm db:migrate
```

Expected last line: `migrations applied`.

If `pnpm install` fails on React Native peer versions:

```powershell
cd apps\client
npx expo install --fix
cd ..\..
pnpm install
```

**Check:** in Supabase → Table Editor you see `predictions`, `priors`, `body_states`, `reinterpretations`, `journal_entries`, `crisis_events`, `clinician_client_links`, `devices`, `users`, and the `predictions` table has `exit_forecast` and `exit_actual` columns.

Optional but recommended — prove RLS is live on the real database:

```powershell
pnpm test:rls
```

Expected: `24 passed`. (This truncates tables; fine while the database is empty.)

---

## Step 7 — Run the API

```powershell
pnpm dev:api
```

Open http://localhost:8080/health in a browser.

**Check:** `{"ok":true,"service":"ledger-api"}`. Leave this terminal running.

---

## Step 8 — Set up Expo / EAS

In a **second** terminal:

```powershell
npm i -g eas-cli
eas login
cd C:\Github\ledger\apps\client
eas init
```

`eas init` prints a project ID. Put it in `.env` as `EXPO_PUBLIC_EAS_PROJECT_ID`.

On your phone, install **Expo Go** (App Store / Play Store).

**Check:** `eas whoami` prints your username; `.env` has the project ID.

---

## Step 9 — Point the phone at your PC

Your phone can't reach `localhost`.

```powershell
ipconfig
```

Find the IPv4 address under your Wi-Fi adapter (something like `192.168.1.42`). In `.env`, set:

```
EXPO_PUBLIC_API_URL=http://192.168.1.42:8080
```

Restart the API terminal (Ctrl+C, then `pnpm dev:api` again) so it picks up nothing — it doesn't need this — but the client does, and `apps/client/app.config.ts` reads the root `.env` when Expo starts.

The first time the phone connects, Windows Firewall will prompt for Node. Allow it on **private** networks.

**Check:** from your phone's browser, open `http://192.168.1.42:8080/health` (your IP). You should see the same `{"ok":true}`.

---

## Step 10 — Run the client on your phone

Phone and PC on the same Wi-Fi.

```powershell
cd C:\Github\ledger
pnpm dev:client
```

Scan the QR code with the camera (iOS) or Expo Go (Android).

If the app refuses to load with an error about a native module, it's `expo-notifications`. Open `apps\client\app.config.ts`, comment out the line `['expo-notifications', { sounds: [] }],`, restart `pnpm dev:client`. Reminders won't work in Expo Go then; they will in a dev build later.

**Check:** the sign-in screen appears on the phone.

---

## Step 11 — Sign in

Enter your email → **Send me a code** → check your email for a 6-digit code → enter it → **Sign in**.

**Check:** you land on the **Open** screen with "Up to date." at the top. In Supabase → Table Editor → `users`, there is one row with your UUID and role `client`. No email is stored there — that's correct.

---

## Step 12 — The milestone test

1. Put the phone in **airplane mode**.
2. Tap **Write a prediction**. Fill in a situation, what you expect, and a confidence. Optionally pick a rule and an exit forecast. Save.
3. On the Open screen, tap the prediction → **Check it**. Fill in what happened, whether it matched, how you know, surprise, and whether you were there for it. If you named an exit, answer **Did you?** Save.
4. Open the **Ledger** tab. You should see the sentence, computed with no network.
5. Turn airplane mode **off**. Return to the Open screen. The status line should change from "Offline" to "Syncing…" to "Up to date."

**Check:** in Supabase → Table Editor → `predictions`, one row. `situation_enc` shows as bytes, not readable text. `confidence` and `outcome_verdict` are readable. That is the milestone.

---

## Step 13 — Commit any local fixes

If step 6 or 10 required changes (`expo install --fix`, the notifications plugin), commit them:

```powershell
git checkout -b fix/local-setup
git add -A
git commit -m "Local setup fixes"
git push -u origin fix/local-setup
```

Open a PR, merge when green.

---

## What's deliberately not in this list

These are milestone 2 and need their own decisions first:

- Deploying the API to Render (needs the Dockerfile, the env vars above, and a Supabase pooler URL).
- `ANTHROPIC_API_KEY` for the "why" and reflect endpoints — the client doesn't call them yet.
- Sentry.
- The clinician web app.
- A dev build via `eas build --profile development` for real push notifications.
- The BAA and privacy-notice items in `docs/data-path.md` → "Open items". Required before anyone other than you uses this.

## If something fails

Copy the exact terminal output and the step number. Don't paste `.env` — the values in it are secrets.
