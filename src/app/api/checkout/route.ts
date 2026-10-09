import { env } from '@/env'
import { getUser, unauthorized } from '@/lib/auth/server'
import { ensureStripeCustomer, resolvePriceId, resolvePromotionCodeId, stripe } from '@/lib/stripe'
import { AUTO_PROMOTION_CODE, CREDIT_PACKS, type PackId } from '@/shared/headshots'
import * as v from 'valibot'

const Body = v.object({
  pack: v.picklist(Object.keys(CREDIT_PACKS) as [PackId, ...PackId[]]),
})

/**
 * POST /api/checkout  { pack }  →  { url }
 *
 * Creates a Stripe Checkout Session for a credit pack. There is deliberately no webhook
 * on the other side: once the charge succeeds, Stripe syncs it into `stripe.charges` and
 * the `app.credit_balances` view picks it up.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return unauthorized()

  const parsed = v.safeParse(Body, await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid pack' }, { status: 400 })

  const packId = parsed.output.pack
  const pack = CREDIT_PACKS[packId]
  const [customer, price, promotionCode] = await Promise.all([ensureStripeCustomer(user), resolvePriceId(pack.lookupKey), AUTO_PROMOTION_CODE ? resolvePromotionCodeId(AUTO_PROMOTION_CODE) : null])

  const metadata = {
    app: 'headshot-studio',
    user_id: user.id,
    pack: packId,
    credits: String(pack.credits),
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    // Auto-applied discount (100% off right now). A $0 session completes without a payment
    // method and creates no PaymentIntent/Charge; the wallet counts the completed session.
    ...(promotionCode ? { discounts: [{ promotion_code: promotionCode }] } : {}),
    // The wallet reads `credits` from the PaymentIntent (paid orders) or the session (free orders).
    payment_intent_data: { metadata },
    metadata,
    success_url: `${env.APP_URL}/studio?checkout=success`,
    cancel_url: `${env.APP_URL}/studio?checkout=cancelled`,
  })

  if (!session.url) return Response.json({ error: 'checkout unavailable' }, { status: 502 })
  return Response.json({ url: session.url })
}
