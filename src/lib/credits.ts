import 'server-only'

import { db } from '@/db/client'
import { creditBalances, customers, imageUsage24h } from '@/db/schema/app'
import { stripeCharges, stripeCheckoutSessions, stripePaymentIntents } from '@/db/schema/stripe'
import { DAILY_IMAGE_LIMIT } from '@/shared/headshots'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

type Wallet = { purchased: number; spent: number; balance: number }

/** The daily rate limit. `freesAt`: when the oldest counted run ages out of the 24-hour window. */
type Usage = { used: number; limit: number; remaining: number; freesAt: string | null }

type Purchase = {
  id: string
  amount: number
  amountRefunded: number
  currency: string
  refunded: boolean
  disputed: boolean
  credits: number
  created: number
}

const EMPTY_WALLET: Wallet = { purchased: 0, spent: 0, balance: 0 }
const PURCHASES_SHOWN = 10

/*
 * Each read is a query builder, not a promise, so callers can send several in one
 * `db.batch` (one HTTP round trip, one snapshot) instead of one request per query.
 */

const walletQuery = (userId: string) =>
  db
    .select({
      purchased: creditBalances.purchased,
      spent: creditBalances.spent,
      balance: creditBalances.balance,
    })
    .from(creditBalances)
    .where(eq(creditBalances.userId, userId))
    .limit(1)

const usageQuery = (userId: string) => db.select({ used: imageUsage24h.used, oldestStartedAt: imageUsage24h.oldestStartedAt }).from(imageUsage24h).where(eq(imageUsage24h.userId, userId)).limit(1)

function toUsage([row]: Awaited<ReturnType<typeof usageQuery>>): Usage {
  const used = row?.used ?? 0
  return {
    used,
    limit: DAILY_IMAGE_LIMIT,
    remaining: Math.max(0, DAILY_IMAGE_LIMIT - used),
    freesAt: row ? new Date(row.oldestStartedAt.getTime() + 24 * 60 * 60 * 1000).toISOString() : null,
  }
}

/** Paid orders: charges (same rules as the view). */
const chargesQuery = (userId: string) =>
  db
    .select({
      id: stripeCharges.id,
      amount: stripeCharges.amount,
      amountRefunded: stripeCharges.amountRefunded,
      currency: stripeCharges.currency,
      refunded: stripeCharges.refunded,
      disputed: stripeCharges.disputed,
      credits: sql<number | null>`(coalesce(${stripeCharges.metadata} ->> 'credits', ${stripePaymentIntents.metadata} ->> 'credits'))::int`,
      created: stripeCharges.created,
    })
    .from(stripeCharges)
    .innerJoin(customers, eq(customers.stripeCustomerId, stripeCharges.customer))
    .leftJoin(stripePaymentIntents, eq(stripePaymentIntents.id, stripeCharges.paymentIntent))
    .where(and(eq(customers.userId, userId), eq(stripeCharges.status, 'succeeded')))
    .orderBy(desc(stripeCharges.created))
    .limit(PURCHASES_SHOWN)

/** Free orders (100% promotion code): completed $0 Checkout Sessions, which have no charge. */
const freeOrdersQuery = (userId: string) =>
  db
    .select({
      id: stripeCheckoutSessions.id,
      currency: stripeCheckoutSessions.currency,
      credits: sql<number | null>`(${stripeCheckoutSessions.metadata} ->> 'credits')::int`,
      created: stripeCheckoutSessions.created,
    })
    .from(stripeCheckoutSessions)
    .innerJoin(customers, eq(customers.stripeCustomerId, stripeCheckoutSessions.customer))
    .where(
      and(
        eq(customers.userId, userId),
        eq(stripeCheckoutSessions.mode, 'payment'),
        eq(stripeCheckoutSessions.status, 'complete'),
        // A $0 order completes as 'paid' or 'no_payment_required' depending on account/API version.
        inArray(stripeCheckoutSessions.paymentStatus, ['paid', 'no_payment_required']),
        eq(stripeCheckoutSessions.amountTotal, 0),
      ),
    )
    .orderBy(desc(stripeCheckoutSessions.created))
    .limit(PURCHASES_SHOWN)

/** Wallet, daily usage and purchase history, ready to spread into a `db.batch`. Pair with `toCredits`. */
export const creditQueries = (userId: string) => [walletQuery(userId), usageQuery(userId), chargesQuery(userId), freeOrdersQuery(userId)] as const

type CreditRows = readonly [Awaited<ReturnType<typeof walletQuery>>, Awaited<ReturnType<typeof usageQuery>>, Awaited<ReturnType<typeof chargesQuery>>, Awaited<ReturnType<typeof freeOrdersQuery>>]

export function toCredits([walletRows, usageRows, charges, freeOrders]: CreditRows): { wallet: Wallet; usage: Usage; purchases: Purchase[] } {
  const purchases: Purchase[] = [
    ...charges.map((c) => ({
      id: c.id,
      amount: c.amount ?? 0,
      amountRefunded: c.amountRefunded ?? 0,
      currency: c.currency ?? 'usd',
      refunded: c.refunded ?? false,
      disputed: c.disputed ?? false,
      credits: c.credits ?? 0,
      created: c.created ?? 0,
    })),
    ...freeOrders.map((s) => ({
      id: s.id,
      amount: 0,
      amountRefunded: 0,
      currency: s.currency ?? 'usd',
      refunded: false,
      disputed: false,
      credits: s.credits ?? 0,
      created: s.created ?? 0,
    })),
  ]
  return {
    // No row = never started a checkout, so there is nothing to spend.
    wallet: walletRows[0] ?? EMPTY_WALLET,
    usage: toUsage(usageRows),
    purchases: purchases.sort((a, b) => b.created - a.created).slice(0, PURCHASES_SHOWN),
  }
}

/** Wallet, daily usage and purchase history in one round trip. */
export async function getCredits(userId: string) {
  return toCredits(await db.batch(creditQueries(userId)))
}

/** What a new run is checked against: credits and the daily limit, in one round trip. */
export async function getAllowance(userId: string): Promise<{ wallet: Wallet; usage: Usage }> {
  const [walletRows, usageRows] = await db.batch([walletQuery(userId), usageQuery(userId)])
  return { wallet: walletRows[0] ?? EMPTY_WALLET, usage: toUsage(usageRows) }
}
