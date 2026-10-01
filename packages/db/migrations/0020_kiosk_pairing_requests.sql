CREATE TYPE "public"."kiosk_pairing_status" AS ENUM('pending', 'approved', 'used');--> statement-breakpoint
CREATE TABLE "kiosk_pairing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"device" text NOT NULL,
	"status" "kiosk_pairing_status" DEFAULT 'pending' NOT NULL,
	"device_id" uuid,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	CONSTRAINT "kiosk_pairing_requests_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "kiosk_pairing_requests_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "kiosk_pairing_requests_approved_has_device" CHECK (("kiosk_pairing_requests"."status" = 'pending') = ("kiosk_pairing_requests"."device_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "kiosk_pairing_requests" ADD CONSTRAINT "kiosk_pairing_requests_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_pairing_requests" ADD CONSTRAINT "kiosk_pairing_requests_device_id_kiosk_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."kiosk_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_pairing_requests" ADD CONSTRAINT "kiosk_pairing_requests_approved_by_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kiosk_pairing_requests_created_at_idx" ON "kiosk_pairing_requests" USING btree ("created_at");