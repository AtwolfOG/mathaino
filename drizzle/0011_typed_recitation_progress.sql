CREATE TABLE "learning_success_days" (
	"user_id" uuid NOT NULL,
	"learning_item_id" uuid NOT NULL,
	"practice_date" date NOT NULL,
	"source_attempt_id" uuid NOT NULL,
	"time_zone" text NOT NULL,
	"day_policy" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_success_days_user_id_learning_item_id_practice_date_pk" PRIMARY KEY("user_id","learning_item_id","practice_date"),
	CONSTRAINT "learning_success_days_zone_nonempty" CHECK (btrim("learning_success_days"."time_zone") <> ''),
	CONSTRAINT "learning_success_days_policy_nonempty" CHECK (btrim("learning_success_days"."day_policy") <> '')
);
--> statement-breakpoint
ALTER TABLE "learning_success_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "learning_preferences" ADD COLUMN "mastery_threshold" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_preferences" ADD COLUMN "time_zone" text DEFAULT 'Etc/UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_owner_id_item_day_unique" UNIQUE("user_id","id","learning_item_id","practice_date");--> statement-breakpoint
ALTER TABLE "learning_success_days" ADD CONSTRAINT "learning_success_days_attempt_fk" FOREIGN KEY ("user_id","source_attempt_id","learning_item_id","practice_date") REFERENCES "public"."practice_attempts"("user_id","id","learning_item_id","practice_date") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_success_days_attempt_idx" ON "learning_success_days" USING btree ("user_id","source_attempt_id","learning_item_id","practice_date");--> statement-breakpoint
ALTER TABLE "learning_preferences" ADD CONSTRAINT "learning_preferences_mastery_threshold_valid" CHECK ("learning_preferences"."mastery_threshold" between 1 and 30);--> statement-breakpoint
ALTER TABLE "learning_preferences" ADD CONSTRAINT "learning_preferences_time_zone_nonempty" CHECK (btrim("learning_preferences"."time_zone") <> '');--> statement-breakpoint
CREATE POLICY "learning_success_days_owner_access" ON "learning_success_days" AS PERMISSIVE FOR ALL TO public USING ("learning_success_days"."user_id" = nullif((select current_setting('mathaino.user_id', true)), '')::uuid) WITH CHECK ("learning_success_days"."user_id" = nullif((select current_setting('mathaino.user_id', true)), '')::uuid);--> statement-breakpoint
ALTER TABLE "learning_success_days" FORCE ROW LEVEL SECURITY;
