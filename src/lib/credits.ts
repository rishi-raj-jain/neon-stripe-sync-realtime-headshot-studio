import 'server-only'

import { db } from '@/db/client'
import { creditBalances, customers } from '@/db/schema/app'
import { stripeCharges, stripeCheckoutSessions, stripePaymentIntents } from '@/db/schema/stripe'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

type Wallet = { purchased: number; spent: number; balance: number }

type Purchase = {
  id: string
  amount: number
  amountRefunded: number
  currency: string
  refunded: boolean
  disputed: boolean
  credits: number
  created: number
  syncedAt: Date | null
}

export async function getWallet(userId: string): Promise<Wallet> {
  const [row] = await db
    .select({
      purchased: creditBalances.purchased,
      spent: creditBalances.spent,
      balance: creditBalances.balance,
    })
    .from(creditBalances)
    .where(eq(creditBalances.userId, userId))
    .limit(1)
  // No row = never started a checkout, so there is nothing to spend.
  return row ?? { purchased: 0, spent: 0, balance: 0 }
}

/**
 * Purchase history straight from the Stripe-synced tables: paid orders are charges, free
 * orders (100% promotion code) are completed $0 Checkout Sessions. Same rules as the view.
 */
export async function getPurchases(userId: string): Promise<Purchase[]> {
  const [charges, freeOrders] = await Promise.all([
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
        syncedAt: stripeCharges.syncedAt,
      })
      .from(stripeCharges)
      .innerJoin(customers, eq(customers.stripeCustomerId, stripeCharges.customer))
      .leftJoin(stripePaymentIntents, eq(stripePaymentIntents.id, stripeCharges.paymentIntent))
      .where(and(eq(customers.userId, userId), eq(stripeCharges.status, 'succeeded')))
      .orderBy(desc(stripeCharges.created))
      .limit(10),
    db
      .select({
        id: stripeCheckoutSessions.id,
        currency: stripeCheckoutSessions.currency,
        credits: sql<number | null>`(${stripeCheckoutSessions.metadata} ->> 'credits')::int`,
        created: stripeCheckoutSessions.created,
        syncedAt: stripeCheckoutSessions.syncedAt,
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
      .limit(10),
  ])

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
      syncedAt: c.syncedAt,
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
      syncedAt: s.syncedAt,
    })),
  ]
  return purchases.sort((a, b) => b.created - a.created).slice(0, 10)
}
