/**
 * @module app/api/mobile/auth/send-otp/route
 * @description Endpoint de envío de código OTP de 6 dígitos (vía Correo Electrónico Real con Gmail SMTP
 * de Tacos Gavilan + soporte determinístico acotado para cuentas oficiales de App Review).
 *
 * @businessRules
 * - Acepta correo electrónico (`email` / `identifier` / `phone` con `@`) y envía al instante un código real de 6 dígitos
 *   mediante el transporte SMTP oficial de Tacos Gavilan (`lib/mobile-auth-email.ts`), guardando el hash HMAC-SHA256
 *   con vigencia de 10 minutos en `public.app_mobile_otp_challenges` sin crear cuentas fantasma previas en `auth.users`.
 * - Aplica rate limiting en memoria acotado por IP (`x-vercel-forwarded-for` / `x-real-ip`) tanto para correo como para teléfono,
 *   además de `checkEmailOtpRateLimit` en base de datos; si el envío SMTP falla, revoca el challenge recién emitido.
 * - Soporta cuentas restringidas de Apple/Google App Review (`APP_REVIEW_ALLOWED_PHONES`, default `2135550199`,
 *   cuando `ENABLE_APP_REVIEW_TEST_ACCOUNTS !== 'false'`).
 *
 * @dataFlow
 * - App Móvil POST `/api/mobile/auth/send-otp` -> Rate Limit IP (`x-vercel-forwarded-for`) -> `checkEmailOtpRateLimit` + `issueEmailOtpChallenge` + `sendMobileOtpEmail` -> Buzón del comensal.
 *
 * @notes
 * - Usa `corsHeaders()` y `corsResponse()` de `@/app/api/mobile/_helpers` para soportar preflight `OPTIONS` (`HTTP 204`).
 * - Responde en inglés o español según la cabecera `Accept-Language`.
 * - Blindaje de Seguridad (2026-11-21): rate limit acotado por IP (`x-vercel-forwarded-for` / `x-real-ip`) cubriendo tanto Email OTP como SMS OTP, y candado de producción en teléfonos de App Review.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { corsHeaders, corsResponse } from '@/app/api/mobile/_helpers'
import {
  EMAIL_REGEX,
  checkEmailOtpRateLimit,
  generateEmailOtpCode,
  issueEmailOtpChallenge,
  revokeEmailOtpChallenge,
  sendMobileOtpEmail,
} from '@/lib/mobile-auth-email'

const APP_REVIEW_ALLOWED_PHONES = new Set(
  (process.env.APP_REVIEW_TEST_PHONES || '2135550199')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
)

const MAX_SEND_OTP_BUCKETS = 2000
const IP_SEND_OTP_LIMIT = 12
const IDENTIFIER_SEND_OTP_LIMIT = 4
const SEND_OTP_WINDOW_MS = 10 * 60_000
const sendOtpBuckets = new Map<string, number[]>()

function extractTrustedClientIp(headers: Headers): string {
  const vercelFwd = headers.get('x-vercel-forwarded-for') || ''
  const firstVercel = vercelFwd.split(',')[0]?.trim()
  if (firstVercel) return firstVercel.slice(0, 64)
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp.slice(0, 64)
  const fwd = headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0]?.trim().slice(0, 64) || 'unknown'
}

function checkBoundedSendOtpLimit(key: string, limit: number, windowMs = SEND_OTP_WINDOW_MS): {
  allowed: boolean
  retryAfterSec: number
} {
  const now = Date.now()
  if (sendOtpBuckets.size >= MAX_SEND_OTP_BUCKETS && !sendOtpBuckets.has(key)) {
    for (const [k, arr] of sendOtpBuckets) {
      const valid = arr.filter((t) => now - t < windowMs)
      if (valid.length === 0) sendOtpBuckets.delete(k)
      else sendOtpBuckets.set(k, valid)
    }
    if (sendOtpBuckets.size >= MAX_SEND_OTP_BUCKETS) {
      const oldest = sendOtpBuckets.keys().next().value
      if (oldest) sendOtpBuckets.delete(oldest)
    }
  }
  const hits = (sendOtpBuckets.get(key) || []).filter((t) => now - t < windowMs)
  if (hits.length >= limit) {
    sendOtpBuckets.set(key, hits)
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000))
    return { allowed: false, retryAfterSec }
  }
  hits.push(now)
  sendOtpBuckets.set(key, hits)
  return { allowed: true, retryAfterSec: 0 }
}

function isAllowedAppReviewPhone(phone10: string): boolean {
  if (process.env.ENABLE_APP_REVIEW_TEST_ACCOUNTS === 'false') return false
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_REVIEWER_TEST_OTP !== 'true') {
    return false
  }
  return APP_REVIEW_ALLOWED_PHONES.has(phone10)
}

function normalizeUsPhone10(raw?: string): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1)
  }
  return digits
}

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}

export async function POST(request: Request): Promise<NextResponse> {
  const headers = corsHeaders()
  const isEn = (request.headers.get('Accept-Language') || '').toLowerCase().startsWith('en')
  try {
    const trustedIp = extractTrustedClientIp(request.headers)
    const clientIp = trustedIp === 'unknown' ? null : trustedIp
    const ipRl = checkBoundedSendOtpLimit(`ip:${trustedIp}`, IP_SEND_OTP_LIMIT)
    if (!ipRl.allowed) {
      return NextResponse.json(
        {
          ok: false,
          code: 'RATE_LIMITED',
          error: isEn
            ? `Too many OTP requests. Please wait ${ipRl.retryAfterSec}s before trying again.`
            : `Demasiadas solicitudes de código. Espera ${ipRl.retryAfterSec}s antes de intentar de nuevo.`,
        },
        {
          status: 429,
          headers: { ...headers, 'Retry-After': String(ipRl.retryAfterSec) },
        }
      )
    }

    let body: { email?: string; phone?: string; identifier?: string }
    try {
      body = (await request.json()) as { email?: string; phone?: string; identifier?: string }
    } catch {
      return NextResponse.json(
        {
          ok: false,
          code: 'VALIDATION_ERROR',
          error: isEn ? 'Invalid JSON request body.' : 'Cuerpo JSON de solicitud inválido.',
        },
        { status: 400, headers }
      )
    }

    const rawEmailCandidate = (body.email || body.identifier || body.phone || '').trim()

    // -------------------------------------------------------------------------
    // CASO A: Autenticación por Correo Electrónico Real (Opción 1 Principal)
    // -------------------------------------------------------------------------
    if (rawEmailCandidate.includes('@')) {
      const cleanEmail = rawEmailCandidate.toLowerCase()
      if (!EMAIL_REGEX.test(cleanEmail) || cleanEmail.length > 120) {
        return NextResponse.json(
          {
            ok: false,
            code: 'INVALID_EMAIL',
            error: isEn
              ? 'Please enter a valid email address.'
              : 'Por favor ingresa un correo electrónico válido.',
          },
          { status: 400, headers }
        )
      }

      const rl = await checkEmailOtpRateLimit(cleanEmail, clientIp)
      if (!rl.allowed) {
        const retrySec = rl.retryAfterSec || 60
        return NextResponse.json(
          {
            ok: false,
            code: rl.reason === 'locked' ? 'OTP_LOCKED' : 'RATE_LIMITED',
            error:
              rl.reason === 'locked'
                ? isEn
                  ? 'Too many failed verification attempts. Please wait 15 minutes before trying again.'
                  : 'Demasiados intentos fallidos. Espera 15 minutos antes de intentar de nuevo.'
                : isEn
                  ? `Please wait ${retrySec}s before requesting another verification code.`
                  : `Espera ${retrySec}s antes de solicitar otro código de verificación.`,
          },
          {
            status: 429,
            headers: {
              ...headers,
              'Retry-After': String(retrySec),
            },
          }
        )
      }

      const code = generateEmailOtpCode(cleanEmail)
      const challengeId = await issueEmailOtpChallenge(cleanEmail, code, clientIp)

      const emailResult = await sendMobileOtpEmail(cleanEmail, code, isEn)
      if (!emailResult.ok) {
        await revokeEmailOtpChallenge(challengeId).catch(() => {})
        return NextResponse.json(
          {
            ok: false,
            code: 'OTP_SEND_FAILED',
            error:
              emailResult.error ||
              (isEn
                ? 'Could not send verification email. Please try again.'
                : 'No se pudo enviar el correo de verificación. Inténtalo de nuevo.'),
          },
          { status: 500, headers }
        )
      }

      return NextResponse.json(
        {
          ok: true,
          success: true,
          channel: 'email',
          message: isEn
            ? '6-digit verification code sent to your email'
            : 'Código de verificación de 6 dígitos enviado a tu correo',
        },
        { status: 200, headers }
      )
    }

    // -------------------------------------------------------------------------
    // CASO B: Número Telefónico (Soporte de Revisión Apple/Google + Rate Limit)
    // -------------------------------------------------------------------------
    const phone = normalizeUsPhone10(rawEmailCandidate)

    if (!phone) {
      return NextResponse.json(
        {
          ok: false,
          code: 'INVALID_IDENTIFIER',
          error: isEn
            ? 'Email address is required.'
            : 'El correo electrónico es requerido.',
        },
        { status: 400, headers }
      )
    }

    const phoneRegex = /^\d{10}$/
    if (!phoneRegex.test(phone)) {
      return NextResponse.json(
        {
          ok: false,
          code: 'INVALID_PHONE',
          error: isEn
            ? 'Please enter a valid email address or 10-digit phone number.'
            : 'Ingresa un correo electrónico válido o un número de 10 dígitos.',
        },
        { status: 400, headers }
      )
    }

    const phoneRl = checkBoundedSendOtpLimit(`phone:${phone}`, IDENTIFIER_SEND_OTP_LIMIT)
    if (!phoneRl.allowed) {
      return NextResponse.json(
        {
          ok: false,
          code: 'RATE_LIMITED',
          error: isEn
            ? `Please wait ${phoneRl.retryAfterSec}s before requesting another code.`
            : `Espera ${phoneRl.retryAfterSec}s antes de solicitar otro código.`,
        },
        {
          status: 429,
          headers: { ...headers, 'Retry-After': String(phoneRl.retryAfterSec) },
        }
      )
    }

    if (isAllowedAppReviewPhone(phone)) {
      return NextResponse.json(
        {
          ok: true,
          success: true,
          channel: 'phone',
          message: isEn ? 'Verification code sent' : 'Código enviado',
        },
        { status: 200, headers }
      )
    }

    const phoneE164 = `+1${phone}`

    const { error: otpError } = await supabaseAdmin.auth.signInWithOtp({
      phone: phoneE164,
    })

    if (otpError) {
      console.error('[MOBILE AUTH] Error al enviar OTP SMS:', otpError.message)

      if (otpError.message.toLowerCase().includes('unsupported phone provider')) {
        return NextResponse.json(
          {
            ok: false,
            code: 'SMS_PROVIDER_UNAVAILABLE',
            error: isEn
              ? 'Please enter your email address to receive your 6-digit verification code immediately.'
              : 'Por favor ingresa tu correo electrónico para recibir tu código de verificación de 6 dígitos al instante.',
          },
          { status: 400, headers }
        )
      }

      return NextResponse.json(
        {
          ok: false,
          code: 'OTP_SEND_FAILED',
          error: isEn
            ? 'Please enter your email address to receive your 6-digit verification code.'
            : 'Por favor ingresa tu correo electrónico para recibir tu código de 6 dígitos.',
        },
        { status: 400, headers }
      )
    }

    return NextResponse.json(
      { ok: true, success: true, channel: 'phone', message: isEn ? 'Verification code sent' : 'Código enviado' },
      { status: 200, headers }
    )
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[MOBILE AUTH] Error inesperado en send-otp:', errorMessage)

    return NextResponse.json(
      {
        ok: false,
        code: 'INTERNAL_ERROR',
        error: isEn ? 'Internal server error. Please try again.' : 'Error interno del servidor. Intenta de nuevo.',
      },
      { status: 500, headers }
    )
  }
}
