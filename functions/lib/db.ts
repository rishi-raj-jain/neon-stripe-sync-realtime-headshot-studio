import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { env } from '@functions/lib/env'

/** Same serverless driver as the Next.js app, over HTTP. */
export const sql = neon(env.DATABASE_URL)
export const db = drizzle({ client: sql })
