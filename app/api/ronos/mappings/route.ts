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
 *
 * @notes
 *   - Soporta `companyId=0` para consultar la consolidación de mapeos de toda la cadena (400+ colaboradores).
 */

import { NextResponse } from 'next/server'
import { getStoreEmployeeMappings, saveEmployeeMapping } from '@/lib/ronos-mapping'
import { RONOS_STORES_MAP, getDynamicRonosStores } from '@/lib/ronos-api'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyAdminAuth } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const auth = verifyAdminAuth(req)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status || 401 }
      )
    }

    const { searchParams } = new URL(req.url)

    // 1. Bloqueo inmediato de format=csv
    const formatParam = searchParams.get('format')
    if (formatParam && formatParam.toLowerCase() === 'csv') {
      return NextResponse.json(
        { success: false, error: 'El formato CSV no está permitido por razones de seguridad.' },
        { status: 400 }
      )
    }

    const companyIdParam = searchParams.get('companyId')
    // Validación estricta con regex: sólo numérico o 'all'/'chain'
    if (companyIdParam !== null && companyIdParam !== 'all' && companyIdParam !== 'chain' && !/^\d+$/.test(companyIdParam)) {
      return NextResponse.json(
        { success: false, error: 'Parámetro companyId inválido: debe ser numérico o all/chain' },
        { status: 400 }
      )
    }

    const weekIdParam = searchParams.get('weekId')
    const targetWeekId = weekIdParam && /^\d+$/.test(weekIdParam) ? parseInt(weekIdParam, 10) : undefined

    const isChain = companyIdParam === '0' || companyIdParam === 'all' || companyIdParam === 'chain'
    const companyId = isChain ? 0 : (companyIdParam ? parseInt(companyIdParam, 10) : 34)

    let result
    if (isChain) {
      const storesList = await getDynamicRonosStores()
      const allResults = await Promise.all(
        storesList.map(s => getStoreEmployeeMappings(s.ronosCompanyId, targetWeekId).catch(() => null))
      )
      const valid = allResults.filter(Boolean) as any[]
      const combinedMappings = valid.flatMap(v => v.mappings || [])
      const combinedCandidates = valid.flatMap(v => v.toastCandidates || [])
      const uniqueCandidatesMap = new Map<string, any>()
      combinedCandidates.forEach(c => {
        if (c?.id && !uniqueCandidatesMap.has(c.id)) uniqueCandidatesMap.set(c.id, c)
      })

      result = {
        mappings: combinedMappings,
        toastCandidates: Array.from(uniqueCandidatesMap.values()),
        stats: {
          totalRonos: combinedMappings.length,
          autoMatched: combinedMappings.filter(m => m.mappingType === 'auto').length,
          manuallyMatched: combinedMappings.filter(m => m.mappingType === 'manual').length,
          inactive: combinedMappings.filter(m => m.mappingType === 'inactive').length,
          unmapped: combinedMappings.filter(m => m.mappingType === 'unmapped').length
        },
        storeName: 'Cadena Completa (16 Ubicaciones)',
        periodLabel: targetWeekId ? `Semana #${targetWeekId}` : 'Semana Actual'
      }
    } else {
      result = await getStoreEmployeeMappings(companyId, targetWeekId)
    }

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
    const auth = verifyAdminAuth(req)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status || 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    if (searchParams.get('format')?.toLowerCase() === 'csv') {
      return NextResponse.json(
        { success: false, error: 'El formato CSV no está permitido por razones de seguridad.' },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => ({}))

    if (body.format && String(body.format).toLowerCase() === 'csv') {
      return NextResponse.json(
        { success: false, error: 'El formato CSV no está permitido por razones de seguridad.' },
        { status: 400 }
      )
    }

    const rawCompanyId = body.ronosCompanyId ?? body.companyId
    if (rawCompanyId === undefined || rawCompanyId === null || !/^\d+$/.test(String(rawCompanyId))) {
      return NextResponse.json(
        { success: false, error: 'Parámetro companyId / ronosCompanyId inválido o no numérico' },
        { status: 400 }
      )
    }

    const targetCompanyId = parseInt(String(rawCompanyId), 10)
    if (targetCompanyId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Parámetro companyId debe ser mayor a 0 para asignar mapeo' },
        { status: 400 }
      )
    }

    // Desactivación permanente de auto-vinculación masiva ciega por coincidencia de nombre (FASE 3)
    if (body.autoMapAll) {
      return NextResponse.json(
        {
          success: false,
          error: 'La auto-vinculación masiva por nombre ha sido desactivada por integridad operativa. Utilice la cola de revisión manual supervisada.'
        },
        { status: 400 }
      )
    }

    // Guardado individual supervisado
    const {
      ronosEmployeeUserId,
      ronosEmployeeId,
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

    if (ronosEmployeeUserId === undefined || ronosEmployeeUserId === null || !/^\d+$/.test(String(ronosEmployeeUserId))) {
      return NextResponse.json(
        { success: false, error: 'Parámetro ronosEmployeeUserId inválido o no numérico' },
        { status: 400 }
      )
    }

    if (ronosEmployeeId !== undefined && ronosEmployeeId !== null && !/^\d+$/.test(String(ronosEmployeeId))) {
      return NextResponse.json(
        { success: false, error: 'Parámetro ronosEmployeeId inválido: debe ser numérico' },
        { status: 400 }
      )
    }

    // Normalización: No almacenar strings 'INACTIVE' o 'UNLINK' en columna UUID toast_employee_id
    const isInactive = toastEmployeeId === 'INACTIVE' || mappingType === 'inactive'
    const isUnlink = toastEmployeeId === 'UNLINK' || mappingType === 'unmapped' || (!isInactive && !toastEmployeeId)
    const cleanToastEmployeeId = (isInactive || isUnlink) ? null : (toastEmployeeId || null)
    const finalMappingType: 'auto' | 'manual' | 'inactive' | 'unmapped' = isInactive
      ? 'inactive'
      : isUnlink
      ? 'unmapped'
      : (mappingType === 'auto' ? 'auto' : 'manual')

    const result = await saveEmployeeMapping({
      ronosEmployeeUserId: Number(ronosEmployeeUserId),
      ronosEmployeeId: Number(ronosEmployeeId || 0),
      ronosCompanyId: targetCompanyId,
      ronosFullName: String(ronosFullName || ''),
      ronosPin: String(ronosPin || ''),
      ronosJobTitle: String(ronosJobTitle || 'Colaborador'),
      toastEmployeeId: cleanToastEmployeeId,
      toastGuid: isInactive || isUnlink ? null : (toastGuid || null),
      toastFullName: isInactive ? 'INACTIVO / NO LABORA' : (isUnlink ? null : (toastFullName || null)),
      toastEmail: isInactive || isUnlink ? null : (toastEmail || null),
      mappingType: finalMappingType,
      isConfirmed: isInactive ? true : (isUnlink ? false : isConfirmed),
      notes: isInactive
        ? (notes || 'Marcado inactivo en revisión manual')
        : isUnlink
        ? (notes || 'Desvinculado manualmente')
        : notes
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
    const auth = verifyAdminAuth(req)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status || 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    if (searchParams.get('format')?.toLowerCase() === 'csv') {
      return NextResponse.json(
        { success: false, error: 'El formato CSV no está permitido por razones de seguridad.' },
        { status: 400 }
      )
    }

    const ronosUserId = searchParams.get('ronosUserId')
    const companyId = searchParams.get('companyId')

    if (!ronosUserId || !/^\d+$/.test(ronosUserId)) {
      return NextResponse.json(
        { success: false, error: 'Parámetro ronosUserId inválido o no numérico' },
        { status: 400 }
      )
    }

    if (!companyId || !/^\d+$/.test(companyId)) {
      return NextResponse.json(
        { success: false, error: 'Parámetro companyId inválido o no numérico' },
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

