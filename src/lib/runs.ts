import 'server-only'

import { db } from '@/db/client'
import { jobs, type Job } from '@/db/schema/app'
import { presignHeadshotDownload, presignSelfieDownload } from '@/lib/storage'
import { and, desc, eq, sql } from 'drizzle-orm'

/** A run as the dashboard sees it: the stored job plus signed URLs for its selfie and results. */
type Run = Pick<Job, 'id' | 'style' | 'variants' | 'cost' | 'status' | 'error' | 'model' | 'prompt' | 'createdAt' | 'startedAt' | 'finishedAt'> & {
  durationMs: number | null
  inputUrl: string | null
  images: string[]
}

type RunStats = { runs: number; succeeded: number; headshots: number; creditsSpent: number }

const RUNS_PAGE_SIZE = 12

/** Selfies exist once the upload landed; never-uploaded runs have nothing to show. */
const HAS_SELFIE: Job['status'][] = ['processing', 'succeeded', 'failed', 'insufficient_credits']

export async function toRun(job: Job): Promise<Run> {
  const [inputUrl, images] = await Promise.all([HAS_SELFIE.includes(job.status) ? presignSelfieDownload(job.inputKey) : null, job.status === 'succeeded' ? Promise.all(job.outputKeys.map(presignHeadshotDownload)) : []])
  return {
    id: job.id,
    style: job.style,
    variants: job.variants,
    cost: job.cost,
    status: job.status,
    error: job.error,
    model: job.model,
    prompt: job.prompt,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.startedAt && job.finishedAt ? job.finishedAt.getTime() - job.startedAt.getTime() : null,
    inputUrl,
    images,
  }
}

/** Cursor = `${createdAt ISO}_${id}` of the last run on the previous page (keyset pagination). */
export async function listRuns(userId: string, cursor?: string | null) {
  const [ts, id] = cursor?.split('_') ?? []
  const after = ts && id && !Number.isNaN(Date.parse(ts)) ? sql`(${jobs.createdAt}, ${jobs.id}) < (${new Date(ts)}, ${id}::uuid)` : undefined

  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.userId, userId), after))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(RUNS_PAGE_SIZE + 1)

  const page = rows.slice(0, RUNS_PAGE_SIZE)
  const last = page.at(-1)
  return {
    runs: await Promise.all(page.map(toRun)),
    nextCursor: rows.length > RUNS_PAGE_SIZE && last ? `${last.createdAt.toISOString()}_${last.id}` : null,
  }
}

export async function getRunStats(userId: string): Promise<RunStats> {
  const [stats] = await db
    .select({
      runs: sql<number>`count(*)::int`,
      succeeded: sql<number>`(count(*) filter (where ${jobs.status} = 'succeeded'))::int`,
      headshots: sql<number>`coalesce(sum(cardinality(${jobs.outputKeys})) filter (where ${jobs.status} = 'succeeded'), 0)::int`,
      creditsSpent: sql<number>`coalesce(sum(${jobs.cost}) filter (where ${jobs.status} in ('processing', 'succeeded')), 0)::int`,
    })
    .from(jobs)
    .where(eq(jobs.userId, userId))
  return stats ?? { runs: 0, succeeded: 0, headshots: 0, creditsSpent: 0 }
}
