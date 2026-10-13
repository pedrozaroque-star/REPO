/**
 * @module app/api/delivery-armor/verify-pin/route
 * @description Endpoint para validar el PIN de 4 dígitos de colaboradores (cajeras, empacadores, cocineros) contra RONOS (Cingular HR).
 *
 * @businessRules
 *   - El PIN del empleado se obtiene y valida contra RONOS, NUNCA de Toast.
 *   - Si el colaborador está asignado a la sucursal o transferido, se autoriza su acceso.
 *
 * @dataFlow
 *   Client Tablet -> POST { storeId, pin } -> verifyRonosPin() -> Supabase RONOS cache -> Response JSON.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyRonosPin } from '@/lib/delivery-armor'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { storeId, pin } = body

    if (!storeId || !pin) {
      return NextResponse.json({
        ok: false,
        error: 'storeId y pin son campos obligatorios.'
      }, { status: 400 })
    }

    const verification = await verifyRonosPin(Number(storeId), String(pin))

    if (!verification.valid) {
      return NextResponse.json({
        ok: false,
        error: verification.error || 'PIN no válido en RONOS.'
      }, { status: 401 })
    }

    return NextResponse.json({
      ok: true,
      verified: true,
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
    console.error('Error en /api/delivery-armor/verify-pin:', err)
    return NextResponse.json({
      ok: false,
      error: 'Error al verificar PIN de RONOS'
    }, { status: 500 })
  }
}
