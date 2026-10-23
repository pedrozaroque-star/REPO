/**
 * @module app/api/mobile/auth/verify-otp/route
 * @description Endpoint de verificación de código OTP SMS (6 dígitos) y emisión de sesión autenticada para Tacos Gavilan App.
 *
 * @businessRules
 * - Exige teléfono de 10 dígitos y código OTP de 6 dígitos numéricos.
 * - Soporta números oficiales de prueba NANPA/FCC (`^\d{3}55501\d{2}$` con código `123456`) para revisiones de Apple App Store Review y Google Play Review, emitiendo una sesión real de Supabase Auth (`auth.users`).
 * - Verifica el token contra Supabase Auth (`supabaseAdmin.auth.verifyOtp`).
 * - Sincroniza el perfil del comensal en `public.app_users` usando el `auth.users.id` autoritativo.
 *
 * @dataFlow
 * - App Móvil POST `/api/mobile/auth/verify-otp` -> `supabaseAdmin.auth` -> `public.app_users` -> Retorna `session` (`access_token`, `refresh_token`, `expires_at`), `token` y perfil.
 *
 * @notes
 * - Incluye tanto el objeto `session: { access_token, refresh_token, expires_at }` esperado por `AuthContext.tsx` como `token`/`userId` en la raíz para `/app/delete-account`.
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { corsHeaders, corsResponse } from '@/app/api/mobile/_helpers'

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

interface VerifySessionPayload {
  access_token: string
  refresh_token: string
  expires_at?: number
}

interface VerifySuccessResponse {
  ok: true
  token: string
  refreshToken: string
  userId: string
  session: VerifySessionPayload
  user: AppUserProfile
  rewards: RewardsBalance
}

interface VerifyErrorResponse {
  ok: false
  error: string
}

const APP_REVIEW_TEST_PHONE_REGEX = /^\d{3}55501\d{2}$/
const APP_REVIEW_TEST_CODE = '123456'

function normalizeUsPhone10(raw?: string): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1)
  }
  return digits
}

function buildReviewerCredentials(phone10: string): { email: string; password: string } {
  const email = `app.reviewer.${phone10}@tacosgavilan.test`
  const secretSeed = process.env.SUPABASE_SERVICE_ROLE_KEY || 'tacos-gavilan-app-review'
  const hash = crypto.createHmac('sha256', secretSeed).update(`reviewer:${phone10}`).digest('hex')
  const password = `TG!${hash.slice(0, 24)}#9a`
  return { email, password }
}

// =============================================================================
// Preflight OPTIONS — responde a la solicitud previa del navegador/cliente
// =============================================================================
export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}

// =============================================================================
// POST /api/mobile/auth/verify-otp
// =============================================================================
export async function POST(request: Request): Promise<NextResponse> {
  const headers = corsHeaders()
  try {
    // -------------------------------------------------------------------------
    // 1. Parsear y validar el body
    // -------------------------------------------------------------------------
    const body = (await request.json()) as { phone?: string; code?: string }
    const phone = normalizeUsPhone10(body.phone)
    const code = body.code?.trim()

    if (!phone || !code) {
      return NextResponse.json<VerifyErrorResponse>(
        { ok: false, error: 'Teléfono y código son requeridos.' },
        { status: 400, headers }
      )
    }

    const phoneRegex = /^\d{10}$/
    if (!phoneRegex.test(phone)) {
      return NextResponse.json<VerifyErrorResponse>(
        { ok: false, error: 'El teléfono debe tener exactamente 10 dígitos numéricos.' },
        { status: 400, headers }
      )
    }

    const codeRegex = /^\d{6}$/
    if (!codeRegex.test(code)) {
      return NextResponse.json<VerifyErrorResponse>(
        { ok: false, error: 'El código debe tener 6 dígitos.' },
        { status: 400, headers }
      )
    }

    let authUserId = ''
    let accessToken = ''
    let refreshToken = ''
    let expiresAt: number | undefined

    // -------------------------------------------------------------------------
    // 2. Verificar OTP (Cuenta de Revisión App Store/Play Store vs Supabase SMS)
    // -------------------------------------------------------------------------
    if (APP_REVIEW_TEST_PHONE_REGEX.test(phone)) {
      if (code !== APP_REVIEW_TEST_CODE) {
        return NextResponse.json<VerifyErrorResponse>(
          { ok: false, error: 'Código inválido o expirado. Solicita uno nuevo.' },
          { status: 401, headers }
        )
      }

      const { email, password } = buildReviewerCredentials(phone)
      let signInRes = await supabaseAdmin.auth.signInWithPassword({ email, password })

      if (signInRes.error || !signInRes.data.session || !signInRes.data.user) {
        const { error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { phone, is_app_reviewer: true },
        })

        if (createAuthErr && !createAuthErr.message.toLowerCase().includes('already')) {
          console.error('[MOBILE AUTH] Error creando usuario reviewer:', createAuthErr.message)
          return NextResponse.json<VerifyErrorResponse>(
            { ok: false, error: 'Error al crear sesión de revisión. Intenta de nuevo.' },
            { status: 500, headers }
          )
        }

        signInRes = await supabaseAdmin.auth.signInWithPassword({ email, password })
      }

      if (signInRes.error || !signInRes.data.session || !signInRes.data.user) {
        return NextResponse.json<VerifyErrorResponse>(
          { ok: false, error: 'Error al iniciar sesión de revisión. Intenta de nuevo.' },
          { status: 500, headers }
        )
      }

      authUserId = signInRes.data.user.id
      accessToken = signInRes.data.session.access_token
      refreshToken = signInRes.data.session.refresh_token
      expiresAt = signInRes.data.session.expires_at
    } else {
      const phoneE164 = `+1${phone}`
      const { data: verifyData, error: verifyError } = await supabaseAdmin.auth.verifyOtp({
        phone: phoneE164,
        token: code,
        type: 'sms',
      })

      if (verifyError) {
        console.error('[MOBILE AUTH] Error al verificar OTP:', verifyError.message)

        if (
          verifyError.message.includes('expired') ||
          verifyError.message.includes('invalid') ||
          verifyError.message.includes('Token')
        ) {
          return NextResponse.json<VerifyErrorResponse>(
            { ok: false, error: 'Código inválido o expirado. Solicita uno nuevo.' },
            { status: 401, headers }
          )
        }

        return NextResponse.json<VerifyErrorResponse>(
          { ok: false, error: 'Error al verificar el código. Intenta de nuevo.' },
          { status: 500, headers }
        )
      }

      if (!verifyData.session || !verifyData.user) {
        console.error('[MOBILE AUTH] Verificación exitosa pero sin sesión/usuario')
        return NextResponse.json<VerifyErrorResponse>(
          { ok: false, error: 'Error al crear sesión. Intenta de nuevo.' },
          { status: 500, headers }
        )
      }

      authUserId = verifyData.user.id
      accessToken = verifyData.session.access_token
      refreshToken = verifyData.session.refresh_token
      expiresAt = verifyData.session.expires_at
    }

    // -------------------------------------------------------------------------
    // 3. Obtener o crear perfil en app_users
    // -------------------------------------------------------------------------
    let userProfile: AppUserProfile | null = null

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

      if (userProfile.id !== authUserId) {
        await supabaseAdmin.from('app_rewards_balances').delete().eq('user_id', userProfile.id)
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
        session: {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
        },
        user: userProfile,
        rewards: rewards,
      },
      { status: 200, headers }
    )
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[MOBILE AUTH] Error inesperado en verify-otp:', errorMessage)

    return NextResponse.json<VerifyErrorResponse>(
      { ok: false, error: 'Error interno del servidor. Intenta de nuevo.' },
      { status: 500, headers }
    )
  }
}
