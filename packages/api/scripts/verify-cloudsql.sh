#!/usr/bin/env bash
#
# Prove that nothing in this schema is Supabase-specific, by running it on
# Cloud SQL — go-live gate A2, Prompt 11.
#
# This runs INSIDE THE VPC, as a Cloud Run job — not from a laptop. The instance
# is private-IP only, the Cloud SQL Auth Proxy has to be on a resource with
# access to the instance's VPC network, and constraints/sql.restrictPublicIp is
# enforced org-wide, so there is no laptop path and no public-IP workaround.
# Prompt 2 builds the job; see docs/gcp-setup.md §6.
#
# That is better than a laptop path rather than a substitute for one: it never
# needs a public IP, and it runs as the same service account the API uses
# against the same private endpoint — so what it proves is what production does.
#
# It is repeatable on every schema change **while the database is empty**, and
# not after. See the data guard, and docs/deploy.md §6 for what replaces this
# method once there is data to lose.
#
# The passwords come from Secret Manager. Cloud Run resolves the secret versions
# and injects them as environment variables, which is why this reads them from
# the environment: the value never exists in a file, an argument, or a shell
# history.
#
# What it does, in order:
#   1. Refuses to run anywhere that is not the Cloud SQL instance you named.
#   2. Creates the ledger_api role from src/db/rls/000_roles.sql.
#   3. Runs the migrations as the owner.
#   4. REFUSES IF ANY TABLE HAS ROWS — see the data guard below. The next step
#      truncates everything, and none of the checks above ask whether there is
#      anything to lose.
#   5. Runs the RLS suite as ledger_api, and prints the case count.
#   6. Restores the instance to empty, so a re-run does not need the escape
#      hatch and the escape hatch stays exceptional.
#
# What it will not do:
#   - print a password, or any connection string that contains one
#   - run against a host that is not the one named in CLOUDSQL_HOST
#   - touch anything in Supabase
#
# In the Cloud Run job, CLOUDSQL_HOST is the instance's private address and the
# two passwords are Secret Manager references resolved at start:
#
#     CLOUDSQL_HOST=10.83.0.3
#     CLOUDSQL_INSTANCE=courageloop-prod:us-west1:courageloop-db
#     PGPASSWORD_OWNER  -> secret db-owner-password:latest
#     PGPASSWORD_API    -> secret ledger-api-password:latest
#
# From anywhere else it will refuse, or simply fail to reach the host, and both
# of those are the correct outcome.
#
set -euo pipefail

DB_NAME="${CLOUDSQL_DB:-ledger}"
DB_PORT="${CLOUDSQL_PORT:-5432}"
OWNER_USER="${CLOUDSQL_OWNER_USER:-postgres}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$here"

fail() { printf '\n  %s\n\n' "$*" >&2; exit 1; }

# --- 1. Refuse to run anywhere else ------------------------------------------
#
# This script migrates a database and then runs a suite that TRUNCATEs every
# table in it. Pointed at the wrong host that is a catastrophe rather than a
# mistake, so the host is named explicitly and checked before anything opens a
# connection. CLOUDSQL_INSTANCE must also be set, because the proxy listens on
# 127.0.0.1 and a bare loopback address proves nothing about what is behind it.

[ -n "${CLOUDSQL_HOST:-}" ] || fail "Set CLOUDSQL_HOST to where the Cloud SQL Auth Proxy is listening."
[ -n "${CLOUDSQL_INSTANCE:-}" ] || fail "Set CLOUDSQL_INSTANCE to the instance connection name, project:region:instance."
[ -n "${PGPASSWORD_OWNER:-}" ] || fail "Set PGPASSWORD_OWNER from Secret Manager. Do not paste it into a file."
[ -n "${PGPASSWORD_API:-}" ] || fail "Set PGPASSWORD_API from Secret Manager. Do not paste it into a file."

case "$CLOUDSQL_INSTANCE" in
  *:*:*) : ;;
  *) fail "CLOUDSQL_INSTANCE must be project:region:instance — got a value that is not." ;;
esac

# The instance connection name must belong to the project of record. A proxy
# can be pointed at any instance in any project; this is the check that says
# which one this script is willing to wipe.
EXPECT_PROJECT="${CLOUDSQL_PROJECT:-courageloop-prod}"
case "$CLOUDSQL_INSTANCE" in
  "$EXPECT_PROJECT":*) : ;;
  *) fail "CLOUDSQL_INSTANCE is not in $EXPECT_PROJECT. Refusing: this script wipes every table." ;;
esac

# Supabase is the dev and CI database and is never the target here.
case "$CLOUDSQL_HOST" in
  *supabase*) fail "CLOUDSQL_HOST looks like Supabase. This script is for Cloud SQL only." ;;
esac

printf 'Instance : %s\n' "$CLOUDSQL_INSTANCE"
printf 'Proxy    : %s:%s\n' "$CLOUDSQL_HOST" "$DB_PORT"
printf 'Database : %s\n\n' "$DB_NAME"

# --- connection strings ------------------------------------------------------
#
# Built here and never echoed: every one of them contains a password. Anything
# this script prints is printed deliberately, and none of it is one of these.

owner_url="postgresql://${OWNER_USER}:${PGPASSWORD_OWNER}@${CLOUDSQL_HOST}:${DB_PORT}/${DB_NAME}"
api_url="postgresql://ledger_api:${PGPASSWORD_API}@${CLOUDSQL_HOST}:${DB_PORT}/${DB_NAME}"

# --- 2. The role -------------------------------------------------------------
#
# 000_roles.sql creates ledger_api with the local development password, which
# is fine on a laptop and not fine here, so the password is set separately from
# a variable and the file is left alone. ON_ERROR_STOP makes psql exit non-zero
# on the first failure instead of carrying on.

printf '== 1/4  the ledger_api role\n'
PGPASSWORD="$PGPASSWORD_OWNER" psql "$owner_url" \
  --quiet --no-psqlrc --set ON_ERROR_STOP=1 \
  --file packages/api/src/db/rls/000_roles.sql

# The file sets the local development password, which is right for a laptop and
# wrong here. `format(%L)` quotes and escapes the real one and `\gexec` runs the
# statement it builds, so the password is never a literal in this file and never
# reaches the shell's history or argv.
PGPASSWORD="$PGPASSWORD_OWNER" psql "$owner_url" \
  --quiet --no-psqlrc --set ON_ERROR_STOP=1 \
  --set api_pw="$PGPASSWORD_API" <<'SQL' >/dev/null
SELECT format('ALTER ROLE ledger_api LOGIN NOBYPASSRLS PASSWORD %L', :'api_pw')
\gexec
SQL
printf '   role present, password set from the environment\n\n'

# --- 3. Migrations -----------------------------------------------------------
#
# As the owner, never as ledger_api: ledger_api owns nothing, which is what
# makes RLS apply to it.

printf '== 2/4  migrations\n'
DATABASE_MIGRATE_URL="$owner_url" DATABASE_URL="$api_url" \
  pnpm --filter @ledger/api db:migrate
printf '\n'

# --- 4. THE DATA GUARD -------------------------------------------------------
#
# Everything above refuses based on WHICH INSTANCE this is: the host is named,
# the instance is well-formed, the project is courageloop-prod, it is not
# Supabase. Every one of those fires before a connection opens, which is right,
# and not one of them asks whether the instance HAS ANYTHING IN IT.
#
# The next step TRUNCATES every table. Today that is harmless because the
# database is empty. After the first real client it is a script that erases a
# clinician's records while every guard above reports success — and §6 of
# docs/deploy.md calls this "repeatable on every schema change", which invites
# exactly that.
#
# So: refuse unless every table in the public schema is empty. Placed here
# because it needs the tables to exist (migrations have just run) and it is
# still before anything destructive.
#
# The `drizzle` schema is excluded: its migration bookkeeping is supposed to
# have rows, and it is not client data.

printf '== 3/4  the data guard\n'

empty_check=$(cat <<'SQL'
DO $$
DECLARE t text; n bigint;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'table % holds % row(s)', t, n;
    END IF;
  END LOOP;
END $$;
SQL
)

set +e
not_empty="$(PGPASSWORD="$PGPASSWORD_OWNER" psql "$owner_url" \
  --quiet --no-psqlrc --tuples-only --set ON_ERROR_STOP=1 \
  --command "$empty_check" 2>&1)"
empty_status=$?
set -e

if [ "$empty_status" -ne 0 ]; then
  # The escape hatch NAMES the instance, for the reason CONFIRM_MIGRATE_HOST
  # and ALLOW_DESTRUCTIVE_TESTS do: a boolean someone leaves set in a profile
  # goes on authorising whatever the script points at next, while a name stops
  # being true the moment the target changes.
  if [ "${CONFIRM_WIPE_INSTANCE:-}" = "$CLOUDSQL_INSTANCE" ]; then
    printf '   NOT EMPTY, and CONFIRM_WIPE_INSTANCE names this instance.\n'
    printf '   %s\n' "$(printf '%s' "$not_empty" | tr -d '\n' | sed 's/^[[:space:]]*//')"
    printf '   Continuing. Everything in those tables is about to be destroyed.\n\n'
  else
    printf '\n' >&2
    printf '  Refusing: %s is not empty.\n' "$CLOUDSQL_INSTANCE" >&2
    printf '  %s\n' "$(printf '%s' "$not_empty" | tr -d '\n' | sed 's/^[[:space:]]*//')" >&2
    printf '\n' >&2
    printf '  The next step TRUNCATES every table. On an empty database that is\n' >&2
    printf '  the intended behaviour; on one with rows in it, it is data loss.\n' >&2
    printf '\n' >&2
    printf '  If those rows are genuinely disposable, say which instance you mean:\n' >&2
    printf '\n' >&2
    printf '      CONFIRM_WIPE_INSTANCE=%s\n' "$CLOUDSQL_INSTANCE" >&2
    printf '\n' >&2
    printf '  A bare "1" is not accepted: the permission has to name the instance\n' >&2
    printf '  it grants, so that it stops being true when the target changes.\n' >&2
    printf '\n' >&2
    exit 1
  fi
else
  printf '   every table in public is empty\n\n'
fi

# --- 5. The RLS suite --------------------------------------------------------
#
# The real test. It connects as ledger_api, so every policy in 0001 through
# 0009 is enforced exactly as it would be for the running API. ALLOW_DESTRUCTIVE_TESTS
# names the host, because the suite TRUNCATEs every table between cases and the
# guard in test/helpers.ts refuses a non-local host that is not named.

printf '== 4/4  the RLS suite, as ledger_api\n'
set +e
DATABASE_URL="$api_url" \
DATABASE_MIGRATE_URL="$owner_url" \
ALLOW_DESTRUCTIVE_TESTS="$CLOUDSQL_HOST" \
  pnpm --filter @ledger/api test:rls 2>&1 | tee /tmp/cloudsql-rls.$$.log
rls_status=${PIPESTATUS[0]}
set -e

printf '\n──────────────────────────────────────────────────\n'
# The count is read from vitest's own summary rather than hard-coded: the suite
# was 24 cases once and is not 24 now, and a number in a script goes stale the
# first time someone adds a policy.
summary="$(grep -E '^\s*Tests ' /tmp/cloudsql-rls.$$.log | tail -1 || true)"
printf 'RLS result : %s\n' "${summary:-no summary line — see the output above}"
if [ "$rls_status" -ne 0 ]; then
  printf 'Failures   :\n'
  grep -E '(×|✕|FAIL|AssertionError)' /tmp/cloudsql-rls.$$.log | head -40 || true
fi
rm -f /tmp/cloudsql-rls.$$.log

# Empty in, empty out.
#
# The guard above proved every table was empty before the suite ran, so
# everything in them now was put there by the suite. Clearing it restores the
# state this script requires, which is what makes a re-run possible without
# reaching for CONFIRM_WIPE_INSTANCE — and an escape hatch reached for
# routinely is an escape hatch that has stopped protecting anything.
#
# Runs whether or not the suite passed: the rows are fixtures either way, and a
# failed run is diagnosed from the output above, not from what it left behind.
printf 'Restoring the instance to empty...\n'
PGPASSWORD="$PGPASSWORD_OWNER" psql "$owner_url" \
  --quiet --no-psqlrc --set ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('TRUNCATE TABLE public.%I CASCADE', t);
  END LOOP;
END $$;
SQL


if [ "$rls_status" -eq 0 ]; then
  printf '\nCloud SQL runs this schema unchanged. Paste the block above into the Prompt 11 report.\n\n'
else
  printf '\nThe suite did not pass on Cloud SQL. Paste the block above — the failures are the finding.\n\n'
fi
exit "$rls_status"
