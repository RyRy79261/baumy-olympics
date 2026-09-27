CREATE TYPE "public"."weight_suggestion_status" AS ENUM('open', 'scheduled', 'dismissed', 'vetoed', 'applied', 'superseded');--> statement-breakpoint
CREATE TABLE "weight_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"chore_id" uuid NOT NULL,
	"week_start" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"sample_intervals" integer[] NOT NULL,
	"median_interval_minutes" integer NOT NULL,
	"raw_points" double precision NOT NULL,
	"current_points" integer NOT NULL,
	"current_cooldown_minutes" integer NOT NULL,
	"suggested_points" integer NOT NULL,
	"suggested_cooldown_minutes" integer NOT NULL,
	"status" "weight_suggestion_status" DEFAULT 'open' NOT NULL,
	"scheduled_points" integer,
	"scheduled_cooldown_minutes" integer,
	"applies_at" timestamp with time zone,
	"scheduled_by" uuid,
	"scheduled_at" timestamp with time zone,
	"dismissed_by" uuid,
	"dismissed_at" timestamp with time zone,
	"vetoed_by" uuid,
	"vetoed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	CONSTRAINT "weight_suggestions_suggested_points_range" CHECK ("weight_suggestions"."suggested_points" BETWEEN 5 AND 60),
	CONSTRAINT "weight_suggestions_scheduled_points_range" CHECK ("weight_suggestions"."scheduled_points" BETWEEN 1 AND 200),
	CONSTRAINT "weight_suggestions_cooldowns_non_negative" CHECK ("weight_suggestions"."suggested_cooldown_minutes" >= 0 AND "weight_suggestions"."scheduled_cooldown_minutes" >= 0),
	CONSTRAINT "weight_suggestions_scheduled_has_schedule" CHECK ("weight_suggestions"."status" NOT IN ('scheduled', 'vetoed', 'applied') OR ("weight_suggestions"."applies_at" IS NOT NULL AND "weight_suggestions"."scheduled_by" IS NOT NULL AND "weight_suggestions"."scheduled_at" IS NOT NULL AND "weight_suggestions"."scheduled_points" IS NOT NULL AND "weight_suggestions"."scheduled_cooldown_minutes" IS NOT NULL)),
	CONSTRAINT "weight_suggestions_open_unscheduled" CHECK ("weight_suggestions"."status" <> 'open' OR "weight_suggestions"."applies_at" IS NULL),
	CONSTRAINT "weight_suggestions_dismissed" CHECK (("weight_suggestions"."status" = 'dismissed') = ("weight_suggestions"."dismissed_by" IS NOT NULL AND "weight_suggestions"."dismissed_at" IS NOT NULL)),
	CONSTRAINT "weight_suggestions_vetoed" CHECK (("weight_suggestions"."status" = 'vetoed') = ("weight_suggestions"."vetoed_by" IS NOT NULL AND "weight_suggestions"."vetoed_at" IS NOT NULL)),
	CONSTRAINT "weight_suggestions_applied" CHECK (("weight_suggestions"."status" = 'applied') = ("weight_suggestions"."applied_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "weight_suggestions" ADD CONSTRAINT "weight_suggestions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_suggestions" ADD CONSTRAINT "weight_suggestions_chore_id_chores_id_fk" FOREIGN KEY ("chore_id") REFERENCES "public"."chores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_suggestions" ADD CONSTRAINT "weight_suggestions_scheduled_by_members_id_fk" FOREIGN KEY ("scheduled_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_suggestions" ADD CONSTRAINT "weight_suggestions_dismissed_by_members_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_suggestions" ADD CONSTRAINT "weight_suggestions_vetoed_by_members_id_fk" FOREIGN KEY ("vetoed_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "weight_suggestions_chore_week_uq" ON "weight_suggestions" USING btree ("chore_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_suggestions_one_active_per_chore_uq" ON "weight_suggestions" USING btree ("chore_id") WHERE "weight_suggestions"."status" IN ('open', 'scheduled');--> statement-breakpoint
CREATE INDEX "weight_suggestions_scheduled_idx" ON "weight_suggestions" USING btree ("applies_at") WHERE "weight_suggestions"."status" = 'scheduled';--> statement-breakpoint
ALTER TABLE "chore_rule_versions" ADD CONSTRAINT "chore_rule_versions_suggestion_id_weight_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."weight_suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chore_rule_versions_suggestion_id_uq" ON "chore_rule_versions" USING btree ("suggestion_id");