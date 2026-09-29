CREATE TABLE "avatars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"pathname" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "avatars_pathname_unique" UNIQUE("pathname"),
	CONSTRAINT "avatars_size_positive" CHECK ("avatars"."width" > 0 AND "avatars"."height" > 0)
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avatar_image_id" uuid;--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avatars_household_id_idx" ON "avatars" USING btree ("household_id");--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_avatar_image_id_avatars_id_fk" FOREIGN KEY ("avatar_image_id") REFERENCES "public"."avatars"("id") ON DELETE no action ON UPDATE no action;