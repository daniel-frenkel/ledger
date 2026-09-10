-- "How much does this one count?" and the measures table.
--
-- docs/proposal-06-counts-for.md. The furnace's reinterpret move — accept the
-- disconfirming event, then re-describe it until it no longer counts — is
-- already captured as text. This captures the *amount* of the discount, as one
-- number asked at the moment of resolution.
--
-- The two halves belong together: `counts_for` is the per-miss measurement of
-- the reinterpret move, and the Immunization Scale in `measures` is the same
-- construct as a validated instrument at intervals. Proposal 03's hypothesis H3
-- reads them against each other, so they arrive in one migration.

ALTER TABLE "predictions" ADD COLUMN "counts_for" smallint;
--> statement-breakpoint
-- Nullable and skippable by design. An unanswered question is NULL, never 100:
-- "they did not say" and "it counted completely" are different facts and the
-- discount rate must not read the first as the second.
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_counts_for_range"
  CHECK ("counts_for" IS NULL OR ("counts_for" BETWEEN 0 AND 100));

--> statement-breakpoint
-- The summary view is rebuilt DROP/CREATE, as in 0002. `counts_for` is a
-- structured number carrying no prose, so it belongs in the summary a clinician
-- with share_predictions = false can see — the same reasoning that puts
-- confidence and the verdict there.
DROP VIEW IF EXISTS predictions_summary;
--> statement-breakpoint
CREATE VIEW predictions_summary WITH (security_barrier = true) AS
  SELECT p.id, p.user_id, p.confidence, p.revise_after_n, p.scheduled_for,
         p.resolved_at, p.outcome_verdict, p.outcome_source, p.surprise_rating,
         p.present_for_it, p.own_part, p.abandoned_at, p.abandon_reason,
         p.exit_forecast, p.exit_actual, p.counts_for,
         p.created_at, p.client_updated_at, p.updated_at, p.deleted_at
  FROM predictions p
  WHERE p.user_id = app_user_id()
     OR app_link_allows(p.user_id, 'calibration');
--> statement-breakpoint
GRANT SELECT ON predictions_summary TO ledger_api;

-- ---------------------------------------------------------------------------
-- measures — proposal 03 §2, arriving here for the Immunization Scale
--
-- Totals and subscales only. Item-level responses are deliberately not stored:
-- some items are sensitive in a way a total is not (PHQ-9 item 9 in
-- particular), and storing them would put the crisis rules in the position of
-- needing to read them. If item-level data is ever wanted it is a new
-- proposal, not a column.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE TABLE "measures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	-- Null when the client administered it to themselves.
	"clinician_id" uuid,
	"instrument" text NOT NULL,
	"score" numeric NOT NULL,
	-- Numeric values keyed by the instrument's published subscale names,
	-- validated against a per-instrument schema in packages/shared. No prose:
	-- a jsonb column is a tempting place to put a comment and this one may not.
	"subscales" jsonb,
	"administered_at" timestamp with time zone NOT NULL,
	"administered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measures_instrument_known" CHECK ("instrument" IN (
	  'phq9', 'gad7', 'pcl5', 'pdss', 'isi', 'ocir', 'shai', 'pg13', 'ims', 'sus', 'umars'
	)),
	CONSTRAINT "measures_administered_by_known" CHECK ("administered_by" IN ('client', 'clinician')),
	CONSTRAINT "measures_subscales_object" CHECK (
	  "subscales" IS NULL OR jsonb_typeof("subscales") = 'object'
	),
	-- A clinician-administered measure names the clinician; a self-administered
	-- one names nobody. The pair is the record of who was in the room.
	CONSTRAINT "measures_administered_by_matches" CHECK (
	  ("administered_by" = 'clinician' AND "clinician_id" IS NOT NULL)
	  OR ("administered_by" = 'client' AND "clinician_id" IS NULL)
	),
	CONSTRAINT "measures_not_self" CHECK ("clinician_id" IS NULL OR "clinician_id" <> "client_id")
);
--> statement-breakpoint
ALTER TABLE "measures" ADD CONSTRAINT "measures_client_id_users_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "measures" ADD CONSTRAINT "measures_clinician_id_users_id_fk"
  FOREIGN KEY ("clinician_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "measures_client_instrument_idx" ON "measures" ("client_id", "instrument", "administered_at");

--> statement-breakpoint
-- Append-only, like formulations: a re-administration is a new row at a new
-- time, never an edit of the last one. A score that can be revised is not a
-- measurement.
CREATE OR REPLACE FUNCTION measures_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'measures are append-only' USING ERRCODE = 'check_violation';
END
$$;
--> statement-breakpoint
CREATE TRIGGER measures_append_only BEFORE UPDATE ON measures
  FOR EACH ROW EXECUTE FUNCTION measures_append_only();

--> statement-breakpoint
-- No UPDATE and no DELETE: the trigger is the second lock, not the first.
GRANT SELECT, INSERT ON measures TO ledger_api;
--> statement-breakpoint
ALTER TABLE "measures" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
-- The client owns the row. They read every measure about themselves, including
-- the ones a clinician administered — a score taken about you is yours to see,
-- which is the opposite of the decision on formulations and is deliberate: a
-- number on a published instrument is not a working note.
CREATE POLICY measures_client_select ON measures FOR SELECT TO ledger_api
  USING (client_id = app_user_id());
--> statement-breakpoint
CREATE POLICY measures_client_insert ON measures FOR INSERT TO ledger_api
  WITH CHECK (
    app_role() = 'client'
    AND client_id = app_user_id()
    AND administered_by = 'client'
    AND clinician_id IS NULL
  );

--> statement-breakpoint
-- The clinician reads through an active link and writes only as themselves.
-- `app_link_allows(client, 'any')` is the same gate the formulations policies
-- use: a revoked link makes these rows invisible immediately and totally.
CREATE POLICY measures_clinician_select ON measures FOR SELECT TO ledger_api
  USING (app_role() = 'clinician' AND app_link_allows(client_id, 'any'));
--> statement-breakpoint
CREATE POLICY measures_clinician_insert ON measures FOR INSERT TO ledger_api
  WITH CHECK (
    app_role() = 'clinician'
    AND clinician_id = app_user_id()
    AND administered_by = 'clinician'
    AND app_link_allows(client_id, 'any')
  );
