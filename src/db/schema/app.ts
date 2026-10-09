import { sql } from 'drizzle-orm'
import { check, index, integer, pgSchema, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'
// Type-only, so drizzle-kit and the function bundles never have to resolve the alias.
import type { StyleId } from '@/shared/headshots'

/**
 * Everything this app owns lives in the `app` schema. The database has three owners:
 *   neon_auth.*  Managed Better Auth (users, sessions)
 *   stripe.*     Stripe Data Pipeline (read-only for us, see ./stripe.ts)
 *   app.*        this file, managed by drizzle-kit
 */
export const app = pgSchema('app')

export const jobStatus = app.enum('job_status', [
  'awaiting_upload', // job created, presigned PUT handed to the browser
  'processing', // claimed by the upload trigger; credits are now spent
  'succeeded',
  'failed', // credits come back automatically (only processing/succeeded count as spent)
  'insufficient_credits',
  'expired', // never uploaded
])

/**
 * Links a Neon Auth user to the Stripe customer we create for them.
 * `user_id` is neon_auth."user".id (uuid). There's no FK because Neon Auth owns that
 * table and drizzle-kit must not generate DDL for it.
 */
export const customers = app.table('customers', {
  userId: uuid('user_id').primaryKey(),
  stripeCustomerId: text('stripe_customer_id').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const jobs = app.table(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    style: text('style').$type<StyleId>().notNull(),
    variants: smallint('variants').notNull(),
    cost: integer('cost').notNull(),
    status: jobStatus('status').notNull().default('awaiting_upload'),
    inputKey: text('input_key').notNull().unique(),
    inputContentType: text('input_content_type').notNull(),
    outputKeys: text('output_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    error: text('error'),
    /** Image model and exact prompt the run used, recorded when the function claims it. */
    model: text('model'),
    prompt: text('prompt'),
    /** Neon trigger invocation that claimed the job — grep it in `neon logs query`. */
    invocationId: text('invocation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    // Run history: keyset pagination on (created_at, id) for one user. Ascending on purpose: a backward
    // scan serves ORDER BY created_at DESC, id DESC (DESC means NULLS FIRST, which a DESC NULLS LAST index can't).
    index('jobs_user_created_id_idx').on(t.userId, t.createdAt, t.id),
    // Wallet "spent" side, read on every balance check: an index-only sum that skips failed/expired runs.
    index('jobs_user_spent_idx')
      .on(t.userId, t.cost)
      .where(sql`${t.status} in ('processing', 'succeeded')`),
    // Sweeper: only in-flight jobs are indexed, so these stay tiny as history grows.
    index('jobs_processing_started_idx')
      .on(t.startedAt)
      .where(sql`${t.status} = 'processing'`),
    index('jobs_awaiting_created_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'awaiting_upload'`),
    check('jobs_variants_check', sql`${t.variants} between 1 and 4`),
    check('jobs_cost_check', sql`${t.cost} > 0`),
  ],
)

/**
 * The wallet. There is no balance column anywhere and no webhook that increments one:
 *
 *   purchased = credits on succeeded, undisputed Stripe charges, pro-rated for refunds
 *   spent     = cost of jobs that are processing or succeeded
 *
 * Refund in the Stripe Dashboard → `stripe.charges.amount_refunded` syncs within seconds →
 * balance drops. Dispute → charge stops counting. Generation fails → job leaves the
 * "spent" states → credits return. Nothing to replay, nothing to double-count.
 *
 * `credits` is read from the charge metadata, falling back to the PaymentIntent metadata
 * set by /api/checkout (PaymentIntent *creates* sync in real time; only updates lag).
 *
 * Free orders (100% promotion code) have no charge at all, so completed $0 Checkout
 * Sessions count too. Stripe reports them as payment_status 'paid' or 'no_payment_required'
 * depending on the account/API version, so both count. Paid orders always have
 * amount_total > 0 and come from charges instead, so nothing is counted twice.
 *
 * Requires the Stripe pipeline to be syncing `charges` and `payment_intents` before you
 * run the migration that creates this view.
 */
export const creditBalances = app
  .view('credit_balances', {
    userId: uuid('user_id').notNull(),
    purchased: integer('purchased').notNull(),
    spent: integer('spent').notNull(),
    balance: integer('balance').notNull(),
  })
  .as(
    sql`
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
      free_orders as (
        select c.user_id, sum(coalesce(cs.metadata ->> 'credits', '0')::int)::int as credits
          from app.customers c
          join stripe.checkout_sessions cs on cs.customer = c.stripe_customer_id
         where cs.mode = 'payment'
           and cs.status = 'complete'
           and cs.payment_status in ('paid', 'no_payment_required')
           and cs.amount_total = 0
         group by c.user_id
      ),
      spent as (
        select j.user_id, sum(j.cost)::int as credits
          from app.jobs j
         where j.status in ('processing', 'succeeded')
         group by j.user_id
      )
      select c.user_id,
             coalesce(p.credits, 0) + coalesce(f.credits, 0) as purchased,
             coalesce(s.credits, 0) as spent,
             coalesce(p.credits, 0) + coalesce(f.credits, 0) - coalesce(s.credits, 0) as balance
        from app.customers c
        left join purchased p on p.user_id = c.user_id
        left join free_orders f on f.user_id = c.user_id
        left join spent s on s.user_id = c.user_id
    `,
  )

export type Job = typeof jobs.$inferSelect
export type JobStatus = (typeof jobStatus.enumValues)[number]
