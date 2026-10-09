DROP INDEX "app"."jobs_user_created_idx";--> statement-breakpoint
DROP INDEX "app"."jobs_status_started_idx";--> statement-breakpoint
CREATE INDEX "jobs_user_created_id_idx" ON "app"."jobs" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "jobs_user_spent_idx" ON "app"."jobs" USING btree ("user_id","cost") WHERE "app"."jobs"."status" in ('processing', 'succeeded');--> statement-breakpoint
CREATE INDEX "jobs_processing_started_idx" ON "app"."jobs" USING btree ("started_at") WHERE "app"."jobs"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "jobs_awaiting_created_idx" ON "app"."jobs" USING btree ("created_at") WHERE "app"."jobs"."status" = 'awaiting_upload';