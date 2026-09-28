CREATE TYPE "public"."chore_kind" AS ENUM('consumable', 'maintenance');--> statement-breakpoint
CREATE TABLE "reminder_acks" (
	"reminder_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"acked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_acks_reminder_id_member_id_pk" PRIMARY KEY("reminder_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" uuid,
	"completed_at" timestamp with time zone,
	CONSTRAINT "reminders_dismissed_together" CHECK (("reminders"."dismissed_at" IS NULL) = ("reminders"."dismissed_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "chores" ADD COLUMN "kind" "chore_kind" DEFAULT 'maintenance' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avatar" jsonb;--> statement-breakpoint
ALTER TABLE "reminder_acks" ADD CONSTRAINT "reminder_acks_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_acks" ADD CONSTRAINT "reminder_acks_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_dismissed_by_members_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_household_open_idx" ON "reminders" USING btree ("household_id","created_at") WHERE "reminders"."dismissed_at" IS NULL AND "reminders"."completed_at" IS NULL;