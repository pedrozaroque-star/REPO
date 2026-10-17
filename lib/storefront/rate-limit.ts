/**
 * @module lib/storefront/rate-limit
 * @description Limitador de frecuencia en memoria (ventana deslizante) para endpoints públicos/móviles
 * que consumen credenciales de DoorDash o geocodificadores de terceros.
 *
 * @businessRules
 * - Clave sugerida: `${ruta}:${userId || ip}`. Rechaza con `retryAfterSeconds` cuando se excede el límite.
 *
 * @dataFlow
 * - Route handler → `checkRateLimit(key, limit, windowMs)` → permitido / rechazado.
 *
 * @notes
 * - En Vercel (serverless) cada instancia tiene su propia memoria: es una defensa de mejor esfuerzo contra
 *   ráfagas y dobles toques, NO un límite global. Para un límite global usar un almacén compartido (Redis/DB).
 */

interface Bucket {
  hits: number[]
}

const buckets = new Map<string, Bucket>()
let lastSweep = 0

function sweep(now: number, windowMs: number): void {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, b] of buckets) {
    b.hits = b.hits.filter((t) => now - t < windowMs)
    if (b.hits.length === 0) buckets.delete(key)
  }
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  sweep(now, windowMs)
  const bucket = buckets.get(key) || { hits: [] }
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs)
  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0]
    buckets.set(key, bucket)
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    }
  }
  bucket.hits.push(now)
  buckets.set(key, bucket)
  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterSeconds: 0 }
}

/** Obtiene la IP del cliente desde cabeceras de proxy (Vercel) sin confiar en ella para autorización. */
export function getClientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for') || ''
  const first = fwd.split(',')[0]?.trim()
  return first || headers.get('x-real-ip') || 'unknown'
}

/** Solo para pruebas automatizadas. */
export function __resetRateLimitsForTests(): void {
  buckets.clear()
  lastSweep = 0
}
