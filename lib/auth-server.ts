/**
 * @module lib/auth-server
 * @description Helper de servidor para autenticar peticiones en rutas de API de Next.js.
 *              Valida el JWT personalizado (teg_token) almacenado en las cookies.
 *
 * @businessRules
 * - **Compatibilidad**: Soporta el sistema de JWT personalizado de Tacos El Gavilan.
 * - **Seguridad**: Valida la firma del token usando la clave de firma de Supabase (SUPABASE_JWT_SECRET).
 * - **Transición**: Diseñado para funcionar de manera transparente junto al cliente de Supabase Auth.
 */

import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || 'your-secret-key-change-this-in-production'

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

    // Use raw string (NOT base64 decoded) — must match login route signing
    const secret = JWT_SECRET.trim().replace(/^"(.*)"$/, '$1')

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
    // Use raw string (NOT base64 decoded) — must match login route signing
    const secret = JWT_SECRET.trim().replace(/^"(.*)"$/, '$1')

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

