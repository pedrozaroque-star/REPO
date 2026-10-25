/**
 * @module app/api/mobile/auth/send-otp/route
 * @description Endpoint de envío de código OTP de 6 dígitos (vía Correo Electrónico Real con Gmail SMTP
 * de Tacos Gavilan + soporte determinístico de números de prueba NANPA/FCC para Apple/Google App Review).
 *
 * @businessRules
 * - Acepta correo electrónico (`email` / `identifier` / `phone` con `@`) y envía al instante un código real de 6 dígitos
 *   mediante el transporte SMTP oficial de Tacos Gavilan (`lib/mobile-auth-email.ts`), guardando el hash HMAC-SHA256
 *   con vigencia de 10 minutos en `auth.users`.
 * - Conserva soporte determinístico para números oficiales de prueba NANPA/FCC (`^\d{3}55501\d{2}$`, ej. `2135550199`)
 *   y correos de revisión (`reviewer@tacosgavilan.com`) para Apple App Store Review y Google Play Review.
 *
 * @dataFlow
 * - App Móvil POST `/api/mobile/auth/send-otp` -> `saveEmailOtpForUser` + `sendMobileOtpEmail` -> Buzón del comensal.
 *
 * @notes
 * - Usa `corsHeaders()` y `corsResponse()` de `@/app/api/mobile/_helpers` para soportar preflight `OPTIONS` (`HTTP 204`).
 * - Responde en inglés o español según la cabecera `Accept-Language`.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { corsHeaders, corsResponse } from '@/app/api/mobile/_helpers'
import {
  EMAIL_REGEX,
  generateEmailOtpCode,
  saveEmailOtpForUser,
  sendMobileOtpEmail,
} from '@/lib/mobile-auth-email'

const APP_REVIEW_TEST_PHONE_REGEX = /^\d{3}55501\d{2}$/

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

      const code = generateEmailOtpCode(cleanEmail)
      await saveEmailOtpForUser(cleanEmail, code)

      const emailResult = await sendMobileOtpEmail(cleanEmail, code, isEn)
      if (!emailResult.ok) {
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
    // CASO B: Número Telefónico (Soporte de Revisión Apple/Google 213-555-0199)
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

    // Soporte determinístico para cuentas de revisión de Apple App Store / Google Play (rango reservado 555-01XX)
    if (APP_REVIEW_TEST_PHONE_REGEX.test(phone)) {
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
