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

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const companyIdParam = searchParams.get('companyId')
    const isChain = companyIdParam === '0' || companyIdParam === 'all' || companyIdParam === 'chain'
    const companyId = isChain ? 0 : (companyIdParam ? parseInt(companyIdParam, 10) : 34)

    let result
    if (isChain) {
      const storesList = await getDynamicRonosStores()
      const allResults = await Promise.all(
        storesList.map(s => getStoreEmployeeMappings(s.ronosCompanyId).catch(() => null))
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
        }
      }
    } else {
      result = await getStoreEmployeeMappings(companyId)
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
    const body = await req.json()
    const targetCompanyId = Number(body.ronosCompanyId || body.companyId)

    if (!targetCompanyId) {
      return NextResponse.json(
        { success: false, error: 'Falta parámetro obligatorio: companyId / ronosCompanyId' },
        { status: 400 }
      )
    }

    // Caso A: Auto-Vincular Todo por Lote (Auto-Map All)
    if (body.autoMapAll) {
      const storeMappings = await getStoreEmployeeMappings(targetCompanyId)
      const autoMatches = storeMappings.mappings.filter(m => m.mappingType === 'auto' && m.toastEmployeeId)

      let savedCount = 0
      for (const item of autoMatches) {
        if (!item.toastEmployeeId) continue
        await saveEmployeeMapping({
          ronosEmployeeUserId: item.ronosEmployeeUserId,
          ronosEmployeeId: item.ronosEmployeeId,
          ronosCompanyId: targetCompanyId,
          ronosFullName: item.ronosFullName,
          ronosPin: item.ronosPin,
          ronosJobTitle: item.ronosJobTitle,
          toastEmployeeId: item.toastEmployeeId,
          toastGuid: item.toastGuid,
          toastFullName: item.toastFullName,
          toastEmail: item.toastEmail,
          mappingType: 'auto',
          isConfirmed: true,
          notes: 'Auto-vinculado por coincidencia de PIN y nombre'
        })
        savedCount++
      }

      return NextResponse.json({
        success: true,
        message: `Se vincularon automáticamente ${savedCount} colaboradores`,
        savedCount
      })
    }

    // Caso B: Guardado Individual
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

    if (!ronosEmployeeUserId) {
      return NextResponse.json(
        { success: false, error: 'Faltan parámetros obligatorios: ronosEmployeeUserId' },
        { status: 400 }
      )
    }

    const result = await saveEmployeeMapping({
      ronosEmployeeUserId: Number(ronosEmployeeUserId),
      ronosEmployeeId: Number(ronosEmployeeId || 0),
      ronosCompanyId: targetCompanyId,
      ronosFullName: String(ronosFullName || ''),
      ronosPin: String(ronosPin || ''),
      ronosJobTitle: String(ronosJobTitle || 'Colaborador'),
      toastEmployeeId: toastEmployeeId === 'INACTIVE' || toastEmployeeId === 'UNLINK' ? toastEmployeeId : toastEmployeeId || null,
      toastGuid: toastGuid || null,
      toastFullName: toastFullName || null,
      toastEmail: toastEmail || null,
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

