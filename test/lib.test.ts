import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../src/lib/password.js'
import { generateCode, isValidAlias } from '../src/lib/shortcode.js'
import { checkTargetUrl } from '../src/lib/url.js'
import { parseUserAgent } from '../src/lib/userAgent.js'
import { countryFromHeaders, referrerHost, visitorHash } from '../src/lib/visitor.js'

const BASE = 'https://acortar.ejemplo.com'

describe('generateCode', () => {
  it('genera códigos base62 de la longitud pedida', () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^[0-9A-Za-z]{7}$/)
    expect(generateCode(12)).toHaveLength(12)
  })

  it('reparte los caracteres de forma uniforme', () => {
    const counts = new Map<string, number>()
    for (const ch of Array.from({ length: 2000 }, () => generateCode(31)).join('')) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }
    // 62.000 caracteres → ~1000 por símbolo; ningún símbolo debería desviarse mucho.
    expect(counts.size).toBe(62)
    for (const n of counts.values()) expect(n).toBeGreaterThan(800)
  })
})

describe('isValidAlias', () => {
  it.each(['mi-enlace', 'Promo_2026', 'abc'])('acepta %s', (alias) => expect(isValidAlias(alias)).toBe(true))
  it.each(['ab', 'con espacio', 'ñandú', 'api', 'DOCS', 'a'.repeat(33)])('rechaza %s', (alias) =>
    expect(isValidAlias(alias)).toBe(false),
  )
})

describe('checkTargetUrl', () => {
  it('acepta y normaliza URLs http(s)', () => {
    expect(checkTargetUrl('  https://example.com/ruta?q=1 ', BASE)).toEqual({ ok: true, url: 'https://example.com/ruta?q=1' })
    expect(checkTargetUrl('http://EXAMPLE.com', BASE)).toEqual({ ok: true, url: 'http://example.com/' })
  })

  it.each([
    ['example.com', 'no es válida'],
    ['javascript:alert(1)', 'Solo se permiten'],
    ['ftp://example.com/archivo', 'Solo se permiten'],
    [`${BASE}/abc123`, 'propio acortador'],
    ['http://localhost:8080', 'locales'],
    ['http://127.0.0.1/admin', 'locales'],
    ['http://192.168.1.10', 'locales'],
    ['http://10.0.0.5', 'locales'],
    ['http://172.20.0.1', 'locales'],
    ['http://[::1]/', 'locales'],
    ['http://impresora.local', 'locales'],
  ])('rechaza %s', (url, reason) => {
    const result = checkTargetUrl(url, BASE)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain(reason)
  })

  it('rechaza URLs demasiado largas', () => {
    expect(checkTargetUrl(`https://example.com/${'a'.repeat(2100)}`, BASE).ok).toBe(false)
  })

  it('no confunde IPs públicas con privadas', () => {
    expect(checkTargetUrl('http://172.32.0.1', BASE).ok).toBe(true)
    expect(checkTargetUrl('http://8.8.8.8', BASE).ok).toBe(true)
  })
})

describe('parseUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      { device: 'mobile', browser: 'Safari', os: 'iOS' },
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      { device: 'mobile', browser: 'Chrome', os: 'Android' },
    ],
    [
      'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      { device: 'tablet', browser: 'Chrome', os: 'Android' },
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
      { device: 'desktop', browser: 'Edge', os: 'Windows' },
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0',
      { device: 'desktop', browser: 'Firefox', os: 'macOS' },
    ],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', { device: 'bot' }],
    ['WhatsApp/2.24.1 A', { device: 'bot' }],
    ['curl/8.7.1', { device: 'bot' }],
  ])('%s', (ua, expected) => {
    expect(parseUserAgent(ua)).toMatchObject(expected)
  })

  it('maneja la ausencia de user agent', () => {
    expect(parseUserAgent(undefined)).toEqual({ device: 'unknown', browser: 'Desconocido', os: 'Desconocido' })
  })
})

describe('visitante', () => {
  const day = new Date('2026-10-31T12:00:00Z')

  it('el hash es estable en el mismo día y cambia al siguiente', () => {
    const a = visitorHash('1.2.3.4', 'ua', 'secreto', day)
    expect(visitorHash('1.2.3.4', 'ua', 'secreto', new Date('2026-10-31T23:00:00Z'))).toBe(a)
    expect(visitorHash('1.2.3.4', 'ua', 'secreto', new Date('2026-11-01T01:00:00Z'))).not.toBe(a)
    expect(visitorHash('1.2.3.5', 'ua', 'secreto', day)).not.toBe(a)
  })

  it('no contiene la IP', () => {
    expect(visitorHash('1.2.3.4', 'ua', 'secreto', day)).not.toContain('1.2.3.4')
  })

  it('lee el país de las cabeceras de CDN', () => {
    expect(countryFromHeaders({ 'cf-ipcountry': 'mx' })).toBe('MX')
    expect(countryFromHeaders({ 'x-vercel-ip-country': 'ES' })).toBe('ES')
    expect(countryFromHeaders({ 'cf-ipcountry': 'XX' })).toBeNull()
    expect(countryFromHeaders({})).toBeNull()
  })

  it('extrae solo el dominio del referer', () => {
    expect(referrerHost('https://www.twitter.com/usuario/status/1?x=1')).toBe('twitter.com')
    expect(referrerHost('no es url')).toBeNull()
    expect(referrerHost(undefined)).toBeNull()
  })
})

describe('contraseñas', () => {
  it('verifica la contraseña correcta y rechaza las demás', async () => {
    const hash = await hashPassword('correcta-123')
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword('correcta-123', hash)).toBe(true)
    expect(await verifyPassword('incorrecta', hash)).toBe(false)
    expect(await verifyPassword('correcta-123', 'basura')).toBe(false)
  })

  it('usa una sal distinta cada vez', async () => {
    expect(await hashPassword('igual')).not.toBe(await hashPassword('igual'))
  })
})
