CREATE TABLE "service_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "service_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "service_tokens_live_name_uq" ON "service_tokens" USING btree ("name") WHERE "service_tokens"."revoked_at" IS NULL;