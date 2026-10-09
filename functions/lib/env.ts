import * as v from 'valibot'

/**
 * Runtime env inside Neon Functions. Everything except IMAGE_MODEL is injected by Neon
 * from the branch the function is deployed to (Postgres, Object Storage, AI Gateway),
 * so a function on a debug branch automatically talks to that branch's data and files.
 */
const FunctionEnv = v.object({
  DATABASE_URL: v.pipe(v.string(), v.url()),
  NEON_BRANCH: v.optional(v.string(), 'unknown'),
  AWS_ACCESS_KEY_ID: v.pipe(v.string(), v.minLength(1)),
  AWS_SECRET_ACCESS_KEY: v.pipe(v.string(), v.minLength(1)),
  AWS_ENDPOINT_URL_S3: v.pipe(v.string(), v.url()),
  AWS_REGION: v.pipe(v.string(), v.minLength(1)),
  NEON_AI_GATEWAY_TOKEN: v.optional(v.string()),
  NEON_AI_GATEWAY_BASE_URL: v.optional(v.pipe(v.string(), v.url())),
  IMAGE_MODEL: v.optional(v.string(), 'gpt-5-mini'),
})

export const env = v.parse(FunctionEnv, process.env)
