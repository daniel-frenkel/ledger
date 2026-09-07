# ADR 001 — Supabase Auth from day one; API connects as an RLS-enforced role

**Status:** accepted · 2026-09-07

## Context
The app must scope every query by user and role at both the API layer and the database. The easy path — API uses the Supabase service-role key and trusts its own `WHERE user_id = …` — makes RLS decorative.

## Decision
- Supabase Auth issues JWTs. The API verifies them (JWKS preferred, HS256 fallback) and extracts `sub` and a custom `role` claim (`client` | `clinician`). Role is also mirrored in `users.role`; the DB value wins on mismatch.
- The API connects to Postgres as `ledger_api`, a role **without** `BYPASSRLS`. Every request runs inside a transaction that sets `request.user_id` and `request.role` via `set_config(..., true)`; RLS policies read `current_setting('request.user_id', true)`.
- The service-role key and the `postgres` superuser are used only by migrations, never by the running API.

## Consequences
- A bug that forgets a `WHERE user_id` returns zero rows, not another user's rows.
- Policies are testable: the RLS suite connects as `ledger_api`, sets the config, and asserts visibility.
- Slight overhead per request (one `SELECT set_config`); acceptable.
- Moving to Cloud Run + Supabase later changes `DATABASE_URL` only.
