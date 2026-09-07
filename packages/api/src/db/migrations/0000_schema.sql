CREATE TYPE "public"."abandon_reason" AS ENUM('situation_did_not_occur', 'avoided', 'left_early', 'forgot', 'other');--> statement-breakpoint
CREATE TYPE "public"."body_channel" AS ENUM('heart', 'breath', 'head', 'unreality', 'stomach', 'muscle', 'legs_vision', 'numb');--> statement-breakpoint
CREATE TYPE "public"."body_phase" AS ENUM('before', 'after');--> statement-breakpoint
CREATE TYPE "public"."credited_to" AS ENUM('body', 'kit', 'person', 'technique', 'luck');--> statement-breakpoint
CREATE TYPE "public"."crisis_source" AS ENUM('prediction', 'journal', 'body_state', 'checkin');--> statement-breakpoint
CREATE TYPE "public"."kit_item" AS ENUM('water', 'medication', 'exit_seat', 'phone', 'safe_person', 'breathing_technique', 'alcohol', 'other');--> statement-breakpoint
CREATE TYPE "public"."link_status" AS ENUM('pending', 'active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."outcome_source" AS ENUM('observed', 'inferred');--> statement-breakpoint
CREATE TYPE "public"."outcome_verdict" AS ENUM('hit', 'partial', 'miss', 'unclear');--> statement-breakpoint
CREATE TYPE "public"."own_part" AS ENUM('none', 'made_it_likelier', 'held_back', 'unsure');--> statement-breakpoint
CREATE TYPE "public"."prior_category" AS ENUM('mattering', 'rank', 'body', 'effort', 'self_story', 'other');--> statement-breakpoint
CREATE TYPE "public"."prior_origin" AS ENUM('client', 'clustered', 'clinician');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('client', 'clinician');--> statement-breakpoint
CREATE TYPE "public"."verdict_arrived" AS ENUM('yes', 'partly', 'no');--> statement-breakpoint
CREATE TABLE "body_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"prediction_id" uuid NOT NULL,
	"phase" "body_phase" NOT NULL,
	"channels" "body_channel"[],
	"intensity" smallint,
	"words_enc" "bytea",
	"verdict_enc" "bytea",
	"verdict_confidence" smallint,
	"room_enc" "bytea",
	"kit_present" "kit_item"[],
	"substances_last_12h" boolean,
	"sleep_hours" real,
	"scan_triggered" boolean,
	"peak_intensity" smallint,
	"ran_past_peak" boolean,
	"time_to_crest_min" smallint,
	"verdict_arrived" "verdict_arrived",
	"credited_to" "credited_to",
	"kit_used" "kit_item"[],
	"felt_vs_observed_enc" "bytea",
	"word_now_enc" "bytea",
	"key_version" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"client_updated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "body_states_intensity_range" CHECK ("body_states"."intensity" IS NULL OR "body_states"."intensity" BETWEEN 0 AND 10),
	CONSTRAINT "body_states_peak_range" CHECK ("body_states"."peak_intensity" IS NULL OR "body_states"."peak_intensity" BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE TABLE "clinician_client_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinician_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "link_status" DEFAULT 'pending' NOT NULL,
	"requested_by" "user_role" NOT NULL,
	"share_calibration" boolean DEFAULT true NOT NULL,
	"share_predictions" boolean DEFAULT false NOT NULL,
	"share_priors" boolean DEFAULT true NOT NULL,
	"share_body_states" boolean DEFAULT false NOT NULL,
	"share_crisis_events" boolean DEFAULT true NOT NULL,
	"consented_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_not_self" CHECK ("clinician_client_links"."clinician_id" <> "clinician_client_links"."client_id")
);
--> statement-breakpoint
CREATE TABLE "crisis_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "crisis_source" NOT NULL,
	"source_entry_id" uuid NOT NULL,
	"rule_ids" text[] NOT NULL,
	"resources_shown" text[] NOT NULL,
	"detected_on_device" boolean NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"clinician_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expo_push_token" text,
	"last_pull_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"prediction_id" uuid,
	"body_enc" "bytea" NOT NULL,
	"shared_at" timestamp with time zone,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"client_updated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prediction_priors" (
	"prediction_id" uuid NOT NULL,
	"prior_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by" "prior_origin" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_priors_prediction_id_prior_id_pk" PRIMARY KEY("prediction_id","prior_id")
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"situation_enc" "bytea" NOT NULL,
	"expected_outcome_enc" "bytea" NOT NULL,
	"confidence" smallint NOT NULL,
	"revise_after_n" smallint,
	"scheduled_for" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"actual_outcome_enc" "bytea",
	"outcome_verdict" "outcome_verdict",
	"outcome_source" "outcome_source",
	"surprise_rating" smallint,
	"present_for_it" boolean,
	"own_part" "own_part",
	"abandoned_at" timestamp with time zone,
	"abandon_reason" "abandon_reason",
	"key_version" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"client_updated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "predictions_id_user_uq" UNIQUE("id","user_id"),
	CONSTRAINT "predictions_confidence_range" CHECK ("predictions"."confidence" BETWEEN 0 AND 100),
	CONSTRAINT "predictions_surprise_range" CHECK ("predictions"."surprise_rating" IS NULL OR "predictions"."surprise_rating" BETWEEN 0 AND 10),
	CONSTRAINT "predictions_resolved_has_verdict" CHECK ("predictions"."resolved_at" IS NULL OR "predictions"."outcome_verdict" IS NOT NULL),
	CONSTRAINT "predictions_resolved_xor_abandoned" CHECK (NOT ("predictions"."resolved_at" IS NOT NULL AND "predictions"."abandoned_at" IS NOT NULL)),
	CONSTRAINT "predictions_abandoned_has_reason" CHECK ("predictions"."abandoned_at" IS NULL OR "predictions"."abandon_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "priors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"label_enc" "bytea" NOT NULL,
	"category" "prior_category" DEFAULT 'other' NOT NULL,
	"origin" "prior_origin" NOT NULL,
	"safe_to_test" boolean,
	"retired_at" timestamp with time zone,
	"created_by" "user_role" NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"client_updated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "priors_id_user_uq" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "reinterpretations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"prediction_id" uuid NOT NULL,
	"text_enc" "bytea" NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"client_updated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role" "user_role" DEFAULT 'client' NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "body_states" ADD CONSTRAINT "body_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_states" ADD CONSTRAINT "body_states_prediction_owner_fk" FOREIGN KEY ("prediction_id","user_id") REFERENCES "public"."predictions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinician_client_links" ADD CONSTRAINT "clinician_client_links_clinician_id_users_id_fk" FOREIGN KEY ("clinician_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinician_client_links" ADD CONSTRAINT "clinician_client_links_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crisis_events" ADD CONSTRAINT "crisis_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_prediction_owner_fk" FOREIGN KEY ("prediction_id","user_id") REFERENCES "public"."predictions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_priors" ADD CONSTRAINT "prediction_priors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_priors" ADD CONSTRAINT "prediction_priors_prediction_owner_fk" FOREIGN KEY ("prediction_id","user_id") REFERENCES "public"."predictions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_priors" ADD CONSTRAINT "prediction_priors_prior_owner_fk" FOREIGN KEY ("prior_id","user_id") REFERENCES "public"."priors"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priors" ADD CONSTRAINT "priors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reinterpretations" ADD CONSTRAINT "reinterpretations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reinterpretations" ADD CONSTRAINT "reinterpretations_prediction_owner_fk" FOREIGN KEY ("prediction_id","user_id") REFERENCES "public"."predictions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "body_states_prediction_phase_uq" ON "body_states" USING btree ("prediction_id","phase");--> statement-breakpoint
CREATE INDEX "body_states_user_updated_idx" ON "body_states" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "links_pair_uq" ON "clinician_client_links" USING btree ("clinician_id","client_id");--> statement-breakpoint
CREATE INDEX "links_client_idx" ON "clinician_client_links" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "links_clinician_idx" ON "clinician_client_links" USING btree ("clinician_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "crisis_dedupe_uq" ON "crisis_events" USING btree ("user_id","source","source_entry_id");--> statement-breakpoint
CREATE INDEX "crisis_user_idx" ON "crisis_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "journal_user_updated_idx" ON "journal_entries" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "prediction_priors_prior_idx" ON "prediction_priors" USING btree ("prior_id");--> statement-breakpoint
CREATE INDEX "predictions_user_created_idx" ON "predictions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "predictions_user_updated_idx" ON "predictions" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "predictions_user_open_idx" ON "predictions" USING btree ("user_id") WHERE "predictions"."resolved_at" IS NULL AND "predictions"."abandoned_at" IS NULL AND "predictions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "priors_user_updated_idx" ON "priors" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "reinterpretations_prediction_idx" ON "reinterpretations" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "reinterpretations_user_updated_idx" ON "reinterpretations" USING btree ("user_id","updated_at");