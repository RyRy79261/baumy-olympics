CREATE TYPE "public"."completion_status" AS ENUM('pending', 'confirmed', 'finalized', 'disputed', 'voided');--> statement-breakpoint
CREATE TYPE "public"."confirm_mode" AS ENUM('optimistic', 'partner');--> statement-breakpoint
CREATE TYPE "public"."dispute_resolution" AS ENUM('withdrawn', 'conceded', 'undone', 'upheld', 'overruled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."prize_mode" AS ENUM('points', 'heaviest_streak', 'longest_streak');--> statement-breakpoint
CREATE TYPE "public"."proof_mode" AS ENUM('none', 'optional', 'required');--> statement-breakpoint
CREATE TYPE "public"."rule_source" AS ENUM('seed', 'manual', 'suggestion');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('active', 'closing', 'closed');--> statement-breakpoint
CREATE TYPE "public"."void_reason" AS ENUM('unconfirmed', 'conceded', 'disputed', 'undone');--> statement-breakpoint
CREATE TABLE "chore_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chore_id" uuid NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"base_points" integer NOT NULL,
	"cooldown_minutes" integer NOT NULL,
	"source" "rule_source" NOT NULL,
	"suggestion_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chore_rule_versions_base_points_range" CHECK ("chore_rule_versions"."base_points" BETWEEN 1 AND 200),
	CONSTRAINT "chore_rule_versions_cooldown_non_negative" CHECK ("chore_rule_versions"."cooldown_minutes" >= 0),
	CONSTRAINT "chore_rule_versions_suggestion_source" CHECK (("chore_rule_versions"."suggestion_id" IS NULL) OR ("chore_rule_versions"."source" = 'suggestion'))
);
--> statement-breakpoint
CREATE TABLE "chores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sprite" text NOT NULL,
	"proof_mode" "proof_mode" DEFAULT 'none' NOT NULL,
	"confirm_mode" "confirm_mode" DEFAULT 'optimistic' NOT NULL,
	"effort_factor_pct" integer DEFAULT 100 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chores_effort_factor_pct_range" CHECK ("chores"."effort_factor_pct" BETWEEN 50 AND 300)
);
--> statement-breakpoint
CREATE TABLE "completion_scores" (
	"completion_id" uuid PRIMARY KEY NOT NULL,
	"rule_version_id" uuid NOT NULL,
	"ruleset_version" integer NOT NULL,
	"streak_len" integer NOT NULL,
	"multiplier_pct" integer NOT NULL,
	"base_pts" integer NOT NULL,
	"streak_pts" integer NOT NULL,
	"broken_member_id" uuid,
	"broken_len" integer,
	"break_pts" integer NOT NULL,
	"total_pts" integer NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "completion_scores_streak_len_positive" CHECK ("completion_scores"."streak_len" >= 1),
	CONSTRAINT "completion_scores_total" CHECK ("completion_scores"."total_pts" = "completion_scores"."streak_pts" + "completion_scores"."break_pts"),
	CONSTRAINT "completion_scores_broken_pair" CHECK (("completion_scores"."broken_member_id" IS NULL) = ("completion_scores"."broken_len" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"chore_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"done_by" uuid NOT NULL,
	"logged_by" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"source" "surface" NOT NULL,
	"status" "completion_status" NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"finalizes_at" timestamp with time zone,
	"photo_pathname" text,
	"photo_attached_at" timestamp with time zone,
	"note" text,
	"void_reason" "void_reason",
	"client_request_id" text NOT NULL,
	CONSTRAINT "completions_void_reason_iff_voided" CHECK (("completions"."status" = 'voided') = ("completions"."void_reason" IS NOT NULL)),
	CONSTRAINT "completions_verified_pair" CHECK (("completions"."verified_by" IS NULL) = ("completions"."verified_at" IS NULL)),
	CONSTRAINT "completions_confirmed_is_verified" CHECK ("completions"."status" <> 'confirmed' OR "completions"."verified_by" IS NOT NULL),
	CONSTRAINT "completions_photo_has_time" CHECK ("completions"."photo_pathname" IS NULL OR "completions"."photo_attached_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"completion_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"resolution" "dispute_resolution",
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_reason_not_blank" CHECK (btrim("disputes"."reason") <> ''),
	CONSTRAINT "disputes_resolution_pair" CHECK (("disputes"."resolution" IS NULL) = ("disputes"."resolved_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "point_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_adjustments_points_nonzero" CHECK ("point_adjustments"."points" <> 0),
	CONSTRAINT "point_adjustments_approver_not_creator" CHECK ("point_adjustments"."approved_by" <> "point_adjustments"."created_by"),
	CONSTRAINT "point_adjustments_approved_pair" CHECK (("point_adjustments"."approved_by" IS NULL) = ("point_adjustments"."approved_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "pot_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"contributed_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pot_contributions_amount_positive" CHECK ("pot_contributions"."amount_cents" > 0),
	CONSTRAINT "pot_contributions_month_first_day" CHECK (extract(day from "pot_contributions"."month") = 1)
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"prize_mode" "prize_mode" DEFAULT 'points' NOT NULL,
	"status" "season_status" DEFAULT 'active' NOT NULL,
	"winner_member_id" uuid,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_ends_after_start" CHECK ("seasons"."ends_at" > "seasons"."starts_at"),
	CONSTRAINT "seasons_winner_only_when_closed" CHECK ("seasons"."winner_member_id" IS NULL OR "seasons"."status" = 'closed')
);
--> statement-breakpoint
ALTER TABLE "chore_rule_versions" ADD CONSTRAINT "chore_rule_versions_chore_id_chores_id_fk" FOREIGN KEY ("chore_id") REFERENCES "public"."chores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_rule_versions" ADD CONSTRAINT "chore_rule_versions_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chores" ADD CONSTRAINT "chores_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_scores" ADD CONSTRAINT "completion_scores_completion_id_completions_id_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."completions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_scores" ADD CONSTRAINT "completion_scores_rule_version_id_chore_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."chore_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_scores" ADD CONSTRAINT "completion_scores_broken_member_id_members_id_fk" FOREIGN KEY ("broken_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_chore_id_chores_id_fk" FOREIGN KEY ("chore_id") REFERENCES "public"."chores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_done_by_members_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_logged_by_members_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_verified_by_members_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_completion_id_completions_id_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."completions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_members_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_adjustments" ADD CONSTRAINT "point_adjustments_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_adjustments" ADD CONSTRAINT "point_adjustments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_adjustments" ADD CONSTRAINT "point_adjustments_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_adjustments" ADD CONSTRAINT "point_adjustments_approved_by_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_contributions" ADD CONSTRAINT "pot_contributions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_contributions" ADD CONSTRAINT "pot_contributions_contributed_by_members_id_fk" FOREIGN KEY ("contributed_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_winner_member_id_members_id_fk" FOREIGN KEY ("winner_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chore_rule_versions_chore_effective_from_uq" ON "chore_rule_versions" USING btree ("chore_id","effective_from");--> statement-breakpoint
CREATE INDEX "chores_household_id_idx" ON "chores" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "completions_household_client_request_uq" ON "completions" USING btree ("household_id","client_request_id");--> statement-breakpoint
CREATE INDEX "completions_chore_season_occurred_idx" ON "completions" USING btree ("chore_id","season_id","occurred_at");--> statement-breakpoint
CREATE INDEX "completions_season_idx" ON "completions" USING btree ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_one_open_per_completion_uq" ON "disputes" USING btree ("completion_id") WHERE "disputes"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "disputes_completion_id_idx" ON "disputes" USING btree ("completion_id");--> statement-breakpoint
CREATE INDEX "point_adjustments_season_id_idx" ON "point_adjustments" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "pot_contributions_season_id_idx" ON "pot_contributions" USING btree ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_household_year_uq" ON "seasons" USING btree ("household_id","year");