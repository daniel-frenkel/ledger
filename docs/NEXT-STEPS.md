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
- `EXPO_PUBLIC_API_URL` — leave as `http://localhost:8080`; only the optional phone step changes it.

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

## Step 8 — Run the web app

`apps/web` is the milestone-1 client. No EAS, no Expo Go, no LAN IP dance.

In a **second** terminal:

```powershell
cd C:\Github\ledger
pnpm dev:web
```

Open http://localhost:5173 in a browser on this PC.

**Check:** the sign-in screen appears, and the API terminal shows no errors.

---

## Step 9 — On your phone (optional, and only on the same Wi-Fi)

Everything below works on the PC alone. You only need this step if you want the
app on your phone *before* it is deployed.

Vite serves on all interfaces, so the app is at `http://<your-PC-IP>:5173` and
the API at `http://<your-PC-IP>:8080`. Find the IP with `ipconfig`, then set
`EXPO_PUBLIC_API_URL` in `.env` to `http://<that-IP>:8080` and restart
`pnpm dev:web` so the client picks it up.

Windows Firewall blocks those ports inbound by default. Allowing them needs an
**administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Ledger dev (TCP 5173,8080, private)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173,8080 -Profile Private
```

Two things do **not** work over plain http from a LAN IP, and both wait for a
real deployment: **install to home screen** and **push notifications**. Both
require https. The offline test below works either way — the service worker is
also allowed on `localhost`.

**Check:** the sign-in screen appears in your phone's browser.

---

## Step 10 — Sign in

Enter your email → **Send me a code** → check your email for a 6-digit code → enter it → **Sign in**.

**Check:** you land on the **Open** screen with "Up to date." at the top. In Supabase → Table Editor → `users`, there is one row with your UUID and role `client`. No email is stored there — that's correct.

---

## Step 11 — The offline test, on the PC

This replaces the airplane-mode test; the browser does it better, because you
can toggle the network without touching the machine.

1. Open DevTools (F12) → **Network** tab → set the throttling dropdown to **Offline**.
2. Reload the page. It should still open — the service worker serves the app shell.
3. Write a prediction, then resolve it. Both save; the status line reads
   *"Offline — entries are saved here and will sync later."*
4. Open the **Ledger** tab. The sentence is computed locally, with no network.
5. Set the dropdown back to **No throttling**. The status line moves to
   *"Syncing…"* and then *"Up to date."*

**Check:** in Supabase → Table Editor → `predictions`, one row. `situation_enc`
is bytes, not readable text; `confidence` and `outcome_verdict` are readable.
That is the milestone.

---

## Step 12 — Commit any local fixes

If any step required local changes, commit them:

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
- Deploying `apps/web` so the phone can install it and receive push (both need https).
- The parked Expo client in `apps/client`: EAS, Expo Go, and a dev build for native push.
- The BAA and privacy-notice items in `docs/data-path.md` → "Open items". Required before anyone other than you uses this.

## If something fails

Copy the exact terminal output and the step number. Don't paste `.env` — the values in it are secrets.
