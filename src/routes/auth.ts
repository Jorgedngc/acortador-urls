import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { notFound } from '../errors.js'
import { AuthResponseSchema, CredentialsSchema } from '../schemas.js'

// Límite estricto para dificultar ataques de fuerza bruta a las contraseñas.
const AUTH_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } }

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { users } = app.services

  app.post(
    '/register',
    {
      config: AUTH_RATE_LIMIT,
      schema: {
        tags: ['Autenticación'],
        summary: 'Crear una cuenta',
        body: CredentialsSchema,
        response: { 201: AuthResponseSchema, 400: Type.Ref('Error'), 409: Type.Ref('Error') },
      },
    },
    async (request, reply) => {
      const user = await users.register(request.body.email, request.body.password)
      const token = app.jwt.sign({ sub: user.id, email: user.email })
      return reply.code(201).send({ token, user })
    },
  )

  app.post(
    '/login',
    {
      config: AUTH_RATE_LIMIT,
      schema: {
        tags: ['Autenticación'],
        summary: 'Iniciar sesión',
        body: CredentialsSchema,
        response: { 200: AuthResponseSchema, 401: Type.Ref('Error') },
      },
    },
    async (request) => {
      const user = await users.authenticate(request.body.email, request.body.password)
      return { token: app.jwt.sign({ sub: user.id, email: user.email }), user }
    },
  )

  app.get(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['Autenticación'],
        summary: 'Usuario actual',
        security: [{ bearerAuth: [] }],
        response: { 200: Type.Ref('User'), 401: Type.Ref('Error') },
      },
    },
    async (request) => {
      const user = await users.findById(request.user.sub)
      if (!user) throw notFound('Usuario')
      return user
    },
  )
}
