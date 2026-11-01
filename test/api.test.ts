import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, DESKTOP_UA, eventually, IPHONE_UA, type TestContext } from './helpers.js'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => ctx?.close())
beforeEach(async () => ctx.reset())

async function register(email = 'ana@ejemplo.com', password = 'contraseña-segura') {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password } })
  return { res, token: res.json().token as string, auth: { authorization: `Bearer ${res.json().token}` } }
}

async function createLink(auth: Record<string, string>, payload: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: '/api/links', headers: auth, payload })
}

const visit = (code: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url: `/${code}`, headers: { 'user-agent': DESKTOP_UA, ...headers } })

describe('autenticación', () => {
  it('registra un usuario y devuelve un token válido', async () => {
    const { res, auth } = await register('Ana@Ejemplo.COM')
    expect(res.statusCode).toBe(201)
    expect(res.json().user).toMatchObject({ id: '1', email: 'ana@ejemplo.com' })

    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: auth })
    expect(me.json().email).toBe('ana@ejemplo.com')
  })

  it('no permite dos cuentas con el mismo email (sin distinguir mayúsculas)', async () => {
    await register('ana@ejemplo.com')
    const { res } = await register('ANA@ejemplo.com')
    expect(res.statusCode).toBe(409)
  })

  it('valida email y longitud de la contraseña', async () => {
    expect((await register('no-es-email')).res.statusCode).toBe(400)
    expect((await register('ana@ejemplo.com', 'corta')).res.statusCode).toBe(400)
  })

  it('da el mismo error para email inexistente y contraseña incorrecta', async () => {
    await register()
    const login = (email: string, password: string) =>
      ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })

    const wrongPassword = await login('ana@ejemplo.com', 'otra-contraseña')
    const unknownEmail = await login('nadie@ejemplo.com', 'otra-contraseña')
    expect(wrongPassword.statusCode).toBe(401)
    expect(unknownEmail.statusCode).toBe(401)
    expect(wrongPassword.json().message).toBe(unknownEmail.json().message)

    const ok = await login('ana@ejemplo.com', 'contraseña-segura')
    expect(ok.statusCode).toBe(200)
    expect(ok.json().token).toBeTypeOf('string')
  })

  it('rechaza peticiones sin token o con un token falso', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/links' })).statusCode).toBe(401)
    const fake = await ctx.app.inject({ method: 'GET', url: '/api/links', headers: { authorization: 'Bearer abc.def.ghi' } })
    expect(fake.statusCode).toBe(401)
  })

  it('limita los intentos de inicio de sesión', async () => {
    const codes: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ana@ejemplo.com', password: 'contraseña-mala' },
      })
      codes.push(res.statusCode)
      if (i === 10) expect(res.json()).toMatchObject({ error: 'Too Many Requests', message: expect.stringContaining('Demasiadas') })
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true)
    expect(codes[10]).toBe(429)
  })
})

describe('enlaces', () => {
  it('crea un enlace con código aleatorio', async () => {
    const { auth } = await register()
    const res = await createLink(auth, { url: 'https://github.com/Jorgedngc' })
    expect(res.statusCode).toBe(201)
    const link = res.json()
    expect(link.code).toMatch(/^[0-9A-Za-z]{7}$/)
    expect(link).toMatchObject({
      shortUrl: `http://sho.rt/${link.code}`,
      url: 'https://github.com/Jorgedngc',
      isActive: true,
      clickCount: 0,
      expiresAt: null,
    })
  })

  it('crea un enlace con alias y rechaza alias repetidos o reservados', async () => {
    const { auth } = await register()
    expect((await createLink(auth, { url: 'https://example.com', alias: 'mi-alias' })).json().code).toBe('mi-alias')
    expect((await createLink(auth, { url: 'https://example.com', alias: 'mi-alias' })).statusCode).toBe(409)
    expect((await createLink(auth, { url: 'https://example.com', alias: 'api' })).statusCode).toBe(400)
  })

  it('valida la URL de destino y la caducidad', async () => {
    const { auth } = await register()
    expect((await createLink(auth, { url: 'javascript:alert(1)' })).statusCode).toBe(400)
    expect((await createLink(auth, { url: 'http://127.0.0.1:5432' })).statusCode).toBe(400)
    expect((await createLink(auth, { url: 'http://sho.rt/abc' })).json().message).toContain('propio acortador')
    expect((await createLink(auth, { url: 'https://example.com', expiresAt: '2020-01-01T00:00:00Z' })).statusCode).toBe(400)
  })

  it('lista los enlaces del usuario paginados, del más reciente al más antiguo', async () => {
    const { auth } = await register()
    for (const alias of ['uno', 'dos', 'tres']) await createLink(auth, { url: 'https://example.com', alias })

    const page1 = await ctx.app.inject({ method: 'GET', url: '/api/links?limit=2', headers: auth })
    expect(page1.json()).toMatchObject({ total: 3, page: 1, limit: 2 })
    expect(page1.json().items.map((l: { code: string }) => l.code)).toEqual(['tres', 'dos'])

    const page2 = await ctx.app.inject({ method: 'GET', url: '/api/links?limit=2&page=2', headers: auth })
    expect(page2.json().items.map((l: { code: string }) => l.code)).toEqual(['uno'])

    const empty = await ctx.app.inject({ method: 'GET', url: '/api/links?limit=2&page=5', headers: auth })
    expect(empty.json()).toMatchObject({ total: 3, items: [] })

    expect((await ctx.app.inject({ method: 'GET', url: '/api/links?limit=500', headers: auth })).statusCode).toBe(400)
  })

  it('al editar el destino, la redirección usa el nuevo (invalida la caché)', async () => {
    const { auth } = await register()
    await createLink(auth, { url: 'https://example.com/viejo', alias: 'cambia' })
    expect((await visit('cambia')).headers.location).toBe('https://example.com/viejo')

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/links/cambia',
      headers: auth,
      payload: { url: 'https://example.com/nuevo' },
    })
    expect(patch.json().url).toBe('https://example.com/nuevo')
    expect((await visit('cambia')).headers.location).toBe('https://example.com/nuevo')
  })

  it('no deja ver, editar, borrar ni consultar estadísticas de enlaces ajenos', async () => {
    const ana = await register('ana@ejemplo.com')
    const luis = await register('luis@ejemplo.com')
    await createLink(ana.auth, { url: 'https://example.com', alias: 'de-ana' })

    const requests = [
      { method: 'GET', url: '/api/links/de-ana' },
      { method: 'PATCH', url: '/api/links/de-ana', payload: { isActive: false } },
      { method: 'DELETE', url: '/api/links/de-ana' },
      { method: 'GET', url: '/api/links/de-ana/stats' },
    ] as const
    for (const req of requests) {
      expect((await ctx.app.inject({ ...req, headers: luis.auth })).statusCode).toBe(404)
    }
    expect((await visit('de-ana')).statusCode).toBe(302)
  })

  it('elimina un enlace y deja de redirigir', async () => {
    const { auth } = await register()
    await createLink(auth, { url: 'https://example.com', alias: 'borrame' })
    await visit('borrame') // queda en caché
    const del = await ctx.app.inject({ method: 'DELETE', url: '/api/links/borrame', headers: auth })
    expect(del.statusCode).toBe(204)
    expect((await visit('borrame')).statusCode).toBe(404)
  })
})

describe('redirección y estadísticas', () => {
  it('redirige con 302 y sin caché del navegador', async () => {
    const { auth } = await register()
    await createLink(auth, { url: 'https://example.com/destino', alias: 'ir-ya' })
    const res = await visit('ir-ya')
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://example.com/destino')
    expect(res.headers['cache-control']).toContain('max-age=0')
  })

  it('devuelve 404 para códigos inexistentes y 410 para enlaces desactivados o caducados', async () => {
    const { auth } = await register()
    expect((await visit('no-existe')).statusCode).toBe(404)

    await createLink(auth, { url: 'https://example.com', alias: 'apagado' })
    await ctx.app.inject({ method: 'PATCH', url: '/api/links/apagado', headers: auth, payload: { isActive: false } })
    expect((await visit('apagado')).json()).toMatchObject({ statusCode: 410, message: 'Este enlace está desactivado' })

    await createLink(auth, { url: 'https://example.com', alias: 'caducado' })
    await ctx.db.query(`UPDATE links SET expires_at = now() - interval '1 minute' WHERE code = 'caducado'`)
    expect((await visit('caducado')).json().message).toBe('Este enlace ha caducado')
  })

  it('registra los clics con país, dispositivo, navegador y origen, sin contar bots', async () => {
    const { auth } = await register()
    await createLink(auth, { url: 'https://example.com', alias: 'stats' })

    await visit('stats', { 'user-agent': IPHONE_UA, 'cf-ipcountry': 'MX', 'x-forwarded-for': '200.1.1.1', referer: 'https://twitter.com/x' })
    await visit('stats', { 'user-agent': IPHONE_UA, 'cf-ipcountry': 'MX', 'x-forwarded-for': '200.1.1.1' })
    await visit('stats', { 'cf-ipcountry': 'ES', 'x-forwarded-for': '80.2.2.2' })
    await visit('stats', { 'user-agent': 'WhatsApp/2.24.1 A', 'x-forwarded-for': '31.3.3.3' })

    const stats = await eventually(
      async () => (await ctx.app.inject({ method: 'GET', url: '/api/links/stats/stats?days=7', headers: auth })).json(),
      (s) => s.totalClicks + s.botClicks === 4,
    )

    expect(stats).toMatchObject({ periodDays: 7, totalClicks: 3, uniqueVisitors: 2, botClicks: 1 })
    expect(stats.clicksByDay).toHaveLength(7)
    expect(stats.clicksByDay.at(-1).clicks).toBe(3)
    expect(stats.countries).toEqual([
      { value: 'MX', clicks: 2 },
      { value: 'ES', clicks: 1 },
    ])
    expect(stats.devices).toEqual([
      { value: 'mobile', clicks: 2 },
      { value: 'desktop', clicks: 1 },
    ])
    expect(stats.browsers).toEqual([
      { value: 'Safari', clicks: 2 },
      { value: 'Chrome', clicks: 1 },
    ])
    expect(stats.referrers).toEqual([
      { value: 'desconocido', clicks: 2 },
      { value: 'twitter.com', clicks: 1 },
    ])

    const link = await ctx.app.inject({ method: 'GET', url: '/api/links/stats', headers: auth })
    expect(link.json().clickCount).toBe(4)
  })

  it('no guarda la IP de los visitantes', async () => {
    const { auth } = await register()
    await createLink(auth, { url: 'https://example.com', alias: 'privado' })
    await visit('privado', { 'x-forwarded-for': '203.0.113.77' })
    const { rows } = await eventually(
      () => ctx.db.query('SELECT * FROM clicks'),
      (r) => r.rowCount === 1,
    )
    expect(JSON.stringify(rows)).not.toContain('203.0.113.77')
  })
})

describe('salud', () => {
  it('informa del estado de PostgreSQL y Redis', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' })
    expect(res.json()).toEqual({ status: 'ok', db: true, redis: true })
  })

  it('publica la especificación OpenAPI', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/docs/json' })
    expect(res.json().paths).toHaveProperty('/api/links/{code}/stats')
  })
})
