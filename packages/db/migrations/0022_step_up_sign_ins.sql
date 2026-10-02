CREATE TABLE "step_up_totp_steps" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_step" bigint NOT NULL,
	"used_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "step_ups" DROP CONSTRAINT "step_ups_method";--> statement-breakpoint
ALTER TABLE "step_up_totp_steps" ADD CONSTRAINT "step_up_totp_steps_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_ups" ADD CONSTRAINT "step_ups_method" CHECK ("step_ups"."method" IN ('passkey', 'totp', 'baumy', 'password', 'google', 'backup_code'));