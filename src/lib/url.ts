import { isIP } from 'node:net'

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string }

const MAX_LENGTH = 2048

/**
 * Valida la URL de destino. Además del formato, evita los abusos típicos de
 * un acortador: esquemas peligrosos (javascript:, data:), bucles hacia el
 * propio acortador y redirecciones a la red interna.
 */
export function checkTargetUrl(raw: string, ownBaseUrl: string): UrlCheck {
  const input = raw.trim()
  if (input.length > MAX_LENGTH) return { ok: false, reason: `La URL no puede superar ${MAX_LENGTH} caracteres` }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { ok: false, reason: 'La URL no es válida (¿falta https://?)' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Solo se permiten URLs http:// o https://' }
  }
  if (url.host === new URL(ownBaseUrl).host) {
    return { ok: false, reason: 'No se puede acortar un enlace del propio acortador' }
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isPrivateIp(host)) {
    return { ok: false, reason: 'No se permiten direcciones locales o de red privada' }
  }

  return { ok: true, url: url.toString() }
}

function isPrivateIp(host: string): boolean {
  const version = isIP(host)
  if (version === 4) {
    const [a, b] = host.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  if (version === 6) {
    return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe80:/.test(host) || host.startsWith('::ffff:')
  }
  return false
}
