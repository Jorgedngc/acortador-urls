import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { CodeParams, CreateLinkSchema, PaginationQuery, UpdateLinkSchema } from '../schemas.js'

const secured = { security: [{ bearerAuth: [] }] }
const errors = { 400: Type.Ref('Error'), 401: Type.Ref('Error'), 404: Type.Ref('Error') }

export const linkRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { links, stats } = app.services

  // Todas las rutas de enlaces requieren estar autenticado.
  app.addHook('onRequest', app.authenticate)

  app.post(
    '/',
    {
      // Límite por usuario (no por IP) para crear enlaces.
      config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: (req) => `user:${req.user?.sub ?? req.ip}` } },
      schema: {
        tags: ['Enlaces'],
        summary: 'Acortar una URL',
        description: 'Si no se indica alias, se genera un código aleatorio de 7 caracteres.',
        ...secured,
        body: CreateLinkSchema,
        response: { 201: Type.Ref('Link'), 409: Type.Ref('Error'), ...errors },
      },
    },
    async (request, reply) => reply.code(201).send(await links.create(request.user.sub, request.body)),
  )

  app.get(
    '/',
    {
      schema: {
        tags: ['Enlaces'],
        summary: 'Listar mis enlaces',
        ...secured,
        querystring: PaginationQuery,
        response: {
          200: Type.Object({
            items: Type.Array(Type.Ref('Link')),
            total: Type.Integer(),
            page: Type.Integer(),
            limit: Type.Integer(),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      const { page, limit } = request.query
      return { ...(await links.list(request.user.sub, page, limit)), page, limit }
    },
  )

  app.get(
    '/:code',
    {
      schema: {
        tags: ['Enlaces'],
        summary: 'Ver un enlace',
        ...secured,
        params: CodeParams,
        response: { 200: Type.Ref('Link'), ...errors },
      },
    },
    async (request) => {
      const { id: _id, ...link } = await links.findOwned(request.user.sub, request.params.code)
      return link
    },
  )

  app.patch(
    '/:code',
    {
      schema: {
        tags: ['Enlaces'],
        summary: 'Editar un enlace',
        description: 'Cambia el destino, desactiva el enlace o modifica su caducidad (null la elimina).',
        ...secured,
        params: CodeParams,
        body: UpdateLinkSchema,
        response: { 200: Type.Ref('Link'), ...errors },
      },
    },
    async (request) => links.update(request.user.sub, request.params.code, request.body),
  )

  app.delete(
    '/:code',
    {
      schema: {
        tags: ['Enlaces'],
        summary: 'Eliminar un enlace',
        ...secured,
        params: CodeParams,
        response: { 204: Type.Null(), ...errors },
      },
    },
    async (request, reply) => {
      await links.remove(request.user.sub, request.params.code)
      return reply.code(204).send(null)
    },
  )

  app.get(
    '/:code/stats',
    {
      schema: {
        tags: ['Estadísticas'],
        summary: 'Estadísticas de un enlace',
        description: 'Clics de los últimos `days` días (UTC), sin contar bots.',
        ...secured,
        params: CodeParams,
        querystring: Type.Object({ days: Type.Integer({ minimum: 1, maximum: 365, default: 30 }) }),
        response: { 200: Type.Ref('Stats'), ...errors },
      },
    },
    async (request) => {
      const link = await links.findOwned(request.user.sub, request.params.code)
      return stats.forLink(link.id, request.query.days)
    },
  )
}
