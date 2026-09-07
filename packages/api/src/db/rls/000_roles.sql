-- Roles for the API. Run once per database, as a superuser / the Supabase
-- `postgres` role. Docker picks this up automatically on first init; on
-- Supabase run it from the SQL editor, then set DATABASE_URL to connect as
-- ledger_api.
--
-- ledger_api: what the running API connects as. LOGIN, NOBYPASSRLS. It owns
-- nothing, so RLS applies to every table it touches.
--
-- Migrations run as the database owner (postgres), never as ledger_api.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_api') THEN
    CREATE ROLE ledger_api LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE
      PASSWORD 'ledger_api'; -- CHANGE THIS outside local dev
  END IF;
END
$$;

GRANT CONNECT ON DATABASE ledger TO ledger_api;
