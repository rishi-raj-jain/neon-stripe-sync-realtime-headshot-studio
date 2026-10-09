import { createObjectStorage } from '@/shared/object-storage'
import { env } from '@functions/lib/env'

/** Neon injects the branch's AWS_* storage credentials into every function. */
const storage = createObjectStorage({
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  endpoint: env.AWS_ENDPOINT_URL_S3,
  region: env.AWS_REGION,
})

export function objectSize(bucket: string, key: string): Promise<number> {
  return storage.size(bucket, key)
}

export async function readObject(bucket: string, key: string): Promise<Buffer> {
  return Buffer.from(await storage.get(bucket, key))
}

export function writeObject(bucket: string, key: string, body: Buffer, contentType: string) {
  return storage.put(bucket, key, body, contentType)
}
