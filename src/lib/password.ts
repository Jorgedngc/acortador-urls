import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// Parámetros de scrypt recomendados por OWASP (N=2^17, r=8, p=1). En los
// tests se usa un coste menor para que no tarden.
const PARAMS: ScryptOptions = {
  N: process.env.NODE_ENV === 'test' ? 2 ** 12 : 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
}
const KEY_LENGTH = 64

function derive(password: string, salt: Buffer, params: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, params, (err, key) => (err ? reject(err) : resolve(key))),
  )
}

/**
 * Hash con scrypt, incluido en Node: no hace falta compilar dependencias
 * nativas como bcrypt. El formato guarda los parámetros para poder
 * endurecerlos en el futuro sin invalidar las contraseñas existentes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, PARAMS)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, N, r, p, salt, key] = stored.split('$')
  if (algorithm !== 'scrypt' || !salt || !key) return false
  const expected = Buffer.from(key, 'base64')
  const actual = await derive(password, Buffer.from(salt, 'base64'), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  })
  // Comparación en tiempo constante para no filtrar información por tiempos.
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
