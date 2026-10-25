/**
 * @module app/api/mobile/auth/verify-otp/route
 * @description Endpoint de verificación de código OTP de 6 dígitos (vía Correo Electrónico Real +
 * soporte de números de prueba NANPA/FCC para Apple/Google App Review) y emisión de sesión autenticada
 * de Supabase Auth (`auth.users` + `public.app_users`) para Tacos Gavilan App.
 *
 * @businessRules
 * - Acepta correo electrónico (`email` / `identifier` / `phone` con `@`) o teléfono de 10 dígitos (`2135550199`) + código de 6 dígitos.
 * - Verifica criptográficamente el código de 6 dígitos enviado por correo (`verifyEmailOtpAndSignIn`), lo invalida tras su uso
 *   y emite una sesión JWT real de Supabase Auth (`access_token`, `refresh_token`, `expires_at`).
 * - Conserva soporte determinístico para números oficiales de prueba NANPA/FCC (`^\d{3}55501\d{2}$` con código `123456`)
 *   para revisiones de Apple App Store Review y Google Play Review.
 * - Sincroniza el perfil del comensal en `public.app_users` usando el `auth.users.id` autoritativo.
 *
 * @dataFlow
 * - App Móvil POST `/api/mobile/auth/verify-otp` -> `verifyEmailOtpAndSignIn` / `supabaseAdmin.auth` -> `public.app_users` -> Retorna `session`, `token` y `user`.
 *
 * @notes
 * - Normaliza `user.phone` en la respuesta para ocultar el prefijo interno `em_` cuando el usuario aún no ha registrado teléfono.
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { corsHeaders, corsResponse } from '@/app/api/mobile/_helpers'
import {
  EMAIL_REGEX,
  buildUniqueEmailPhonePlaceholder,
  normalizeDisplayPhone,
  verifyEmailOtpAndSignIn,
} from '@/lib/mobile-auth-email'

function createEphemeralAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

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

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}

export async function POST(request: Request): Promise<NextResponse> {
  const headers = corsHeaders()
  const isEn = (request.headers.get('Accept-Language') || '').toLowerCase().startsWith('en')
  try {
    let body: { email?: string; phone?: string; identifier?: string; code?: string }
    try {
      body = (await request.json()) as {
        email?: string
        phone?: string
        identifier?: string
        code?: string
      }
    } catch {
      return NextResponse.json<VerifyErrorResponse>(
        {
          ok: false,
          error: isEn ? 'Invalid JSON request body.' : 'Cuerpo JSON de solicitud inválido.',
        },
        { status: 400, headers }
      )
    }

    const rawIdentifier = (body.email || body.identifier || body.phone || '').trim()
    const code = (body.code || '').trim()

    if (!rawIdentifier || !code) {
      return NextResponse.json<VerifyErrorResponse>(
        {
          ok: false,
          error: isEn
            ? 'Email/phone and 6-digit code are required.'
            : 'El correo/teléfono y el código de 6 dígitos son requeridos.',
        },
        { status: 400, headers }
      )
    }

    const codeRegex = /^\d{6}$/
    if (!codeRegex.test(code)) {
      return NextResponse.json<VerifyErrorResponse>(
        {
          ok: false,
          error: isEn ? 'Verification code must be 6 digits.' : 'El código debe tener 6 dígitos.',
        },
        { status: 400, headers }
      )
    }

    let authUserId = ''
    let accessToken = ''
    let refreshToken = ''
    let expiresAt: number | undefined
    let verifiedEmail: string | null = null
    let verifiedPhone = ''

    // -------------------------------------------------------------------------
    // CASO A: Verificación por Correo Electrónico Real (Opción 1 Principal)
    // -------------------------------------------------------------------------
    if (rawIdentifier.includes('@')) {
      const cleanEmail = rawIdentifier.toLowerCase()
      if (!EMAIL_REGEX.test(cleanEmail)) {
        return NextResponse.json<VerifyErrorResponse>(
          {
            ok: false,
            error: isEn
              ? 'Please enter a valid email address.'
              : 'Por favor ingresa un correo electrónico válido.',
          },
          { status: 400, headers }
        )
      }

      const emailAuthRes = await verifyEmailOtpAndSignIn(cleanEmail, code)
      if (!emailAuthRes.ok || !emailAuthRes.authUserId || !emailAuthRes.accessToken) {
        return NextResponse.json<VerifyErrorResponse>(
          {
            ok: false,
            error: isEn
              ? 'Invalid or expired 6-digit verification code. Please request a new one.'
              : 'Código de verificación de 6 dígitos inválido o expirado. Solicita uno nuevo.',
          },
          { status: 401, headers }
        )
      }

      authUserId = emailAuthRes.authUserId
      accessToken = emailAuthRes.accessToken
      refreshToken = emailAuthRes.refreshToken || ''
      expiresAt = emailAuthRes.expiresAt
      verifiedEmail = cleanEmail
    } else {
      // -----------------------------------------------------------------------
      // CASO B: Verificación por Teléfono (Soporte Reviewer 213-555-0199 + SMS)
      // -----------------------------------------------------------------------
      const phone = normalizeUsPhone10(rawIdentifier)
      const phoneRegex = /^\d{10}$/
      if (!phoneRegex.test(phone)) {
        return NextResponse.json<VerifyErrorResponse>(
          {
            ok: false,
            error: isEn
              ? 'Please enter a valid email address or 10-digit phone number.'
              : 'Ingresa un correo electrónico válido o un número de 10 dígitos.',
          },
          { status: 400, headers }
        )
      }

      verifiedPhone = phone

      if (APP_REVIEW_TEST_PHONE_REGEX.test(phone)) {
        if (code !== APP_REVIEW_TEST_CODE) {
          return NextResponse.json<VerifyErrorResponse>(
            {
              ok: false,
              error: isEn
                ? 'Invalid or expired verification code. Please request a new one.'
                : 'Código inválido o expirado. Solicita uno nuevo.',
            },
            { status: 401, headers }
          )
        }

        const { email, password } = buildReviewerCredentials(phone)
        const ephemeralAuth = createEphemeralAuthClient()
        let signInRes = await ephemeralAuth.auth.signInWithPassword({ email, password })

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

          signInRes = await ephemeralAuth.auth.signInWithPassword({ email, password })
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
        const ephemeralAuth = createEphemeralAuthClient()
        const { data: verifyData, error: verifyError } = await ephemeralAuth.auth.verifyOtp({
          phone: phoneE164,
          token: code,
          type: 'sms',
        })

        if (verifyError || !verifyData.session || !verifyData.user) {
          return NextResponse.json<VerifyErrorResponse>(
            {
              ok: false,
              error: isEn
                ? 'Invalid or expired verification code. Please request a new one.'
                : 'Código inválido o expirado. Solicita uno nuevo.',
            },
            { status: 401, headers }
          )
        }

        authUserId = verifyData.user.id
        accessToken = verifyData.session.access_token
        refreshToken = verifyData.session.refresh_token
        expiresAt = verifyData.session.expires_at
      }
    }

    // -------------------------------------------------------------------------
    // 3. Obtener o crear perfil en public.app_users
    // -------------------------------------------------------------------------
    let userProfile: AppUserProfile | null = null

    if (verifiedEmail) {
      const { data: existingById } = await supabaseAdmin
        .from('app_users')
        .select('*')
        .eq('id', authUserId)
        .maybeSingle()

      if (existingById) {
        if (existingById.email !== verifiedEmail) {
          const { data: updated } = await supabaseAdmin
            .from('app_users')
            .update({ email: verifiedEmail, updated_at: new Date().toISOString() })
            .eq('id', authUserId)
            .select('*')
            .single()
          userProfile = (updated || existingById) as AppUserProfile
        } else {
          userProfile = existingById as AppUserProfile
        }
      } else {
        const defaultFirstName = verifiedEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, ' ').trim().slice(0, 30)
        const { data: created } = await supabaseAdmin
          .from('app_users')
          .upsert(
            {
              id: authUserId,
              phone: buildUniqueEmailPhonePlaceholder(authUserId),
              first_name: defaultFirstName ? defaultFirstName.charAt(0).toUpperCase() + defaultFirstName.slice(1) : '',
              last_name: '',
              email: verifiedEmail,
              avatar_url: null,
            },
            { onConflict: 'id' }
          )
          .select('*')
          .single()

        userProfile =
          (created as AppUserProfile) || {
            id: authUserId,
            phone: '',
            first_name: '',
            last_name: '',
            email: verifiedEmail,
            avatar_url: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
      }
    } else {
      const candidatePhones = [verifiedPhone, `+1${verifiedPhone}`, `1${verifiedPhone}`]
      const { data: existingUser } = await supabaseAdmin
        .from('app_users')
        .select('*')
        .in('phone', candidatePhones)
        .limit(1)
        .maybeSingle()

      if (existingUser) {
        userProfile = existingUser as AppUserProfile
        if (userProfile.id !== authUserId) {
          const legacyUserId = userProfile.id
          await supabaseAdmin.from('app_devices').delete().eq('user_id', legacyUserId)
          await supabaseAdmin.from('app_carts').delete().eq('user_id', legacyUserId)
          await supabaseAdmin.from('app_favorite_orders').delete().eq('user_id', legacyUserId)
          await supabaseAdmin.from('app_rewards_transactions').delete().eq('user_id', legacyUserId)
          await supabaseAdmin.from('app_rewards_balances').delete().eq('user_id', legacyUserId)
          const { error: updateIdError } = await supabaseAdmin
            .from('app_users')
            .update({ id: authUserId, phone: verifiedPhone, updated_at: new Date().toISOString() })
            .eq('id', legacyUserId)

          if (!updateIdError) {
            userProfile.id = authUserId
            userProfile.phone = verifiedPhone
          }
        }
      } else {
        const { data: createdUser } = await supabaseAdmin
          .from('app_users')
          .upsert(
            {
              id: authUserId,
              phone: verifiedPhone,
              first_name: '',
              last_name: '',
              email: null,
              avatar_url: null,
            },
            { onConflict: 'id' }
          )
          .select('*')
          .single()

        userProfile =
          (createdUser as AppUserProfile) || {
            id: authUserId,
            phone: verifiedPhone,
            first_name: '',
            last_name: '',
            email: null,
            avatar_url: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
      }
    }

    // Normalizar phone para el cliente si usa el placeholder interno em_
    const sanitizedUserProfile: AppUserProfile = {
      ...userProfile,
      phone: normalizeDisplayPhone(userProfile.phone),
    }

    // -------------------------------------------------------------------------
    // 4. Obtener o crear balance de recompensas
    // -------------------------------------------------------------------------
    let rewards: RewardsBalance
    const { data: existingRewards } = await supabaseAdmin
      .from('app_rewards_balances')
      .select('points_balance, points_accumulated, points_redeemed, tier')
      .eq('user_id', authUserId)
      .maybeSingle()

    if (existingRewards) {
      rewards = existingRewards as RewardsBalance
    } else {
      const defaultRewards: RewardsBalance = {
        points_balance: 0,
        points_accumulated: 0,
        points_redeemed: 0,
        tier: 'BRONZE',
      }
      await supabaseAdmin
        .from('app_rewards_balances')
        .upsert(
          {
            user_id: authUserId,
            ...defaultRewards,
          },
          { onConflict: 'user_id' }
        )
      rewards = defaultRewards
    }

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
        user: sanitizedUserProfile,
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
