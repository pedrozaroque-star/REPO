/**
 * @module app/api/mobile/auth/send-otp/route
 * @description Endpoint de envío de código OTP vía SMS para autenticación de comensales en Tacos Gavilan App.
 *
 * @businessRules
 * - Normaliza y valida que el número telefónico tenga exactamente 10 dígitos numéricos de EE. UU. y lo formatea a E.164 (`+1XXXXXXXXXX`).
 * - Soporta números oficiales de prueba NANPA/FCC (`^\d{3}55501\d{2}$`, ej. `2135550199`) para revisiones de Apple App Store Review y Google Play Review.
 * - Delega la emisión y envío de SMS a Supabase Auth (`supabaseAdmin.auth.signInWithOtp`).
 * - La creación/vinculación del perfil en `public.app_users` ocurre determinísticamente al verificar el OTP en `/api/mobile/auth/verify-otp`.
 *
 * @dataFlow
 * - App Móvil POST `/api/mobile/auth/send-otp` -> `supabaseAdmin.auth.signInWithOtp` -> Proveedor SMS de Supabase.
 *
 * @notes
 * - Usa `corsHeaders()` y `corsResponse()` de `@/app/api/mobile/_helpers` para soportar preflight `OPTIONS` (`HTTP 204`) con cabeceras móviles completas.
 * - Responde en inglés o español según la cabecera `Accept-Language`.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { corsHeaders, corsResponse } from '@/app/api/mobile/_helpers'

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
    let body: { phone?: string }
    try {
      body = (await request.json()) as { phone?: string }
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

    const phone = normalizeUsPhone10(body.phone)

    if (!phone) {
      return NextResponse.json(
        {
          ok: false,
          code: 'INVALID_PHONE',
          error: isEn ? 'Phone number is required.' : 'El número de teléfono es requerido.',
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
            ? 'Phone number must be exactly 10 digits.'
            : 'El teléfono debe tener exactamente 10 dígitos numéricos.',
        },
        { status: 400, headers }
      )
    }

    // Soporte determinístico para cuentas de revisión de Apple App Store / Google Play (rango reservado 555-01XX)
    if (APP_REVIEW_TEST_PHONE_REGEX.test(phone)) {
      return NextResponse.json(
        { ok: true, success: true, message: isEn ? 'Verification code sent' : 'Código enviado' },
        { status: 200, headers }
      )
    }

    const phoneE164 = `+1${phone}`

    const { error: otpError } = await supabaseAdmin.auth.signInWithOtp({
      phone: phoneE164,
    })

    if (otpError) {
      console.error('[MOBILE AUTH] Error al enviar OTP:', otpError.message)

      if (otpError.message.includes('rate') || otpError.message.includes('limit')) {
        return NextResponse.json(
          {
            ok: false,
            code: 'RATE_LIMITED',
            error: isEn
              ? 'Too many attempts. Please wait a moment before trying again.'
              : 'Demasiados intentos. Espera un momento antes de intentar de nuevo.',
          },
          { status: 429, headers }
        )
      }

      if (otpError.message.toLowerCase().includes('unsupported phone provider')) {
        return NextResponse.json(
          {
            ok: false,
            code: 'SMS_PROVIDER_UNAVAILABLE',
            error: isEn
              ? 'SMS delivery is temporarily under maintenance. You can continue as a guest to order immediately.'
              : 'El envío de SMS está en mantenimiento temporal. Puedes continuar como invitado para ordenar de inmediato.',
          },
          { status: 503, headers }
        )
      }

      return NextResponse.json(
        {
          ok: false,
          code: 'OTP_SEND_FAILED',
          error: isEn
            ? 'Could not send verification code. Please try again later.'
            : 'No se pudo enviar el código. Intenta de nuevo más tarde.',
        },
        { status: 500, headers }
      )
    }

    return NextResponse.json(
      { ok: true, success: true, message: isEn ? 'Verification code sent' : 'Código enviado' },
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
