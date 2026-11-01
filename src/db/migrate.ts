import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { MIGRATIONS } from './migrations.js'

/**
 * Aplica las migraciones pendientes, cada una en su propia transacción.
 * Un advisory lock evita que dos instancias migren a la vez al arrancar.
 */
export async function migrate(pool: pg.Pool, log: (msg: string) => void = () => {}): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(727274)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    const { rows } = await client.query<{ id: string }>('SELECT id FROM schema_migrations')
    const applied = new Set(rows.map((r) => r.id))

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue
      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id])
        await client.query('COMMIT')
        log(`Migración aplicada: ${migration.id}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {})
    client.release()
  }
}

// Permite ejecutar `npm run migrate` directamente.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  migrate(pool, console.log)
    .then(() => console.log('Base de datos al día'))
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
    .finally(() => pool.end())
}
