import { Redis } from 'ioredis'
import pg from 'pg'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { migrate } from './db/migrate.js'

const config = loadConfig()
const db = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 })

const app = await buildApp({ config, db, redis })
await migrate(db, (msg) => app.log.info(msg))
await app.listen({ port: config.port, host: config.host })
app.log.info(`Documentación en ${config.baseUrl}/docs`)

// Cierre ordenado: deja de aceptar peticiones, termina las que están en
// curso y luego cierra las conexiones.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} recibido, cerrando...`)
    await app.close()
    await Promise.all([db.end(), redis.quit()])
    process.exit(0)
  })
}
