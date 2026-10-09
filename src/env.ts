import 'server-only'

import * as v from 'valibot'

/**
 * Server env for the Next.js app, validated once at module load.
 *
 * Locally, `neon deploy` / `neon env pull` write the Neon-managed vars into `.env`
 * (Next.js loads it). Object Storage credentials arrive as AWS_*, but Vercel reserves
 * the AWS_* names, so on Vercel set them as NEON_STORAGE_* instead. Both are accepted.
 */
const url = v.pipe(v.string(), v.url())
const nonEmpty = v.pipe(v.string(), v.minLength(1))

const ServerEnv = v.object({
  DATABASE_URL: url,
  NEON_AUTH_BASE_URL: url,
  NEON_AUTH_COOKIE_SECRET: v.pipe(v.string(), v.minLength(32, 'NEON_AUTH_COOKIE_SECRET must be at least 32 chars (openssl rand -base64 32)')),
  STRIPE_SECRET_KEY: v.pipe(v.string(), v.regex(/^(sk|rk)_(test|live)_/, 'STRIPE_SECRET_KEY must be a secret or restricted key')),
  APP_URL: url,
  /** Shared demo login behind the "Try the demo account" button. Server-side only. */
  DEMO_USERNAME: v.optional(v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_.-]{3,30}$/)), 'demo'),
  DEMO_PASSWORD: v.optional(v.pipe(v.string(), v.minLength(8, 'DEMO_PASSWORD must be at least 8 characters'))),
  /** Prefilled in Stripe Checkout for the demo account (its login has no real email). */
  DEMO_EMAIL: v.optional(v.pipe(v.string(), v.email('DEMO_EMAIL must be an email address')), 'demo@example.com'),
  STORAGE_ACCESS_KEY_ID: nonEmpty,
  STORAGE_SECRET_ACCESS_KEY: nonEmpty,
  STORAGE_ENDPOINT: url,
  STORAGE_REGION: nonEmpty,
})

type ServerEnv = v.InferOutput<typeof ServerEnv>

function appUrl(e: NodeJS.ProcessEnv): string {
  if (e.APP_URL) return e.APP_URL
  if (e.VERCEL_ENV === 'production' && e.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${e.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  if (e.VERCEL_URL) return `https://${e.VERCEL_URL}`
  return 'http://localhost:3000'
}

function parseServerEnv(e: NodeJS.ProcessEnv): ServerEnv {
  const result = v.safeParse(ServerEnv, {
    DATABASE_URL: e.DATABASE_URL,
    NEON_AUTH_BASE_URL: e.NEON_AUTH_BASE_URL,
    NEON_AUTH_COOKIE_SECRET: e.NEON_AUTH_COOKIE_SECRET,
    STRIPE_SECRET_KEY: e.STRIPE_SECRET_KEY,
    APP_URL: appUrl(e),
    DEMO_USERNAME: e.DEMO_USERNAME || undefined,
    DEMO_PASSWORD: e.DEMO_PASSWORD || undefined,
    DEMO_EMAIL: e.DEMO_EMAIL || undefined,
    STORAGE_ACCESS_KEY_ID: e.NEON_STORAGE_ACCESS_KEY_ID ?? e.AWS_ACCESS_KEY_ID,
    STORAGE_SECRET_ACCESS_KEY: e.NEON_STORAGE_SECRET_ACCESS_KEY ?? e.AWS_SECRET_ACCESS_KEY,
    STORAGE_ENDPOINT: e.NEON_STORAGE_ENDPOINT ?? e.AWS_ENDPOINT_URL_S3,
    STORAGE_REGION: e.NEON_STORAGE_REGION ?? e.AWS_REGION,
  })

  if (!result.success) {
    const issues = Object.entries(v.flatten<typeof ServerEnv>(result.issues).nested ?? {})
      .map(([key, messages]) => `  - ${key}: ${messages?.join(', ')}`)
      .join('\n')
    throw new Error(`Invalid server environment:\n${issues}`)
  }
  return result.output
}

export const env = parseServerEnv(process.env)
