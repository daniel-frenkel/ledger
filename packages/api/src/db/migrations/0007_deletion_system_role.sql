-- Account deletion: the hard-delete half.
--
-- DELETE /v1/me soft-deletes — it stamps deleted_at, which every RLS policy
-- and every query already treats as gone. This migration is what lets the rows
-- actually leave, thirty days later, and nothing else.
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
--   * only for rows already soft-deleted, so a live row is unreachable by the
--     verb even in the system context;
--   * only after the grace period, computed in SQL, so a job with the interval
--     wrong still cannot delete yesterday's row.
--
-- A client running as themselves matches none of these and cannot hard-delete
-- their own live rows. rls.test.ts #44 is that case.

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
-- True only for a row that is soft-deleted and past the grace period, running
-- in the system context. Every purge policy below is exactly this predicate.
CREATE OR REPLACE FUNCTION app_purgeable(deleted_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_role() = 'system'
     AND deleted_at IS NOT NULL
     AND deleted_at < now() - app_deletion_grace()
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_purgeable(timestamptz) TO ledger_api;

-- ---------------------------------------------------------------------------
-- The verb, and the policies that are the whole of its scope.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
GRANT DELETE ON users, predictions, priors, body_states, reinterpretations,
  journal_entries, devices TO ledger_api;

--> statement-breakpoint
CREATE POLICY users_system_purge ON users FOR DELETE TO ledger_api
  USING (app_purgeable(deleted_at));
--> statement-breakpoint
CREATE POLICY predictions_system_purge ON predictions FOR DELETE TO ledger_api
  USING (app_purgeable(deleted_at));
--> statement-breakpoint
CREATE POLICY priors_system_purge ON priors FOR DELETE TO ledger_api
  USING (app_purgeable(deleted_at));
--> statement-breakpoint
CREATE POLICY body_states_system_purge ON body_states FOR DELETE TO ledger_api
  USING (app_purgeable(deleted_at));
--> statement-breakpoint
CREATE POLICY reinterpretations_system_purge ON reinterpretations FOR DELETE TO ledger_api
  USING (app_purgeable(deleted_at));
--> statement-breakpoint
CREATE POLICY journal_entries_system_purge ON journal_entries FOR DELETE TO ledger_api
  USING (app_purgeable(deleted_at));

-- ---------------------------------------------------------------------------
-- And the matching SELECT, which is not optional.
--
-- A DELETE whose WHERE clause reads a column needs SELECT permission and has
-- SELECT policies applied to it as well. Every SELECT policy in 0001 keys on
-- app_user_id(), and the system context has no user id — so without these the
-- purge job can see nothing, and therefore deletes nothing, silently.
--
-- The predicate is the same one, deliberately: the system role can read
-- exactly the rows it can delete, and no others. A live row stays invisible to
-- it, which is what keeps a bug in the job from becoming a cross-user read.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY users_system_purge_read ON users FOR SELECT TO ledger_api
  USING (app_purgeable(deleted_at));
--> statement-breakpoint
CREATE POLICY predictions_system_purge_read ON predictions FOR SELECT TO ledger_api
  USING (app_purgeable(deleted_at));
--> statement-breakpoint
CREATE POLICY priors_system_purge_read ON priors FOR SELECT TO ledger_api
  USING (app_purgeable(deleted_at));
--> statement-breakpoint
CREATE POLICY body_states_system_purge_read ON body_states FOR SELECT TO ledger_api
  USING (app_purgeable(deleted_at));
--> statement-breakpoint
CREATE POLICY reinterpretations_system_purge_read ON reinterpretations FOR SELECT TO ledger_api
  USING (app_purgeable(deleted_at));
--> statement-breakpoint
CREATE POLICY journal_entries_system_purge_read ON journal_entries FOR SELECT TO ledger_api
  USING (app_purgeable(deleted_at));

-- ---------------------------------------------------------------------------
-- The tables with no deleted_at of their own.
--
-- crisis_events, devices, prediction_priors and clinician_client_links have no
-- soft-delete column, and they are not given one: they hang off a user and
-- their foreign keys cascade. Deleting the users row removes them, which is
-- why the purge job deletes users last and why completeness does not depend on
-- the job listing every table correctly.
--
-- devices are the exception that cannot wait. A row there is a push token, and
-- a token that outlives the account is a notification sent to someone who
-- deleted their account. DELETE /v1/me removes them immediately, under the
-- user's own context — so devices is in the grant above and gets an owner
-- policy rather than a system one.
-- ---------------------------------------------------------------------------
--> statement-breakpoint
CREATE POLICY devices_owner_delete ON devices FOR DELETE TO ledger_api
  USING (user_id = app_user_id());

-- ---------------------------------------------------------------------------
-- Soft-deleting the rows in the first place.
--
-- The API role could already UPDATE these tables, and 0001's per-table
-- policies scope that to the owner, so no new policy is needed to *set*
-- deleted_at on a client's own rows. users is the exception: its UPDATE grant
-- is column-level and already covers (timezone, deleted_at).
-- ---------------------------------------------------------------------------
