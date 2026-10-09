ALTER TYPE "app"."job_status" ADD VALUE 'rate_limited' BEFORE 'expired';--> statement-breakpoint
DROP INDEX "app"."jobs_user_spent_idx";--> statement-breakpoint
CREATE INDEX "jobs_user_counted_idx" ON "app"."jobs" USING btree ("user_id","started_at","cost","variants") WHERE "app"."jobs"."status" in ('processing', 'succeeded');--> statement-breakpoint
CREATE VIEW "app"."image_usage_24h" AS (
      select j.user_id, sum(j.variants)::int as used, min(j.started_at) as oldest_started_at
        from app.jobs j
       where j.status in ('processing', 'succeeded')
         and j.started_at > now() - interval '24 hours'
       group by j.user_id
    );