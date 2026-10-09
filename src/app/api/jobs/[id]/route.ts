import { db } from '@/db/client'
import { jobs } from '@/db/schema/app'
import { getUser, unauthorized } from '@/lib/auth/server'
import { runColumns, toRun } from '@/lib/runs'
import { and, eq } from 'drizzle-orm'
import * as v from 'valibot'

const JobId = v.pipe(v.string(), v.uuid())

/** GET /api/jobs/:id  →  { run }   One run with signed URLs for its selfie and results. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser()
  if (!user) return unauthorized()

  const id = v.safeParse(JobId, (await params).id)
  if (!id.success) return Response.json({ error: 'not found' }, { status: 404 })

  const [job] = await db
    .select(runColumns)
    .from(jobs)
    .where(and(eq(jobs.id, id.output), eq(jobs.userId, user.id)))
    .limit(1)
  if (!job) return Response.json({ error: 'not found' }, { status: 404 })

  return Response.json({ run: await toRun(job) })
}
