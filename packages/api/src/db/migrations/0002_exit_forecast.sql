CREATE TYPE "public"."exit_move" AS ENUM('leave_early', 'not_really_try', 'explain_it_away', 'notice_only_the_bad', 'push_until_they_react', 'none');--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "exit_forecast" "exit_move";--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "exit_forecast_note_enc" "bytea";--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "exit_actual" "exit_move";--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "exit_actual_note_enc" "bytea";--> statement-breakpoint
-- Expose the two enums (never the encrypted notes) on the calibration-only view.
-- Postgres cannot insert columns mid-view with CREATE OR REPLACE; drop and recreate.
DROP VIEW IF EXISTS predictions_summary;
--> statement-breakpoint
CREATE VIEW predictions_summary WITH (security_barrier = true) AS
  SELECT p.id, p.user_id, p.confidence, p.revise_after_n, p.scheduled_for,
         p.resolved_at, p.outcome_verdict, p.outcome_source, p.surprise_rating,
         p.present_for_it, p.own_part, p.abandoned_at, p.abandon_reason,
         p.exit_forecast, p.exit_actual,
         p.created_at, p.client_updated_at, p.updated_at, p.deleted_at
  FROM predictions p
  WHERE p.user_id = app_user_id()
     OR app_link_allows(p.user_id, 'calibration');
--> statement-breakpoint
GRANT SELECT ON predictions_summary TO ledger_api;
