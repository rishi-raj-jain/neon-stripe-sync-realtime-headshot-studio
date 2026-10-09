import 'server-only'

import { db } from '@/db/client'
import { creditBalances, jobs, type Job } from '@/db/schema/app'
import { presignHeadshotDownload, presignSelfieDownload } from '@/lib/storage'
import { selfieKey, type SelfieContentType, type StyleId } from '@/shared/headshots'
import { and, desc, eq, gte, sql } from 'drizzle-orm'

/** Only what the dashboard shows (no user_id, invocation_id, content type). */
export const runColumns = {
  id: jobs.id,
  style: jobs.style,
  variants: jobs.variants,
  cost: jobs.cost,
  status: jobs.status,
  error: jobs.error,
  model: jobs.model,
  prompt: jobs.prompt,
  inputKey: jobs.inputKey,
  outputKeys: jobs.outputKeys,
  createdAt: jobs.createdAt,
  startedAt: jobs.startedAt,
  finishedAt: jobs.finishedAt,
}

type RunRow = Pick<Job, keyof typeof runColumns>

/**
 * A run as the dashboard sees it: the stored job plus signed URLs for its selfie and results.
 * Dates are ISO strings so the server-rendered first page and the JSON API have the same shape.
 */
type Run = Omit<RunRow, 'inputKey' | 'outputKeys' | 'createdAt' | 'startedAt' | 'finishedAt'> & {
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  inputUrl: string | null
  images: string[]
}

const RUNS_PAGE_SIZE = 12

/** Selfies exist once the upload landed; never-uploaded runs have nothing to show. */
const HAS_SELFIE: Job['status'][] = ['processing', 'succeeded', 'failed', 'insufficient_credits']

export async function toRun({ inputKey, outputKeys, createdAt, startedAt, finishedAt, ...job }: RunRow): Promise<Run> {
  const [inputUrl, images] = await Promise.all([HAS_SELFIE.includes(job.status) ? presignSelfieDownload(inputKey) : null, job.status === 'succeeded' ? Promise.all(outputKeys.map(presignHeadshotDownload)) : []])
  return {
    ...job,
    createdAt: createdAt.toISOString(),
    startedAt: startedAt?.toISOString() ?? null,
    finishedAt: finishedAt?.toISOString() ?? null,
    durationMs: startedAt && finishedAt ? finishedAt.getTime() - startedAt.getTime() : null,
    inputUrl,
    images,
  }
}

/**
 * One page of runs, newest first. Cursor = `${createdAt ISO}_${id}` of the last run on the
 * previous page (keyset pagination on jobs_user_created_id_idx). Fetches one extra row to
 * know whether there is a next page.
 */
export function runsQuery(userId: string, cursor?: string | null) {
  const [ts, id] = cursor?.split('_') ?? []
  const after = ts && id && !Number.isNaN(Date.parse(ts)) ? sql`(${jobs.createdAt}, ${jobs.id}) < (${new Date(ts)}, ${id}::uuid)` : undefined
  return db
    .select(runColumns)
    .from(jobs)
    .where(and(eq(jobs.userId, userId), after))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(RUNS_PAGE_SIZE + 1)
}

export async function toRunsPage(rows: RunRow[]) {
  const page = rows.slice(0, RUNS_PAGE_SIZE)
  const last = page.at(-1)
  return {
    runs: await Promise.all(page.map(toRun)),
    nextCursor: rows.length > RUNS_PAGE_SIZE && last ? `${last.createdAt.toISOString()}_${last.id}` : null,
  }
}

/** All-time stats for the dashboard header. Always returns exactly one row. */
export const statsQuery = (userId: string) =>
  db
    .select({
      runs: sql<number>`count(*)::int`,
      succeeded: sql<number>`(count(*) filter (where ${jobs.status} = 'succeeded'))::int`,
      headshots: sql<number>`coalesce(sum(cardinality(${jobs.outputKeys})) filter (where ${jobs.status} = 'succeeded'), 0)::int`,
      creditsSpent: sql<number>`coalesce(sum(${jobs.cost}) filter (where ${jobs.status} in ('processing', 'succeeded')), 0)::int`,
    })
    .from(jobs)
    .where(eq(jobs.userId, userId))

export const toStats = ([stats]: Awaited<ReturnType<typeof statsQuery>>) => stats ?? { runs: 0, succeeded: 0, headshots: 0, creditsSpent: 0 }

/** A page of runs; the first page (no cursor) also carries stats, fetched in the same round trip. */
export async function getRunsPage(userId: string, cursor?: string | null) {
  if (cursor) return toRunsPage(await runsQuery(userId, cursor))
  const [rows, stats] = await db.batch([runsQuery(userId), statsQuery(userId)])
  return { ...(await toRunsPage(rows)), stats: toStats(stats) }
}

type NewJob = { userId: string; style: StyleId; variants: number; cost: number; contentType: SelfieContentType }

/**
 * Creates a job only if the wallet covers its cost: INSERT … SELECT from the wallet view, so the
 * check and the insert are one statement and one round trip. Null means not enough credits.
 * (This is only a pre-check. Credits are spent when `onupload` claims the job.)
 */
export async function createJobIfAffordable({ userId, style, variants, cost, contentType }: NewJob) {
  const id = crypto.randomUUID()
  const inputKey = selfieKey(userId, id, contentType)

  // Insert-select needs every column, in table order. The row only exists if the balance covers `cost`.
  const [job] = await db
    .insert(jobs)
    .select(
      db
        .select({
          id: sql`${id}::uuid`.as('id'),
          userId: sql`${userId}::uuid`.as('user_id'),
          style: sql`${style}::text`.as('style'),
          variants: sql`${variants}::smallint`.as('variants'),
          cost: sql`${cost}::int`.as('cost'),
          status: sql`'awaiting_upload'::app.job_status`.as('status'),
          inputKey: sql`${inputKey}::text`.as('input_key'),
          inputContentType: sql`${contentType}::text`.as('input_content_type'),
          outputKeys: sql`'{}'::text[]`.as('output_keys'),
          error: sql`null::text`.as('error'),
          model: sql`null::text`.as('model'),
          prompt: sql`null::text`.as('prompt'),
          invocationId: sql`null::text`.as('invocation_id'),
          createdAt: sql`now()`.as('created_at'),
          startedAt: sql`null::timestamptz`.as('started_at'),
          finishedAt: sql`null::timestamptz`.as('finished_at'),
        })
        .from(creditBalances)
        .where(and(eq(creditBalances.userId, userId), gte(creditBalances.balance, cost))),
    )
    .returning({ id: jobs.id, style: jobs.style, variants: jobs.variants, cost: jobs.cost, status: jobs.status, error: jobs.error, inputKey: jobs.inputKey, createdAt: jobs.createdAt })

  return job ?? null
}
