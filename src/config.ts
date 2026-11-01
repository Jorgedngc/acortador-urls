export interface Config {
  port: number
  host: string
  baseUrl: string
  databaseUrl: string
  redisUrl: string
  jwtSecret: string
  logLevel: string
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Falta la variable de entorno ${name} (revisa .env.example)`)
  return value
}

export function loadConfig(): Config {
  const jwtSecret = required('JWT_SECRET')
  if (process.env.NODE_ENV === 'production' && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción')
  }
  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    baseUrl: (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: required('REDIS_URL'),
    jwtSecret,
    logLevel: process.env.LOG_LEVEL ?? 'info',
  }
}
