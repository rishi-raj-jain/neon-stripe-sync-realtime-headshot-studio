import { AwsClient } from 'aws4fetch'

/**
 * Minimal S3 client for Neon Object Storage on top of aws4fetch (SigV4 + fetch, no AWS SDK).
 * Shared by the Next.js app and the Neon Functions, so it imports nothing app-specific.
 * Neon Object Storage requires path-style URLs: {endpoint}/{bucket}/{key}.
 */
type ObjectStorageConfig = {
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
  region: string
}

type RequestOptions = {
  method: 'GET' | 'HEAD' | 'PUT' | 'DELETE'
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: string | Uint8Array
}

class ObjectStorageError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
    readonly detail: string,
  ) {
    super(`${operation} failed with ${status}: ${detail.slice(0, 300)}`)
  }
}

export function createObjectStorage(config: ObjectStorageConfig) {
  // aws4fetch retries 5xx/429 (e.g. Neon's 503 SlowDown) with backoff.
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: 's3',
    retries: 3,
  })
  const endpoint = config.endpoint.replace(/\/+$/, '')

  function objectUrl(bucket: string, key = '', query: Record<string, string> = {}) {
    const path = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    const url = new URL(`${endpoint}/${bucket}${key ? `/${path}` : ''}`)
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
    return url
  }

  async function request(bucket: string, key: string, options: RequestOptions) {
    const response = await client.fetch(objectUrl(bucket, key, options.query), {
      method: options.method,
      headers: options.headers,
      // Node Buffers are Uint8Array<ArrayBufferLike>; fetch accepts them, the DOM BodyInit type doesn't.
      body: options.body as string | Uint8Array<ArrayBuffer> | undefined,
    })
    if (!response.ok) {
      throw new ObjectStorageError(response.status, `${options.method} ${bucket}/${key}`, await response.text().catch(() => ''))
    }
    return response
  }

  return {
    request,

    /**
     * Presigned URL (query-string SigV4). Content-Type is not part of the signature.
     *
     * With `stableForSeconds`, the signing time is rounded down to that window and the expiry
     * stretched by it, so every call inside the window returns the *same* URL (still valid for
     * at least `expiresInSeconds`). A polling UI then keeps its <img src> and the browser
     * reuses the image instead of downloading it again on every poll.
     */
    async presign(method: 'GET' | 'PUT', bucket: string, key: string, expiresInSeconds: number, stableForSeconds = 0) {
      const windowMs = stableForSeconds * 1000
      const signedAt = windowMs ? Math.floor(Date.now() / windowMs) * windowMs : Date.now()
      const url = objectUrl(bucket, key, { 'X-Amz-Expires': String(expiresInSeconds + stableForSeconds) })
      // SigV4 datetime: YYYYMMDDTHHMMSSZ
      const datetime = new Date(signedAt).toISOString().replace(/[:-]|\.\d{3}/g, '')
      const signed = await client.sign(url, { method, aws: { signQuery: true, datetime } })
      return signed.url
    },
  }
}
