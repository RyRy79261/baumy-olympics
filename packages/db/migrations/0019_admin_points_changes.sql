CREATE TYPE "public"."weight_change_origin" AS ENUM('measured', 'admin');--> statement-breakpoint
DROP INDEX "weight_suggestions_chore_week_uq";--> statement-breakpoint
ALTER TABLE "weight_suggestions" ALTER COLUMN "window_start" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_suggestions" ALTER COLUMN "window_end" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_suggestions" ALTER COLUMN "sample_intervals" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_suggestions" ALTER COLUMN "median_interval_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_suggestions" ALTER COLUMN "raw_points" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_suggestions" ALTER COLUMN "suggested_points" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_suggestions" ALTER COLUMN "suggested_cooldown_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_suggestions" ADD COLUMN "origin" "weight_change_origin" DEFAULT 'measured' NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_suggestions" ADD COLUMN "reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "weight_suggestions_chore_week_uq" ON "weight_suggestions" USING btree ("chore_id","week_start") WHERE "weight_suggestions"."origin" = 'measured';--> statement-breakpoint
ALTER TABLE "weight_suggestions" ADD CONSTRAINT "weight_suggestions_measured_has_measurement" CHECK ("weight_suggestions"."origin" <> 'measured' OR ("weight_suggestions"."window_start" IS NOT NULL AND "weight_suggestions"."window_end" IS NOT NULL AND "weight_suggestions"."sample_intervals" IS NOT NULL AND "weight_suggestions"."median_interval_minutes" IS NOT NULL AND "weight_suggestions"."raw_points" IS NOT NULL AND "weight_suggestions"."suggested_points" IS NOT NULL AND "weight_suggestions"."suggested_cooldown_minutes" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "weight_suggestions" ADD CONSTRAINT "weight_suggestions_admin_scheduled" CHECK ("weight_suggestions"."origin" <> 'admin' OR ("weight_suggestions"."status" <> 'open' AND "weight_suggestions"."scheduled_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "weight_suggestions" ADD CONSTRAINT "weight_suggestions_reason_length" CHECK ("weight_suggestions"."reason" IS NULL OR char_length("weight_suggestions"."reason") BETWEEN 1 AND 280);