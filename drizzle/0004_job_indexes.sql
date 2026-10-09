DROP INDEX "app"."jobs_user_created_idx";
DROP INDEX "app"."jobs_status_started_idx";
CREATE INDEX "jobs_user_created_id_idx" ON "app"."jobs" USING btree ("user_id","created_at","id");
CREATE INDEX "jobs_user_spent_idx" ON "app"."jobs" USING btree ("user_id","cost") WHERE "app"."jobs"."status" in ('processing', 'succeeded');
CREATE INDEX "jobs_processing_started_idx" ON "app"."jobs" USING btree ("started_at") WHERE "app"."jobs"."status" = 'processing';
CREATE INDEX "jobs_awaiting_created_idx" ON "app"."jobs" USING btree ("created_at") WHERE "app"."jobs"."status" = 'awaiting_upload';