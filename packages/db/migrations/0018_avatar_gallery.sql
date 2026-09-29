CREATE TYPE "public"."avatar_pose" AS ENUM('idle', 'walk', 'emote');--> statement-breakpoint
CREATE TABLE "avatar_poses" (
	"avatar_id" uuid NOT NULL,
	"pose" "avatar_pose" NOT NULL,
	"pathname" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	CONSTRAINT "avatar_poses_avatar_id_pose_pk" PRIMARY KEY("avatar_id","pose"),
	CONSTRAINT "avatar_poses_pathname_unique" UNIQUE("pathname"),
	CONSTRAINT "avatar_poses_size_positive" CHECK ("avatar_poses"."width" > 0 AND "avatar_poses"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "avatars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avatar_image_id" uuid;--> statement-breakpoint
ALTER TABLE "avatar_poses" ADD CONSTRAINT "avatar_poses_avatar_id_avatars_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "public"."avatars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avatars_household_id_idx" ON "avatars" USING btree ("household_id");--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_avatar_image_id_avatars_id_fk" FOREIGN KEY ("avatar_image_id") REFERENCES "public"."avatars"("id") ON DELETE no action ON UPDATE no action;