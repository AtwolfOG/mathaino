CREATE TABLE "learning_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"verse_id" uuid NOT NULL,
	"state" text DEFAULT 'learning' NOT NULL,
	"mastered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_items_user_verse_unique" UNIQUE("user_id","verse_id"),
	CONSTRAINT "learning_items_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "learning_items_owner_id_state_unique" UNIQUE("user_id","id","state"),
	CONSTRAINT "learning_items_state_valid" CHECK ("learning_items"."state" in ('learning', 'mastered')),
	CONSTRAINT "learning_items_mastery_consistent" CHECK (("learning_items"."state" = 'mastered') = ("learning_items"."mastered_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "learning_items" ADD CONSTRAINT "learning_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_items" ADD CONSTRAINT "learning_items_verse_id_bible_verses_id_fk" FOREIGN KEY ("verse_id") REFERENCES "public"."bible_verses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_items_user_state_idx" ON "learning_items" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "learning_items_verse_idx" ON "learning_items" USING btree ("verse_id");