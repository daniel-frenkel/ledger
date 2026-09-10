-- Research readiness — docs/proposal-03-research-readiness.md.
--
-- Nothing here is a study. It is the set of columns and documents without
-- which a study could not be run later: every claim a paper would make — the
-- prediction was written before the event, symptoms changed, the protocol
-- started on this date, the participant agreed to this — has to be a row,
-- written at the time, by the person entitled to write it.
--
-- The proposal calls this 0004 because it was drafted to land beside 0003.
-- It is 0009 because five migrations went first; nothing else about it moved.

-- ---------------------------------------------------------------------------
-- 1. Provenance on every row
--
-- `created_at` and `client_updated_at` are the client's clock. `received_at`
-- is the server's, set once on insert and immutable thereafter. The pair is
-- the evidence that a prediction existed before its outcome — the study's
-- central methodological claim, and the one a reviewer will press hardest,
-- because a client's clock is a client's to set.
--
-- `app_version` makes a result reproducible against a build: the calibration
-- functions in packages/shared change, and a number computed by one version is
-- not the same claim as the same number computed by another.
-- ---------------------------------------------------------------------------
ALTER TABLE "predictions" ADD COLUMN "app_version" text;
--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "priors" ADD COLUMN "app_version" text;
--> statement-breakpoint
ALTER TABLE "priors" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "body_states" ADD COLUMN "app_version" text;
--> statement-breakpoint
ALTER TABLE "body_states" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "reinterpretations" ADD COLUMN "app_version" text;
--> statement-breakpoint
ALTER TABLE "reinterpretations" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "app_version" text;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "crisis_events" ADD COLUMN "app_version" text;
--> statement-breakpoint
ALTER TABLE "crisis_events" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "formulations" ADD COLUMN "app_version" text;
--> statement-breakpoint
ALTER TABLE "formulations" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "measures" ADD COLUMN "app_version" text;
--> statement-breakpoint
ALTER TABLE "measures" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;

--> statement-breakpoint
-- One trigger, every table. It fires on UPDATE only: the insert takes the
-- default, and after that the column is not the writer's to move.
CREATE OR REPLACE FUNCTION received_at_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'received_at is the server clock and cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER predictions_received_at_immutable BEFORE UPDATE ON predictions
  FOR EACH ROW EXECUTE FUNCTION received_at_immutable();
--> statement-breakpoint
CREATE TRIGGER priors_received_at_immutable BEFORE UPDATE ON priors
  FOR EACH ROW EXECUTE FUNCTION received_at_immutable();
--> statement-breakpoint
CREATE TRIGGER body_states_received_at_immutable BEFORE UPDATE ON body_states
  FOR EACH ROW EXECUTE FUNCTION received_at_immutable();
--> statement-breakpoint
CREATE TRIGGER reinterpretations_received_at_immutable BEFORE UPDATE ON reinterpretations
  FOR EACH ROW EXECUTE FUNCTION received_at_immutable();
--> statement-breakpoint
CREATE TRIGGER journal_entries_received_at_immutable BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION received_at_immutable();
--> statement-breakpoint
CREATE TRIGGER crisis_events_received_at_immutable BEFORE UPDATE ON crisis_events
  FOR EACH ROW EXECUTE FUNCTION received_at_immutable();

-- ---------------------------------------------------------------------------
-- 2. measures — the link, and the care-record line
--
-- The table landed in 0006 with Prompt 14; this extends it.
--
-- A measure taken under an active clinician link is part of the care record
-- and survives the client's purge the way a formulation does. A measure with
-- no link is the client's own data and goes with the account. The column is
-- what makes that distinguishable at purge time rather than a guess about
-- `administered_by`, which says who typed it, not whose record it is.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
ALTER TABLE "measures" ADD COLUMN "link_id" uuid;
--> statement-breakpoint
-- CASCADE, like formulations.link_id: a link that is deleted takes the care
-- record written against it. The purge never deletes a link, so in practice
-- this fires only if a link is removed deliberately.
ALTER TABLE "measures" ADD CONSTRAINT "measures_link_id_links_id_fk"
  FOREIGN KEY ("link_id") REFERENCES "clinician_client_links"("id") ON DELETE cascade;
--> statement-breakpoint
-- A clinician-administered measure is always under a link; a self-administered
-- one may or may not be, because a client can take an instrument on their own
-- while linked. So the constraint runs one way only.
ALTER TABLE "measures" ADD CONSTRAINT "measures_clinician_has_link"
  CHECK ("administered_by" = 'client' OR "link_id" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- The purge, revisited for measures.
--
-- 0007 never deletes a measure, because nothing it deletes cascades to one.
-- Now the line can be drawn: a measure taken under a link is part of the care
-- record and stays with the clinician who took it; a measure with no link is
-- the client's own and goes with the account.
--
-- The DELETE verb on measures is new, so it gets the same treatment as every
-- other client table in 0007: a RESTRICTIVE policy making the system role a
-- necessary condition, then the permissive one that is the whole of the scope.
-- Without the restrictive one, 0006's measures_client_insert is FOR INSERT
-- only and would not have permitted a delete — but a future FOR ALL policy
-- would, and this is the guard that means it could not.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
GRANT DELETE ON measures TO ledger_api;
--> statement-breakpoint
CREATE POLICY measures_delete_system_only ON measures AS RESTRICTIVE
  FOR DELETE TO ledger_api USING (app_role() = 'system');
--> statement-breakpoint
CREATE POLICY measures_system_purge ON measures FOR DELETE TO ledger_api
  USING (app_purgeable_user(client_id) AND link_id IS NULL);
--> statement-breakpoint
CREATE POLICY measures_system_purge_read ON measures FOR SELECT TO ledger_api
  USING (app_purgeable_user(client_id));

-- ---------------------------------------------------------------------------
-- 3. phase_events — the vertical line on a multiple-baseline graph
--
-- Append-only, clinician-written, and no note column: this table says when a
-- phase started, not how it went.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE TYPE "phase_kind" AS ENUM ('started', 'completed', 'paused', 'abandoned');
--> statement-breakpoint
CREATE TABLE "phase_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"clinician_id" uuid NOT NULL,
	"formulation_id" uuid,
	"protocol_slug" text NOT NULL,
	-- The protocol's own phase number. 0 is the gates.
	"phase" smallint NOT NULL,
	"kind" "phase_kind" NOT NULL,
	-- The clinician's date, not the server's: a phase started on Tuesday and
	-- recorded on Thursday started on Tuesday. Bounded so it is a correction
	-- rather than a rewrite.
	"at" timestamp with time zone NOT NULL,
	"app_version" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phase_events_phase_range" CHECK ("phase" BETWEEN 0 AND 20),
	CONSTRAINT "phase_events_slug_shape" CHECK ("protocol_slug" ~ '^[a-z0-9-]{1,64}$'),
	CONSTRAINT "phase_events_not_self" CHECK ("clinician_id" <> "client_id"),
	CONSTRAINT "phase_events_backdate_limit"
	  CHECK ("at" >= "created_at" - interval '14 days' AND "at" <= "created_at" + interval '1 day')
);
--> statement-breakpoint
ALTER TABLE "phase_events" ADD CONSTRAINT "phase_events_client_id_users_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "phase_events" ADD CONSTRAINT "phase_events_clinician_id_users_id_fk"
  FOREIGN KEY ("clinician_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "phase_events" ADD CONSTRAINT "phase_events_formulation_id_fk"
  FOREIGN KEY ("formulation_id") REFERENCES "formulations"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "phase_events_client_at_idx" ON "phase_events" ("client_id", "at");

--> statement-breakpoint
CREATE OR REPLACE FUNCTION phase_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'phase events are append-only' USING ERRCODE = 'check_violation';
END
$$;
--> statement-breakpoint
CREATE TRIGGER phase_events_append_only BEFORE UPDATE ON phase_events
  FOR EACH ROW EXECUTE FUNCTION phase_events_append_only();

-- ---------------------------------------------------------------------------
-- 4. Research consent
--
-- Separate from clinician sharing in every way: different screen, different
-- flags, and withdrawing one does not touch the other. Withdrawal sets the
-- withdrawn timestamp and leaves the consent timestamp as history — the fact
-- that someone consented on a date does not stop being true.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "research_consent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "research_consent_withdrawn_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "research_consent_version" text;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_research_consent_pair"
  CHECK (("research_consent_at" IS NULL) = ("research_consent_version" IS NULL));
--> statement-breakpoint
-- Withdrawal without consent is not a state anyone can be in.
ALTER TABLE "users" ADD CONSTRAINT "users_research_withdrawn_needs_consent"
  CHECK ("research_consent_withdrawn_at" IS NULL OR "research_consent_at" IS NOT NULL);
--> statement-breakpoint
-- Column-level, like timezone: the user writes their own row and nothing else
-- can. A clinician has no route to these columns and no grant on them, which
-- is the point — consent that a clinician could set is not consent.
GRANT UPDATE ("research_consent_at", "research_consent_withdrawn_at", "research_consent_version")
  ON users TO ledger_api;

--> statement-breakpoint
-- Consented *right now*: consent given and not withdrawn. Withdrawal is
-- immediate and removes someone from every future export, which is what the
-- consent screen promises, so the check is evaluated at read time rather than
-- captured when a run starts.
--
-- SECURITY DEFINER, like app_link_allows: it reads `users`, and a policy whose
-- meaning depended on the caller's own view of `users` would be a policy that
-- changed with the caller.
CREATE OR REPLACE FUNCTION app_research_consented(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_role() = 'system' AND EXISTS (
    SELECT 1 FROM users u
     WHERE u.id = p_user
       AND u.research_consent_at IS NOT NULL
       AND u.research_consent_withdrawn_at IS NULL
       AND u.deleted_at IS NULL
  )
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_research_consented(uuid) TO ledger_api;

-- ---------------------------------------------------------------------------
-- 5. usage_events
--
-- Five columns and no sixth. No payload, no entity id, no text of any kind:
-- this table answers "did they open the app" and must never become able to
-- answer "and what did they write". A test asserts the column list.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE TYPE "usage_kind" AS ENUM (
  'app_open', 'prediction_created', 'prediction_resolved', 'ledger_viewed',
  'sync_completed', 'crisis_card_shown', 'settings_opened'
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "usage_kind" NOT NULL,
	"app_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "usage_events_user_created_idx" ON "usage_events" ("user_id", "created_at");

-- ---------------------------------------------------------------------------
-- 6. exports — the log of what left
--
-- Run id, timestamp, participant count, allowlist hash. Nothing about who: an
-- export log that named its participants would defeat the export's own
-- pseudonymisation.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"participant_count" integer NOT NULL,
	"allowlist_sha256" bytea NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	CONSTRAINT "exports_allowlist_sha256_len" CHECK (octet_length("allowlist_sha256") = 32),
	CONSTRAINT "exports_participant_count_sane" CHECK ("participant_count" >= 0)
);

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
--> statement-breakpoint
GRANT SELECT, INSERT ON phase_events TO ledger_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON usage_events TO ledger_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON exports TO ledger_api;
--> statement-breakpoint
ALTER TABLE "phase_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "exports" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
-- phase_events: clinician-written through an active link; the client reads
-- their own, because a phase is a fact about their treatment.
CREATE POLICY phase_events_clinician_insert ON phase_events FOR INSERT TO ledger_api
  WITH CHECK (
    app_role() = 'clinician'
    AND clinician_id = app_user_id()
    AND app_link_allows(client_id, 'any')
  );
--> statement-breakpoint
CREATE POLICY phase_events_clinician_select ON phase_events FOR SELECT TO ledger_api
  USING (app_role() = 'clinician' AND clinician_id = app_user_id() AND app_link_allows(client_id, 'any'));
--> statement-breakpoint
CREATE POLICY phase_events_client_select ON phase_events FOR SELECT TO ledger_api
  USING (client_id = app_user_id());
--> statement-breakpoint
-- Consented-only, not blanket: the system role's reason to read this table is
-- the export, and the export is consented-only by construction.
CREATE POLICY phase_events_system_select ON phase_events FOR SELECT TO ledger_api
  USING (app_research_consented(client_id));

--> statement-breakpoint
-- usage_events: the user writes their own, and only the system reads. Not the
-- clinician — how often someone opens an app is not clinical information and
-- would become a stick.
CREATE POLICY usage_events_own_insert ON usage_events FOR INSERT TO ledger_api
  WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY usage_events_system_select ON usage_events FOR SELECT TO ledger_api
  USING (app_research_consented(user_id));

--> statement-breakpoint
-- exports: written and read by the system role alone.
CREATE POLICY exports_system_all ON exports FOR SELECT TO ledger_api
  USING (app_role() = 'system');
--> statement-breakpoint
CREATE POLICY exports_system_insert ON exports FOR INSERT TO ledger_api
  WITH CHECK (app_role() = 'system');

--> statement-breakpoint
-- The export reads client rows as the system role. Until now the system role
-- could see only what it was about to purge; these give it read access to the
-- tables the allowlist covers, **for consented participants only**, so that
-- "consented-only" is enforced by the database rather than by remembering to
-- write the right WHERE clause. A withdrawn participant becomes invisible to
-- the export the moment they withdraw, with nothing to re-run.
CREATE POLICY predictions_research_select ON predictions FOR SELECT TO ledger_api
  USING (app_research_consented(user_id));
--> statement-breakpoint
CREATE POLICY priors_research_select ON priors FOR SELECT TO ledger_api
  USING (app_research_consented(user_id));
--> statement-breakpoint
CREATE POLICY body_states_research_select ON body_states FOR SELECT TO ledger_api
  USING (app_research_consented(user_id));
--> statement-breakpoint
CREATE POLICY reinterpretations_research_select ON reinterpretations FOR SELECT TO ledger_api
  USING (app_research_consented(user_id));
--> statement-breakpoint
CREATE POLICY journal_entries_research_select ON journal_entries FOR SELECT TO ledger_api
  USING (app_research_consented(user_id));
--> statement-breakpoint
CREATE POLICY crisis_events_research_select ON crisis_events FOR SELECT TO ledger_api
  USING (app_research_consented(user_id));
--> statement-breakpoint
CREATE POLICY prediction_priors_research_select ON prediction_priors FOR SELECT TO ledger_api
  USING (app_research_consented(user_id));
--> statement-breakpoint
CREATE POLICY measures_research_select ON measures FOR SELECT TO ledger_api
  USING (app_research_consented(client_id));

-- ---------------------------------------------------------------------------
-- The export writes its own audit line.
--
-- 0008's insert policy requires actor_id = app_user_id(), which is null in the
-- system context — so the export could read client rows and leave no trace,
-- which is the one thing the access log exists to prevent. The system role may
-- now write a line about itself, and only about itself: actor_role must be
-- 'system', so this cannot be used to forge a line naming a person.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY access_log_system_insert ON access_log FOR INSERT TO ledger_api
  WITH CHECK (app_role() = 'system' AND actor_role = 'system');
