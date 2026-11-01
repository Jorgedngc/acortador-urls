import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Código aleatorio en base62. Con 7 caracteres hay 62^7 ≈ 3,5 billones de
 * combinaciones, así que las colisiones son rarísimas (y se reintentan).
 *
 * Se descartan los bytes >= 248 (rejection sampling) porque 256 no es
 * múltiplo de 62: usar `byte % 62` directamente haría que los primeros
 * caracteres salieran un poco más a menudo.
 */
export function generateCode(length = 7): string {
  let code = ''
  while (code.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 248) continue
      code += ALPHABET[byte % 62]
      if (code.length === length) break
    }
  }
  return code
}

/** Rutas propias de la API que no pueden usarse como alias. */
export const RESERVED_ALIASES = new Set(['api', 'docs', 'health', 'favicon.ico', 'robots.txt', 'admin', 'login', 'static'])

export const ALIAS_PATTERN = '^[A-Za-z0-9_-]{3,32}$'

export function isValidAlias(alias: string): boolean {
  return new RegExp(ALIAS_PATTERN).test(alias) && !RESERVED_ALIASES.has(alias.toLowerCase())
}
