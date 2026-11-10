CREATE TABLE "learning_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"removal_policy" text DEFAULT 'archive' NOT NULL,
	"current_learning_item_id" uuid,
	"queue_version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_preferences_removal_policy_valid" CHECK ("learning_preferences"."removal_policy" in ('archive', 'delete')),
	CONSTRAINT "learning_preferences_queue_version_nonnegative" CHECK ("learning_preferences"."queue_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "learning_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "learning_items" ADD COLUMN "queue_order" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "learning_items_queue_order_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "learning_items" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learning_preferences" ADD CONSTRAINT "learning_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_preferences" ADD CONSTRAINT "learning_preferences_owned_current_item_fk" FOREIGN KEY ("user_id","current_learning_item_id") REFERENCES "public"."learning_items"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_items_active_queue_idx" ON "learning_items" USING btree ("user_id","state","queue_order") WHERE "learning_items"."archived_at" is null;--> statement-breakpoint
CREATE POLICY "learning_preferences_owner_access" ON "learning_preferences" AS PERMISSIVE FOR ALL TO public USING ("learning_preferences"."user_id" = nullif((select current_setting('mathaino.user_id', true)), '')::uuid) WITH CHECK ("learning_preferences"."user_id" = nullif((select current_setting('mathaino.user_id', true)), '')::uuid);
