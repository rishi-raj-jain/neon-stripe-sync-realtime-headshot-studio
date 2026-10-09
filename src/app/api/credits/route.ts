import { getUser, unauthorized } from '@/lib/auth/server'
import { getCredits } from '@/lib/credits'

/**
 * GET /api/credits  →  { wallet, purchases }
 *
 * Polled by the studio after Checkout returns: the new charge appears here a few seconds
 * after payment, straight from the Stripe-synced tables. One database round trip.
 */
export async function GET() {
  const user = await getUser()
  if (!user) return unauthorized()

  return Response.json(await getCredits(user.id))
}
