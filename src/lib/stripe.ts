import 'server-only'

import { db } from '@/db/client'
import { customers } from '@/db/schema/app'
import { stripeCustomers, stripePrices, stripePromotionCodes } from '@/db/schema/stripe'
import { env } from '@/env'
import type { SessionUser } from '@/lib/auth/server'
import { isPlaceholderEmail, usernameToEmail } from '@/lib/auth/username'
import { and, desc, eq } from 'drizzle-orm'
import Stripe from 'stripe'

/**
 * Stripe is only ever *written* through the API. Everything we *read* comes from the
 * synced `stripe.*` tables in Neon, so the app has no webhook endpoint at all.
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  appInfo: { name: 'headshot-studio' },
})

/**
 * Create the Stripe customer up front and keep the mapping in our own table. Joining on
 * customer id beats `checkout_sessions.client_reference_id`: Checkout Session *creates*
 * can take minutes to sync during the preview, while charges sync within seconds.
 *
 * A stored id is re-checked against the *current* Stripe account, so switching keys (live →
 * sandbox, or another account) heals itself: an unknown id is replaced by a fresh customer.
 */
export async function ensureStripeCustomer(user: SessionUser): Promise<string> {
  const email = billingEmail(user)
  const [existing] = await db.select({ id: customers.stripeCustomerId }).from(customers).where(eq(customers.userId, user.id)).limit(1)

  if (existing) {
    const current = await findCustomer(existing.id)
    if (current) {
      // Keep the email Checkout prefills in step (e.g. DEMO_EMAIL changed, or set after creation).
      if (email && current.email !== email) await stripe.customers.update(existing.id, { email })
      return existing.id
    }
  }

  const customer = await stripe.customers.create(
    { name: user.name || undefined, ...(email && { email }), metadata: { user_id: user.id } },
    // Two tabs racing here get the same customer back instead of two customers.
    { idempotencyKey: `customer:${user.id}:${existing?.id ?? 'new'}` },
  )

  const [row] = await db
    .insert(customers)
    .values({ userId: user.id, stripeCustomerId: customer.id })
    .onConflictDoUpdate({ target: customers.userId, set: { stripeCustomerId: customer.id } })
    .returning({ id: customers.stripeCustomerId })
  if (!row) throw new Error(`failed to persist Stripe customer for ${user.id}`)
  return row.id
}

/**
 * The email Stripe Checkout prefills (it reads it from the Customer). The demo account gets
 * DEMO_EMAIL; other username accounts carry a placeholder address that must never reach
 * Stripe, so they get none and Checkout asks for one.
 */
function billingEmail(user: SessionUser): string | undefined {
  if (user.email.toLowerCase() === usernameToEmail(env.DEMO_USERNAME)) return env.DEMO_EMAIL
  return isPlaceholderEmail(user.email) ? undefined : user.email
}

/** The customer in the Stripe account the current key belongs to, or null if it isn't there. */
async function findCustomer(id: string): Promise<{ email: string | null } | null> {
  // The pipeline only syncs the current account, so a synced row settles it without an API call.
  const [synced] = await db.select({ email: stripeCustomers.email }).from(stripeCustomers).where(eq(stripeCustomers.id, id)).limit(1)
  if (synced) return synced

  try {
    const customer = await stripe.customers.retrieve(id)
    return 'deleted' in customer && customer.deleted ? null : { email: customer.email }
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') return null
    throw error
  }
}

/** Active price for a pack, read from the synced `stripe.prices` table by lookup key. */
export async function resolvePriceId(lookupKey: string): Promise<string> {
  const [price] = await db
    .select({ id: stripePrices.id })
    .from(stripePrices)
    .where(and(eq(stripePrices.lookupKey, lookupKey), eq(stripePrices.active, true)))
    .orderBy(desc(stripePrices.created))
    .limit(1)
  if (price) return price.id

  // Not synced yet (e.g. a freshly created price): ask Stripe directly.
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  if (!data[0]) throw new Error(`no active Stripe price with lookup_key ${lookupKey}`)
  return data[0].id
}

/** Promotion code id for a customer-facing code, from `stripe.promotion_codes` first. */
export async function resolvePromotionCodeId(code: string): Promise<string> {
  const [promo] = await db
    .select({ id: stripePromotionCodes.id })
    .from(stripePromotionCodes)
    .where(and(eq(stripePromotionCodes.code, code), eq(stripePromotionCodes.active, true)))
    .orderBy(desc(stripePromotionCodes.created))
    .limit(1)
  if (promo) return promo.id

  const { data } = await stripe.promotionCodes.list({ code, active: true, limit: 1 })
  if (!data[0]) throw new Error(`no active Stripe promotion code ${code}`)
  return data[0].id
}
