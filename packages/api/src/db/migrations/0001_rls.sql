-- ---------------------------------------------------------------------------
-- 0001_rls — row-level security, grants, and guard triggers.
--
-- The API connects as `ledger_api` (no BYPASSRLS) and, per request, runs
--   SELECT set_config('request.user_id', $1, true), set_config('request.role', $2, true);
-- inside a transaction. Every policy below reads those two settings.
--
-- Clients see only their own rows. Clinicians see a client's rows only
-- through an ACTIVE link and only for the layers that link shares.
-- Revoking a link (status <> 'active') closes every door at once.
-- ---------------------------------------------------------------------------

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.user_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.role', true), '')
$$;
--> statement-breakpoint
-- Does the current clinician hold an active link to p_client that shares p_layer?
-- SECURITY DEFINER so the lookup does not recurse through the links policies.
CREATE OR REPLACE FUNCTION app_link_allows(p_client uuid, p_layer text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_role() = 'clinician' AND EXISTS (
    SELECT 1 FROM clinician_client_links l
    WHERE l.client_id = p_client
      AND l.clinician_id = app_user_id()
      AND l.status = 'active'
      AND CASE p_layer
            WHEN 'any'           THEN true
            WHEN 'calibration'   THEN l.share_calibration
            WHEN 'predictions'   THEN l.share_predictions
            WHEN 'priors'        THEN l.share_priors
            WHEN 'body_states'   THEN l.share_body_states
            WHEN 'crisis_events' THEN l.share_crisis_events
            ELSE false
          END
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_link_allows(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_link_allows(uuid, text) TO ledger_api;

-- ---------------------------------------------------------------------------
-- updated_at maintenance (server clock, used as the sync cursor)
-- ---------------------------------------------------------------------------
--> statement-breakpoint
-- clock_timestamp(), not now(): now() is the transaction START, and a
-- transaction that waited on the per-user advisory lock would otherwise stamp
-- rows earlier than the cursor another transaction already handed out.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER predictions_touch BEFORE INSERT OR UPDATE ON predictions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER body_states_touch BEFORE INSERT OR UPDATE ON body_states FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER reinterpretations_touch BEFORE INSERT OR UPDATE ON reinterpretations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER priors_touch BEFORE INSERT OR UPDATE ON priors FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER journal_entries_touch BEFORE INSERT OR UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER crisis_events_touch BEFORE INSERT OR UPDATE ON crisis_events FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER links_touch BEFORE INSERT OR UPDATE ON clinician_client_links FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER devices_touch BEFORE INSERT OR UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

--> statement-breakpoint
-- A clinician tagging a prediction must surface on the client's next pull,
-- which cursors on predictions.updated_at. Owner-run trigger: bypasses RLS.
CREATE OR REPLACE FUNCTION prediction_priors_touch_prediction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE predictions SET updated_at = clock_timestamp() WHERE id = COALESCE(NEW.prediction_id, OLD.prediction_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER prediction_priors_touch AFTER INSERT OR DELETE ON prediction_priors FOR EACH ROW EXECUTE FUNCTION prediction_priors_touch_prediction();

-- ---------------------------------------------------------------------------
-- Guard triggers
-- ---------------------------------------------------------------------------
--> statement-breakpoint
-- Reinterpretations are append-only. Soft-delete is the only permitted update.
CREATE OR REPLACE FUNCTION reinterpretations_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.text_enc IS DISTINCT FROM OLD.text_enc
     OR NEW.prediction_id IS DISTINCT FROM OLD.prediction_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'reinterpretations are append-only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER reinterpretations_append_only BEFORE UPDATE ON reinterpretations FOR EACH ROW EXECUTE FUNCTION reinterpretations_append_only();
--> statement-breakpoint
-- Clinicians may change only safe_to_test on a client's priors.
CREATE OR REPLACE FUNCTION priors_clinician_columns() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_role() = 'clinician' AND NEW.user_id <> app_user_id() THEN
    IF NEW.label_enc IS DISTINCT FROM OLD.label_enc
       OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.origin IS DISTINCT FROM OLD.origin
       OR NEW.retired_at IS DISTINCT FROM OLD.retired_at
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'clinicians may only set safe_to_test' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER priors_clinician_columns BEFORE UPDATE ON priors FOR EACH ROW EXECUTE FUNCTION priors_clinician_columns();
--> statement-breakpoint
-- Only the client side of a link can change consent or activate it.
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
  END IF;
  IF NEW.status = 'active' AND OLD.status <> 'active' THEN NEW.consented_at := now(); END IF;
  IF NEW.status = 'revoked' AND OLD.status <> 'revoked' THEN NEW.revoked_at := now(); END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER links_consent_guard BEFORE UPDATE ON clinician_client_links FOR EACH ROW EXECUTE FUNCTION links_consent_guard();

-- ---------------------------------------------------------------------------
-- Calibration-only view for clinicians: no encrypted columns, no prose.
-- Owned by the migration role, so it bypasses table RLS and carries its own
-- filter. This is the ONLY way a clinician with share_calibration but not
-- share_predictions can see anything from `predictions`.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE OR REPLACE VIEW predictions_summary WITH (security_barrier = true) AS
  SELECT p.id, p.user_id, p.confidence, p.revise_after_n, p.scheduled_for,
         p.resolved_at, p.outcome_verdict, p.outcome_source, p.surprise_rating,
         p.present_for_it, p.own_part, p.abandoned_at, p.abandon_reason,
         p.created_at, p.client_updated_at, p.updated_at, p.deleted_at
  FROM predictions p
  WHERE p.user_id = app_user_id()
     OR app_link_allows(p.user_id, 'calibration');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ledger_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON users TO ledger_api;
--> statement-breakpoint
-- Role is never client-settable. Only the migration role (or an auth hook) changes it.
GRANT UPDATE (timezone, deleted_at) ON users TO ledger_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON clinician_client_links, predictions, body_states,
  reinterpretations, priors, journal_entries, crisis_events, devices TO ledger_api;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON prediction_priors TO ledger_api;
--> statement-breakpoint
GRANT SELECT ON predictions_summary TO ledger_api;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. FORCE is not needed: ledger_api owns nothing.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE clinician_client_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE body_states ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reinterpretations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE priors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE prediction_priors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crisis_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY users_self_select ON users FOR SELECT TO ledger_api
  USING (id = app_user_id() OR app_link_allows(id, 'any'));
--> statement-breakpoint
CREATE POLICY users_self_insert ON users FOR INSERT TO ledger_api
  WITH CHECK (id = app_user_id());
--> statement-breakpoint
CREATE POLICY users_self_update ON users FOR UPDATE TO ledger_api
  USING (id = app_user_id()) WITH CHECK (id = app_user_id());

-- ---------------------------------------------------------------------------
-- clinician_client_links
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY links_select ON clinician_client_links FOR SELECT TO ledger_api
  USING (client_id = app_user_id() OR clinician_id = app_user_id());
--> statement-breakpoint
-- Either side may propose a link; it starts pending and the client activates it.
CREATE POLICY links_insert ON clinician_client_links FOR INSERT TO ledger_api
  WITH CHECK (
    status = 'pending'
    AND ((app_role() = 'client' AND client_id = app_user_id() AND requested_by = 'client')
      OR (app_role() = 'clinician' AND clinician_id = app_user_id() AND requested_by = 'clinician'))
  );
--> statement-breakpoint
CREATE POLICY links_update ON clinician_client_links FOR UPDATE TO ledger_api
  USING (client_id = app_user_id() OR clinician_id = app_user_id())
  WITH CHECK (client_id = app_user_id() OR clinician_id = app_user_id());

-- ---------------------------------------------------------------------------
-- predictions
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY predictions_client_all ON predictions FOR ALL TO ledger_api
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY predictions_clinician_select ON predictions FOR SELECT TO ledger_api
  USING (app_link_allows(user_id, 'predictions'));

-- ---------------------------------------------------------------------------
-- body_states
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY body_states_client_all ON body_states FOR ALL TO ledger_api
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY body_states_clinician_select ON body_states FOR SELECT TO ledger_api
  USING (app_link_allows(user_id, 'body_states'));

-- ---------------------------------------------------------------------------
-- reinterpretations
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY reinterpretations_client_all ON reinterpretations FOR ALL TO ledger_api
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY reinterpretations_clinician_select ON reinterpretations FOR SELECT TO ledger_api
  USING (app_link_allows(user_id, 'predictions'));

-- ---------------------------------------------------------------------------
-- priors
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY priors_client_all ON priors FOR ALL TO ledger_api
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY priors_clinician_select ON priors FOR SELECT TO ledger_api
  USING (app_link_allows(user_id, 'priors'));
--> statement-breakpoint
CREATE POLICY priors_clinician_update ON priors FOR UPDATE TO ledger_api
  USING (app_link_allows(user_id, 'priors')) WITH CHECK (app_link_allows(user_id, 'priors'));
--> statement-breakpoint
CREATE POLICY priors_clinician_insert ON priors FOR INSERT TO ledger_api
  WITH CHECK (app_link_allows(user_id, 'priors') AND origin = 'clinician' AND created_by = 'clinician');

-- ---------------------------------------------------------------------------
-- prediction_priors
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY prediction_priors_client_all ON prediction_priors FOR ALL TO ledger_api
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY prediction_priors_clinician_select ON prediction_priors FOR SELECT TO ledger_api
  USING (app_link_allows(user_id, 'priors'));
--> statement-breakpoint
CREATE POLICY prediction_priors_clinician_insert ON prediction_priors FOR INSERT TO ledger_api
  WITH CHECK (app_link_allows(user_id, 'priors') AND assigned_by = 'clinician');
--> statement-breakpoint
CREATE POLICY prediction_priors_clinician_delete ON prediction_priors FOR DELETE TO ledger_api
  USING (app_link_allows(user_id, 'priors') AND assigned_by = 'clinician');

-- ---------------------------------------------------------------------------
-- journal_entries — shared one entry at a time, never as a layer
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY journal_client_all ON journal_entries FOR ALL TO ledger_api
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY journal_clinician_select ON journal_entries FOR SELECT TO ledger_api
  USING (shared_at IS NOT NULL AND deleted_at IS NULL AND app_link_allows(user_id, 'any'));

-- ---------------------------------------------------------------------------
-- crisis_events
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY crisis_client_select ON crisis_events FOR SELECT TO ledger_api
  USING (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY crisis_client_insert ON crisis_events FOR INSERT TO ledger_api
  WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY crisis_client_update ON crisis_events FOR UPDATE TO ledger_api
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY crisis_clinician_select ON crisis_events FOR SELECT TO ledger_api
  USING (app_link_allows(user_id, 'crisis_events'));

-- ---------------------------------------------------------------------------
-- devices — the owner only. Clinicians never see devices.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY devices_client_all ON devices FOR ALL TO ledger_api
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
