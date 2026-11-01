import { Redis } from 'ioredis'
import pg from 'pg'
import { buildApp, type App } from '../src/app.js'
import type { Config } from '../src/config.js'
import { migrate } from '../src/db/migrate.js'

/**
 * Los tests de integración usan PostgreSQL y Redis reales (los de
 * docker-compose), pero en una base de datos y un índice de Redis aparte para
 * no tocar los datos de desarrollo.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://acortador:acortador@localhost:5432/acortador_test'
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1'

export const config: Config = {
  port: 0,
  host: '127.0.0.1',
  baseUrl: 'http://sho.rt',
  databaseUrl: DATABASE_URL,
  redisUrl: REDIS_URL,
  jwtSecret: 'secreto-de-test-con-longitud-suficiente-123',
  logLevel: 'silent',
}

async function ensureDatabase() {
  const url = new URL(DATABASE_URL)
  const name = url.pathname.slice(1)
  url.pathname = '/postgres'
  const admin = new pg.Client({ connectionString: url.toString() })
  await admin.connect()
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
    if (!rowCount) await admin.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`)
  } finally {
    await admin.end()
  }
}

export interface TestContext {
  app: App
  db: pg.Pool
  redis: Redis
  reset: () => Promise<void>
  close: () => Promise<void>
}

export async function createTestContext(): Promise<TestContext> {
  await ensureDatabase()
  const db = new pg.Pool({ connectionString: DATABASE_URL })
  const redis = new Redis(REDIS_URL)
  await migrate(db)
  const app = await buildApp({ config, db, redis, logger: false })
  await app.ready()

  return {
    app,
    db,
    redis,
    reset: async () => {
      await app.services.links.flushClicks()
      await db.query('TRUNCATE users, links, clicks RESTART IDENTITY CASCADE')
      await redis.flushdb()
    },
    close: async () => {
      await app.close()
      await db.end()
      await redis.quit()
    },
  }
}

/** Reintenta hasta que la condición se cumpla (el registro de clics es asíncrono). */
export async function eventually<T>(fn: () => Promise<T>, check: (value: T) => boolean, timeoutMs = 2000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (check(value) || Date.now() - start > timeoutMs) return value
    await new Promise((r) => setTimeout(r, 25))
  }
}

export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
export const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
