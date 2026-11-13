/**
 * @module lib/mobile-auth-email
 * @description Servicio de generación, firmado criptográfico (HMAC-SHA256) y despacho inmediato por correo
 * electrónico (Gmail SMTP oficial de Tacos Gavilan) de códigos de verificación OTP de 6 dígitos para Tacos Gavilan App.
 *
 * @businessRules
 * - Nombre oficial de la marca: estrictamente **Tacos Gavilan** (nunca "Tacos El Gavilan").
 * - Emite códigos numéricos reales de 6 dígitos con vigencia de 10 minutos en `public.app_mobile_otp_challenges`.
 * - No crea cuentas en `auth.users` ni `public.app_users` hasta que el código OTP es verificado exitosamente (cero cuentas fantasma).
 * - Exige secreto criptográfico real (`MOBILE_OTP_SECRET` o `SUPABASE_SERVICE_ROLE_KEY`), búsqueda O(1) vía `get_auth_user_id_by_email` y bloqueo tras 5 intentos fallidos.
 * - Envía un correo HTML bilingüe (Inglés / Español) mediante la cuenta SMTP oficial (`SMTP_EMAIL` / `SMTP_PASSWORD`).
 * - Soporta cuentas de revisión y pruebas automatizadas (`@tacosgavilan.test`, `reviewer@tacosgavilan.com`, `apple@tacosgavilan.com`, `google@tacosgavilan.com`) con código `123456`.
 *
 * @dataFlow
 * - `POST /api/mobile/auth/send-otp` -> `checkEmailOtpRateLimit` + `issueEmailOtpChallenge` -> `sendMobileOtpEmail` (Nodemailer Gmail SMTP).
 * - `POST /api/mobile/auth/verify-otp` -> Verificación constante (`crypto.timingSafeEqual`) + bloqueo -> `findOrCreateEmailAuthUser` -> Emisión de JWT real de Supabase Auth.
 *
 * @notes
 * - [2026-11-12] Migrado OTP desde `auth.users.user_metadata` hacia `public.app_mobile_otp_challenges`, eliminados fallbacks de secretos hardcodeados y reemplazado `listUsers(1000)` por RPC `get_auth_user_id_by_email`.
 */

import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './supabase'

export const EMAIL_OTP_TTL_MS = 10 * 60 * 1000 // 10 minutos
export const APP_REVIEW_TEST_CODE = '123456'
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

function requireMobileOtpSecret(): string {
  const secret =
    process.env.MOBILE_OTP_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_JWT_SECRET
  if (!secret || !secret.trim()) {
    throw new Error(
      'Configuración de seguridad faltante: MOBILE_OTP_SECRET o SUPABASE_SERVICE_ROLE_KEY es requerido.'
    )
  }
  return secret.trim()
}

export function buildUniqueEmailPhonePlaceholder(authUserId: string): string {
  return `em_${authUserId.replace(/-/g, '').slice(0, 14)}`
}

export function normalizeDisplayPhone(phone?: string | null): string {
  if (!phone) return ''
  if (phone.startsWith('em_')) return ''
  return phone
}

async function findExistingEmailAuthUserId(cleanEmail: string): Promise<string | null> {
  // 1. Buscar primero en public.app_users por email (O(1))
  const { data: existingAppUser } = await supabaseAdmin
    .from('app_users')
    .select('id, phone, email')
    .ilike('email', cleanEmail)
    .limit(1)
    .maybeSingle()

  if (existingAppUser?.id) {
    return existingAppUser.id
  }

  // 2. Búsqueda O(1) en auth.users vía RPC indexado (evita tope de listUsers 1000)
  const { data: rpcUserId, error: rpcErr } = await supabaseAdmin.rpc('get_auth_user_id_by_email', {
    p_email: cleanEmail,
  })
  if (rpcErr) {
    throw new Error(rpcErr.message)
  }
  if (typeof rpcUserId === 'string' && rpcUserId.trim()) {
    const authId = rpcUserId.trim()
    await supabaseAdmin
      .from('app_users')
      .upsert(
        {
          id: authId,
          phone: buildUniqueEmailPhonePlaceholder(authId),
          first_name: '',
          last_name: '',
          email: cleanEmail,
          avatar_url: null,
        },
        { onConflict: 'id' }
      )
    return authId
  }

  return null
}

/**
 * Crea o recupera el usuario autenticado en Supabase Auth y `public.app_users`
 * ÚNICAMENTE después de verificar el código OTP o aprobar cuenta oficial de App Review.
 */
export async function findOrCreateEmailAuthUser(cleanEmail: string): Promise<string> {
  const existingId = await findExistingEmailAuthUserId(cleanEmail)
  if (existingId) {
    return existingId
  }

  // Intentar crear en auth.users
  const password = buildDeterministicEmailAuthPassword(cleanEmail)
  const { data: createdAuth, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: cleanEmail,
    password,
    email_confirm: true,
    user_metadata: { auth_channel: 'email_otp' },
  })

  if (!createErr && createdAuth?.user?.id) {
    const authUserId = createdAuth.user.id
    const { error: upsertErr } = await supabaseAdmin
      .from('app_users')
      .upsert(
        {
          id: authUserId,
          phone: buildUniqueEmailPhonePlaceholder(authUserId),
          first_name: '',
          last_name: '',
          email: cleanEmail,
          avatar_url: null,
        },
        { onConflict: 'id' }
      )
    if (upsertErr) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {})
      throw new Error(upsertErr.message)
    }
    return authUserId
  }

  // Si ya existía en auth.users por condición de carrera concurrente
  const racedId = await findExistingEmailAuthUserId(cleanEmail)
  if (!racedId) {
    throw new Error(createErr?.message || 'Unable to locate or create auth user.')
  }

  return racedId
}

export async function checkEmailOtpRateLimit(
  cleanEmail: string,
  clientIp?: string | null
): Promise<{
  allowed: boolean
  reason?: 'locked' | 'cooldown' | 'email_quota' | 'ip_quota'
  retryAfterSec?: number
}> {
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const window15mIso = new Date(nowMs - 15 * 60 * 1000).toISOString()
  const isReviewer = isAppReviewTestEmail(cleanEmail)

  const { data: recentForEmail } = await supabaseAdmin
    .from('app_mobile_otp_challenges')
    .select('created_at, locked_until')
    .ilike('email', cleanEmail)
    .gte('created_at', window15mIso)
    .order('created_at', { ascending: false })
    .limit(10)

  if (recentForEmail && recentForEmail.length > 0) {
    const latest = recentForEmail[0]
    if (latest.locked_until) {
      const lockedUntilMs = Date.parse(latest.locked_until)
      if (!Number.isNaN(lockedUntilMs) && lockedUntilMs > nowMs) {
        return {
          allowed: false,
          reason: 'locked',
          retryAfterSec: Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000)),
        }
      }
    }

    if (!isReviewer) {
      const latestMs = Date.parse(latest.created_at)
      if (!Number.isNaN(latestMs) && nowMs - latestMs < 45 * 1000) {
        return {
          allowed: false,
          reason: 'cooldown',
          retryAfterSec: Math.max(1, Math.ceil((45 * 1000 - (nowMs - latestMs)) / 1000)),
        }
      }
      if (recentForEmail.length >= 5) {
        return {
          allowed: false,
          reason: 'email_quota',
          retryAfterSec: 15 * 60,
        }
      }
    }
  }

  if (clientIp && !isReviewer) {
    const { count } = await supabaseAdmin
      .from('app_mobile_otp_challenges')
      .select('id', { count: 'exact', head: true })
      .eq('client_ip', clientIp)
      .gte('created_at', window15mIso)
      .lte('created_at', nowIso)

    if ((count || 0) >= 20) {
      return {
        allowed: false,
        reason: 'ip_quota',
        retryAfterSec: 15 * 60,
      }
    }
  }

  return { allowed: true }
}

/**
 * Registra un reto OTP pendiente en `public.app_mobile_otp_challenges`
 * SIN crear cuentas en `auth.users` ni `app_users` hasta verificar el código.
 */
export async function issueEmailOtpChallenge(
  cleanEmail: string,
  code: string,
  clientIp?: string | null
): Promise<string> {
  const otpHash = hashEmailOtpCode(cleanEmail, code)
  const expiresAtIso = new Date(Date.now() + EMAIL_OTP_TTL_MS).toISOString()

  const { data, error } = await supabaseAdmin
    .from('app_mobile_otp_challenges')
    .insert({
      email: cleanEmail,
      code_hash: otpHash,
      client_ip: clientIp || null,
      attempts: 0,
      max_attempts: 5,
      expires_at: expiresAtIso,
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    throw new Error(error?.message || 'Unable to store OTP challenge')
  }

  return data.id
}

export async function revokeEmailOtpChallenge(challengeId: string): Promise<void> {
  if (!challengeId) return
  await supabaseAdmin.from('app_mobile_otp_challenges').delete().eq('id', challengeId)
}

export async function saveEmailOtpForUser(
  cleanEmail: string,
  code: string,
  clientIp?: string | null
): Promise<string> {
  return issueEmailOtpChallenge(cleanEmail, code, clientIp)
}

export async function verifyEmailOtpAndSignIn(
  cleanEmail: string,
  code: string
): Promise<{
  ok: boolean
  authUserId?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  errorCode?: 'INVALID_OTP' | 'LOCKED' | 'AUTH_ERROR'
}> {
  const trimmedCode = code.trim()
  const isReviewer = isAppReviewTestEmail(cleanEmail)

  if (isReviewer) {
    if (trimmedCode !== APP_REVIEW_TEST_CODE) {
      return { ok: false, errorCode: 'INVALID_OTP' }
    }
  } else {
    const { data: challenge, error: challengeErr } = await supabaseAdmin
      .from('app_mobile_otp_challenges')
      .select('id, code_hash, attempts, max_attempts, locked_until, expires_at')
      .ilike('email', cleanEmail)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (challengeErr || !challenge) {
      return { ok: false, errorCode: 'INVALID_OTP' }
    }

    const nowMs = Date.now()
    if (challenge.locked_until && Date.parse(challenge.locked_until) > nowMs) {
      return { ok: false, errorCode: 'LOCKED' }
    }

    const expiresAtMs = Date.parse(challenge.expires_at)
    const isValid = verifyEmailOtpHash(cleanEmail, trimmedCode, challenge.code_hash, expiresAtMs)

    if (!isValid) {
      const nextAttempts = Number(challenge.attempts || 0) + 1
      const maxAttempts = Number(challenge.max_attempts || 5)
      const shouldLock = nextAttempts >= maxAttempts
      const lockedUntil = shouldLock ? new Date(nowMs + 15 * 60 * 1000).toISOString() : null

      await supabaseAdmin
        .from('app_mobile_otp_challenges')
        .update({
          attempts: nextAttempts,
          ...(lockedUntil ? { locked_until: lockedUntil } : {}),
        })
        .eq('id', challenge.id)

      return { ok: false, errorCode: shouldLock ? 'LOCKED' : 'INVALID_OTP' }
    }

    // Consumo atómico de un solo uso para evitar replay race conditions
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('app_mobile_otp_challenges')
      .update({ consumed_at: new Date(nowMs).toISOString() })
      .eq('id', challenge.id)
      .is('consumed_at', null)
      .select('id')
      .maybeSingle()

    if (claimErr || !claimed?.id) {
      return { ok: false, errorCode: 'INVALID_OTP' }
    }
  }

  const authUserId = await findOrCreateEmailAuthUser(cleanEmail)
  const { data: userRes, error: getUserErr } = await supabaseAdmin.auth.admin.getUserById(authUserId)

  if (getUserErr || !userRes?.user) {
    return { ok: false, errorCode: 'AUTH_ERROR' }
  }

  const meta = (userRes.user.user_metadata as Record<string, unknown>) || {}
  const password = buildDeterministicEmailAuthPassword(cleanEmail)

  // Asegurar contraseña determinística confirmada y marcar última verificación
  await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    password,
    email_confirm: true,
    user_metadata: {
      ...meta,
      last_verified_at: new Date().toISOString(),
    },
  })

  const ephemeralAuth = createEphemeralAuthClient()
  const signInRes = await ephemeralAuth.auth.signInWithPassword({
    email: cleanEmail,
    password,
  })

  if (signInRes.error || !signInRes.data.session || !signInRes.data.user) {
    return { ok: false, errorCode: 'AUTH_ERROR' }
  }

  return {
    ok: true,
    authUserId: signInRes.data.user.id,
    accessToken: signInRes.data.session.access_token,
    refreshToken: signInRes.data.session.refresh_token,
    expiresAt: signInRes.data.session.expires_at,
  }
}

export function isAppReviewTestEmail(email: string): boolean {
  if (process.env.ENABLE_APP_REVIEW_TEST_ACCOUNTS === 'false') {
    return false
  }
  const clean = email.trim().toLowerCase()
  return (
    clean === 'reviewer@tacosgavilan.com' ||
    clean === 'apple@tacosgavilan.com' ||
    clean === 'google@tacosgavilan.com' ||
    clean.endsWith('@tacosgavilan.test')
  )
}

export function generateEmailOtpCode(email: string): string {
  if (isAppReviewTestEmail(email)) {
    return APP_REVIEW_TEST_CODE
  }
  return crypto.randomInt(100000, 999999).toString()
}

export function hashEmailOtpCode(email: string, code: string): string {
  const secret = requireMobileOtpSecret()
  return crypto
    .createHmac('sha256', secret)
    .update(`email-otp:${email.trim().toLowerCase()}:${code.trim()}`)
    .digest('hex')
}

export function verifyEmailOtpHash(
  email: string,
  code: string,
  expectedHash?: string | null,
  expiresAtMs?: number | null
): boolean {
  if (isAppReviewTestEmail(email) && code.trim() === APP_REVIEW_TEST_CODE) {
    return true
  }
  if (!expectedHash || !expiresAtMs) return false
  if (Date.now() > Number(expiresAtMs)) return false

  const computed = hashEmailOtpCode(email, code)
  try {
    const a = Buffer.from(computed, 'hex')
    const b = Buffer.from(expectedHash, 'hex')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export function buildDeterministicEmailAuthPassword(email: string): string {
  const secretSeed = requireMobileOtpSecret()
  const hash = crypto
    .createHmac('sha256', secretSeed)
    .update(`email-auth:${email.trim().toLowerCase()}`)
    .digest('hex')
  return `TG!${hash.slice(0, 24)}#9a`
}

export function generateMobileOtpEmailHtml(code: string, isEn: boolean): string {
  const title = isEn
    ? 'Your Tacos Gavilan Verification Code'
    : 'Tu Código de Verificación de Tacos Gavilan'
  const subtitle = isEn
    ? 'Enter this 6-digit code in the Tacos Gavilan App to sign in to your account:'
    : 'Ingresa este código de 6 dígitos en la aplicación de Tacos Gavilan para iniciar sesión en tu cuenta:'
  const expiryNote = isEn
    ? 'This code is valid for 10 minutes. If you did not request this code, you can safely ignore this email.'
    : 'Este código es válido por 10 minutos. Si no solicitaste este código, puedes ignorar este correo con seguridad.'

  return `
<!DOCTYPE html>
<html lang="${isEn ? 'en' : 'es'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #121212; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #1a1a1c; border-radius: 20px; overflow: hidden; border: 1px solid #2e2e32;">
          <tr>
            <td style="background: linear-gradient(135deg, #DA291C 0%, #9E1B12 100%); padding: 24px; text-align: center; border-bottom: 3px solid #FFC72C;">
              <div style="font-size: 11px; font-weight: 900; letter-spacing: 2.5px; color: #FFC72C; text-transform: uppercase;">
                TACOS GAVILAN • SINCE 1992
              </div>
              <div style="font-size: 22px; font-weight: 900; color: #FFFFFF; margin-top: 6px; letter-spacing: 0.5px;">
                ${title}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 24px; text-align: center;">
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #d4d4d8;">
                ${subtitle}
              </p>
              <div style="display: inline-block; background-color: #111113; border: 2px solid #FFC72C; border-radius: 16px; padding: 16px 32px; margin: 4px 0 22px 0;">
                <span style="font-size: 34px; font-weight: 900; letter-spacing: 10px; color: #FFC72C; font-family: 'Courier New', Courier, monospace;">
                  ${code}
                </span>
              </div>
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #a1a1aa;">
                ${expiryNote}
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #141416; padding: 16px 24px; text-align: center; border-top: 1px solid #27272a;">
              <p style="margin: 0; font-size: 11px; color: #71717a;">
                Tacos Gavilan • 15 Official Locations in Southern California
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

export async function sendMobileOtpEmail(
  recipientEmail: string,
  code: string,
  isEn = false
): Promise<{ ok: boolean; error?: string }> {
  const cleanEmail = recipientEmail.trim().toLowerCase()

  // Para correos de revisión/prueba automatizada (@tacosgavilan.test o reviewer@tacosgavilan.com), no requiere despacho externo
  if (isAppReviewTestEmail(cleanEmail)) {
    return { ok: true }
  }

  const smtpUser = process.env.SMTP_EMAIL || 'carlos@tacosgavilan.com'
  const smtpPass = process.env.SMTP_PASSWORD

  if (!smtpPass) {
    console.error('[MobileAuthEmail] SMTP_PASSWORD no está configurado en variables de entorno.')
    return {
      ok: false,
      error: isEn
        ? 'Email service is temporarily unavailable.'
        : 'El servicio de correo no está disponible temporalmente.',
    }
  }

  const subject = isEn
    ? `${code} is your Tacos Gavilan verification code`
    : `${code} es tu código de verificación de Tacos Gavilan`

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })

    const html = generateMobileOtpEmailHtml(code, isEn)

    await transporter.sendMail({
      from: `"Tacos Gavilan" <${smtpUser}>`,
      to: cleanEmail,
      subject,
      html,
    })

    return { ok: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'SMTP error'
    console.error('[MobileAuthEmail] Error enviando código OTP por correo:', msg)
    return {
      ok: false,
      error: isEn
        ? 'Could not send verification email. Please verify your email address and try again.'
        : 'No se pudo enviar el correo de verificación. Verifica tu dirección de correo e inténtalo de nuevo.',
    }
  }
}
