-- ---------------------------------------------------------------------------
-- 0003_links_formulations — invites, formulations, and assistant runs.
--
-- Additive. Nothing in 0000-0002 is altered. Two functions from 0001 are
-- redefined with CREATE OR REPLACE (links_consent_guard, and the new
-- redeem_invite alongside app_link_allows); the migrations themselves are not
-- edited, which is the rule.
--
-- The trust model this file has to hold, from proposal 02:
--
--   * A clinician originates an invite. Only the client redeems it, and
--     redemption is the client's act of consent.
--   * The client has no visibility into link_invites at all. Redemption
--     therefore runs through a SECURITY DEFINER function, in the pattern of
--     app_link_allows().
--   * Consent is the client's: share_* columns are writable only by the
--     client. A clinician may set status = 'revoked' on their own link and
--     change nothing else.
--   * Formulations are the clinician's working notes about a client. They are
--     append-only, require an active link at write time, and the client does
--     not read them in this version.
-- ---------------------------------------------------------------------------

--> statement-breakpoint
CREATE TABLE "link_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinician_id" uuid NOT NULL,
	-- SHA-256 of the token. The token itself is never stored, anywhere.
	"token_hash" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" uuid,
	"link_id" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "link_invites_token_hash_unique" UNIQUE ("token_hash"),
	CONSTRAINT "link_invites_token_hash_len" CHECK (octet_length("token_hash") = 32),
	CONSTRAINT "link_invites_redeem_pair" CHECK (("redeemed_at" IS NULL) = ("redeemed_by" IS NULL)),
	CONSTRAINT "link_invites_not_self" CHECK ("redeemed_by" IS NULL OR "redeemed_by" <> "clinician_id")
);
--> statement-breakpoint
ALTER TABLE "link_invites" ADD CONSTRAINT "link_invites_clinician_id_users_id_fk"
  FOREIGN KEY ("clinician_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "link_invites" ADD CONSTRAINT "link_invites_redeemed_by_users_id_fk"
  FOREIGN KEY ("redeemed_by") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "link_invites" ADD CONSTRAINT "link_invites_link_id_links_id_fk"
  FOREIGN KEY ("link_id") REFERENCES "clinician_client_links"("id") ON DELETE set null;
--> statement-breakpoint
-- The redemption UPDATE looks the token up by hash; the unique index serves it.
CREATE INDEX "link_invites_clinician_open_idx" ON "link_invites" ("clinician_id")
  WHERE "redeemed_at" IS NULL AND "revoked_at" IS NULL;

--> statement-breakpoint
CREATE TABLE "assistant_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinician_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	-- The hash exists so two runs on the same note can be recognised as the
	-- same note. The note itself is never stored, here or anywhere else.
	"note_sha256" bytea NOT NULL,
	"observation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_runs_note_sha256_len" CHECK (octet_length("note_sha256") = 32),
	CONSTRAINT "assistant_runs_not_self" CHECK ("clinician_id" <> "client_id"),
	CONSTRAINT "assistant_runs_observation_ids_array" CHECK (jsonb_typeof("observation_ids") = 'array')
);
--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_clinician_id_users_id_fk"
  FOREIGN KEY ("clinician_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_client_id_users_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE cascade;

--> statement-breakpoint
CREATE TABLE "formulations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinician_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	-- 1 on the first formulation for the pair, +1 per re-aim. The clinician app
	-- renders "Re-aim N of 2" from this, and puts the formulation itself on
	-- trial at 3.
	"version" smallint NOT NULL,
	"note_enc" bytea NOT NULL,
	"falsify_enc" bytea NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	-- Observation ids from the locator's list. Ids only; validated against
	-- packages/shared before the insert.
	"observations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	-- The clinician's attestation. Never the assistant's.
	"gates" jsonb NOT NULL,
	"floor" smallint NOT NULL,
	"protocol_slug" text,
	"assistant_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "formulations_version_unique" UNIQUE ("clinician_id", "client_id", "version"),
	CONSTRAINT "formulations_version_positive" CHECK ("version" >= 1),
	CONSTRAINT "formulations_floor_range" CHECK ("floor" BETWEEN 1 AND 8),
	CONSTRAINT "formulations_not_self" CHECK ("clinician_id" <> "client_id"),
	CONSTRAINT "formulations_observations_array" CHECK (jsonb_typeof("observations") = 'array'),
	-- All three gates, present and boolean. A formulation without an
	-- attestation is not a formulation.
	--
	-- coalesce is load-bearing: `gates -> 'calibrated'` on a missing key is SQL
	-- NULL, jsonb_typeof(NULL) is NULL, and a CHECK that evaluates to NULL
	-- PASSES — only FALSE fails. Without it this constraint accepts a
	-- formulation that attests two of the three gates, which is exactly what
	-- it exists to refuse.
	CONSTRAINT "formulations_gates_shape" CHECK (
		jsonb_typeof("gates") = 'object'
		AND coalesce(jsonb_typeof("gates" -> 'risk'), '') = 'boolean'
		AND coalesce(jsonb_typeof("gates" -> 'dial'), '') = 'boolean'
		AND coalesce(jsonb_typeof("gates" -> 'calibrated'), '') = 'boolean'
	)
);
--> statement-breakpoint
ALTER TABLE "formulations" ADD CONSTRAINT "formulations_clinician_id_users_id_fk"
  FOREIGN KEY ("clinician_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "formulations" ADD CONSTRAINT "formulations_client_id_users_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "formulations" ADD CONSTRAINT "formulations_link_id_links_id_fk"
  FOREIGN KEY ("link_id") REFERENCES "clinician_client_links"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "formulations" ADD CONSTRAINT "formulations_assistant_run_id_fk"
  FOREIGN KEY ("assistant_run_id") REFERENCES "assistant_runs"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "formulations_pair_idx" ON "formulations" ("clinician_id", "client_id", "version" DESC);

-- ---------------------------------------------------------------------------
-- Invite guards
-- ---------------------------------------------------------------------------
--> statement-breakpoint
-- expires_at is created_at + 7 days and is not editable. Set here rather than
-- as a column default so that a client of this table cannot choose it.
CREATE OR REPLACE FUNCTION link_invites_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_open integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.clinician_id AND u.role = 'clinician') THEN
      RAISE EXCEPTION 'only a clinician can invite' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.created_at := now();
    NEW.expires_at := NEW.created_at + interval '7 days';
    NEW.redeemed_at := NULL;
    NEW.redeemed_by := NULL;
    NEW.link_id := NULL;
    NEW.revoked_at := NULL;
    -- 20 unredeemed invites per clinician. The route enforces this too; here
    -- it cannot be got around.
    SELECT count(*) INTO v_open FROM link_invites i
      WHERE i.clinician_id = NEW.clinician_id AND i.redeemed_at IS NULL AND i.revoked_at IS NULL;
    IF v_open >= 20 THEN
      RAISE EXCEPTION 'too many open invites' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE. The only writes are redemption, which runs as the definer, and
  -- revocation by the owning clinician.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.clinician_id IS DISTINCT FROM OLD.clinician_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'an invite cannot be re-pointed or extended' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.redeemed_at IS NOT NULL AND NEW.redeemed_at IS DISTINCT FROM OLD.redeemed_at THEN
    RAISE EXCEPTION 'an invite is redeemed once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER link_invites_guard BEFORE INSERT OR UPDATE ON link_invites
  FOR EACH ROW EXECUTE FUNCTION link_invites_guard();

-- ---------------------------------------------------------------------------
-- Redemption. SECURITY DEFINER because the client cannot see link_invites at
-- all — there is no policy that would let them, by design.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE OR REPLACE FUNCTION redeem_invite(
  p_token_hash bytea,
  p_link_id uuid,
  p_share_predictions boolean,
  p_share_body_states boolean
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client uuid := app_user_id();
  v_invite uuid;
  v_clinician uuid;
BEGIN
  -- The caller must be a signed-in client acting for themselves.
  IF v_client IS NULL OR app_role() <> 'client' THEN
    RETURN NULL;
  END IF;

  -- One statement is the single-use guarantee: whichever transaction lands
  -- this UPDATE first takes the invite, and the row no longer matches for
  -- anyone else. Unknown, expired, revoked, already used, and self-redemption
  -- all fail here, identically, by matching no row.
  UPDATE link_invites
     SET redeemed_at = now(),
         redeemed_by = v_client
   WHERE token_hash = p_token_hash
     AND redeemed_at IS NULL
     AND revoked_at IS NULL
     AND expires_at > now()
     AND clinician_id <> v_client
  RETURNING id, clinician_id INTO v_invite, v_clinician;

  IF v_invite IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO clinician_client_links (
    id, clinician_id, client_id, status, requested_by,
    share_predictions, share_body_states, consented_at
  ) VALUES (
    p_link_id, v_clinician, v_client, 'active', 'clinician',
    coalesce(p_share_predictions, false), coalesce(p_share_body_states, false), now()
  );

  UPDATE link_invites SET link_id = p_link_id WHERE id = v_invite;

  RETURN p_link_id;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION redeem_invite(bytea, uuid, boolean, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION redeem_invite(bytea, uuid, boolean, boolean) TO ledger_api;

-- ---------------------------------------------------------------------------
-- Consent stays the client's. Redefines the 0001 function; 0001 is untouched.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE OR REPLACE FUNCTION links_consent_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A link's two parties are fixed at creation. Nobody re-points a link.
  IF NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.clinician_id IS DISTINCT FROM OLD.clinician_id THEN
    RAISE EXCEPTION 'a link cannot be re-pointed' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF app_user_id() <> OLD.client_id THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'revoked' THEN
      RAISE EXCEPTION 'only the client can activate a link' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.share_calibration IS DISTINCT FROM OLD.share_calibration
       OR NEW.share_predictions IS DISTINCT FROM OLD.share_predictions
       OR NEW.share_priors IS DISTINCT FROM OLD.share_priors
       OR NEW.share_body_states IS DISTINCT FROM OLD.share_body_states
       OR NEW.share_crisis_events IS DISTINCT FROM OLD.share_crisis_events THEN
      RAISE EXCEPTION 'only the client can change what is shared' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- New in 0003: revoking is the whole of what the other side may do. The
    -- checks above already cover status and the share flags; this closes the
    -- columns that were previously unguarded because nothing wrote them.
    IF NEW.requested_by IS DISTINCT FROM OLD.requested_by
       OR NEW.consented_at IS DISTINCT FROM OLD.consented_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'a clinician may only revoke a link' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.status = 'active' AND OLD.status <> 'active' THEN NEW.consented_at := now(); END IF;
  IF NEW.status = 'revoked' AND OLD.status <> 'revoked' THEN NEW.revoked_at := now(); END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- Formulations: append-only, and only against an active link.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE OR REPLACE FUNCTION formulations_active_link() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM clinician_client_links l
    WHERE l.id = NEW.link_id
      AND l.clinician_id = NEW.clinician_id
      AND l.client_id = NEW.client_id
      AND l.status = 'active'
  ) THEN
    RAISE EXCEPTION 'a formulation needs an active link' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER formulations_active_link BEFORE INSERT ON formulations
  FOR EACH ROW EXECUTE FUNCTION formulations_active_link();
--> statement-breakpoint
-- Append-only, in the reinterpretations pattern. A re-aim is a new row with a
-- higher version, never an edit. Soft-delete is left for the deletion job,
-- which is not granted to the API role in this migration.
CREATE OR REPLACE FUNCTION formulations_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.clinician_id IS DISTINCT FROM OLD.clinician_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.link_id IS DISTINCT FROM OLD.link_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.note_enc IS DISTINCT FROM OLD.note_enc
     OR NEW.falsify_enc IS DISTINCT FROM OLD.falsify_enc
     OR NEW.key_version IS DISTINCT FROM OLD.key_version
     OR NEW.observations IS DISTINCT FROM OLD.observations
     OR NEW.gates IS DISTINCT FROM OLD.gates
     OR NEW.floor IS DISTINCT FROM OLD.floor
     OR NEW.protocol_slug IS DISTINCT FROM OLD.protocol_slug
     OR NEW.assistant_run_id IS DISTINCT FROM OLD.assistant_run_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'formulations are append-only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER formulations_append_only BEFORE UPDATE ON formulations
  FOR EACH ROW EXECUTE FUNCTION formulations_append_only();
--> statement-breakpoint
-- Assistant runs are a record of what happened; nothing rewrites one.
CREATE OR REPLACE FUNCTION assistant_runs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'assistant runs are append-only' USING ERRCODE = 'check_violation';
END
$$;
--> statement-breakpoint
CREATE TRIGGER assistant_runs_append_only BEFORE UPDATE ON assistant_runs
  FOR EACH ROW EXECUTE FUNCTION assistant_runs_append_only();

-- ---------------------------------------------------------------------------
-- Grants. No UPDATE or DELETE on formulations or assistant_runs: the append-
-- only triggers are the second lock, not the first.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON link_invites TO ledger_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON formulations TO ledger_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON assistant_runs TO ledger_api;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--> statement-breakpoint
ALTER TABLE "link_invites" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "formulations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "assistant_runs" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
-- Invites belong to the clinician who made them. There is deliberately no
-- policy for clients: a client cannot read an invite even with the token in
-- hand, which is why redemption is a definer function.
CREATE POLICY link_invites_owner_select ON link_invites FOR SELECT TO ledger_api
  USING (app_role() = 'clinician' AND clinician_id = app_user_id());
--> statement-breakpoint
CREATE POLICY link_invites_owner_insert ON link_invites FOR INSERT TO ledger_api
  WITH CHECK (app_role() = 'clinician' AND clinician_id = app_user_id());
--> statement-breakpoint
-- Revocation only. The guard trigger decides which columns may move.
CREATE POLICY link_invites_owner_update ON link_invites FOR UPDATE TO ledger_api
  USING (app_role() = 'clinician' AND clinician_id = app_user_id())
  WITH CHECK (app_role() = 'clinician' AND clinician_id = app_user_id());

--> statement-breakpoint
-- A formulation is the clinician's working note about a client they hold an
-- active link to. No UPDATE or DELETE policy exists, for anyone.
CREATE POLICY formulations_author_select ON formulations FOR SELECT TO ledger_api
  USING (clinician_id = app_user_id() AND app_link_allows(client_id, 'any'));
--> statement-breakpoint
CREATE POLICY formulations_author_insert ON formulations FOR INSERT TO ledger_api
  WITH CHECK (clinician_id = app_user_id() AND app_link_allows(client_id, 'any'));

--> statement-breakpoint
CREATE POLICY assistant_runs_author_select ON assistant_runs FOR SELECT TO ledger_api
  USING (clinician_id = app_user_id() AND app_link_allows(client_id, 'any'));
--> statement-breakpoint
CREATE POLICY assistant_runs_author_insert ON assistant_runs FOR INSERT TO ledger_api
  WITH CHECK (clinician_id = app_user_id() AND app_link_allows(client_id, 'any'));
