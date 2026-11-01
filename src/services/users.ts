import type pg from 'pg'
import { ApiError, isUniqueViolation } from '../errors.js'
import { hashPassword, verifyPassword } from '../lib/password.js'

export interface User {
  id: string
  email: string
  createdAt: string
}

interface UserRow {
  id: string
  email: string
  password_hash: string
  created_at: Date
}

const toUser = (row: UserRow): User => ({ id: row.id, email: row.email, createdAt: row.created_at.toISOString() })

export class UserService {
  private readonly db: pg.Pool

  constructor(db: pg.Pool) {
    this.db = db
  }

  async register(email: string, password: string): Promise<User> {
    const hash = await hashPassword(password)
    try {
      const { rows } = await this.db.query<UserRow>(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *',
        [email.trim().toLowerCase(), hash],
      )
      return toUser(rows[0])
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError(409, 'Ya existe una cuenta con ese email')
      throw err
    }
  }

  async authenticate(email: string, password: string): Promise<User> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()])
    // Mismo mensaje para email inexistente y contraseña incorrecta, para no
    // revelar qué emails están registrados.
    if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) {
      throw new ApiError(401, 'Email o contraseña incorrectos')
    }
    return toUser(rows[0])
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id])
    return rows[0] ? toUser(rows[0]) : null
  }
}
