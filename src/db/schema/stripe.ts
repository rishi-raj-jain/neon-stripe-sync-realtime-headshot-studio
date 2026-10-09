import { bigint, boolean, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Read-only Drizzle mappings for the tables Stripe Data Pipeline maintains
 * (real-time sync to Postgres, schema for API version 2026-03-25.dahlia):
 * https://docs.stripe.com/data/data-pipeline/real-time-sync-to-postgres/schema
 *
 * Only the columns this app reads are mapped. Stripe owns these tables: never write to
 * them, never add triggers to them, and keep this file OUT of drizzle.config.ts so
 * drizzle-kit never generates DDL for it.
 *
 * Conventions in the synced schema:
 *   - `id` is the Stripe object id (text)
 *   - unix timestamps (`created`, …) are bigint seconds
 *   - nested objects and `metadata` are jsonb
 *   - `_account_id`, `_updated_at`, `_raw_data` are sync metadata; `_raw_data` is the full
 *     API object as jsonb
 *
 * Sync latency (public preview): changes land within seconds, except updates to
 * `payment_intents` and creates in `checkout_sessions`, which can take up to 10 minutes.
 * That is why the wallet keys off `charges`, and never off `checkout_sessions`.
 */
const stripe = pgSchema('stripe')

const unixSeconds = (name: string) => bigint(name, { mode: 'number' })
const syncColumns = {
  accountId: text('_account_id'),
  syncedAt: timestamp('_updated_at', { withTimezone: true }),
}

export const stripeCustomers = stripe.table('customers', {
  id: text('id').primaryKey(),
  email: text('email'),
  name: text('name'),
  metadata: jsonb('metadata').$type<Record<string, string>>(),
  livemode: boolean('livemode'),
  created: unixSeconds('created'),
  ...syncColumns,
})

export const stripeCharges = stripe.table('charges', {
  id: text('id').primaryKey(),
  customer: text('customer'),
  paymentIntent: text('payment_intent'),
  amount: bigint('amount', { mode: 'number' }),
  amountRefunded: bigint('amount_refunded', { mode: 'number' }),
  currency: text('currency'),
  status: text('status'),
  paid: boolean('paid'),
  refunded: boolean('refunded'),
  disputed: boolean('disputed'),
  receiptUrl: text('receipt_url'),
  metadata: jsonb('metadata').$type<Record<string, string>>(),
  livemode: boolean('livemode'),
  created: unixSeconds('created'),
  ...syncColumns,
})

export const stripePaymentIntents = stripe.table('payment_intents', {
  id: text('id').primaryKey(),
  customer: text('customer'),
  status: text('status'),
  latestCharge: text('latest_charge'),
  metadata: jsonb('metadata').$type<Record<string, string>>(),
  created: unixSeconds('created'),
  ...syncColumns,
})

export const stripePrices = stripe.table('prices', {
  id: text('id').primaryKey(),
  product: text('product'),
  lookupKey: text('lookup_key'),
  active: boolean('active'),
  currency: text('currency'),
  unitAmount: bigint('unit_amount', { mode: 'number' }),
  metadata: jsonb('metadata').$type<Record<string, string>>(),
  livemode: boolean('livemode'),
  created: unixSeconds('created'),
  ...syncColumns,
})

export const stripePromotionCodes = stripe.table('promotion_codes', {
  id: text('id').primaryKey(),
  code: text('code'),
  active: boolean('active'),
  promotion: jsonb('promotion').$type<{ type: string; coupon?: string }>(),
  livemode: boolean('livemode'),
  created: unixSeconds('created'),
  ...syncColumns,
})

/**
 * Only used for no-cost orders (100% discount): Checkout creates no PaymentIntent or Charge
 * for a $0 session, so the completed session is the only record of the purchase.
 * Preview caveat: *creates* in this table can take up to 10 minutes to sync.
 */
export const stripeCheckoutSessions = stripe.table('checkout_sessions', {
  id: text('id').primaryKey(),
  customer: text('customer'),
  mode: text('mode'),
  status: text('status'),
  paymentStatus: text('payment_status'),
  amountTotal: bigint('amount_total', { mode: 'number' }),
  currency: text('currency'),
  metadata: jsonb('metadata').$type<Record<string, string>>(),
  livemode: boolean('livemode'),
  created: unixSeconds('created'),
  ...syncColumns,
})
