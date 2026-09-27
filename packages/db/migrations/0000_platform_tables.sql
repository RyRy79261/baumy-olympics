CREATE TYPE "public"."action_request_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."surface" AS ENUM('ui', 'kiosk', 'ai', 'mcp', 'brain');--> statement-breakpoint
CREATE TABLE "action_rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_requests" (
	"actor_member_id" uuid NOT NULL,
	"source" "surface" NOT NULL,
	"request_id" text NOT NULL,
	"action" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" "action_request_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_requests_actor_member_id_source_request_id_pk" PRIMARY KEY("actor_member_id","source","request_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_member_id" uuid NOT NULL,
	"source" "surface" NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"payload" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tz" text DEFAULT 'Europe/Berlin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"auth_user_id" text,
	"display_name" text NOT NULL,
	"avatar_sprite" text NOT NULL,
	"color" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"kiosk_pin_hash" text,
	"kiosk_pin_locked_at" timestamp with time zone,
	"telegram_user_id" bigint,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "members_telegram_user_id_unique" UNIQUE("telegram_user_id")
);
--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_rate_limit_window_start_idx" ON "action_rate_limit" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "audit_events_at_idx" ON "audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "members_household_id_idx" ON "members" USING btree ("household_id");