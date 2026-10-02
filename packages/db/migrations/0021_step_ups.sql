CREATE TYPE "public"."login_request_purpose" AS ENUM('sign_in', 'step_up');--> statement-breakpoint
CREATE TABLE "step_ups" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"method" text NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "step_ups_method" CHECK ("step_ups"."method" IN ('passkey', 'totp', 'baumy', 'password'))
);
--> statement-breakpoint
ALTER TABLE "login_requests" ADD COLUMN "purpose" "login_request_purpose" DEFAULT 'sign_in' NOT NULL;--> statement-breakpoint
ALTER TABLE "login_requests" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "step_ups" ADD CONSTRAINT "step_ups_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_ups" ADD CONSTRAINT "step_ups_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_requests" ADD CONSTRAINT "login_requests_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_requests" ADD CONSTRAINT "login_requests_step_up_has_session" CHECK (("login_requests"."purpose" = 'step_up') = ("login_requests"."session_id" IS NOT NULL));