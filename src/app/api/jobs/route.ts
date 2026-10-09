import { db } from '@/db/client'
import { jobs } from '@/db/schema/app'
import { getUser, unauthorized } from '@/lib/auth/server'
import { getWallet } from '@/lib/credits'
import { getRunStats, listRuns } from '@/lib/runs'
import { presignSelfieUpload } from '@/lib/storage'
import { CREDITS_PER_VARIANT, MAX_VARIANTS, SELFIE_CONTENT_TYPES, STYLES, selfieKey, type SelfieContentType, type StyleId } from '@/shared/headshots'
import * as v from 'valibot'

const CreateJob = v.object({
  style: v.picklist(Object.keys(STYLES) as [StyleId, ...StyleId[]]),
  variants: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_VARIANTS)),
  contentType: v.picklist(Object.keys(SELFIE_CONTENT_TYPES) as [SelfieContentType, ...SelfieContentType[]], "Upload a JPEG, PNG or WebP. HEIC isn't supported, so export it as JPEG first."),
})

const jobColumns = {
  id: jobs.id,
  style: jobs.style,
  variants: jobs.variants,
  cost: jobs.cost,
  status: jobs.status,
  error: jobs.error,
  createdAt: jobs.createdAt,
  finishedAt: jobs.finishedAt,
}

/**
 * GET /api/jobs?cursor=…  →  { runs, nextCursor, stats? }
 *
 * The signed-in user's run history, newest first, 12 per page. Every run comes back with
 * signed URLs for its selfie and results, so the dashboard renders without extra requests.
 * The first page (no cursor) also carries all-time stats.
 */
export async function GET(request: Request) {
  const user = await getUser()
  if (!user) return unauthorized()

  const cursor = new URL(request.url).searchParams.get('cursor')
  const [page, stats] = await Promise.all([listRuns(user.id, cursor), cursor ? null : getRunStats(user.id)])
  return Response.json({ ...page, ...(stats && { stats }) })
}

/**
 * POST /api/jobs  { style, variants, contentType }  →  { job, upload }
 *
 * Creates the job row and returns a presigned PUT URL. The browser uploads the selfie
 * straight to Neon Object Storage, and that upload fires the `onupload` Neon Function.
 * Credits are only *checked* here. They're spent atomically when the function claims the job.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return unauthorized()

  const parsed = v.safeParse(CreateJob, await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.issues[0]?.message ?? 'invalid job' }, { status: 400 })
  }
  const { style, variants, contentType } = parsed.output
  const cost = variants * CREDITS_PER_VARIANT

  const wallet = await getWallet(user.id)
  if (wallet.balance < cost) {
    return Response.json({ error: `This needs ${cost} credits and you have ${wallet.balance}.` }, { status: 402 })
  }

  const id = crypto.randomUUID()
  const inputKey = selfieKey(user.id, id, contentType)

  const [job] = await db
    .insert(jobs)
    .values({
      id,
      userId: user.id,
      style,
      variants,
      cost,
      inputKey,
      inputContentType: contentType,
    })
    .returning(jobColumns)

  const upload = await presignSelfieUpload(inputKey, contentType)
  return Response.json({ job, upload }, { status: 201 })
}
