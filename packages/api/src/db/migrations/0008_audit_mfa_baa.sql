-- Audit log, clinician MFA, and the BAA gate — go-live gate B1, B2, A1.
--
-- RLS decides who *can* read a client's rows. Nothing until now recorded who
-- *did*. That is the gap B1 names, and it is the one a HIPAA risk analysis
-- asks about first: a policy is a control, an access log is evidence.

-- ---------------------------------------------------------------------------
-- B1 — access_log
--
-- Written inside withUser, on the same transaction as the read it records, so
-- a read that is rolled back leaves no line claiming it happened.
--
-- There is no content column and there will not be one. The whole value of
-- this table is that it can be kept for six years without becoming another
-- copy of the ledger — it holds who, whose, which table, how many rows, when.
-- A test asserts the column list, so adding a column that could hold prose
-- fails rather than passing review.
--
-- `table_name`, not `table`: the gate writes `table`, which is reserved in
-- SQL and would need quoting at every reference in every query for the rest of
-- the project's life. The name is the only deviation.
-- ---------------------------------------------------------------------------
CREATE TABLE "access_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	-- Whose rows were read. Null for a read that is not about one client,
	-- such as a research export covering a cohort.
	"client_id" uuid,
	"table_name" text NOT NULL,
	"action" text NOT NULL,
	"row_count" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_log_action_known" CHECK ("action" IN ('read', 'export')),
	CONSTRAINT "access_log_row_count_sane" CHECK ("row_count" >= 0),
	CONSTRAINT "access_log_actor_role_known" CHECK ("actor_role" IN ('client', 'clinician', 'system'))
);
--> statement-breakpoint
-- No foreign key to users on actor_id or client_id, deliberately. This table
-- outlives the accounts it names: retention is six years, an account can be
-- deleted in thirty days, and an audit record that disappears with the person
-- it is about is not an audit record. It also means the tombstone does not
-- have to carry the log's weight.
CREATE INDEX "access_log_client_at_idx" ON "access_log" ("client_id", "at");
--> statement-breakpoint
CREATE INDEX "access_log_actor_at_idx" ON "access_log" ("actor_id", "at");

--> statement-breakpoint
-- Append-only, and more strictly than the other append-only tables: there is
-- no UPDATE or DELETE grant at all, so the trigger is the second lock.
CREATE OR REPLACE FUNCTION access_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the access log is append-only' USING ERRCODE = 'check_violation';
END
$$;
--> statement-breakpoint
CREATE TRIGGER access_log_append_only BEFORE UPDATE OR DELETE ON access_log
  FOR EACH ROW EXECUTE FUNCTION access_log_append_only();

--> statement-breakpoint
GRANT SELECT, INSERT ON access_log TO ledger_api;
--> statement-breakpoint
ALTER TABLE "access_log" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
-- Anyone may write a line about their own reading. Nobody may write one about
-- anyone else's: an audit log that an actor can forge a line into, naming
-- another actor, is worse than none.
CREATE POLICY access_log_actor_insert ON access_log FOR INSERT TO ledger_api
  WITH CHECK (actor_id = app_user_id() AND actor_role = app_role());

--> statement-breakpoint
-- Only the system role reads it. Not the clinician who wrote the lines, and
-- not the client the lines are about — a client asking "who looked at my
-- record" is a right worth building, and it is a request with a person on the
-- other end of it, not a SELECT. Until that exists, this table is for the
-- audit and nothing else.
CREATE POLICY access_log_system_select ON access_log FOR SELECT TO ledger_api
  USING (app_role() = 'system');

-- ---------------------------------------------------------------------------
-- A1 — the clinician BAA, recorded on the user row
--
-- Under HIPAA the vendor is a business associate of every clinician who uses
-- this with a client. The agreement has to exist before the first invite, so
-- the invite route reads these two columns and refuses without them.
--
-- Clinician-only in practice: a client is never shown a BAA and never has
-- these set. They are on `users` rather than a table of their own because
-- there is exactly one row per clinician and no history worth keeping beyond
-- which version was accepted and when — a new version is a new acceptance,
-- overwriting the old, and the version string is what says which.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "baa_accepted_version" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "baa_accepted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_baa_pair"
  CHECK (("baa_accepted_version" IS NULL) = ("baa_accepted_at" IS NULL));
--> statement-breakpoint
-- Writable by the user for their own row, and by nobody else. The existing
-- column-level grant covered (timezone, deleted_at); this extends it by
-- exactly these two, so no other column on users becomes writable.
-- users_self_update in 0001 scopes it to `id = app_user_id()`.
GRANT UPDATE ("baa_accepted_version", "baa_accepted_at") ON users TO ledger_api;

--> statement-breakpoint
-- users_system_scrub from 0007 already covers these: it is FOR UPDATE with no
-- column list, so the scrub reaches whatever the grant above allows. Nothing
-- to add there.

-- ---------------------------------------------------------------------------
-- The tombstone, revisited.
--
-- 0007 scrubs a purged account to id + deleted_at and nothing that says
-- anything about the person. These two columns are clinician-only and a
-- clinician row is never purged — DELETE /v1/me refuses a clinician outright,
-- because their formulations are a record they are keeping, not data they own.
-- They are added to the scrub anyway, for symmetry: a column that is never
-- reached by the scrub because of who happens to hold it is a column that
-- would be missed the day that changes.
-- ---------------------------------------------------------------------------
