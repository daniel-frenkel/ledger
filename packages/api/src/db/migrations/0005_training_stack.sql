-- The training stack, and the scope gate that reads it.
--
-- docs/theory/tools/training-stack.md: a clinician's stack is the set of
-- modalities they can actually run, each at a stated depth, and a practice is
-- measured by floor coverage rather than modality count. Once a formulation
-- places a client on a floor, the stack says whether the clinician holds a
-- tool that reaches it.
--
-- Nothing in this migration is client data. A clinician's own training is not
-- PHI, and no client can read it — there is no client policy on the table at
-- all, which is why it needs none of the encryption the other tables carry.

CREATE TABLE "clinician_modalities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinician_id" uuid NOT NULL,
	-- A slug from the catalogue in packages/shared/src/stack/. Not an FK:
	-- the catalogue is the document's, lives in code, and is versioned with it.
	"modality_slug" text NOT NULL,
	"tier" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinician_modalities_tier_known"
	  CHECK ("tier" IN ('master', 'deep', 'fluent', 'literacy')),
	CONSTRAINT "clinician_modalities_slug_shape"
	  CHECK ("modality_slug" ~ '^[a-z0-9-]{1,64}$')
);
--> statement-breakpoint
ALTER TABLE "clinician_modalities" ADD CONSTRAINT "clinician_modalities_clinician_id_users_id_fk"
  FOREIGN KEY ("clinician_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
-- One row per modality per clinician. Changing a tier is an UPDATE, not a
-- second row: a stack is a current statement of depth, not a history.
CREATE UNIQUE INDEX "clinician_modalities_unique"
  ON "clinician_modalities" ("clinician_id", "modality_slug");
--> statement-breakpoint
-- Reading rule 1: one Master, because it is the identity and the thousand
-- hours. Reading rule 3: one Deep at a time — acquiring certifications in
-- parallel is the jack-of-all-trades error wearing a to-do list. Both are
-- partial unique indexes rather than triggers, so the database states the
-- rule and the API does not have to remember it.
CREATE UNIQUE INDEX "clinician_modalities_one_master"
  ON "clinician_modalities" ("clinician_id") WHERE "tier" = 'master';
--> statement-breakpoint
CREATE UNIQUE INDEX "clinician_modalities_one_deep"
  ON "clinician_modalities" ("clinician_id") WHERE "tier" = 'deep';

-- ---------------------------------------------------------------------------
-- The scope gate, recorded on the formulation it applied to.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
-- Nullable, because every formulation already written was written before this
-- gate existed and backfilling a verdict would be inventing one.
ALTER TABLE "formulations" ADD COLUMN "scope" text;
--> statement-breakpoint
ALTER TABLE "formulations" ADD COLUMN "scope_ack" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "formulations" ADD CONSTRAINT "formulations_scope_known"
  CHECK ("scope" IS NULL OR "scope" IN ('covered', 'stretch', 'uncovered'));
--> statement-breakpoint
-- The gate itself, and the only part of it the database can hold: a
-- formulation written outside the clinician's stack carries the
-- acknowledgement, or it is not written. It does not block the work — a
-- clinician may work outside their stack under supervision, and often should —
-- it refuses to let that happen silently.
--
-- scope_ack is NOT NULL, so this is never NULL and never passes by accident.
-- The verdict itself is computed at the API from the clinician's own stack and
-- is not accepted from the request body.
ALTER TABLE "formulations" ADD CONSTRAINT "formulations_scope_acknowledged"
  CHECK ("scope" IS NULL OR "scope" = 'covered' OR "scope_ack");

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
--> statement-breakpoint
-- DELETE is granted here, unlike formulations: a stack is a statement about
-- the present, and removing a modality you no longer run is a correction
-- rather than the loss of a record.
GRANT SELECT, INSERT, UPDATE, DELETE ON clinician_modalities TO ledger_api;
--> statement-breakpoint
ALTER TABLE "clinician_modalities" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
-- A clinician's own stack, and nobody else's. There is deliberately no client
-- policy and no cross-clinician policy: this is not a directory of who can
-- treat what, and building one out of it later must be a deliberate act.
CREATE POLICY clinician_modalities_owner_select ON clinician_modalities FOR SELECT TO ledger_api
  USING (app_role() = 'clinician' AND clinician_id = app_user_id());
--> statement-breakpoint
CREATE POLICY clinician_modalities_owner_insert ON clinician_modalities FOR INSERT TO ledger_api
  WITH CHECK (app_role() = 'clinician' AND clinician_id = app_user_id());
--> statement-breakpoint
CREATE POLICY clinician_modalities_owner_update ON clinician_modalities FOR UPDATE TO ledger_api
  USING (app_role() = 'clinician' AND clinician_id = app_user_id())
  WITH CHECK (app_role() = 'clinician' AND clinician_id = app_user_id());
--> statement-breakpoint
CREATE POLICY clinician_modalities_owner_delete ON clinician_modalities FOR DELETE TO ledger_api
  USING (app_role() = 'clinician' AND clinician_id = app_user_id());
