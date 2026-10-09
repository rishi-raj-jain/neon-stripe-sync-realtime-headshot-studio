import '@dotenvx/dotenvx/config'

import { defineConfig } from '@neon/config/v1'
// Neon's config loader doesn't read tsconfig paths, so this one import stays relative.
import { BUCKETS, SELFIE_UPLOAD_PREFIX } from './src/shared/headshots'

/**
 * Infrastructure for Headshot Studio, applied with `neon deploy`.
 *
 * Project region: AWS US East (Ohio) / aws-us-east-2 — same metro as Vercel's cle1,
 * and one of the regions where Object Storage, Functions and AI Gateway are available.
 *
 * The Stripe → Postgres pipeline is NOT declared here: connect it once in the Stripe
 * Dashboard (Data management → Pipelines → Neon). Stripe owns the `stripe` schema.
 */
export default defineConfig({
  // Managed Better Auth: users + sessions live in the `neon_auth` schema.
  auth: true,
  // Image generation for the headshots (OpenAI Responses API dialect).
  aiGateway: true,
  buckets: {
    // Raw selfies. Browsers PUT here through presigned URLs minted by the Next.js API.
    [BUCKETS.selfies]: { access: 'private' },
    // Generated headshots. Served back through short-lived presigned GET URLs.
    [BUCKETS.headshots]: { access: 'private' },
  },
  functions: {
    // Slugs must match ^[a-z0-9]{1,20}$ and can't change after the first deploy.
    onupload: {
      name: 'Generate headshots on selfie upload',
      source: './functions/onupload.ts',
      env: {
        IMAGE_MODEL: 'gpt-5-mini',
      },
      dev: { port: 8787 },
    },
    sweeper: {
      name: 'Fail stuck jobs, expire abandoned uploads',
      source: './functions/sweeper.ts',
      dev: { port: 8788 },
    },
  },
  triggers: {
    // The upload IS the job queue: no webhook, no queue service.
    'selfie-uploaded': {
      type: 'storage_object_created',
      function: 'onupload',
      bucket: BUCKETS.selfies,
      prefix: SELFIE_UPLOAD_PREFIX,
    },
    // Fires even when the database compute is scaled to zero.
    'sweep-stale-jobs': {
      type: 'schedule',
      function: 'sweeper',
      cron: '*/5 * * * *',
    },
  },
  branch: (branch) => {
    if (branch.isDefault) {
      return {
        protected: true,
        postgres: {
          // Matches the live main branch (min raised to 2 CU in the Console).
          computeSettings: { autoscalingLimitMinCu: 2, autoscalingLimitMaxCu: 2 },
        },
      }
    }
    if (!branch.exists) {
      // Debug / preview branches: tiny, auto-expiring. Inherited triggers start disabled,
      // so a branch never processes uploads until you deploy to it explicitly.
      return {
        ttl: '7d',
        postgres: {
          computeSettings: {
            autoscalingLimitMinCu: 2,
            autoscalingLimitMaxCu: 2,
            suspendTimeout: '5m',
          },
        },
      }
    }
    return {}
  },
})
