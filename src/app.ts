import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import Fastify, { type FastifyRequest } from 'fastify'
import type { Redis } from 'ioredis'
import type pg from 'pg'
import type { Config } from './config.js'
import { authRoutes } from './routes/auth.js'
import { linkRoutes } from './routes/links.js'
import { redirectRoutes } from './routes/redirect.js'
import { ErrorSchema, LinkSchema, StatsSchema, UserSchema } from './schemas.js'
import { LinkService } from './services/links.js'
import { StatsService } from './services/stats.js'
import { UserService } from './services/users.js'

export interface AppDeps {
  config: Config
  db: pg.Pool
  redis: Redis
  /** false en los tests para no llenar la consola. */
  logger?: boolean
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string }
    user: { sub: string; email: string }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>
    services: { users: UserService; links: LinkService; stats: StatsService }
    config: Config
  }
}

/**
 * Construye la aplicación sin arrancar el servidor. Recibir la base de datos y
 * Redis como dependencias permite usar la misma app en los tests con
 * `app.inject()`, sin abrir puertos.
 */
export async function buildApp({ config, db, redis, logger = true }: AppDeps) {
  const app = Fastify({
    logger: logger && { level: config.logLevel },
    // Detrás de un proxy o CDN, la IP real del cliente llega en X-Forwarded-For.
    trustProxy: true,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: true } },
  }).withTypeProvider<TypeBoxTypeProvider>()

  app.decorate('config', config)
  app.decorate('services', {
    users: new UserService(db),
    links: new LinkService(db, redis, config.baseUrl),
    stats: new StatsService(db),
  })

  // Al cerrar (SIGTERM, fin de los tests...) se esperan los clics que aún se están guardando.
  app.addHook('onClose', async () => app.services.links.flushClicks())

  for (const schema of [ErrorSchema, UserSchema, LinkSchema, StatsSchema]) app.addSchema(schema)

  await app.register(cors, { origin: true })

  // El límite se guarda en Redis, así se comparte entre varias instancias de la API.
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    redis,
    nameSpace: 'ratelimit:',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Demasiadas peticiones. Inténtalo de nuevo en ${Math.ceil(ctx.ttl / 1000)} s.`,
    }),
  })

  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '7d' } })
  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify()
    } catch {
      throw Object.assign(new Error('Falta el token o no es válido. Usa la cabecera Authorization: Bearer <token>'), {
        statusCode: 401,
      })
    }
  })

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Acortador de URLs',
        description:
          'API REST para acortar enlaces y ver estadísticas de clics. Regístrate en `/api/auth/register`, pulsa **Authorize** y pega el token.',
        version: '1.0.0',
      },
      servers: [{ url: config.baseUrl }],
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      tags: [
        { name: 'Autenticación', description: 'Registro e inicio de sesión' },
        { name: 'Enlaces', description: 'Crear y gestionar enlaces cortos' },
        { name: 'Estadísticas', description: 'Clics por día, país, dispositivo...' },
        { name: 'Redirección', description: 'El enlace corto en sí' },
      ],
    },
    refResolver: { buildLocalReference: (json, _baseUri, _fragment, i) => String(json.$id ?? `def-${i}`) },
  })
  await app.register(swaggerUi, { routePrefix: '/docs' })

  app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: `Datos no válidos: ${error.message}` })
    }
    const statusCode = error.statusCode ?? 500
    if (statusCode >= 500) request.log.error(error)
    return reply.code(statusCode).send({
      statusCode,
      error: httpReason(statusCode),
      // Los detalles de los errores internos no se envían al cliente.
      message: statusCode >= 500 ? 'Error interno del servidor' : error.message,
    })
  })

  app.get('/health', { schema: { hide: true } }, async (_req, reply) => {
    const [dbOk, redisOk] = await Promise.all([
      db.query('SELECT 1').then(() => true, () => false),
      redis.ping().then(() => true, () => false),
    ])
    return reply.code(dbOk && redisOk ? 200 : 503).send({ status: dbOk && redisOk ? 'ok' : 'degraded', db: dbOk, redis: redisOk })
  })

  app.get('/', { schema: { hide: true } }, async () => ({
    name: 'Acortador de URLs',
    docs: `${config.baseUrl}/docs`,
  }))

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(linkRoutes, { prefix: '/api/links' })
  // Va al final: captura cualquier /:code que no sea una ruta de la API.
  await app.register(redirectRoutes)

  return app
}

export type App = Awaited<ReturnType<typeof buildApp>>

function httpReason(code: number): string {
  return (
    {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      410: 'Gone',
      413: 'Payload Too Large',
      415: 'Unsupported Media Type',
      429: 'Too Many Requests',
      503: 'Service Unavailable',
    }[code] ?? (code >= 500 ? 'Internal Server Error' : 'Error')
  )
}
