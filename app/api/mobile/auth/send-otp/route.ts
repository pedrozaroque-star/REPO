/**
 * @module app/api/mobile/auth/send-otp/route
 * @description Endpoint de envío de código OTP vía SMS para autenticación de comensales en Tacos Gavilan App.
 *
 * @businessRules
 * - Valida que el número telefónico tenga exactamente 10 dígitos numéricos de EE. UU. y lo formatea a E.164 (`+1XXXXXXXXXX`).
 * - Delega la emisión y envío de SMS a Supabase Auth (`supabaseAdmin.auth.signInWithOtp`).
 * - La creación/vinculación del perfil en `public.app_users` ocurre determinísticamente al verificar el OTP en `/api/mobile/auth/verify-otp`.
 *
 * @dataFlow
 * - App Móvil POST `/api/mobile/auth/send-otp` -> `supabaseAdmin.auth.signInWithOtp` -> Proveedor SMS de Supabase.
 *
 * @notes
 * - Maneja límites de tasa (`HTTP 429`) y errores de proveedor sin simular envíos exitosos.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return NextResponse.json(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { phone?: string }
    const phone = body.phone?.trim()

    if (!phone) {
      return NextResponse.json(
        { ok: false, error: 'El número de teléfono es requerido.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const phoneRegex = /^\d{10}$/
    if (!phoneRegex.test(phone)) {
      return NextResponse.json(
        { ok: false, error: 'El teléfono debe tener exactamente 10 dígitos numéricos.' },
        { status: 400, headers: CORS_HEADERS }
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
