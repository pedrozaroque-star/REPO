import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// ============================================================================
// Tipos compartidos para la API móvil
// ============================================================================

/** Resultado de autenticación exitoso */
interface AuthSuccess {
  userId: string
  email: string
}

/** Resultado de autenticación fallido */
interface AuthFailure {
  error: string
}

/** Tipo de retorno de getAuthUser */
type AuthResult = AuthSuccess | AuthFailure

// ============================================================================
// CORS Headers — Permitir acceso desde la app móvil (Expo)
// ============================================================================

/**
 * Genera los headers CORS necesarios para respuestas de la API móvil.
 * Expo/React Native usa fetch nativo, pero incluimos CORS para
 * compatibilidad con web y herramientas de prueba.
 */
export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400', // Caché de preflight por 24 horas
  }
}

/**
 * Respuesta para solicitudes OPTIONS (preflight CORS).
 * Todos los endpoints móviles deben exportar un handler OPTIONS que llame a esta función.
 */
export function corsResponse(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  })
}

// ============================================================================
// Autenticación — Verificar Bearer token con Supabase Auth
// ============================================================================

/**
 * Extrae y verifica el Bearer token del header Authorization.
 * Usa supabaseAdmin.auth.getUser() para validar el JWT de Supabase Auth.
 *
 * @returns AuthSuccess con userId y email si es válido, AuthFailure con mensaje de error si no.
 */
export async function getAuthUser(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get('Authorization')

  if (!authHeader) {
    return { error: 'Token de autorización no proporcionado' }
  }

  // Formato esperado: "Bearer <token>"
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return { error: 'Formato de autorización inválido. Use: Bearer <token>' }
  }

  const token = parts[1]

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token)

    if (error || !data.user) {
      return { error: 'Token inválido o expirado' }
    }

    return {
      userId: data.user.id,
      email: data.user.email ?? '',
    }
  } catch {
    return { error: 'Error al verificar el token de autenticación' }
  }
}

// ============================================================================
// Helpers de respuesta — Wrappers para respuestas JSON con CORS
// ============================================================================

/**
 * Crea una respuesta JSON exitosa con headers CORS incluidos.
 */
export function jsonOk<T extends Record<string, unknown>>(data: T, status = 200): NextResponse {
  return NextResponse.json(
    { ok: true, ...data },
    { status, headers: corsHeaders() }
  )
}

/**
 * Crea una respuesta JSON de error con headers CORS incluidos.
 */
export function jsonError(message: string, status = 400): NextResponse {
  return NextResponse.json(
    { ok: false, error: message },
    { status, headers: corsHeaders() }
  )
}

/**
 * Type guard para verificar si el resultado de autenticación es exitoso.
 */
export function isAuthSuccess(result: AuthResult): result is AuthSuccess {
  return 'userId' in result
}
