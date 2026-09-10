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

--> statement-breakpoint
-- The same test, applied to a value rather than looked up by id.
--
-- A WITH CHECK has to judge the row as it will be *after* the write, and
-- app_purgeable_user() cannot do that: it is STABLE and queries `users`, so it
-- sees the statement's snapshot — the row as it was. Written that way, a
-- WITH CHECK would approve an update that cleared deleted_at, because at the
-- moment it ran deleted_at was still set. This one reads the new row's own
-- column and has nothing to re-query.
CREATE OR REPLACE FUNCTION app_purgeable_stamp(p_deleted_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_role() = 'system'
     AND p_deleted_at IS NOT NULL
     AND p_deleted_at < now() - app_deletion_grace()
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_purgeable_stamp(timestamptz) TO ledger_api;

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
-- users is deliberately absent, and so is clinician_client_links. See below.
GRANT DELETE ON predictions, priors, body_states, reinterpretations,
  journal_entries, crisis_events, devices, link_invites TO ledger_api;

-- ---------------------------------------------------------------------------
-- FIRST: take the verb back from everyone else.
--
-- 0001 gives the client FOR ALL on their own rows — predictions, priors,
-- body_states, reinterpretations, prediction_priors, journal_entries — and FOR
-- ALL includes DELETE. That was harmless only because no DELETE grant existed;
-- the moment the grant above is made, every one of those policies starts
-- permitting a client to hard-delete their own ledger, which is the exact
-- guarantee this migration is supposed to preserve.
--
-- A RESTRICTIVE policy is ANDed with the permissive ones rather than ORed, so
-- this makes 'system' a necessary condition for DELETE on these tables no
-- matter what any present or future permissive policy says. It is written
-- before the purge policies below because it is the one that matters: without
-- it, they would be additions rather than the whole of the permission.
--
-- devices is deliberately absent: DELETE /v1/me removes push tokens under the
-- user's own context, and a token outliving its account is the worse failure.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY predictions_delete_system_only ON predictions AS RESTRICTIVE
  FOR DELETE TO ledger_api USING (app_role() = 'system');
--> statement-breakpoint
CREATE POLICY priors_delete_system_only ON priors AS RESTRICTIVE
  FOR DELETE TO ledger_api USING (app_role() = 'system');
--> statement-breakpoint
CREATE POLICY body_states_delete_system_only ON body_states AS RESTRICTIVE
  FOR DELETE TO ledger_api USING (app_role() = 'system');
--> statement-breakpoint
CREATE POLICY reinterpretations_delete_system_only ON reinterpretations AS RESTRICTIVE
  FOR DELETE TO ledger_api USING (app_role() = 'system');
--> statement-breakpoint
CREATE POLICY journal_entries_delete_system_only ON journal_entries AS RESTRICTIVE
  FOR DELETE TO ledger_api USING (app_role() = 'system');
--> statement-breakpoint
CREATE POLICY crisis_events_delete_system_only ON crisis_events AS RESTRICTIVE
  FOR DELETE TO ledger_api USING (app_role() = 'system');
--> statement-breakpoint
CREATE POLICY link_invites_delete_system_only ON link_invites AS RESTRICTIVE
  FOR DELETE TO ledger_api USING (app_role() = 'system');
--> statement-breakpoint
-- prediction_priors already had DELETE granted, from 0001, and its FOR ALL
-- policy has always let a client remove a tag. That stays: a tag is not a
-- record of anything. The restriction here is only that the *purge* path
-- cannot be reached by anyone else.
CREATE POLICY prediction_priors_purge_is_system ON prediction_priors AS RESTRICTIVE
  FOR DELETE TO ledger_api USING (user_id = app_user_id() OR app_role() = 'system');

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

-- ---------------------------------------------------------------------------
-- users is never hard-deleted. It becomes a tombstone.
--
-- Two things point at a client's user row that are not the client's data:
-- `formulations` and `assistant_runs` are the clinician's record of their own
-- clinical reasoning, and both foreign-key to users with ON DELETE CASCADE.
-- Deleting the row would take them silently — not block on a constraint, take
-- them — and a clinician's chart is not the client's to delete.
--
-- So the row survives with its id and its deleted_at and nothing else that
-- says anything about the person. There is no DELETE grant on users and no
-- DELETE policy, which is the strongest form of "never": the verb is absent
-- rather than merely restricted.
--
-- `clinician_client_links` is exempt for the same reason at one remove:
-- `formulations.link_id` is NOT NULL and cascades from it, so deleting a link
-- deletes the formulations written against it. The link stays, revoked.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY users_system_purge_read ON users FOR SELECT TO ledger_api
  USING (app_purgeable_user(id));
--> statement-breakpoint
-- The scrub, and the only thing the system role may do to a user row. USING
-- judges the row as it is and WITH CHECK the row as it will be, so the system
-- role can neither reach a live account nor update a tombstone back out of the
-- purgeable set by clearing deleted_at. The two use different functions for
-- the reason given above app_purgeable_stamp(): a WITH CHECK that re-queried
-- the table would be reading the row it is about to replace.
--
-- Which columns may move is a column-level GRANT, not a policy: 0001 grants
-- UPDATE (timezone, deleted_at) on users and nothing else, so the scrub can
-- touch those and no others however this policy is written.
CREATE POLICY users_system_scrub ON users FOR UPDATE TO ledger_api
  USING (app_purgeable_user(id))
  WITH CHECK (app_purgeable_stamp(deleted_at));

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
