CREATE TABLE "daily_practice_completions" (
	"user_id" uuid NOT NULL,
	"practice_date" date NOT NULL,
	"source_attempt_id" uuid NOT NULL,
	"time_zone" text NOT NULL,
	"day_policy" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_practice_completions_user_id_practice_date_pk" PRIMARY KEY("user_id","practice_date"),
	CONSTRAINT "daily_completion_zone_nonempty" CHECK (btrim("daily_practice_completions"."time_zone") <> ''),
	CONSTRAINT "daily_completion_policy_nonempty" CHECK (btrim("daily_practice_completions"."day_policy") <> '')
);
--> statement-breakpoint
CREATE TABLE "practice_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"learning_item_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"mode" text NOT NULL,
	"purpose" text NOT NULL,
	"outcome" text NOT NULL,
	"practiced_at" timestamp with time zone NOT NULL,
	"practice_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"assessment_policy" text NOT NULL,
	"day_policy" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_attempts_user_operation_unique" UNIQUE("user_id","operation_id"),
	CONSTRAINT "practice_attempts_owner_id_day_unique" UNIQUE("user_id","id","practice_date"),
	CONSTRAINT "practice_attempts_mode_valid" CHECK ("practice_attempts"."mode" in ('typing', 'voice')),
	CONSTRAINT "practice_attempts_purpose_valid" CHECK ("practice_attempts"."purpose" in ('learning', 'review')),
	CONSTRAINT "practice_attempts_outcome_valid" CHECK ("practice_attempts"."outcome" in ('success', 'failure')),
	CONSTRAINT "practice_attempts_hash_sha256" CHECK ("practice_attempts"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "practice_attempts_zone_nonempty" CHECK (btrim("practice_attempts"."time_zone") <> ''),
	CONSTRAINT "practice_attempts_assessment_nonempty" CHECK (btrim("practice_attempts"."assessment_policy") <> ''),
	CONSTRAINT "practice_attempts_day_policy_nonempty" CHECK (btrim("practice_attempts"."day_policy") <> '')
);
--> statement-breakpoint
CREATE TABLE "review_schedules" (
	"learning_item_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"learning_state" text DEFAULT 'mastered' NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"policy_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_schedules_mastered_only" CHECK ("review_schedules"."learning_state" = 'mastered'),
	CONSTRAINT "review_schedules_policy_nonempty" CHECK (btrim("review_schedules"."policy_id") <> '')
);
--> statement-breakpoint
ALTER TABLE "daily_practice_completions" ADD CONSTRAINT "daily_completion_owned_day_attempt_fk" FOREIGN KEY ("user_id","source_attempt_id","practice_date") REFERENCES "public"."practice_attempts"("user_id","id","practice_date") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_owned_item_fk" FOREIGN KEY ("user_id","learning_item_id") REFERENCES "public"."learning_items"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_schedules" ADD CONSTRAINT "review_schedules_owned_mastered_item_fk" FOREIGN KEY ("user_id","learning_item_id","learning_state") REFERENCES "public"."learning_items"("user_id","id","state") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "daily_completion_attempt_idx" ON "daily_practice_completions" USING btree ("user_id","source_attempt_id","practice_date");--> statement-breakpoint
CREATE INDEX "practice_attempts_item_time_idx" ON "practice_attempts" USING btree ("user_id","learning_item_id","practiced_at");--> statement-breakpoint
CREATE INDEX "practice_attempts_user_day_idx" ON "practice_attempts" USING btree ("user_id","practice_date");--> statement-breakpoint
CREATE INDEX "review_schedules_owner_item_idx" ON "review_schedules" USING btree ("user_id","learning_item_id","learning_state");--> statement-breakpoint
CREATE INDEX "review_schedules_user_due_idx" ON "review_schedules" USING btree ("user_id","next_due_at");