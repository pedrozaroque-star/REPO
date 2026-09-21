/**
 * @module lib/auth-server
 * @description Helper de servidor para autenticar peticiones en rutas de API de Next.js.
 *              Valida el JWT personalizado (teg_token) almacenado en las cookies o headers.
 *
 * @businessRules
 * - **Compatibilidad**: Soporta el sistema de JWT personalizado de Tacos Gavilan.
 * - **Seguridad**: Valida la firma del token usando la clave de firma de Supabase (SUPABASE_JWT_SECRET) sin fallbacks inseguros.
 * - **Transición**: Diseñado para funcionar de manera transparente junto al cliente de Supabase Auth.
 *
 * @dataFlow
 * - Request (Cookie 'teg_token' o Header 'Authorization') -> verifyAdminAuth() / getServerUser() -> jwt.verify() -> AuthSession / User.
 *
 * @notes
 * - Fail-closed: si no hay secreto JWT configurado en el entorno, rechaza peticiones con error 500 para evitar bypasses.
 */

import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'

export function getJwtSecret(): string | null {
  const secret = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET
  if (!secret || !secret.trim()) {
    return null
  }
  return secret.trim().replace(/^"(.*)"$/, '$1')
}

export function getCronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || !secret.trim()) {
    return null
  }
  return secret.trim()
}

interface ServerUser {
  id: string
  email: string
  name: string
  role: string
}

/**
 * Obtiene el usuario autenticado del lado del servidor leyendo la cookie 'teg_token'.
 *
 * @returns ServerUser si el token es válido, null de lo contrario.
 */
export async function getServerUser(): Promise<ServerUser | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('teg_token')?.value

    if (!token) {
      return null
    }

    const secret = getJwtSecret()
    if (!secret) {
      console.error('❌ [getServerUser] Fail-closed: JWT secret no configurado en variables de entorno')
      return null
    }

    const decoded = jwt.verify(token, secret) as any
    if (!decoded || !decoded.sub || !decoded.email) {
      return null
    }

    return {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.user_metadata?.full_name || decoded.email,
      role: decoded.user_role || 'user'
    }
  } catch (err: any) {
    console.error('❌ [getServerUser] Verification failed:', err.message)
    return null
  }
}

export interface DecodedToken {
  id: string
  sub: string
  email: string
  user_role: string
  user_type?: string
  user_metadata?: {
    full_name?: string
    role?: string
    store_scope?: any
    store_id?: any
    store_ids?: any
    toast_guid?: string
  }
}

/**
 * Verifica un token JWT de autenticación de forma sincrónica.
 * 
 * @param token El token JWT a verificar.
 * @returns El token decodificado o null si es inválido.
 */
export function verifyAuthToken(token: string): DecodedToken | null {
  try {
    if (!token || typeof token !== 'string') {
      return null
    }

    const secret = getJwtSecret()
    if (!secret) {
      console.error('❌ [verifyAuthToken] Fail-closed: JWT secret no configurado en variables de entorno')
      return null
    }

    const decoded = jwt.verify(token, secret) as any
    if (!decoded || !decoded.sub || !decoded.email) {
      return null
    }
    // Map sub (which contains the user/employee ID) to id for backward compatibility
    decoded.id = decoded.sub
    return decoded as DecodedToken
  } catch (err: any) {
    console.error('❌ [verifyAuthToken] Verification failed:', err.message)
    return null
  }
}

export interface AdminAuthResult {
  authorized: boolean
  user?: DecodedToken
  error?: string
  status?: number
}

/**
 * Valida que una petición HTTP a endpoints administrativos cuente con token JWT válido con rol 'admin',
 * o provenga de un invocador de cron autorizado con CRON_SECRET.
 *
 * Fail-Closed:
 * - Si falta JWT_SECRET en el entorno, rechaza con status 401 sin fallback.
 * - Si falta CRON_SECRET, cualquier intento de cron es rechazado de inmediato.
 * - Si no hay token de autenticación: 401.
 * - Si el usuario no tiene rol 'admin': 403.
 */
export function verifyAdminAuth(request: Request, options?: { allowCron?: boolean }): AdminAuthResult {
  const allowCron = options?.allowCron ?? true
  const cronSecret = getCronSecret()

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization')
  const cookieHeader = request.headers.get('cookie') || ''
  const cronHeader = request.headers.get('x-cron-auth') || authHeader

  // 1. Invocación de cron: SOLO si está permitida Y el secreto está explícitamente configurado
  if (allowCron && cronSecret) {
    const isCronAuthorized = cronHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret
    if (isCronAuthorized) {
      return { authorized: true }
    }
  }

  // 2. Extracción de token de usuario
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7).trim()
    : (cookieHeader.match(/teg_token=([^;]+)/)?.[1]?.trim() || null)

  if (!token) {
    return {
      authorized: false,
      error: 'No autorizado: Token de autenticación no proporcionado',
      status: 401
    }
  }

  // 3. Fallo cerrado si falta secreto de firma JWT
  const jwtSecret = getJwtSecret()
  if (!jwtSecret) {
    console.error('❌ [verifyAdminAuth] Fail-closed: JWT_SECRET / SUPABASE_JWT_SECRET no configurado')
    return {
      authorized: false,
      error: 'No autorizado: Configuración de seguridad del servidor no disponible',
      status: 401
    }
  }

  // 4. Validación de firma y contenido de token
  const user = verifyAuthToken(token)
  if (!user) {
    return {
      authorized: false,
      error: 'No autorizado: Token inválido o expirado',
      status: 401
    }
  }

  // 5. Exigir rol 'admin' obligatorio
  const userRole = (user.user_role || (user as any).role || user.user_metadata?.role || '').toLowerCase()
  if (userRole !== 'admin') {
    return {
      authorized: false,
      error: 'Acceso denegado: Se requiere rol de administrador',
      status: 403
    }
  }

  return { authorized: true, user }
}
