/**
 * @module app/api/mobile/auth/verify-otp/route
 * @description Endpoint de verificación de código OTP de 6 dígitos (vía Correo Electrónico Real +
 * soporte acotado de cuentas de Apple/Google App Review) y emisión de sesión autenticada
 * de Supabase Auth (`auth.users` + `public.app_users`) para Tacos Gavilan App.
 *
 * @businessRules
 * - Acepta correo electrónico (`email` / `identifier` / `phone` con `@`) o teléfono de 10 dígitos (`2135550199`) + código de 6 dígitos.
 * - Verifica criptográficamente el código de 6 dígitos contra `public.app_mobile_otp_challenges` (`verifyEmailOtpAndSignIn`),
 *   bloquea tras 5 intentos fallidos (`HTTP 429 LOCKED`), crea/recupera la cuenta en `auth.users` solo tras verificación real,
 *   e invalida el challenge tras su consumo atómico emitiendo una sesión JWT real de Supabase Auth.
 * - Soporta cuentas restringidas de revisión (`APP_REVIEW_ALLOWED_PHONES`, default `2135550199`, y `reviewer@tacosgavilan.com`
 *   con código `123456` cuando `ENABLE_APP_REVIEW_TEST_ACCOUNTS !== 'false'`).
 * - Sincroniza el perfil del comensal en `public.app_users` usando el `auth.users.id` autoritativo y falla explícitamente (`500`)
 *   si la escritura de perfil falla.
 *
 * @dataFlow
 * - App Móvil POST `/api/mobile/auth/verify-otp` -> `verifyEmailOtpAndSignIn` / `supabaseAdmin.auth` -> `public.app_users` -> Retorna `session`, `token` y `user`.
 *
 * @notes
 * - Normaliza `user.phone` en la respuesta para ocultar el prefijo interno `em_` cuando el usuario aún no ha registrado teléfono.
 * - Nov 2026: Endurecido sin secretos hardcodeados de respaldo, con bloqueo `429 LOCKED` y manejo estricto de errores en `app_users`.
 * - Blindaje de Seguridad (2026-11-21): rate limit acotado por IP (`x-vercel-forwarded-for` / `x-real-ip`) e identificador + comparación constante de hashes OTP mediante `crypto.timingSafeEqual`.
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

const APP_REVIEW_ALLOWED_PHONES = new Set(
  (process.env.APP_REVIEW_TEST_PHONES || '2135550199')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
)
const APP_REVIEW_TEST_CODE = '123456'

function isAllowedAppReviewPhone(phone10: string): boolean {
  if (process.env.ENABLE_APP_REVIEW_TEST_ACCOUNTS === 'false') return false
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_REVIEWER_TEST_OTP !== 'true') {
    return false
  }
  return APP_REVIEW_ALLOWED_PHONES.has(phone10)
}

const TIER_RANK: Record<RewardsBalance['tier'], number> = {
  BRONZE: 0,
  SILVER: 1,
  GOLD: 2,
  PLATINUM: 3,
}

async function reconcileLegacyAppUserToAuthId(
  legacyUser: AppUserProfile & Record<string, unknown>,
  authUserId: string,
  opts: { verifiedPhone?: string; verifiedEmail?: string }
): Promise<AppUserProfile> {
  const legacyUserId = legacyUser.id
  if (legacyUserId === authUserId) {
    return legacyUser
  }

  const { data: existingTarget } = await supabaseAdmin
    .from('app_users')
    .select('*')
    .eq('id', authUserId)
    .maybeSingle()

  const tempPlaceholderPhone = `mig_${legacyUserId.replace(/-/g, '').slice(0, 14)}`
  const { error: releaseErr } = await supabaseAdmin
    .from('app_users')
    .update({
      phone: tempPlaceholderPhone,
      email: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', legacyUserId)

  if (releaseErr) {
    console.error('[MOBILE AUTH] Error liberando phone/email temporal en migración app_users:', releaseErr.message)
    return legacyUser
  }

  const resolvedPhone =
    opts.verifiedPhone ||
    (existingTarget?.phone && !String(existingTarget.phone).startsWith('em_')
      ? String(existingTarget.phone)
      : legacyUser.phone)

  const upsertPayload: Record<string, unknown> = {
    id: authUserId,
    phone: resolvedPhone,
    first_name: existingTarget?.first_name || legacyUser.first_name || '',
    last_name: existingTarget?.last_name || legacyUser.last_name || '',
    email: opts.verifiedEmail || existingTarget?.email || legacyUser.email || null,
    avatar_url: existingTarget?.avatar_url || legacyUser.avatar_url || null,
    updated_at: new Date().toISOString(),
  }

  if ('wallet_balance' in legacyUser || (existingTarget && 'wallet_balance' in existingTarget)) {
    upsertPayload.wallet_balance =
      Number((existingTarget as Record<string, unknown> | null)?.wallet_balance || 0) +
      Number(legacyUser.wallet_balance || 0)
  }
  if ('loyalty_points' in legacyUser || (existingTarget && 'loyalty_points' in existingTarget)) {
    upsertPayload.loyalty_points =
      Number((existingTarget as Record<string, unknown> | null)?.loyalty_points || 0) +
      Number(legacyUser.loyalty_points || 0)
  }

  const { data: targetRow, error: targetUpsertErr } = await supabaseAdmin
    .from('app_users')
    .upsert(upsertPayload, { onConflict: 'id' })
    .select('*')
    .single()

  if (targetUpsertErr || !targetRow) {
    // Rollback unique fields on legacyUser so zero data is lost
    await supabaseAdmin
      .from('app_users')
      .update({
        phone: legacyUser.phone,
        email: legacyUser.email,
        updated_at: new Date().toISOString(),
      })
      .eq('id', legacyUserId)
    console.error('[MOBILE AUTH] Error creando fila destino en migración app_users:', targetUpsertErr?.message)
    return legacyUser
  }

  // 1. Merge app_rewards_balances (preserving points_balance, points_accumulated, points_redeemed & highest tier)
  const [{ data: legacyRewards }, { data: targetRewards }] = await Promise.all([
    supabaseAdmin
      .from('app_rewards_balances')
      .select('points_balance, points_accumulated, points_redeemed, tier')
      .eq('user_id', legacyUserId)
      .maybeSingle(),
    supabaseAdmin
      .from('app_rewards_balances')
      .select('points_balance, points_accumulated, points_redeemed, tier')
      .eq('user_id', authUserId)
      .maybeSingle(),
  ])

  if (legacyRewards) {
    const legTier = (legacyRewards.tier as RewardsBalance['tier']) || 'BRONZE'
    const tgtTier = (targetRewards?.tier as RewardsBalance['tier']) || 'BRONZE'
    const bestTier = (TIER_RANK[legTier] ?? 0) >= (TIER_RANK[tgtTier] ?? 0) ? legTier : tgtTier

    await supabaseAdmin.from('app_rewards_balances').upsert(
      {
        user_id: authUserId,
        points_balance: Number(targetRewards?.points_balance || 0) + Number(legacyRewards.points_balance || 0),
        points_accumulated:
          Number(targetRewards?.points_accumulated || 0) + Number(legacyRewards.points_accumulated || 0),
        points_redeemed: Number(targetRewards?.points_redeemed || 0) + Number(legacyRewards.points_redeemed || 0),
        tier: bestTier,
      },
      { onConflict: 'user_id' }
    )
    await supabaseAdmin.from('app_rewards_balances').delete().eq('user_id', legacyUserId)
  }

  // 2. Preserve rewards transactions, favorite orders, historical orders & quotes
  await Promise.all([
    supabaseAdmin.from('app_rewards_transactions').update({ user_id: authUserId }).eq('user_id', legacyUserId),
    supabaseAdmin.from('app_favorite_orders').update({ user_id: authUserId }).eq('user_id', legacyUserId),
    supabaseAdmin.from('app_orders').update({ user_id: authUserId }).eq('user_id', legacyUserId),
    supabaseAdmin.from('app_quotes').update({ user_id: authUserId }).eq('user_id', legacyUserId),
  ])

  // 3. Preserve non-conflicting carts & devices
  const [{ data: legacyCarts }, { data: targetCarts }] = await Promise.all([
    supabaseAdmin.from('app_carts').select('id, store_id').eq('user_id', legacyUserId),
    supabaseAdmin.from('app_carts').select('store_id').eq('user_id', authUserId),
  ])
  const targetCartStores = new Set((targetCarts || []).map((c: any) => String(c.store_id)))
  for (const c of legacyCarts || []) {
    if (!targetCartStores.has(String(c.store_id))) {
      await supabaseAdmin.from('app_carts').update({ user_id: authUserId }).eq('id', c.id)
    }
  }

  const [{ data: legacyDevices }, { data: targetDevices }] = await Promise.all([
    supabaseAdmin.from('app_devices').select('id, push_token').eq('user_id', legacyUserId),
    supabaseAdmin.from('app_devices').select('push_token').eq('user_id', authUserId),
  ])
  const targetTokens = new Set((targetDevices || []).map((d: any) => String(d.push_token)))
  for (const d of legacyDevices || []) {
    if (!targetTokens.has(String(d.push_token))) {
      await supabaseAdmin.from('app_devices').update({ user_id: authUserId }).eq('id', d.id)
    }
  }

  // 4. Clean up empty legacy shell row after all child rows are safely re-pointed
  await supabaseAdmin.from('app_users').delete().eq('id', legacyUserId)

  return targetRow as AppUserProfile
}

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
  const secretSeed =
    process.env.MOBILE_OTP_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_JWT_SECRET
  if (!secretSeed || !secretSeed.trim()) {
    throw new Error('Configuración de seguridad faltante: MOBILE_OTP_SECRET / SUPABASE_SERVICE_ROLE_KEY.')
  }
  const hash = crypto.createHmac('sha256', secretSeed.trim()).update(`reviewer:${phone10}`).digest('hex')
  const password = `TG!${hash.slice(0, 24)}#9a`
  return { email, password }
}

const MAX_VERIFY_OTP_BUCKETS = 2000
const VERIFY_OTP_IP_LIMIT = 15
const VERIFY_OTP_IDENTIFIER_LIMIT = 6
const VERIFY_OTP_WINDOW_MS = 10 * 60_000
const verifyOtpBuckets = new Map<string, number[]>()

function extractTrustedClientIp(headers: Headers): string {
  const vercelFwd = headers.get('x-vercel-forwarded-for') || ''
  const firstVercel = vercelFwd.split(',')[0]?.trim()
  if (firstVercel) return firstVercel.slice(0, 64)
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp.slice(0, 64)
  const fwd = headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0]?.trim().slice(0, 64) || 'unknown'
}

function checkBoundedVerifyOtpLimit(key: string, limit: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now()
  if (verifyOtpBuckets.size >= MAX_VERIFY_OTP_BUCKETS && !verifyOtpBuckets.has(key)) {
    for (const [k, arr] of verifyOtpBuckets) {
      const valid = arr.filter((t) => now - t < VERIFY_OTP_WINDOW_MS)
      if (valid.length === 0) verifyOtpBuckets.delete(k)
      else verifyOtpBuckets.set(k, valid)
    }
    if (verifyOtpBuckets.size >= MAX_VERIFY_OTP_BUCKETS) {
      const oldest = verifyOtpBuckets.keys().next().value
      if (oldest) verifyOtpBuckets.delete(oldest)
    }
  }
  const hits = (verifyOtpBuckets.get(key) || []).filter((t) => now - t < VERIFY_OTP_WINDOW_MS)
  if (hits.length >= limit) {
    verifyOtpBuckets.set(key, hits)
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((VERIFY_OTP_WINDOW_MS - (now - hits[0])) / 1000)),
    }
  }
  hits.push(now)
  verifyOtpBuckets.set(key, hits)
  return { allowed: true, retryAfterSec: 0 }
}

function verifyOtpHashConstantTime(candidateCode: string, expectedCode: string): boolean {
  const key = process.env.MOBILE_OTP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'teg-otp-hmac'
  const candidateDigest = crypto.createHmac('sha256', key).update(String(candidateCode)).digest()
  const expectedDigest = crypto.createHmac('sha256', key).update(String(expectedCode)).digest()
  return candidateDigest.length === expectedDigest.length && crypto.timingSafeEqual(candidateDigest, expectedDigest)
}

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}

export async function POST(request: Request): Promise<NextResponse> {
  const headers = corsHeaders()
  const isEn = (request.headers.get('Accept-Language') || '').toLowerCase().startsWith('en')
  try {
    const clientIp = extractTrustedClientIp(request.headers)
    const ipRl = checkBoundedVerifyOtpLimit(`ip:${clientIp}`, VERIFY_OTP_IP_LIMIT)
    if (!ipRl.allowed) {
      return NextResponse.json<VerifyErrorResponse>(
        {
          ok: false,
          error: isEn
            ? `Too many verification attempts. Please wait ${ipRl.retryAfterSec}s before trying again.`
            : `Demasiados intentos de verificación. Espera ${ipRl.retryAfterSec}s antes de intentar de nuevo.`,
        },
        { status: 429, headers: { ...headers, 'Retry-After': String(ipRl.retryAfterSec) } }
      )
    }
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

    const idRl = checkBoundedVerifyOtpLimit(`ident:${rawIdentifier.toLowerCase().slice(0, 120)}`, VERIFY_OTP_IDENTIFIER_LIMIT)
    if (!idRl.allowed) {
      return NextResponse.json<VerifyErrorResponse>(
        {
          ok: false,
          error: isEn
            ? `Too many attempts for this account. Please wait ${idRl.retryAfterSec}s.`
            : `Demasiados intentos para esta cuenta. Espera ${idRl.retryAfterSec}s.`,
        },
        { status: 429, headers: { ...headers, 'Retry-After': String(idRl.retryAfterSec) } }
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
        const isLocked = emailAuthRes.errorCode === 'LOCKED'
        return NextResponse.json<VerifyErrorResponse>(
          {
            ok: false,
            error: isLocked
              ? isEn
                ? 'Too many failed verification attempts. Please wait 15 minutes and request a new code.'
                : 'Demasiados intentos fallidos. Espera 15 minutos y solicita un nuevo código.'
              : isEn
                ? 'Invalid or expired 6-digit verification code. Please request a new one.'
                : 'Código de verificación de 6 dígitos inválido o expirado. Solicita uno nuevo.',
          },
          { status: isLocked ? 429 : 401, headers }
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

      if (isAllowedAppReviewPhone(phone)) {
        if (!verifyOtpHashConstantTime(code, APP_REVIEW_TEST_CODE)) {
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
        const { data: legacyByEmail } = await supabaseAdmin
          .from('app_users')
          .select('*')
          .ilike('email', verifiedEmail)
          .limit(1)
          .maybeSingle()

        if (legacyByEmail && legacyByEmail.id !== authUserId) {
          userProfile = await reconcileLegacyAppUserToAuthId(
            legacyByEmail as AppUserProfile & Record<string, unknown>,
            authUserId,
            { verifiedEmail }
          )
        } else {
          const defaultFirstName = verifiedEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, ' ').trim().slice(0, 30)
          const { data: created, error: createProfileErr } = await supabaseAdmin
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

          if (createProfileErr || !created) {
            console.error('[MOBILE AUTH] Error sincronizando perfil app_users por correo:', createProfileErr?.message)
            return NextResponse.json<VerifyErrorResponse>(
              { ok: false, error: 'Error sincronizando perfil de usuario. Intenta de nuevo.' },
              { status: 500, headers }
            )
          }
          userProfile = created as AppUserProfile
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
          userProfile = await reconcileLegacyAppUserToAuthId(
            existingUser as AppUserProfile & Record<string, unknown>,
            authUserId,
            { verifiedPhone }
          )
        }
      } else {
        const { data: createdUser, error: createPhoneErr } = await supabaseAdmin
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

        if (createPhoneErr || !createdUser) {
          console.error('[MOBILE AUTH] Error sincronizando perfil app_users por teléfono:', createPhoneErr?.message)
          return NextResponse.json<VerifyErrorResponse>(
            { ok: false, error: 'Error sincronizando perfil de usuario. Intenta de nuevo.' },
            { status: 500, headers }
          )
        }

        userProfile = createdUser as AppUserProfile
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
