-- The training stack, and the scope gate that reads it.
--
-- docs/theory/tools/training-stack.md: a clinician's stack is the set of
-- modalities they can actually run, each at a stated depth, and a practice is
-- measured by floor coverage rather than modality count. Once a formulation
-- places a client on a floor, the stack says whether the clinician holds a
-- tool that reaches it.
--
-- Nothing in this migration is client data. A clinician's own training is not
-- PHI, and no client can read it — there is no client policy on either table,
-- which is why neither needs the encryption the other tables carry.

CREATE TABLE "clinician_stacks" (
	"clinician_id" uuid NOT NULL,
	-- A slug from apps/clinician/content/modalities.ts, which is the single
	-- source for modality slugs and home floors. Not an FK: the catalogue is
	-- the document's, lives in code, and is versioned with it.
	"modality_slug" text NOT NULL,
	"tier" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinician_stacks_pk" PRIMARY KEY ("clinician_id", "modality_slug"),
	CONSTRAINT "clinician_stacks_tier_known"
	  CHECK ("tier" IN ('literacy', 'fluent', 'deep', 'master')),
	CONSTRAINT "clinician_stacks_slug_shape"
	  CHECK ("modality_slug" ~ '^[a-z0-9-]{1,64}$')
);
--> statement-breakpoint
ALTER TABLE "clinician_stacks" ADD CONSTRAINT "clinician_stacks_clinician_id_users_id_fk"
  FOREIGN KEY ("clinician_id") REFERENCES "users"("id") ON DELETE cascade;

-- ---------------------------------------------------------------------------
-- There is deliberately no constraint here for "one Master, one Deep".
--
-- Those are reading rules about how a career is built, not facts about a row.
-- The app warns; it does not block. A clinician mid-transition between two
-- certifications is describing something true, and a database that refused the
-- write would be teaching them to describe something false instead.
-- ---------------------------------------------------------------------------

--> statement-breakpoint
CREATE TABLE "stack_goals" (
	"clinician_id" uuid NOT NULL,
	"modality_slug" text NOT NULL,
	"target_tier" text NOT NULL,
	-- A date, not a timestamp: "by the spring" is the resolution this has.
	"target_by" date,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- No note column, by the prompt. A roadmap row is a modality, a tier and a
	-- date; anything else people would write here belongs in supervision.
	CONSTRAINT "stack_goals_pk" PRIMARY KEY ("clinician_id", "modality_slug"),
	CONSTRAINT "stack_goals_tier_known"
	  CHECK ("target_tier" IN ('literacy', 'fluent', 'deep', 'master')),
	CONSTRAINT "stack_goals_slug_shape"
	  CHECK ("modality_slug" ~ '^[a-z0-9-]{1,64}$')
);
--> statement-breakpoint
ALTER TABLE "stack_goals" ADD CONSTRAINT "stack_goals_clinician_id_users_id_fk"
  FOREIGN KEY ("clinician_id") REFERENCES "users"("id") ON DELETE cascade;

-- ---------------------------------------------------------------------------
-- The scope gate, recorded on the formulation it applied to.
--
-- It annotates and never blocks. The boolean says the clinician was told, at
-- the moment they wrote it, that the floor they placed this client on is
-- outside their stack at this tier — so a later reader knows the decision was
-- made with that in front of them. There is no constraint tying it to
-- anything: it is a record of what was shown, not a claim the database can
-- check, and a CHECK here would turn a note into a refusal.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
-- Nullable: every formulation written before this gate existed was written
-- without it, and backfilling false would assert something nobody was told.
ALTER TABLE "formulations" ADD COLUMN "outside_stack" boolean;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
--> statement-breakpoint
-- DELETE is granted here, unlike formulations: a stack is a statement about
-- the present, and removing a modality you no longer run is a correction
-- rather than the loss of a record.
GRANT SELECT, INSERT, UPDATE, DELETE ON clinician_stacks TO ledger_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON stack_goals TO ledger_api;
--> statement-breakpoint
ALTER TABLE "clinician_stacks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stack_goals" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
-- A clinician's own stack, and nobody else's. There is deliberately no client
-- policy and no cross-clinician policy: this is not a directory of who can
-- treat what, and building one out of it later must be a deliberate act.
CREATE POLICY clinician_stacks_owner_select ON clinician_stacks FOR SELECT TO ledger_api
  USING (app_role() = 'clinician' AND clinician_id = app_user_id());
--> statement-breakpoint
CREATE POLICY clinician_stacks_owner_insert ON clinician_stacks FOR INSERT TO ledger_api
  WITH CHECK (app_role() = 'clinician' AND clinician_id = app_user_id());
--> statement-breakpoint
CREATE POLICY clinician_stacks_owner_update ON clinician_stacks FOR UPDATE TO ledger_api
  USING (app_role() = 'clinician' AND clinician_id = app_user_id())
  WITH CHECK (app_role() = 'clinician' AND clinician_id = app_user_id());
--> statement-breakpoint
CREATE POLICY clinician_stacks_owner_delete ON clinician_stacks FOR DELETE TO ledger_api
  USING (app_role() = 'clinician' AND clinician_id = app_user_id());

--> statement-breakpoint
CREATE POLICY stack_goals_owner_select ON stack_goals FOR SELECT TO ledger_api
  USING (app_role() = 'clinician' AND clinician_id = app_user_id());
--> statement-breakpoint
CREATE POLICY stack_goals_owner_insert ON stack_goals FOR INSERT TO ledger_api
  WITH CHECK (app_role() = 'clinician' AND clinician_id = app_user_id());
--> statement-breakpoint
CREATE POLICY stack_goals_owner_update ON stack_goals FOR UPDATE TO ledger_api
  USING (app_role() = 'clinician' AND clinician_id = app_user_id())
  WITH CHECK (app_role() = 'clinician' AND clinician_id = app_user_id());
--> statement-breakpoint
CREATE POLICY stack_goals_owner_delete ON stack_goals FOR DELETE TO ledger_api
  USING (app_role() = 'clinician' AND clinician_id = app_user_id());
