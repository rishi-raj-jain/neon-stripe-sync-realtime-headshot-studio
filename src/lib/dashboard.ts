import 'server-only'

import { db } from '@/db/client'
import { creditQueries, toCredits } from '@/lib/credits'
import { runsQuery, statsQuery, toRunsPage, toStats } from '@/lib/runs'

/**
 * Everything the studio shows on first paint, in ONE database round trip: wallet, daily usage, purchases,
 * the newest page of runs and all-time stats. Rendered on the server, so the browser doesn't
 * fetch /api/credits and /api/jobs after hydration. The same shape those endpoints return.
 */
export async function getDashboard(userId: string) {
  const [wallet, usage, charges, freeOrders, runs, stats] = await db.batch([...creditQueries(userId), runsQuery(userId), statsQuery(userId)])
  return { ...toCredits([wallet, usage, charges, freeOrders]), ...(await toRunsPage(runs)), stats: toStats(stats) }
}
