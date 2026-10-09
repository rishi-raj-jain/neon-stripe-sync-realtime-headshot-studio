import { createObjectStorage } from '@/shared/object-storage'
import { env } from '@functions/lib/env'

/** Neon injects the branch's AWS_* storage credentials into every function. */
const storage = createObjectStorage({
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  endpoint: env.AWS_ENDPOINT_URL_S3,
  region: env.AWS_REGION,
})

/**
 * The object's bytes, or null if it is over `maxBytes`. One GET: the size is checked from
 * Content-Length before the body is read (and again after, in case it was missing).
 */
export async function readObject(bucket: string, key: string, maxBytes: number): Promise<Buffer | null> {
  const response = await storage.request(bucket, key, { method: 'GET' })
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel()
    return null
  }
  const body = Buffer.from(await response.arrayBuffer())
  return body.length > maxBytes ? null : body
}

export async function writeObject(bucket: string, key: string, body: Buffer, contentType: string) {
  await storage.request(bucket, key, { method: 'PUT', body, headers: { 'Content-Type': contentType } })
}
