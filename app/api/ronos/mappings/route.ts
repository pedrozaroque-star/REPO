/**
 * @module app/api/ronos/mappings/route
 * @description API endpoint para consultar y guardar vinculaciones entre empleados de RONOS y Toast (Planificador).
 *
 * @businessRules
 *   - Los mapeos guardados manualmente en Supabase prevalecen sobre el auto-match heurístico.
 *   - Devuelve la lista completa de candidatos de Toast para facilitar la selección en el dropdown.
 *
 * @dataFlow
 *   GET: /api/ronos/mappings?companyId=34 -> getStoreEmployeeMappings() -> JSON.
 *   POST: /api/ronos/mappings { companyId, ronosUserId, toastEmployeeId, ... } -> saveEmployeeMapping() -> JSON.
 */

import { NextResponse } from 'next/server'
import { getStoreEmployeeMappings, saveEmployeeMapping } from '@/lib/ronos-mapping'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const companyIdParam = searchParams.get('companyId')
    const companyId = companyIdParam ? parseInt(companyIdParam, 10) : 34

    const result = await getStoreEmployeeMappings(companyId)

    return NextResponse.json({
      success: true,
      data: result
    })
  } catch (error: any) {
    console.error('Error in GET /api/ronos/mappings:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Error al obtener mapeos de personal' },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      ronosEmployeeUserId,
      ronosEmployeeId,
      ronosCompanyId,
      ronosFullName,
      ronosPin,
      ronosJobTitle,
      toastEmployeeId,
      toastGuid,
      toastFullName,
      toastEmail,
      mappingType = 'manual',
      isConfirmed = true,
      notes
    } = body

    if (!ronosEmployeeUserId || !ronosCompanyId) {
      return NextResponse.json(
        { success: false, error: 'Faltan parámetros obligatorios: ronosEmployeeUserId, ronosCompanyId' },
        { status: 400 }
      )
    }

    const result = await saveEmployeeMapping({
      ronosEmployeeUserId,
      ronosEmployeeId,
      ronosCompanyId,
      ronosFullName,
      ronosPin,
      ronosJobTitle,
      toastEmployeeId,
      toastGuid,
      toastFullName,
      toastEmail,
      mappingType,
      isConfirmed,
      notes
    })

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Mapeo guardado exitosamente' })
  } catch (error: any) {
    console.error('Error in POST /api/ronos/mappings:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Error al guardar mapeo de personal' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const ronosUserId = searchParams.get('ronosUserId')
    const companyId = searchParams.get('companyId')

    if (!ronosUserId || !companyId) {
      return NextResponse.json(
        { success: false, error: 'Faltan parámetros obligatorios: ronosUserId, companyId' },
        { status: 400 }
      )
    }

    const { error } = await supabaseAdmin
      .from('ronos_employee_mappings')
      .delete()
      .eq('ronos_employee_user_id', parseInt(ronosUserId, 10))
      .eq('ronos_company_id', parseInt(companyId, 10))

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Mapeo eliminado exitosamente' })
  } catch (error: any) {
    console.error('Error in DELETE /api/ronos/mappings:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Error al eliminar mapeo' },
      { status: 500 }
    )
  }
}

