CREATE INDEX "learning_preferences_current_item_idx" ON "learning_preferences" USING btree ("user_id","current_learning_item_id");
--> statement-breakpoint
ALTER TABLE "learning_preferences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER "learning_preferences_touch_updated_at"
BEFORE UPDATE ON "learning_preferences"
FOR EACH ROW EXECUTE FUNCTION "mathaino_touch_updated_at"();
