import { createHmac } from 'node:crypto'

/**
 * Identificador anónimo de visitante: HMAC de IP + user agent + día, con un
 * secreto del servidor. Permite contar visitantes únicos por día sin guardar
 * la IP, y como cambia cada día no sirve para seguir a nadie a largo plazo.
 */
export function visitorHash(ip: string, userAgent: string | undefined, secret: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10)
  return createHmac('sha256', secret).update(`${day}|${ip}|${userAgent ?? ''}`).digest('base64url').slice(0, 22)
}

/**
 * País del visitante a partir de las cabeceras que añaden las CDN y
 * plataformas habituales (Cloudflare, Vercel, CloudFront, Fastly...).
 * Sin CDN delante, el país queda como desconocido.
 */
export function countryFromHeaders(headers: Record<string, string | string[] | undefined>): string | null {
  const candidates = ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'fastly-client-country', 'x-country-code']
  for (const name of candidates) {
    const raw = headers[name]
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase()
    // Cloudflare usa XX para desconocido y T1 para Tor.
    if (value && /^[A-Z]{2}$/.test(value) && value !== 'XX' && value !== 'T1') return value
  }
  return null
}

/** Dominio de origen del clic (solo el host, nunca la URL completa). */
export function referrerHost(referer: string | undefined): string | null {
  if (!referer) return null
  try {
    return new URL(referer).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}
