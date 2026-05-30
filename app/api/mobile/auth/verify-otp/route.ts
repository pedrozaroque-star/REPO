import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// =============================================================================
// Tipos de respuesta para tipado estricto
// =============================================================================
interface AppUserProfile {
  id: string
  phone: string
  first_name: string
  last_name: string
  email: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

interface RewardsBalance {
  points_balance: number
  points_accumulated: number
  points_redeemed: number
  tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM'
}

interface VerifySuccessResponse {
  ok: true
  token: string
  refreshToken: string
  userId: string
  user: AppUserProfile
  rewards: RewardsBalance
}

interface VerifyErrorResponse {
  ok: false
  error: string
}

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
// POST /api/mobile/auth/verify-otp
// Verifica el código OTP recibido por SMS y devuelve sesión + perfil.
//
// Body esperado: { phone: string, code: string }
// phone: 10 dígitos sin código de país
// code: 6 dígitos del OTP
//
// Respuesta éxito: VerifySuccessResponse
// Respuesta error: VerifyErrorResponse
// =============================================================================
export async function POST(request: Request) {
  try {
    // -------------------------------------------------------------------------
    // 1. Parsear y validar el body
    // -------------------------------------------------------------------------
    const body = await request.json() as { phone?: string; code?: string }
    const phone = body.phone?.trim()
    const code = body.code?.trim()

    if (!phone || !code) {
      return NextResponse.json<VerifyErrorResponse>(
        { ok: false, error: 'Teléfono y código son requeridos.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    // Validar formato del teléfono (10 dígitos)
    const phoneRegex = /^\d{10}$/
    if (!phoneRegex.test(phone)) {
      return NextResponse.json<VerifyErrorResponse>(
        { ok: false, error: 'El teléfono debe tener exactamente 10 dígitos numéricos.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    // Validar formato del código OTP (6 dígitos)
    const codeRegex = /^\d{6}$/
    if (!codeRegex.test(code)) {
      return NextResponse.json<VerifyErrorResponse>(
        { ok: false, error: 'El código debe tener 6 dígitos.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    // Formato E.164 para USA (+1XXXXXXXXXX)
    const phoneE164 = `+1${phone}`

    // -------------------------------------------------------------------------
    // 2. Verificar OTP contra Supabase Auth
    // -------------------------------------------------------------------------
    const { data: verifyData, error: verifyError } = await supabaseAdmin.auth.verifyOtp({
      phone: phoneE164,
      token: code,
      type: 'sms',
    })

    if (verifyError) {
      console.error('[MOBILE AUTH] Error al verificar OTP:', verifyError.message)

      // Códigos expirados o inválidos
      if (
        verifyError.message.includes('expired') ||
        verifyError.message.includes('invalid') ||
        verifyError.message.includes('Token')
      ) {
        return NextResponse.json<VerifyErrorResponse>(
          { ok: false, error: 'Código inválido o expirado. Solicita uno nuevo.' },
          { status: 401, headers: CORS_HEADERS }
        )
      }

      return NextResponse.json<VerifyErrorResponse>(
        { ok: false, error: 'Error al verificar el código. Intenta de nuevo.' },
        { status: 500, headers: CORS_HEADERS }
      )
    }

    // Validar que tenemos sesión y usuario de la respuesta
    if (!verifyData.session || !verifyData.user) {
      console.error('[MOBILE AUTH] Verificación exitosa pero sin sesión/usuario')
      return NextResponse.json<VerifyErrorResponse>(
        { ok: false, error: 'Error al crear sesión. Intenta de nuevo.' },
        { status: 500, headers: CORS_HEADERS }
      )
    }

    const authUserId = verifyData.user.id
    const accessToken = verifyData.session.access_token
    const refreshToken = verifyData.session.refresh_token

    // -------------------------------------------------------------------------
    // 3. Obtener o crear perfil en app_users
    // -------------------------------------------------------------------------
    let userProfile: AppUserProfile | null = null

    // Primero intentar buscar por phone (match más confiable)
    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('app_users')
      .select('*')
      .eq('phone', phone)
      .maybeSingle()

    if (fetchError) {
      console.error('[MOBILE AUTH] Error al buscar perfil:', fetchError.message)
    }

    if (existingUser) {
      userProfile = existingUser as AppUserProfile

      // Actualizar el id si no coincide (caso edge: usuario re-registrado)
      if (userProfile.id !== authUserId) {
        const { error: updateIdError } = await supabaseAdmin
          .from('app_users')
          .update({ id: authUserId, updated_at: new Date().toISOString() })
          .eq('phone', phone)

        if (updateIdError) {
          console.error('[MOBILE AUTH] Error al actualizar id de usuario:', updateIdError.message)
        } else {
          userProfile.id = authUserId
        }
      }
    } else {
      // No existe — crear perfil nuevo vinculado al auth user
      const newUser = {
        id: authUserId,
        phone: phone,
        first_name: '',
        last_name: '',
        email: null,
        avatar_url: null,
      }

      const { data: createdUser, error: createError } = await supabaseAdmin
        .from('app_users')
        .upsert(newUser, { onConflict: 'id' })
        .select('*')
        .single()

      if (createError) {
        console.error('[MOBILE AUTH] Error al crear perfil de usuario:', createError.message)

        // Incluso si falla la creación del perfil, devolvemos la sesión
        // El usuario podrá completar su perfil después
        userProfile = {
          id: authUserId,
          phone: phone,
          first_name: '',
          last_name: '',
          email: null,
          avatar_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      } else {
        userProfile = createdUser as AppUserProfile
      }
    }

    // -------------------------------------------------------------------------
    // 4. Obtener o crear balance de recompensas
    // -------------------------------------------------------------------------
    let rewards: RewardsBalance

    const { data: existingRewards, error: rewardsError } = await supabaseAdmin
      .from('app_rewards_balances')
      .select('points_balance, points_accumulated, points_redeemed, tier')
      .eq('user_id', authUserId)
      .maybeSingle()

    if (rewardsError) {
      console.error('[MOBILE AUTH] Error al buscar rewards:', rewardsError.message)
    }

    if (existingRewards) {
      rewards = existingRewards as RewardsBalance
    } else {
      // Crear registro de rewards con valores por defecto (tier BRONZE, 0 puntos)
      const defaultRewards: RewardsBalance = {
        points_balance: 0,
        points_accumulated: 0,
        points_redeemed: 0,
        tier: 'BRONZE',
      }

      const { error: createRewardsError } = await supabaseAdmin
        .from('app_rewards_balances')
        .upsert(
          {
            user_id: authUserId,
            ...defaultRewards,
          },
          { onConflict: 'user_id' }
        )

      if (createRewardsError) {
        console.error('[MOBILE AUTH] Error al crear rewards balance:', createRewardsError.message)
      }

      rewards = defaultRewards
    }

    // -------------------------------------------------------------------------
    // 5. Respuesta exitosa con sesión completa
    // -------------------------------------------------------------------------
    return NextResponse.json<VerifySuccessResponse>(
      {
        ok: true,
        token: accessToken,
        refreshToken: refreshToken,
        userId: authUserId,
        user: userProfile,
        rewards: rewards,
      },
      { status: 200, headers: CORS_HEADERS }
    )

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[MOBILE AUTH] Error inesperado en verify-otp:', errorMessage)

    return NextResponse.json<VerifyErrorResponse>(
      { ok: false, error: 'Error interno del servidor. Intenta de nuevo.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}
