/**
 * Migraciones en orden. Están en TypeScript (y no en .sql sueltos) para que
 * viajen dentro del build sin pasos extra de copia.
 */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '001_init',
    sql: `
      CREATE TABLE users (
        id            BIGSERIAL PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE links (
        id          BIGSERIAL PRIMARY KEY,
        code        TEXT NOT NULL UNIQUE,
        url         TEXT NOT NULL,
        user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_active   BOOLEAN NOT NULL DEFAULT true,
        expires_at  TIMESTAMPTZ,
        click_count BIGINT NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX links_user_created_idx ON links (user_id, created_at DESC);

      -- No se guarda la IP: solo un hash diario para contar visitantes únicos.
      CREATE TABLE clicks (
        id            BIGSERIAL PRIMARY KEY,
        link_id       BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
        clicked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        visitor_hash  TEXT NOT NULL,
        country       CHAR(2),
        device        TEXT NOT NULL,
        browser       TEXT NOT NULL,
        os            TEXT NOT NULL,
        referrer_host TEXT
      );
      CREATE INDEX clicks_link_time_idx ON clicks (link_id, clicked_at);
    `,
  },
]
