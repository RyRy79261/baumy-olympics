CREATE TABLE "mcp_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_access_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "mcp_access_tokens_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "mcp_auth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"client_secret_hash" text,
	"client_name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"token_endpoint_auth_method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_oauth_clients_auth_method" CHECK ("mcp_oauth_clients"."token_endpoint_auth_method" IN ('none', 'client_secret_basic', 'client_secret_post')),
	CONSTRAINT "mcp_oauth_clients_secret_matches_method" CHECK (("mcp_oauth_clients"."client_secret_hash" IS NULL) = ("mcp_oauth_clients"."token_endpoint_auth_method" = 'none'))
);
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_client_id_mcp_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_auth_codes" ADD CONSTRAINT "mcp_auth_codes_client_id_mcp_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_auth_codes" ADD CONSTRAINT "mcp_auth_codes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_access_tokens_member_id_idx" ON "mcp_access_tokens" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "mcp_access_tokens_grant_id_idx" ON "mcp_access_tokens" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "mcp_auth_codes_member_id_idx" ON "mcp_auth_codes" USING btree ("member_id");