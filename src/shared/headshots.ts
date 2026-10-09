/** Domain constants shared by the Next.js app (Vercel) and the Neon Functions. Keep it dependency-free. */

export const BUCKETS = {
  selfies: 'selfies',
  headshots: 'headshots',
} as const

export const SELFIE_UPLOAD_PREFIX = 'uploads/'

/** 1 credit = 1 generated headshot. */
export const CREDITS_PER_VARIANT = 1
export const MAX_VARIANTS = 2
/**
 * Rate limit: headshots (variants) one user can generate in any rolling 24 hours. Enforced
 * when `onupload` claims a job; failed runs don't count, like they don't cost credits.
 */
export const DAILY_IMAGE_LIMIT = 2
export const MAX_SELFIE_BYTES = 10 * 1024 * 1024

export const SELFIE_CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const
export type SelfieContentType = keyof typeof SELFIE_CONTENT_TYPES

export const STYLES = {
  corporate: {
    label: 'Corporate',
    prompt: 'a professional corporate headshot: navy suit, soft grey seamless studio backdrop, ' + 'three-point lighting, shallow depth of field',
  },
  startup: {
    label: 'Startup casual',
    prompt: 'a relaxed tech-founder headshot: plain crew-neck tee, bright modern office softly ' + 'blurred behind, natural window light',
  },
  studio: {
    label: 'Studio B&W',
    prompt: 'a dramatic black-and-white studio portrait: dark backdrop, Rembrandt lighting, ' + 'fine film grain',
  },
  outdoor: {
    label: 'Outdoor',
    prompt: 'an outdoor golden-hour headshot: smart-casual jacket, city park bokeh background, ' + 'warm rim light',
  },
} as const
export type StyleId = keyof typeof STYLES

export function buildPrompt(style: StyleId): string {
  return (
    `Turn the person in the attached selfie into ${STYLES[style].prompt}. ` +
    'Preserve their identity exactly: face shape, skin tone, eye colour, hairstyle, ' +
    'glasses and facial hair. Head-and-shoulders crop, looking at the camera, square 1:1.'
  )
}

/** Credit packs sold through Stripe Checkout. `credits` is written to PaymentIntent metadata. */
/**
 * Credit packs. Each one is a Stripe Product + Price (lookup_key `headshots_<id>`). Checkout
 * resolves the price id from the synced `stripe.prices` table. `unitAmount` is display-only;
 * Stripe's price is the source of truth.
 */
export const CREDIT_PACKS = {
  starter: { label: 'Starter', credits: 10, unitAmount: 900, lookupKey: 'headshots_starter' },
  pro: { label: 'Pro', credits: 40, unitAmount: 2900, lookupKey: 'headshots_pro' },
  studio: { label: 'Studio', credits: 100, unitAmount: 5900, lookupKey: 'headshots_studio' },
} as const

/**
 * Applied to every Checkout Session the app creates. `HEADSHOTS100` is a 100%-off, once-only
 * coupon in Stripe, so every pack is currently free. Set this to null to start charging.
 */
export const AUTO_PROMOTION_CODE: string | null = 'HEADSHOTS100'
export type PackId = keyof typeof CREDIT_PACKS

/**
 * Object keys. The selfie key carries everything the upload trigger needs to find the
 * job, so the function never trusts anything but the key Neon reports.
 *   selfies:   uploads/{userId}/{jobId}.{ext}
 *   headshots: {userId}/{jobId}/{n}.jpeg
 */
export function selfieKey(userId: string, jobId: string, contentType: SelfieContentType) {
  return `${SELFIE_UPLOAD_PREFIX}${userId}/${jobId}.${SELFIE_CONTENT_TYPES[contentType]}`
}

export function parseSelfieKey(key: string): { userId: string; jobId: string } | null {
  // Both ids are uuids: neon_auth."user".id and app.jobs.id.
  const match = /^uploads\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|webp)$/.exec(key)
  if (!match) return null
  return { userId: match[1]!, jobId: match[2]! }
}

export function headshotKey(userId: string, jobId: string, index: number) {
  return `${userId}/${jobId}/${index}.jpeg`
}
