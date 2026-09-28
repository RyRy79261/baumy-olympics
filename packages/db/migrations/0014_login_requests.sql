CREATE TYPE "public"."login_request_status" AS ENUM('pending', 'approved', 'denied', 'used');--> statement-breakpoint
CREATE TABLE "login_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid,
	"secret_hash" text NOT NULL,
	"code" integer NOT NULL,
	"choices" integer[] NOT NULL,
	"device" text NOT NULL,
	"status" "login_request_status" DEFAULT 'pending' NOT NULL,
	"deny_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	CONSTRAINT "login_requests_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "login_requests_code_two_digits" CHECK ("login_requests"."code" BETWEEN 10 AND 99)
);
--> statement-breakpoint
ALTER TABLE "login_requests" ADD CONSTRAINT "login_requests_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_requests_member_id_idx" ON "login_requests" USING btree ("member_id","decided_at");--> statement-breakpoint
CREATE INDEX "login_requests_created_at_idx" ON "login_requests" USING btree ("created_at");