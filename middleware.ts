/**
 * @module middleware
 * @description Edge Middleware de Next.js para protección criptográfica de rutas API (`/api/viele/*`), bloqueo en borde
 * del laboratorio interno `/app` (`/app`, `/app/v1`, `/app/v2`) y bloqueo 404 en profundidad de directorios estáticos heredados (`/tacosgavilan-web/*`).
 *
 * @businessRules
 * - Bloquea con `HTTP 404` cualquier intento de acceso a `/tacosgavilan-web/api/*`, `/tacosgavilan-web/vercel.json`,
 *   `/tacosgavilan-web/wp-content/*` y `/tacosgavilan-web/wp-includes/*`.
 * - Protege `/api/viele/*` verificando criptográficamente la firma HS256 de `teg_token` (`verifyTegJwtEdge`) o `CRON_SECRET` en tiempo constante (impidiendo bypasses por tokens falsos o `"Bearer undefined"`).
 * - Redirige en el borde (`HTTP 307` -> `/login`) cualquier petición sin cookie/Bearer JWT HS256 válido hacia
 *   `/app`, `/app/v1` y `/app/v2` (laboratorio interno), manteniendo públicas `/ordenar` (hub público de pedidos),
 *   `/app/privacy`, `/app/terms`, `/app/support`, `/app/delete-account`, `/app/index.html` y `/clientes` (`HTTP 200`).
 *
 * @dataFlow
 * - `NextRequest` -> defensa 404 `/tacosgavilan-web/*` -> verificación criptográfica `/api/viele` -> rutas públicas -> verificación HS256 en `/app*` -> `x-require-auth`.
 *
 * @notes
 * - Hardened 2026-11-21: Verificación criptográfica completa en `/api/viele/*`, comparación segura de `CRON_SECRET` y bloqueo 404 de rutas heredadas `/tacosgavilan-web/*`.
 * - 2026-11-24: Separación de `/ordenar` como portal público oficial para clientes (sin login TEG) manteniendo `/app`, `/app/v1` y `/app/v2` protegidos como laboratorio interno.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const MAX_EXPIRED_GRACE_MS = 14 * 24 * 60 * 60 * 1000 // 14 días máx de gracia para tabletas

// Rutas públicas que NO requieren autenticación
const PUBLIC_ROUTES = [
  '/login',
  '/auth',
  '/ordenar',
  '/app/privacy',
  '/app/terms',
  '/app/support',
  '/app/delete-account',
  '/clientes',
  '/gavilan-pos',
  '/evaluacion/kiosk',
  '/feedback-publico',
  '/mantenimiento/registro',
  '/tv',
  '/t/',
  '/order-ready-board',
  '/tablet',
  '/admin/blindaje-delivery/empaque',
  '/training/portal'
]

function isBlockedLegacyWebAsset(pathname: string): boolean {
  return (
    pathname === '/tacosgavilan-web/vercel.json' ||
    pathname === '/tacosgavilan-web/api' ||
    pathname.startsWith('/tacosgavilan-web/api/') ||
    pathname === '/tacosgavilan-web/wp-content' ||
    pathname.startsWith('/tacosgavilan-web/wp-content/') ||
    pathname === '/tacosgavilan-web/wp-includes' ||
    pathname.startsWith('/tacosgavilan-web/wp-includes/')
  )
}

// Rutas del laboratorio interno de App Clientes que exigen sesión TEG válida incluso en Edge
function isProtectedCustomerAppLabRoute(pathname: string): boolean {
  return (
    pathname === '/app' ||
    pathname === '/app/' ||
    pathname === '/app/v1' ||
    pathname.startsWith('/app/v1/') ||
    pathname === '/app/v2' ||
    pathname.startsWith('/app/v2/')
  )
}

function constantTimeEqualEdge(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const encoder = new TextEncoder()
  const bytesA = encoder.encode(a)
  const bytesB = encoder.encode(b)
  if (bytesA.byteLength !== bytesB.byteLength || bytesA.byteLength === 0) {
    return false
  }
  let diff = 0
  for (let i = 0; i < bytesA.byteLength; i++) {
    diff |= bytesA[i] ^ bytesB[i]
  }
  return diff === 0
}

function base64UrlToUint8Array(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function verifyTegJwtEdge(token: string | undefined): Promise<boolean> {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return false

  const rawSecret = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET
  if (!rawSecret || !rawSecret.trim()) return false
  const secret = rawSecret.trim().replace(/^"(.*)"$/, '$1')

  try {
    const encoder = new TextEncoder()
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    const sigBytes = base64UrlToUint8Array(parts[2])
    const dataBytes = encoder.encode(`${parts[0]}.${parts[1]}`)
    const sigValid = await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      sigBytes as BufferSource,
      dataBytes as BufferSource
    )
    if (!sigValid) return false

    const payloadJson = new TextDecoder().decode(base64UrlToUint8Array(parts[1]))
    const payload = JSON.parse(payloadJson) as { sub?: unknown; email?: unknown; user_type?: unknown; exp?: unknown }
    if (!payload || !payload.sub || !payload.email) return false
    if (typeof payload.exp === 'number') {
      if (payload.user_type === 'employee' && payload.exp * 1000 <= Date.now()) {
        return false
      }
      if (Date.now() - payload.exp * 1000 > MAX_EXPIRED_GRACE_MS) {
        return false
      }
    } else if (payload.user_type === 'employee') {
      return false
    }
    return true
  } catch {
    return false
  }
}

// Rutas protegidas que SÍ requieren autenticación
const PROTECTED_ROUTES = [
  '/dashboard',
  '/checklists',
  '/inspecciones',
  '/tiendas',
  '/usuarios',
  '/reportes',
  '/estadisticas',
  '/configuracion',
  '/buscar',
  '/feedback',
  '/app'
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Defensa en profundidad: bloquear artefactos heredados de /tacosgavilan-web
  if (isBlockedLegacyWebAsset(pathname)) {
    return new NextResponse('Not Found', { status: 404 })
  }

  // Proteger endpoints de la API de Viele & Sons con verificación criptográfica HS256 o CRON_SECRET válido
  if (pathname.startsWith('/api/viele')) {
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
    const cronHeader = request.headers.get('x-cron-auth') || ''
    const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7).trim()
      : undefined
    const cookieToken = request.cookies.get('teg_token')?.value?.trim()

    const rawCronSecret = process.env.CRON_SECRET
    const cronSecret = rawCronSecret && rawCronSecret.trim().length > 0 ? rawCronSecret.trim() : null
    const isCron = Boolean(
      cronSecret &&
        (constantTimeEqualEdge(cronHeader, cronSecret) ||
          constantTimeEqualEdge(cronHeader, `Bearer ${cronSecret}`) ||
          constantTimeEqualEdge(authHeader, `Bearer ${cronSecret}`))
    )

    const hasValidSession =
      isCron ||
      (await verifyTegJwtEdge(bearerToken)) ||
      (await verifyTegJwtEdge(cookieToken))

    if (!hasValidSession) {
      return NextResponse.json(
        { success: false, error: 'No autorizado: Token de sesión válido requerido' },
        { status: 401 }
      )
    }
    return NextResponse.next()
  }

  // Verificar si es una ruta pública
  const isPublicRoute = PUBLIC_ROUTES.some(route => pathname.startsWith(route))

  if (isPublicRoute) {
    return NextResponse.next()
  }

  // Bloqueo estricto en Edge para el laboratorio de App Clientes (/app, /app/v1, /app/v2, /ordenar)
  if (isProtectedCustomerAppLabRoute(pathname)) {
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization')
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined
    const cookieToken = request.cookies.get('teg_token')?.value?.trim()
    const hasValidSession = (await verifyTegJwtEdge(cookieToken)) || (await verifyTegJwtEdge(bearerToken))

    if (!hasValidSession) {
      const loginUrl = new URL('/login', request.url)
      const targetPath = `${pathname}${request.nextUrl.search || ''}`
      if (targetPath.startsWith('/') && !targetPath.startsWith('//')) {
        loginUrl.searchParams.set('next', targetPath)
      }
      return NextResponse.redirect(loginUrl, 307)
    }

    const response = NextResponse.next()
    response.headers.set('x-require-auth', 'true')
    return response
  }

  // Verificar si es una ruta protegida
  const isProtectedRoute = PROTECTED_ROUTES.some(route => pathname.startsWith(route))

  if (isProtectedRoute) {
    const response = NextResponse.next()
    response.headers.set('x-require-auth', 'true')
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/api/viele/:path*',
    '/app',
    '/app/v1',
    '/app/v1/:path*',
    '/app/v2',
    '/app/v2/:path*',
    '/tacosgavilan-web/api/:path*',
    '/tacosgavilan-web/vercel.json',
    '/tacosgavilan-web/wp-content/:path*',
    '/tacosgavilan-web/wp-includes/:path*',
  ],
}
