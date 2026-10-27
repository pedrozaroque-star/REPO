/**
 * @module api/auth/refresh
 * @description Endpoint de renovación silenciosa de token JWT (`teg_token`) para tabletas de cocina (`/inventory/preparador`) y pantallas de comedor (`/order-ready-board`) que operan 24/7.
 *
 * @businessRules
 * - Verifica la firma criptográfica HMAC-SHA256 del token actual (`SUPABASE_JWT_SECRET`) incluso si su `exp` de 7 días acaba de vencer (`ignoreExpiration: true`).
 * - Consulta en vivo la tabla `users` en Supabase para confirmar que el usuario sigue existiendo y tiene `is_active === true`.
 * - Si el usuario está activo, emite un nuevo JWT válido por 30 días y renueva la cookie `teg_token`.
 *
 * @dataFlow
 * - Client (`purgeTabletStaleCaches` / `ProtectedRoute`) -> POST /api/auth/refresh -> Supabase `users` -> Nuevo `teg_token` (cookie + JSON).
 *
 * @notes
 * - Previene que las tabletas de línea de preparación o pantallas TV pierdan sincronización tras 7 días continuos de operación sin recargar.
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib/supabase'
import { getJwtSecret } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const secret = getJwtSecret()
    if (!secret) {
      return NextResponse.json({ error: 'Server authentication configuration error' }, { status: 500 })
    }

    let token: string | undefined

    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim()
    }

    if (!token) {
      try {
        const body = await request.json()
        if (body?.token && typeof body.token === 'string') {
          token = body.token.trim()
        }
      } catch {
        // Sin body JSON
      }
    }

    if (!token) {
      try {
        const cookieStore = await cookies()
        token = cookieStore.get('teg_token')?.value
      } catch {
        // Ignorar
      }
    }

    if (!token) {
      return NextResponse.json({ error: 'Token requerido' }, { status: 401 })
    }

    // Verificar firma criptográfica auténtica (permitiendo renovar tokens cuya ventana de 7 días venció en una tableta activa)
    let decoded: any
    try {
      decoded = jwt.verify(token, secret, { ignoreExpiration: true })
    } catch {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
    }

    if (!decoded || !decoded.sub) {
      return NextResponse.json({ error: 'Payload de token inválido' }, { status: 401 })
    }

    // Bloquear colisión de IDs entre toast_employees (user_type: 'employee') y public.users
    if (decoded.user_type === 'employee') {
      return NextResponse.json({ error: 'Sesión de empleado expirada, inicie sesión nuevamente' }, { status: 401 })
    }

    // Verificar en vivo en Supabase que el usuario exista, coincida en email y siga activo
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, role, store_scope, store_id, is_active')
      .eq('id', decoded.sub)
      .maybeSingle()

    if (
      error ||
      !user ||
      user.is_active === false ||
      (decoded.email && String(user.email || '').trim().toLowerCase() !== String(decoded.email).trim().toLowerCase())
    ) {
      return NextResponse.json({ error: 'Usuario inactivo o no encontrado' }, { status: 401 })
    }

    const newToken = jwt.sign(
      {
        sub: String(user.id),
        aud: 'authenticated',
        role: 'authenticated',
        email: user.email,
        user_role: user.role,
        user_type: 'admin',
        user_metadata: {
          full_name: user.full_name,
          role: user.role,
          store_scope: user.store_scope,
          store_id: user.store_id
        }
      },
      secret,
      {
        algorithm: 'HS256',
        expiresIn: '30d'
      }
    )

    const response = NextResponse.json({
      success: true,
      token: newToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: user.role,
        store_scope: user.store_scope,
        store_id: user.store_id,
        user_type: 'admin'
      }
    })

    response.cookies.set('teg_token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60
    })

    return response
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error renovando sesión' }, { status: 500 })
  }
}
