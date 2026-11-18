ALTER TABLE "review_schedules" ADD COLUMN "interval_stage" integer;--> statement-breakpoint
UPDATE "review_schedules"
SET "interval_stage" = 0,
    "policy_id" = 'fixed-review-ladder-v1'
WHERE "interval_stage" IS NULL;--> statement-breakpoint
ALTER TABLE "review_schedules" ALTER COLUMN "interval_stage" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_schedules" ADD CONSTRAINT "review_schedules_interval_stage_valid" CHECK ("review_schedules"."interval_stage" between 0 and 6);
