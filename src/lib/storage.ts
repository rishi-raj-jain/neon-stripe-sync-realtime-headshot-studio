import 'server-only'

import { env } from '@/env'
import { BUCKETS, type SelfieContentType } from '@/shared/headshots'
import { createObjectStorage } from '@/shared/object-storage'

/** Neon Object Storage via aws4fetch. Branch-scoped endpoint, path-style addressing. */
const storage = createObjectStorage({
  accessKeyId: env.STORAGE_ACCESS_KEY_ID,
  secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
  endpoint: env.STORAGE_ENDPOINT,
  region: env.STORAGE_REGION,
})

const UPLOAD_TTL_SECONDS = 5 * 60
const DOWNLOAD_TTL_SECONDS = 10 * 60

/** Presigned PUT for the browser. The object landing in the bucket fires `onupload`. */
export async function presignSelfieUpload(key: string, contentType: SelfieContentType) {
  const url = await storage.presign('PUT', BUCKETS.selfies, key, UPLOAD_TTL_SECONDS)
  return { url, method: 'PUT' as const, headers: { 'Content-Type': contentType } }
}

export function presignHeadshotDownload(key: string) {
  return storage.presign('GET', BUCKETS.headshots, key, DOWNLOAD_TTL_SECONDS)
}

/** Short-lived view URL for the selfie a run started from (shown next to its results). */
export function presignSelfieDownload(key: string) {
  return storage.presign('GET', BUCKETS.selfies, key, DOWNLOAD_TTL_SECONDS)
}
