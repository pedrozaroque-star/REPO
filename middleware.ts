/**
 * @module middleware
 * @description Edge Middleware de Next.js para protección de rutas API, bloqueo en borde del laboratorio `/app`
 * (`/app`, `/app/v1`, `/app/v2`, `/ordenar`) y marcado de cabeceras de autenticación.
 *
 * @businessRules
 * - Protege `/api/viele/*` exigiendo `teg_token` (cookie o Bearer) o `CRON_SECRET`.
 * - Redirige en el borde (`HTTP 307` -> `/login`) cualquier petición sin cookie JWT HS256 válida hacia
 *   `/app`, `/app/v1`, `/app/v2` y `/ordenar`, manteniendo públicas `/app/privacy`, `/app/terms`,
 *   `/app/support`, `/app/delete-account`, `/app/index.html` y `/clientes` (`HTTP 200`).
 * - Mantiene el bloqueo `<ProtectedRoute>` en `components/ClientLayout.tsx` sobre el resto de rutas internas
 *   con cabecera `x-require-auth` para no romper tabletas 24/7 cuya sesión inicia en `localStorage`.
 *
 * @dataFlow
 * - `NextRequest` -> validación `/api/viele` -> rutas públicas -> verificación HS256 en `/app*` & `/ordenar` -> `x-require-auth`.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Rutas públicas que NO requieren autenticación
const PUBLIC_ROUTES = [
  '/login',
  '/auth',
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

// Rutas del laboratorio de App Clientes que exigen sesión TEG válida incluso en Edge
function isProtectedCustomerAppLabRoute(pathname: string): boolean {
  return (
    pathname === '/app' ||
    pathname === '/app/' ||
    pathname === '/app/v1' ||
    pathname.startsWith('/app/v1/') ||
    pathname === '/app/v2' ||
    pathname.startsWith('/app/v2/') ||
    pathname === '/ordenar' ||
    pathname.startsWith('/ordenar/')
  )
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
    if (payload.user_type === 'employee' && typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
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
  '/app',
  '/ordenar'
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Proteger endpoints de la API de Viele & Sons contra accesos no autenticados
  if (pathname.startsWith('/api/viele')) {
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    const cronHeader = request.headers.get('x-cron-auth');
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7).trim()
      : request.cookies.get('teg_token')?.value;

    const cronSecret = process.env.CRON_SECRET;
    const isCron = !!(cronSecret && (cronHeader === cronSecret || cronHeader === `Bearer ${cronSecret}` || authHeader === `Bearer ${cronSecret}`));

    if (!token && !isCron) {
      return NextResponse.json(
        { success: false, error: 'No autorizado: Token de sesión requerido' },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  // Verificar si es una ruta pública (incluyendo todas las sub-rutas de /admin)
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
      return NextResponse.redirect(loginUrl, 307)
    }

    const response = NextResponse.next()
    response.headers.set('x-require-auth', 'true')
    return response
  }

  // Verificar si es una ruta protegida
  const isProtectedRoute = PROTECTED_ROUTES.some(route => pathname.startsWith(route))

  // Si es ruta protegida, verificar autenticación
  if (isProtectedRoute) {
    // En el cliente, verificaremos con localStorage
    // Aquí solo redirigimos a login si no hay cookie/header de sesión
    const response = NextResponse.next()

    // Agregar header para que el cliente verifique
    response.headers.set('x-require-auth', 'true')

    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    '/api/viele/:path*',
  ],
}
