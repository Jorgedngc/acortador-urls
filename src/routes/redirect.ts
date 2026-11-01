import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { parseUserAgent } from '../lib/userAgent.js'
import { countryFromHeaders, referrerHost, visitorHash } from '../lib/visitor.js'
import { CodeParams } from '../schemas.js'

export const redirectRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { links } = app.services

  app.get(
    '/:code',
    {
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
      schema: {
        tags: ['Redirección'],
        summary: 'Abrir un enlace corto',
        description: 'Redirige (302) a la URL original y registra el clic. 404 si no existe, 410 si está desactivado o caducado.',
        params: CodeParams,
        response: { 404: Type.Ref('Error'), 410: Type.Ref('Error') },
      },
    },
    async (request, reply) => {
      const link = await links.resolve(request.params.code)
      if (!link) return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Este enlace no existe' })

      const expired = link.expiresAt !== null && new Date(link.expiresAt).getTime() <= Date.now()
      if (!link.isActive || expired) {
        return reply.code(410).send({
          statusCode: 410,
          error: 'Gone',
          message: expired ? 'Este enlace ha caducado' : 'Este enlace está desactivado',
        })
      }

      const userAgent = request.headers['user-agent']
      const ua = parseUserAgent(userAgent)
      const click = {
        visitorHash: visitorHash(request.ip, userAgent, app.config.jwtSecret),
        country: countryFromHeaders(request.headers),
        device: ua.device,
        browser: ua.browser,
        os: ua.os,
        referrerHost: referrerHost(request.headers.referer),
      }
      // El clic se guarda sin esperar: la redirección no debe ir más lenta
      // por las estadísticas. Si falla, se registra en el log y ya está.
      links.recordClick(link.id, click).catch((err) => request.log.error({ err }, 'No se pudo registrar el clic'))

      // 302 (y no 301) para que el navegador no cachee la redirección: así
      // cada visita llega al servidor y se cuenta, y el destino se puede cambiar.
      return reply.header('cache-control', 'private, max-age=0').redirect(link.url, 302)
    },
  )
}
