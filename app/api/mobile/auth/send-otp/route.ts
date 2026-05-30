import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// =============================================================================
// HEADERS CORS para la app móvil (React Native / Expo)
// =============================================================================
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// =============================================================================
// Preflight OPTIONS — responde a la solicitud previa del navegador/cliente
// =============================================================================
export async function OPTIONS() {
  return NextResponse.json(null, { status: 204, headers: CORS_HEADERS })
}

// =============================================================================
// POST /api/mobile/auth/send-otp
// Envía un código OTP por SMS al número de teléfono proporcionado.
//
// Body esperado: { phone: string } — 10 dígitos sin código de país
// Respuesta éxito: { ok: true, message: 'Código enviado' }
// Respuesta error: { ok: false, error: '...' }
// =============================================================================
export async function POST(request: Request) {
  try {
    // -------------------------------------------------------------------------
    // 1. Parsear y validar el body
    // -------------------------------------------------------------------------
    const body = await request.json() as { phone?: string }
    const phone = body.phone?.trim()

    if (!phone) {
      return NextResponse.json(
        { ok: false, error: 'El número de teléfono es requerido.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    // Validar que sea exactamente 10 dígitos numéricos
    const phoneRegex = /^\d{10}$/
    if (!phoneRegex.test(phone)) {
      return NextResponse.json(
        { ok: false, error: 'El teléfono debe tener exactamente 10 dígitos numéricos.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    // Formato E.164 para USA (+1XXXXXXXXXX)
    const phoneE164 = `+1${phone}`

    // -------------------------------------------------------------------------
    // 2. Disparar OTP vía Supabase Auth (SMS nativo de Supabase)
    // -------------------------------------------------------------------------
    // Supabase Auth maneja la creación del usuario en auth.users si no existe,
    // genera el código OTP, y lo envía por SMS a través del proveedor configurado
    // (Twilio, MessageBird, Vonage, etc.) en el dashboard de Supabase.
    const { error: otpError } = await supabaseAdmin.auth.signInWithOtp({
      phone: phoneE164,
    })

    if (otpError) {
      console.error('[MOBILE AUTH] Error al enviar OTP:', otpError.message)

      // Errores comunes: rate limit, proveedor SMS no configurado, etc.
      if (otpError.message.includes('rate') || otpError.message.includes('limit')) {
        return NextResponse.json(
          { ok: false, error: 'Demasiados intentos. Espera un momento antes de intentar de nuevo.' },
          { status: 429, headers: CORS_HEADERS }
        )
      }

      return NextResponse.json(
        { ok: false, error: 'No se pudo enviar el código. Intenta de nuevo más tarde.' },
        { status: 500, headers: CORS_HEADERS }
      )
    }

    // -------------------------------------------------------------------------
    // 3. Asegurar que existe un registro placeholder en app_users
    // -------------------------------------------------------------------------
    // Supabase Auth ya creó (o reutilizó) un usuario en auth.users.
    // Buscamos si ya tiene perfil en app_users; si no, creamos uno placeholder.
    const { data: existingProfile } = await supabaseAdmin
      .from('app_users')
      .select('id')
      .eq('phone', phone)
      .maybeSingle()

    // Si no existe perfil, intentamos crear uno buscando el auth user
    if (!existingProfile) {
      // Buscar en auth.users por el teléfono E.164
      // listUsers no tiene filtro nativo por phone, filtramos manualmente
      const { data: allUsersPage } = await supabaseAdmin.auth.admin.listUsers({
        perPage: 50,
        page: 1,
      })

      const authUser = allUsersPage?.users?.find(
        (u) => u.phone === phoneE164
      )

      if (authUser) {
        // Crear registro placeholder en app_users
        // El usuario completará su perfil después del primer login
        const { error: insertError } = await supabaseAdmin
          .from('app_users')
          .upsert(
            {
              id: authUser.id,
              phone: phone,
              first_name: '',
              last_name: '',
            },
            { onConflict: 'id' }
          )

        if (insertError) {
          // No es un error fatal — el usuario aún puede verificar el OTP
          // El perfil se creará en verify-otp como fallback
          console.error('[MOBILE AUTH] Error al crear perfil placeholder:', insertError.message)
        }
      }
    }

    // -------------------------------------------------------------------------
    // 4. Respuesta exitosa
    // -------------------------------------------------------------------------
    return NextResponse.json(
      { ok: true, message: 'Código enviado' },
      { status: 200, headers: CORS_HEADERS }
    )

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[MOBILE AUTH] Error inesperado en send-otp:', errorMessage)

    return NextResponse.json(
      { ok: false, error: 'Error interno del servidor. Intenta de nuevo.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}
