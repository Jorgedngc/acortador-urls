/** Error con código HTTP; el manejador de errores de Fastify lo usa tal cual. */
export class ApiError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

export const notFound = (what = 'Enlace') => new ApiError(404, `${what} no encontrado`)

/** Código de PostgreSQL para violación de restricción UNIQUE. */
export const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && 'code' in err && err.code === '23505'
