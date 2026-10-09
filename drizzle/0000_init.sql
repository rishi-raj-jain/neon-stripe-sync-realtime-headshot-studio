CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."job_status" AS ENUM('awaiting_upload', 'processing', 'succeeded', 'failed', 'insufficient_credits', 'expired');--> statement-breakpoint
CREATE TABLE "app"."customers" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "app"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"style" text NOT NULL,
	"variants" smallint NOT NULL,
	"cost" integer NOT NULL,
	"status" "app"."job_status" DEFAULT 'awaiting_upload' NOT NULL,
	"input_key" text NOT NULL,
	"input_content_type" text NOT NULL,
	"output_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"error" text,
	"invocation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_input_key_unique" UNIQUE("input_key"),
	CONSTRAINT "jobs_variants_check" CHECK ("app"."jobs"."variants" between 1 and 4),
	CONSTRAINT "jobs_cost_check" CHECK ("app"."jobs"."cost" > 0)
);
--> statement-breakpoint
CREATE INDEX "jobs_user_created_idx" ON "app"."jobs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_status_started_idx" ON "app"."jobs" USING btree ("status","started_at");--> statement-breakpoint
CREATE VIEW "app"."credit_balances" AS (
      with purchased as (
        select c.user_id,
               sum(
                 floor(
                   coalesce(ch.metadata ->> 'credits', pi.metadata ->> 'credits', '0')::numeric
                   * (ch.amount - ch.amount_refunded) / nullif(ch.amount, 0)
                 )
               )::int as credits
          from app.customers c
          join stripe.charges ch on ch.customer = c.stripe_customer_id
          left join stripe.payment_intents pi on pi.id = ch.payment_intent
         where ch.status = 'succeeded'
           and ch.paid
           and not ch.disputed
         group by c.user_id
      ),
      spent as (
        select j.user_id, sum(j.cost)::int as credits
          from app.jobs j
         where j.status in ('processing', 'succeeded')
         group by j.user_id
      )
      select c.user_id,
             coalesce(p.credits, 0) as purchased,
             coalesce(s.credits, 0) as spent,
             coalesce(p.credits, 0) - coalesce(s.credits, 0) as balance
        from app.customers c
        left join purchased p on p.user_id = c.user_id
        left join spent s on s.user_id = c.user_id
    );