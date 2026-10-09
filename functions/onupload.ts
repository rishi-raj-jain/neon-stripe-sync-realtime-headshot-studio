import { isStorageObjectCreatedTriggerInvocation, parseTriggerDelivery } from '@neon/functions/triggers'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { jobs } from '@/db/schema/app'
import { BUCKETS, MAX_SELFIE_BYTES, STYLES, buildPrompt, headshotKey, parseSelfieKey, type StyleId } from '@/shared/headshots'
import { db, sql } from '@functions/lib/db'
import { env } from '@functions/lib/env'
import { generateHeadshot } from '@functions/lib/generate'
import { sniffImage } from '@functions/lib/image'
import { readObject, writeObject } from '@functions/lib/storage'

/**
 * Fires on every object created under selfies/uploads/ (see `neon.ts`).
 *
 *   1. parse + authenticate the trigger delivery
 *   2. CLAIM the job: under a per-user advisory lock, move it to `processing` only if the
 *      derived wallet balance covers it. That transition is the debit.
 *   3. generate → write outputs → `succeeded`, or `failed` (which refunds by construction)
 *
 * Redeliveries are harmless: a job only leaves `awaiting_upload` once.
 */

class UserFacingError extends Error {}

type ClaimedJob = {
  id: string
  style: string
  variants: number
  input_key: string
}

const app = new Hono()

app.post('/', async (c) => {
  const delivery = await parseTriggerDelivery(c.req.raw)
  if (!delivery.ok) {
    // missing_header = not from Neon's trigger system (Neon strips client X-Neon-* headers).
    return c.json({ error: delivery.error }, delivery.error === 'missing_header' ? 401 : 400)
  }
  const { invocation } = delivery
  if (!isStorageObjectCreatedTriggerInvocation(invocation)) {
    return c.json({ error: 'expected a storage_object_created delivery' }, 400)
  }

  const { bucketName, objectKey } = invocation.data
  const log = (message: string) => console.log(`[onupload] branch=${env.NEON_BRANCH} invocation=${invocation.invocationId} ` + `key=${objectKey} ${message}`)
  log('received')

  const ids = bucketName === BUCKETS.selfies ? parseSelfieKey(objectKey) : null
  if (!ids) {
    log('ignored: not a selfie key')
    return c.json({ outcome: 'ignored' })
  }

  const job = await claim(ids.userId, ids.jobId, objectKey, invocation.invocationId)
  if (!job) {
    log('not claimed (duplicate delivery, expired job, or insufficient credits)')
    return c.json({ outcome: 'not_claimed' })
  }
  log(`claimed job=${job.id} variants=${job.variants} style=${job.style}`)

  try {
    const outputKeys = await generate(ids.userId, job, bucketName, objectKey)
    await db
      .update(jobs)
      .set({ status: 'succeeded', outputKeys, finishedAt: new Date() })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, 'processing')))
    log(`succeeded outputs=${outputKeys.length}`)
    return c.json({ outcome: 'succeeded', outputs: outputKeys.length })
  } catch (error) {
    const message = error instanceof UserFacingError ? error.message : 'Generation failed. Your credits were returned.'
    console.error(`[onupload] job=${job.id} failed`, error)
    await db
      .update(jobs)
      .set({ status: 'failed', error: message, finishedAt: new Date() })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, 'processing')))
    // 200 on purpose: the failure is recorded and retrying the same bytes won't help.
    return c.json({ outcome: 'failed', error: message })
  }
})

/**
 * One HTTP round trip, one transaction (neon `sql.transaction`):
 *   lock the user's wallet → try to move the job to processing if the balance covers it →
 *   otherwise mark it insufficient_credits. Exactly one of the two updates can match.
 */
async function claim(userId: string, jobId: string, inputKey: string, invocationId: string): Promise<ClaimedJob | null> {
  const [, claimed] = await sql.transaction([
    sql`select 1 from pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
    sql`
      update app.jobs j
         set status = 'processing', started_at = now(), invocation_id = ${invocationId},
             model = ${env.IMAGE_MODEL}
       where j.id = ${jobId}
         and j.user_id = ${userId}
         and j.input_key = ${inputKey}
         and j.status = 'awaiting_upload'
         and coalesce(
               (select b.balance from app.credit_balances b where b.user_id = ${userId}),
               0
             ) >= j.cost
      returning j.id, j.style, j.variants, j.input_key`,
    sql`
      update app.jobs
         set status = 'insufficient_credits',
             finished_at = now(),
             invocation_id = ${invocationId},
             error = 'You ran out of credits before the upload finished.'
       where id = ${jobId}
         and user_id = ${userId}
         and status = 'awaiting_upload'
      returning id`,
  ])
  return (claimed?.[0] as ClaimedJob | undefined) ?? null
}

async function generate(userId: string, job: ClaimedJob, bucket: string, key: string): Promise<string[]> {
  if (!(job.style in STYLES)) throw new UserFacingError(`Unknown style "${job.style}".`)

  const prompt = buildPrompt(job.style as StyleId)
  // Keep the exact prompt with the run (history shows what produced each result), written
  // while the selfie downloads rather than after it.
  const [selfie] = await Promise.all([readObject(bucket, key, MAX_SELFIE_BYTES), db.update(jobs).set({ prompt }).where(eq(jobs.id, job.id))])
  if (!selfie) throw new UserFacingError('That photo is over 10 MB. Try a smaller one.')

  const kind = sniffImage(selfie)
  if (kind === 'image/heic') {
    throw new UserFacingError("That's an iPhone HEIC photo. Export it as JPEG and try again.")
  }
  if (kind === 'unknown') throw new UserFacingError("That file doesn't look like a photo.")

  return Promise.all(
    Array.from({ length: job.variants }, async (_, index) => {
      const image = await generateHeadshot({ selfie, mimeType: kind, prompt })
      const outputKey = headshotKey(userId, job.id, index)
      await writeObject(BUCKETS.headshots, outputKey, image, 'image/jpeg')
      return outputKey
    }),
  )
}

export default app
