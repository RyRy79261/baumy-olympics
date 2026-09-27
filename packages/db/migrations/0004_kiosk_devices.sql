CREATE TABLE "kiosk_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text,
	"pairing_code_hash" text,
	"pairing_expires_at" timestamp with time zone,
	"paired_by" uuid NOT NULL,
	"paired_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kiosk_devices_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "kiosk_devices_pairing_code_hash_unique" UNIQUE("pairing_code_hash"),
	CONSTRAINT "kiosk_devices_paired_has_token" CHECK (("kiosk_devices"."paired_at" IS NULL) = ("kiosk_devices"."token_hash" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "kiosk_devices" ADD CONSTRAINT "kiosk_devices_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_devices" ADD CONSTRAINT "kiosk_devices_paired_by_members_id_fk" FOREIGN KEY ("paired_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kiosk_devices_household_id_idx" ON "kiosk_devices" USING btree ("household_id");