import { Type } from 'typebox'
import { ALIAS_PATTERN } from './lib/shortcode.js'

/** Esquemas compartidos: validan las peticiones y generan la documentación OpenAPI. */

export const ErrorSchema = Type.Object(
  {
    statusCode: Type.Integer({ examples: [400] }),
    error: Type.String({ examples: ['Bad Request'] }),
    message: Type.String({ examples: ['La URL no es válida (¿falta https://?)'] }),
  },
  { $id: 'Error', title: 'Error' },
)

export const UserSchema = Type.Object(
  {
    id: Type.String({ examples: ['1'] }),
    email: Type.String({ format: 'email' }),
    createdAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'User', title: 'Usuario' },
)

export const CredentialsSchema = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254, examples: ['ana@ejemplo.com'] }),
  password: Type.String({ minLength: 8, maxLength: 128, examples: ['una-contraseña-segura'] }),
})

export const AuthResponseSchema = Type.Object({
  token: Type.String({ description: 'JWT para la cabecera Authorization: Bearer <token>. Caduca en 7 días.' }),
  user: Type.Ref('User'),
})

export const LinkSchema = Type.Object(
  {
    code: Type.String({ examples: ['aZ3kP9q'] }),
    shortUrl: Type.String({ format: 'uri', examples: ['http://localhost:3000/aZ3kP9q'] }),
    url: Type.String({ format: 'uri', examples: ['https://github.com/Jorgedngc'] }),
    isActive: Type.Boolean(),
    expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    clickCount: Type.Integer(),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'Link', title: 'Enlace' },
)

export const CodeParams = Type.Object({
  code: Type.String({ pattern: ALIAS_PATTERN.replace('{3,32}', '{1,32}'), description: 'Código o alias del enlace' }),
})

export const CreateLinkSchema = Type.Object({
  url: Type.String({ minLength: 1, maxLength: 2048, examples: ['https://github.com/Jorgedngc'] }),
  alias: Type.Optional(Type.String({ description: 'Alias personalizado (3-32 caracteres: letras, números, - y _)', examples: ['mi-github'] })),
  expiresAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
})

export const UpdateLinkSchema = Type.Object(
  {
    url: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    isActive: Type.Optional(Type.Boolean()),
    expiresAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
  },
  { additionalProperties: false },
)

export const PaginationQuery = Type.Object({
  page: Type.Integer({ minimum: 1, default: 1 }),
  limit: Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
})

const BucketSchema = Type.Object({ value: Type.String(), clicks: Type.Integer() })

export const StatsSchema = Type.Object(
  {
    periodDays: Type.Integer(),
    totalClicks: Type.Integer(),
    uniqueVisitors: Type.Integer({ description: 'Visitantes únicos por día, sumados en el periodo' }),
    botClicks: Type.Integer({ description: 'Clics de bots y previsualizaciones, excluidos del resto de cifras' }),
    clicksByDay: Type.Array(Type.Object({ date: Type.String({ examples: ['2026-10-31'] }), clicks: Type.Integer() })),
    countries: Type.Array(BucketSchema),
    devices: Type.Array(BucketSchema),
    browsers: Type.Array(BucketSchema),
    os: Type.Array(BucketSchema),
    referrers: Type.Array(BucketSchema),
  },
  { $id: 'Stats', title: 'Estadísticas' },
)
