import type { Redis } from 'ioredis'
import type pg from 'pg'
import { ApiError, isUniqueViolation, notFound } from '../errors.js'
import { generateCode, isValidAlias } from '../lib/shortcode.js'
import { checkTargetUrl } from '../lib/url.js'

export interface Link {
  code: string
  shortUrl: string
  url: string
  isActive: boolean
  expiresAt: string | null
  clickCount: number
  createdAt: string
  updatedAt: string
}

interface LinkRow {
  id: string
  code: string
  url: string
  user_id: string
  is_active: boolean
  expires_at: Date | null
  click_count: string
  created_at: Date
  updated_at: Date
}

/** Lo mínimo que necesita la redirección; es lo que se guarda en Redis. */
export interface CachedLink {
  id: string
  url: string
  isActive: boolean
  expiresAt: string | null
}

export interface ClickData {
  visitorHash: string
  country: string | null
  device: string
  browser: string
  os: string
  referrerHost: string | null
}

const CACHE_TTL_SECONDS = 60 * 60
// Los códigos inexistentes también se cachean un poco, para que alguien
// probando códigos al azar no golpee la base de datos en cada intento.
const MISSING_TTL_SECONDS = 60
const MISSING = '__missing__'

export class LinkService {
  private readonly db: pg.Pool
  private readonly redis: Redis
  private readonly baseUrl: string
  /** Escrituras de clics en curso; se esperan al cerrar la app para no perder ninguna. */
  private readonly pendingClicks = new Set<Promise<void>>()

  constructor(db: pg.Pool, redis: Redis, baseUrl: string) {
    this.db = db
    this.redis = redis
    this.baseUrl = baseUrl
  }

  private toLink(row: LinkRow): Link {
    return {
      code: row.code,
      shortUrl: `${this.baseUrl}/${row.code}`,
      url: row.url,
      isActive: row.is_active,
      expiresAt: row.expires_at?.toISOString() ?? null,
      clickCount: Number(row.click_count),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }
  }

  private validateUrl(url: string): string {
    const check = checkTargetUrl(url, this.baseUrl)
    if (!check.ok) throw new ApiError(400, check.reason)
    return check.url
  }

  private validateExpiry(expiresAt: string | null | undefined): Date | null {
    if (!expiresAt) return null
    const date = new Date(expiresAt)
    if (date.getTime() <= Date.now()) throw new ApiError(400, 'La fecha de caducidad debe estar en el futuro')
    return date
  }

  async create(userId: string, input: { url: string; alias?: string; expiresAt?: string | null }): Promise<Link> {
    const url = this.validateUrl(input.url)
    const expiresAt = this.validateExpiry(input.expiresAt)
    const insert = (code: string) =>
      this.db.query<LinkRow>(
        'INSERT INTO links (code, url, user_id, expires_at) VALUES ($1, $2, $3, $4) RETURNING *',
        [code, url, userId, expiresAt],
      )

    if (input.alias !== undefined) {
      if (!isValidAlias(input.alias)) {
        throw new ApiError(400, 'El alias debe tener 3-32 caracteres (letras, números, - o _) y no ser una palabra reservada')
      }
      try {
        const { rows } = await insert(input.alias)
        await this.redis.del(cacheKey(input.alias))
        return this.toLink(rows[0])
      } catch (err) {
        if (isUniqueViolation(err)) throw new ApiError(409, 'Ese alias ya está en uso')
        throw err
      }
    }

    // Con códigos aleatorios una colisión es casi imposible, pero si ocurre
    // simplemente se prueba con otro.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { rows } = await insert(generateCode())
        return this.toLink(rows[0])
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
      }
    }
    throw new ApiError(503, 'No se pudo generar un código único, inténtalo de nuevo')
  }

  async list(userId: string, page: number, limit: number): Promise<{ items: Link[]; total: number }> {
    const { rows } = await this.db.query<LinkRow & { total: string }>(
      `SELECT *, count(*) OVER () AS total FROM links
       WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [userId, limit, (page - 1) * limit],
    )
    let total = Number(rows[0]?.total ?? 0)
    // Si la página pedida está vacía, el total no viene en ninguna fila.
    if (rows.length === 0 && page > 1) {
      const count = await this.db.query<{ n: string }>('SELECT count(*) AS n FROM links WHERE user_id = $1', [userId])
      total = Number(count.rows[0].n)
    }
    return { items: rows.map((r) => this.toLink(r)), total }
  }

  /** Busca un enlace del usuario. Los ajenos se tratan como inexistentes para no revelar que existen. */
  async findOwned(userId: string, code: string): Promise<Link & { id: string }> {
    const { rows } = await this.db.query<LinkRow>('SELECT * FROM links WHERE code = $1 AND user_id = $2', [code, userId])
    if (!rows[0]) throw notFound()
    return { ...this.toLink(rows[0]), id: rows[0].id }
  }

  async update(
    userId: string,
    code: string,
    patch: { url?: string; isActive?: boolean; expiresAt?: string | null },
  ): Promise<Link> {
    const sets: string[] = []
    const values: unknown[] = []
    const add = (column: string, value: unknown) => {
      values.push(value)
      sets.push(`${column} = $${values.length}`)
    }
    if (patch.url !== undefined) add('url', this.validateUrl(patch.url))
    if (patch.isActive !== undefined) add('is_active', patch.isActive)
    if (patch.expiresAt !== undefined) add('expires_at', this.validateExpiry(patch.expiresAt))
    if (sets.length === 0) return this.findOwned(userId, code)

    values.push(code, userId)
    const { rows } = await this.db.query<LinkRow>(
      `UPDATE links SET ${sets.join(', ')}, updated_at = now()
       WHERE code = $${values.length - 1} AND user_id = $${values.length} RETURNING *`,
      values,
    )
    if (!rows[0]) throw notFound()
    await this.redis.del(cacheKey(code))
    return this.toLink(rows[0])
  }

  async remove(userId: string, code: string): Promise<void> {
    const { rowCount } = await this.db.query('DELETE FROM links WHERE code = $1 AND user_id = $2', [code, userId])
    if (!rowCount) throw notFound()
    await this.redis.del(cacheKey(code))
  }

  /** Camino rápido de la redirección: Redis primero, PostgreSQL si no está en caché. */
  async resolve(code: string): Promise<CachedLink | null> {
    const cached = await this.redis.get(cacheKey(code))
    if (cached === MISSING) return null
    if (cached) return JSON.parse(cached) as CachedLink

    const { rows } = await this.db.query<LinkRow>('SELECT * FROM links WHERE code = $1', [code])
    if (!rows[0]) {
      await this.redis.set(cacheKey(code), MISSING, 'EX', MISSING_TTL_SECONDS)
      return null
    }
    const link: CachedLink = {
      id: rows[0].id,
      url: rows[0].url,
      isActive: rows[0].is_active,
      expiresAt: rows[0].expires_at?.toISOString() ?? null,
    }
    await this.redis.set(cacheKey(code), JSON.stringify(link), 'EX', CACHE_TTL_SECONDS)
    return link
  }

  /**
   * Guarda el clic y actualiza el contador del enlace en una sola consulta.
   * Se lanza sin esperar (la redirección no debe ir más lenta por esto), pero
   * la promesa queda registrada para poder esperarla con `flushClicks`.
   */
  recordClick(linkId: string, click: ClickData): Promise<void> {
    const write = this.db
      .query(
        `WITH inserted AS (
           INSERT INTO clicks (link_id, visitor_hash, country, device, browser, os, referrer_host)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
         )
         UPDATE links SET click_count = click_count + 1 WHERE id = $1`,
        [linkId, click.visitorHash, click.country, click.device, click.browser, click.os, click.referrerHost],
      )
      .then(() => undefined)
      .finally(() => this.pendingClicks.delete(write))
    this.pendingClicks.add(write)
    return write
  }

  /** Espera a que terminen las escrituras de clics pendientes (los errores ya se registran aparte). */
  async flushClicks(): Promise<void> {
    await Promise.allSettled(this.pendingClicks)
  }
}

const cacheKey = (code: string) => `link:${code}`
