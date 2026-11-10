-- The owner policies are declared in Drizzle; FORCE also covers table owners.
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "learning_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "practice_attempts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "daily_practice_completions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_schedules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Database-maintained audit time also covers raw SQL and non-Drizzle writers.
CREATE FUNCTION "mathaino_touch_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "users_touch_updated_at" BEFORE UPDATE ON "users"
FOR EACH ROW EXECUTE FUNCTION "mathaino_touch_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "auth_accounts_touch_updated_at" BEFORE UPDATE ON "auth_accounts"
FOR EACH ROW EXECUTE FUNCTION "mathaino_touch_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "auth_sessions_touch_updated_at" BEFORE UPDATE ON "auth_sessions"
FOR EACH ROW EXECUTE FUNCTION "mathaino_touch_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "bible_books_touch_updated_at" BEFORE UPDATE ON "bible_books"
FOR EACH ROW EXECUTE FUNCTION "mathaino_touch_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "bible_verses_touch_updated_at" BEFORE UPDATE ON "bible_verses"
FOR EACH ROW EXECUTE FUNCTION "mathaino_touch_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "learning_items_touch_updated_at" BEFORE UPDATE ON "learning_items"
FOR EACH ROW EXECUTE FUNCTION "mathaino_touch_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "review_schedules_touch_updated_at" BEFORE UPDATE ON "review_schedules"
FOR EACH ROW EXECUTE FUNCTION "mathaino_touch_updated_at"();
