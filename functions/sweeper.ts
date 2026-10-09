import { parseTriggerDelivery } from '@neon/functions/triggers'
import { and, eq, lt, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { jobs } from '@/db/schema/app'
import { db } from '@functions/lib/db'
import { env } from '@functions/lib/env'

const STUCK_AFTER = sql`now() - interval '20 minutes'`
const ABANDONED_AFTER = sql`now() - interval '1 hour'`

/**
 * Runs every 5 minutes (schedule trigger in neon.ts), even while Postgres is scaled to zero.
 *
 * - `processing` for 20+ minutes means the function was evicted mid-generation. Fail the
 *   job, which returns its credits, since only processing/succeeded jobs count as spent.
 * - `awaiting_upload` for 1+ hour means the browser never uploaded. Expire it.
 *
 * Each run logs its `scheduledAt`, so you can time-travel query the database as of that
 * moment to see exactly what the sweeper saw (docs/debugging.md).
 */
const app = new Hono()

app.post('/', async (c) => {
  const delivery = await parseTriggerDelivery(c.req.raw)
  if (!delivery.ok) return c.json({ error: delivery.error }, 401)
  const { invocation } = delivery
  if (invocation.trigger.type !== 'schedule') return c.json({ error: 'expected schedule' }, 400)

  // Both sweeps in one round trip (and one transaction).
  const [failed, expired] = await db.batch([
    db
      .update(jobs)
      .set({
        status: 'failed',
        error: 'Generation timed out. Your credits were returned.',
        finishedAt: new Date(),
      })
      .where(and(eq(jobs.status, 'processing'), lt(jobs.startedAt, STUCK_AFTER)))
      .returning({ id: jobs.id }),
    db
      .update(jobs)
      .set({ status: 'expired', finishedAt: new Date() })
      .where(and(eq(jobs.status, 'awaiting_upload'), lt(jobs.createdAt, ABANDONED_AFTER)))
      .returning({ id: jobs.id }),
  ])

  console.log(
    `[sweeper] branch=${env.NEON_BRANCH} invocation=${invocation.invocationId} ` +
      `scheduledAt=${'scheduledAt' in invocation.data ? invocation.data.scheduledAt : '?'} ` +
      `failed=${failed.length} expired=${expired.length}`,
  )
  return c.json({ failed: failed.length, expired: expired.length })
})

export default app
