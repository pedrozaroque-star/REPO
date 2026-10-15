/**
 * @module app/api/delivery-armor/verify-pin/route
 * @description Endpoint para validar el PIN de 4 dígitos de colaboradores contra RONOS y gestionar la sesión única activa por tienda.
 *
 * @businessRules
 *   - El PIN del empleado se obtiene y valida contra RONOS, NUNCA de Toast.
 *   - Solo puede existir 1 sesión de PIN activa por sucursal (`storeId`): si otra persona inicia sesión en esa tienda, la sesión anterior se invalida inmediatamente.
 *   - La sesión expira automáticamente tras 10 minutos sin actividad.
 *
 * @dataFlow
 *   Client Tablet -> POST/PUT/DELETE { storeId, pin / sessionToken } -> verifyRonosPin() + registerExclusiveStorePinSession() -> Supabase -> Response JSON.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  verifyRonosPin,
  registerExclusiveStorePinSession,
  touchActiveStorePinSession,
  clearActiveStorePinSession
} from '@/lib/delivery-armor'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { storeId, pin } = body

    if (!storeId || !pin) {
      return NextResponse.json(
        {
          ok: false,
          error: 'storeId y pin son campos obligatorios.'
        },
        { status: 400 }
      )
    }

    const numericStoreId = Number(storeId)
    const verification = await verifyRonosPin(numericStoreId, String(pin))

    if (!verification.valid || !verification.employeeUserId || !verification.fullName) {
      return NextResponse.json(
        {
          ok: false,
          error: verification.error || 'PIN no válido en RONOS.'
        },
        { status: 401 }
      )
    }

    const session = await registerExclusiveStorePinSession({
      storeId: numericStoreId,
      employeeUserId: verification.employeeUserId,
      employeeName: verification.fullName,
      jobTitle: verification.jobTitle || 'Colaborador'
    })

    return NextResponse.json({
      ok: true,
      verified: true,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      session,
      employee: {
        id: verification.employeeUserId,
        employee_id: verification.employeeUserId,
        fullName: verification.fullName,
        full_name: verification.fullName,
        jobTitle: verification.jobTitle,
        job_title: verification.jobTitle
      }
    })
  } catch (err: any) {
    console.error('Error en POST /api/delivery-armor/verify-pin:', err)
    return NextResponse.json(
      {
        ok: false,
        error: 'Error al verificar PIN de RONOS'
      },
      { status: 500 }
    )
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const storeId = Number(body.storeId)
    const sessionToken = String(body.sessionToken || '').trim()

    if (!storeId || !sessionToken) {
      return NextResponse.json({ ok: false, valid: false }, { status: 400 })
    }

    const check = await touchActiveStorePinSession(storeId, sessionToken)
    if (!check.valid) {
      return NextResponse.json(
        {
          ok: false,
          valid: false,
          replacedBy: check.replacedBy || null,
          expired: !!check.expired
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      ok: true,
      valid: true,
      session: check.session
    })
  } catch {
    return NextResponse.json({ ok: false, valid: false }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const storeId = Number(body.storeId)
    const sessionToken = body.sessionToken ? String(body.sessionToken) : undefined

    if (storeId > 0) {
      await clearActiveStorePinSession(storeId, sessionToken)
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}

