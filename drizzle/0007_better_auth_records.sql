CREATE TABLE "auth_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key"),
	CONSTRAINT "auth_rate_limits_count_nonnegative" CHECK ("auth_rate_limits"."count" >= 0),
	CONSTRAINT "auth_rate_limits_time_nonnegative" CHECK ("auth_rate_limits"."last_request" >= 0)
);
--> statement-breakpoint
ALTER TABLE "auth_rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_sessions" ALTER COLUMN "token_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "access_token" text;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "id_token" text;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "refresh_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "token" text;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "ip_address" text;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "auth_verifications_expiry_idx" ON "auth_verifications" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_token_unique" UNIQUE("token");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_one_credential" CHECK (("auth_sessions"."token_hash" is not null) <> ("auth_sessions"."token" is not null));--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_token_nonempty" CHECK ("auth_sessions"."token" is null or btrim("auth_sessions"."token") <> '');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_canonical" CHECK ("users"."email" = lower(btrim("users"."email")));--> statement-breakpoint
CREATE POLICY "auth_accounts_authentication_access" ON "auth_accounts" AS PERMISSIVE FOR ALL TO "mathaino_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "auth_sessions_authentication_access" ON "auth_sessions" AS PERMISSIVE FOR ALL TO "mathaino_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "users_authentication_access" ON "users" AS PERMISSIVE FOR ALL TO "mathaino_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "auth_rate_limits_service_access" ON "auth_rate_limits" AS PERMISSIVE FOR ALL TO "mathaino_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "auth_verifications_service_access" ON "auth_verifications" AS PERMISSIVE FOR ALL TO "mathaino_auth" USING (true) WITH CHECK (true);