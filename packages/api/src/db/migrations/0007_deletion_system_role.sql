-- Account deletion: the hard-delete half.
--
-- DELETE /v1/me soft-deletes — it stamps deleted_at, which every RLS policy
-- and every query already treats as gone. This migration is what lets a
-- deleted account's rows actually leave, thirty days later, and nothing else.
--
-- The unit is the account, not the row. Nothing in the milestone-1 schema
-- cascades from `users` — every foreign key there is ON DELETE NO ACTION, on
-- purpose, so that no single delete can quietly take a ledger with it — which
-- means the purge has to name every table and delete in dependency order. It
-- also means the permission has to be phrased per account rather than per row:
-- `prediction_priors`, `crisis_events`, `devices` and `clinician_client_links`
-- have no deleted_at of their own and belong to a user, not to a moment.
--
-- The shape of the permission matters more than the permission. Until now the
-- API role held no DELETE grant on any client table, so "cannot destroy a
-- client's ledger" was true because the verb was absent. Adding the verb means
-- the guarantee has to be carried by a policy instead, so the policy is as
-- narrow as it can be made:
--
--   * only for `request.role = 'system'`, a context no HTTP request can set —
--     the auth plugin writes 'client' or 'clinician' from the verified token,
--     and withUser() takes its role from there;
--   * only for rows belonging to a user whose own row is already soft-deleted,
--     so a live account is unreachable by the verb even in that context;
--   * only after the grace period, computed in SQL, so a job with the interval
--     wrong still cannot delete an account deleted yesterday.
--
-- A client running as themselves matches none of these and cannot hard-delete
-- their own rows. rls.test.ts #44-#48 are those cases.

-- ---------------------------------------------------------------------------
-- The grace period, in the database rather than only in the job.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_deletion_grace() RETURNS interval
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('app.deletion_grace_days', true), ''),
    '30'
  )::int * interval '1 day'
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_deletion_grace() TO ledger_api;

--> statement-breakpoint
-- True only for rows belonging to an account that is soft-deleted and past the
-- grace period, in the system context. Every policy below is this predicate.
--
-- SECURITY DEFINER, like app_link_allows: it reads `users`, and a policy that
-- depended on the caller's own visibility of `users` would be a policy whose
-- meaning changed with the caller. Owned by postgres, search_path pinned.
CREATE OR REPLACE FUNCTION app_purgeable_user(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_role() = 'system' AND EXISTS (
    SELECT 1 FROM users u
     WHERE u.id = p_user
       AND u.deleted_at IS NOT NULL
       AND u.deleted_at < now() - app_deletion_grace()
  )
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_purgeable_user(uuid) TO ledger_api;

-- ---------------------------------------------------------------------------
-- The verb, and the policies that are the whole of its scope.
--
-- Both SELECT and DELETE, and the SELECT is not optional: a DELETE whose WHERE
-- clause reads a column has SELECT policies applied to it as well, and every
-- SELECT policy in 0001 keys on app_user_id(), which is null here. Without the
-- read the purge would see nothing, delete nothing, and report success.
--
-- The two predicates are identical, so the system role can read exactly what
-- it can destroy and no more. A live account stays invisible to it, which is
-- what keeps a bug in the job from becoming a cross-user read.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
GRANT DELETE ON users, predictions, priors, body_states, reinterpretations,
  journal_entries, crisis_events, devices, clinician_client_links,
  link_invites TO ledger_api;

--> statement-breakpoint
CREATE POLICY predictions_system_purge ON predictions FOR DELETE TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY predictions_system_purge_read ON predictions FOR SELECT TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY priors_system_purge ON priors FOR DELETE TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY priors_system_purge_read ON priors FOR SELECT TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY body_states_system_purge ON body_states FOR DELETE TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY body_states_system_purge_read ON body_states FOR SELECT TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY reinterpretations_system_purge ON reinterpretations FOR DELETE TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY reinterpretations_system_purge_read ON reinterpretations FOR SELECT TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY journal_entries_system_purge ON journal_entries FOR DELETE TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY journal_entries_system_purge_read ON journal_entries FOR SELECT TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY prediction_priors_system_purge ON prediction_priors FOR DELETE TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY prediction_priors_system_purge_read ON prediction_priors FOR SELECT TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY crisis_events_system_purge ON crisis_events FOR DELETE TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY crisis_events_system_purge_read ON crisis_events FOR SELECT TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
CREATE POLICY devices_system_purge ON devices FOR DELETE TO ledger_api
  USING (app_purgeable_user(user_id));
--> statement-breakpoint
-- A link has two parties. Either being purged takes the row: the other party
-- keeps nothing that points at an account that no longer exists.
CREATE POLICY links_system_purge ON clinician_client_links FOR DELETE TO ledger_api
  USING (app_purgeable_user(client_id) OR app_purgeable_user(clinician_id));
--> statement-breakpoint
CREATE POLICY links_system_purge_read ON clinician_client_links FOR SELECT TO ledger_api
  USING (app_purgeable_user(client_id) OR app_purgeable_user(clinician_id));
--> statement-breakpoint
-- An invite has to be deleted rather than left behind. `redeemed_by` is
-- ON DELETE SET NULL, and link_invites_redeem_pair requires redeemed_at and
-- redeemed_by to be null or not-null together — so nulling the redeemer of a
-- redeemed invite is a check violation, and deleting the user would fail. The
-- clinician side cascades; this covers both so the order does not matter.
CREATE POLICY link_invites_system_purge ON link_invites FOR DELETE TO ledger_api
  USING (app_purgeable_user(clinician_id) OR app_purgeable_user(redeemed_by));
--> statement-breakpoint
CREATE POLICY link_invites_system_purge_read ON link_invites FOR SELECT TO ledger_api
  USING (app_purgeable_user(clinician_id) OR app_purgeable_user(redeemed_by));

--> statement-breakpoint
-- users last, and its own row rather than a child's.
CREATE POLICY users_system_purge ON users FOR DELETE TO ledger_api
  USING (app_purgeable_user(id));
--> statement-breakpoint
CREATE POLICY users_system_purge_read ON users FOR SELECT TO ledger_api
  USING (app_purgeable_user(id));

-- ---------------------------------------------------------------------------
-- Push tokens, which cannot wait for the grace period.
--
-- A row in devices is a push token, and a token that outlives the account is a
-- notification sent to someone who deleted their account. DELETE /v1/me
-- removes them at once, under the user's own context, so this policy is the
-- owner's rather than the system's.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY devices_owner_delete ON devices FOR DELETE TO ledger_api
  USING (user_id = app_user_id());

-- ---------------------------------------------------------------------------
-- Soft-deleting the rows in the first place needs nothing new: the API role
-- could already UPDATE these tables, 0001's policies scope that to the owner,
-- and users' column-level UPDATE grant already covers (timezone, deleted_at).
-- ---------------------------------------------------------------------------
