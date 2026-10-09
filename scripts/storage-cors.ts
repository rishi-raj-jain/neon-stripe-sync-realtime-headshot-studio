import '@dotenvx/dotenvx/config'

import { createHash } from 'node:crypto'
import * as v from 'valibot'
import { BUCKETS } from '@/shared/headshots'
import { createObjectStorage } from '@/shared/object-storage'

/**
 * Browsers PUT selfies directly to Neon Object Storage, which is cross-origin, so the
 * selfies bucket needs a CORS rule. Re-run per branch: buckets are branch-scoped.
 *
 *   APP_ORIGINS="https://headshots.example.com,http://localhost:3000" npm run storage:cors
 */
const env = v.parse(
  v.object({
    AWS_ACCESS_KEY_ID: v.string(),
    AWS_SECRET_ACCESS_KEY: v.string(),
    AWS_ENDPOINT_URL_S3: v.pipe(v.string(), v.url()),
    AWS_REGION: v.string(),
    APP_ORIGINS: v.optional(v.string(), 'http://localhost:3000'),
  }),
  process.env,
)

const origins = env.APP_ORIGINS.split(',').map((origin) => origin.trim())

const storage = createObjectStorage({
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  endpoint: env.AWS_ENDPOINT_URL_S3,
  region: env.AWS_REGION,
})

const escapeXml = (value: string) => value.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`)

const body = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <CORSRule>
${origins.map((origin) => `    <AllowedOrigin>${escapeXml(origin)}</AllowedOrigin>`).join('\n')}
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedHeader>content-type</AllowedHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`

// PutBucketCors requires an integrity header.
await storage.request(BUCKETS.selfies, '', {
  method: 'PUT',
  query: { cors: '' },
  body,
  headers: {
    'Content-Type': 'application/xml',
    'Content-MD5': createHash('md5').update(body).digest('base64'),
  },
})

console.log(`CORS on ${BUCKETS.selfies}: PUT from ${origins.join(', ')}`)
