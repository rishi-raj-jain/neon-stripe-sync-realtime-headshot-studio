import { getUser, unauthorized } from '@/lib/auth/server'
import { getAllowance } from '@/lib/credits'
import { createJobIfAllowed, getRunsPage, parseCursor } from '@/lib/runs'
import { presignSelfieUpload } from '@/lib/storage'
import { CREDITS_PER_VARIANT, MAX_VARIANTS, SELFIE_CONTENT_TYPES, STYLES, type SelfieContentType, type StyleId } from '@/shared/headshots'
import * as v from 'valibot'

const CreateJob = v.object({
  style: v.picklist(Object.keys(STYLES) as [StyleId, ...StyleId[]]),
  variants: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_VARIANTS)),
  contentType: v.picklist(Object.keys(SELFIE_CONTENT_TYPES) as [SelfieContentType, ...SelfieContentType[]], "Upload a JPEG, PNG or WebP. HEIC isn't supported, so export it as JPEG first."),
})

/**
 * GET /api/jobs?cursor=…  →  { runs, nextCursor, stats? }
 *
 * The signed-in user's run history, newest first, 12 per page. Every run comes back with
 * signed URLs for its selfie and results, so the dashboard renders without extra requests.
 * The first page (no cursor) also carries all-time stats, read in the same round trip.
 */
export async function GET(request: Request) {
  const user = await getUser()
  if (!user) return unauthorized()

  const raw = new URL(request.url).searchParams.get('cursor')
  const cursor = raw ? parseCursor(raw) : null
  if (raw && !cursor) return Response.json({ error: 'invalid cursor' }, { status: 400 })
  return Response.json(await getRunsPage(user.id, cursor))
}

/**
 * POST /api/jobs  { style, variants, contentType }  →  { job, upload }
 *
 * Creates the job row and returns a presigned PUT URL. The browser uploads the selfie
 * straight to Neon Object Storage, and that upload fires the `onupload` Neon Function.
 * Credits and the daily image limit (DAILY_IMAGE_LIMIT per rolling 24 hours) are only
 * *checked* here: 402 when credits are short, 429 when the limit is used up. Both are enforced
 * atomically when the function claims the job.
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

  const job = await createJobIfAllowed({ userId: user.id, style, variants, cost, contentType })
  if (!job) {
    // Rare path: read the allowance only to explain the refusal. The limit comes first, since
    // buying credits wouldn't get past it.
    const { wallet, usage } = await getAllowance(user.id)
    if (usage.remaining < variants) {
      const retryAfter = usage.freesAt ? Math.max(1, Math.ceil((Date.parse(usage.freesAt) - Date.now()) / 1000)) : 60
      const left = usage.remaining === 0 ? 'none left' : `${usage.remaining} left`
      return Response.json({ error: `Daily limit: ${usage.limit} headshots per 24 hours, and you have ${left}.`, usage }, { status: 429, headers: { 'Retry-After': String(retryAfter) } })
    }
    return Response.json({ error: `This needs ${cost} credits and you have ${wallet.balance}.` }, { status: 402 })
  }

  const { inputKey, ...created } = job
  const upload = await presignSelfieUpload(inputKey, contentType)
  return Response.json({ job: created, upload }, { status: 201 })
}
