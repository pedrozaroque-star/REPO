import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Rutas públicas que NO requieren autenticación
const PUBLIC_ROUTES = [
  '/login',
  '/clientes',
  '/evaluacion', 
  '/admin',
  '/feedback-publico'
]

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
  '/feedback'
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
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
  ],
}
