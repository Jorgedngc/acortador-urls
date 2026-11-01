import type pg from 'pg'

export interface Bucket {
  value: string
  clicks: number
}

export interface LinkStats {
  periodDays: number
  totalClicks: number
  /** Visitantes únicos por día, sumados en el periodo. */
  uniqueVisitors: number
  botClicks: number
  clicksByDay: { date: string; clicks: number }[]
  countries: Bucket[]
  devices: Bucket[]
  browsers: Bucket[]
  os: Bucket[]
  referrers: Bucket[]
}

// Lista cerrada de columnas: el nombre se interpola en el SQL, así que nunca
// puede venir de la petición.
const BREAKDOWNS = {
  countries: 'country',
  devices: 'device',
  browsers: 'browser',
  os: 'os',
  referrers: 'referrer_host',
} as const

export class StatsService {
  private readonly db: pg.Pool

  constructor(db: pg.Pool) {
    this.db = db
  }

  async forLink(linkId: string, days: number): Promise<LinkStats> {
    // Los bots (previsualizaciones de WhatsApp, buscadores...) no cuentan como
    // visitas reales, pero se informa de cuántos hubo.
    const scope = `link_id = $1 AND clicked_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - make_interval(days => $2 - 1)`

    const [totals, byDay, ...breakdowns] = await Promise.all([
      this.db.query<{ total: string; unique_visitors: string; bots: string }>(
        `SELECT count(*) FILTER (WHERE device <> 'bot') AS total,
                count(DISTINCT visitor_hash) FILTER (WHERE device <> 'bot') AS unique_visitors,
                count(*) FILTER (WHERE device = 'bot') AS bots
         FROM clicks WHERE ${scope}`,
        [linkId, days],
      ),
      // generate_series rellena con 0 los días sin clics, para que la gráfica no tenga huecos.
      this.db.query<{ date: string; clicks: string }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS date, count(c.id) AS clicks
         FROM generate_series(
                date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => $2 - 1),
                date_trunc('day', now() AT TIME ZONE 'UTC'),
                interval '1 day'
              ) AS d
         LEFT JOIN clicks c
           ON c.link_id = $1 AND c.device <> 'bot'
          AND date_trunc('day', c.clicked_at AT TIME ZONE 'UTC') = d
         GROUP BY d ORDER BY d`,
        [linkId, days],
      ),
      ...Object.values(BREAKDOWNS).map((column) =>
        this.db.query<{ value: string; clicks: string }>(
          `SELECT COALESCE(${column}, 'desconocido') AS value, count(*) AS clicks
           FROM clicks WHERE ${scope} AND device <> 'bot'
           GROUP BY 1 ORDER BY clicks DESC, value LIMIT 10`,
          [linkId, days],
        ),
      ),
    ])

    const buckets = (result: pg.QueryResult<{ value: string; clicks: string }>): Bucket[] =>
      result.rows.map((r) => ({ value: r.value.trim(), clicks: Number(r.clicks) }))
    const [countries, devices, browsers, os, referrers] = breakdowns.map(buckets)

    return {
      periodDays: days,
      totalClicks: Number(totals.rows[0].total),
      uniqueVisitors: Number(totals.rows[0].unique_visitors),
      botClicks: Number(totals.rows[0].bots),
      clicksByDay: byDay.rows.map((r) => ({ date: r.date, clicks: Number(r.clicks) })),
      countries,
      devices,
      browsers,
      os,
      referrers,
    }
  }
}
