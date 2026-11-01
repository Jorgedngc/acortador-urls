export interface ParsedUserAgent {
  device: 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown'
  browser: string
  os: string
}

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegrambot|preview|curl|wget|python-requests|httpclient|headless/i

/**
 * Parser deliberadamente pequeño: solo necesitamos categorías amplias para
 * las estadísticas, no la versión exacta de cada navegador. El orden de las
 * comprobaciones importa: Edge y Opera incluyen "Chrome" en su user agent, y
 * Chrome incluye "Safari".
 */
export function parseUserAgent(ua: string | undefined): ParsedUserAgent {
  if (!ua) return { device: 'unknown', browser: 'Desconocido', os: 'Desconocido' }

  return {
    device: BOT.test(ua) ? 'bot' : detectDevice(ua),
    browser: detectBrowser(ua),
    os: detectOs(ua),
  }
}

function detectDevice(ua: string): ParsedUserAgent['device'] {
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet'
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return 'mobile'
  if (/Windows|Macintosh|X11|Linux|CrOS/i.test(ua)) return 'desktop'
  return 'unknown'
}

function detectBrowser(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge'
  if (/OPR\/|Opera/.test(ua)) return 'Opera'
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet'
  if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox'
  if (/Chrome\/|CriOS/.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'Otro'
}

function detectOs(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Otro'
}
