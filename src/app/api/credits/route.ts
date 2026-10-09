import { getUser, unauthorized } from '@/lib/auth/server'
import { getPurchases, getWallet } from '@/lib/credits'

/**
 * GET /api/credits  →  { wallet, purchases }
 *
 * Polled by the studio after Checkout returns: the new charge appears here a few seconds
 * after payment, straight from the Stripe-synced tables.
 */
export async function GET() {
  const user = await getUser()
  if (!user) return unauthorized()

  const [wallet, purchases] = await Promise.all([getWallet(user.id), getPurchases(user.id)])
  return Response.json({ wallet, purchases })
}
