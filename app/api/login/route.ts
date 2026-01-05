import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || 'your-secret-key-change-this-in-production'



export async function POST(request: Request) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email y contraseña son requeridos' },
        { status: 400 }
      )
    }

    // Buscar usuario en la base de datos
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    )

    const users = await response.json()

    if (!users || users.length === 0) {
      return NextResponse.json(
        { error: 'Credenciales incorrectas' },
        { status: 401 }
      )
    }

    const user = users[0]

    // Verificar que el usuario esté activo
    if (!user.is_active) {
      return NextResponse.json(
        { error: 'Usuario inactivo. Contacta al administrador.' },
        { status: 403 }
      )
    }

    // Validar contraseña
    // Como tus contraseñas están en texto plano, comparar directamente
    // En producción esto debería usar bcrypt
    if (user.password !== password) {
      return NextResponse.json(
        { error: 'Credenciales incorrectas' },
        { status: 401 }
      )
    }

    // Generar JWT token compatible con Supabase Auth
    // Los secretos de Supabase que miden 88 caracteres son Base64 (HS256 64 bytes)
    const rawSecret = JWT_SECRET.trim().replace(/^"(.*)"$/, '$1')
    const secret = rawSecret.length === 88 || rawSecret.includes('+') || rawSecret.includes('/')
      ? Buffer.from(rawSecret, 'base64')
      : rawSecret

    const token = jwt.sign(
      {
        sub: String(user.id),    // Asegurar que sea string (estándar Supabase)
        aud: 'authenticated',    // Audience
        role: 'authenticated',   // Postgres Role
        email: user.email,
        user_role: user.role,
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
        expiresIn: '7d'
      }
    )

    // Actualizar last_login
    await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${user.id}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ last_login: new Date().toISOString() })
      }
    )

    // Retornar datos del usuario y token
    // Retornar datos del usuario y token
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: user.role,
        store_scope: user.store_scope,  // ✅ AGREGADO
        store_id: user.store_id         // ✅ AGREGADO
      },
      token
    })

  } catch (error) {
    console.error('Error en login:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}