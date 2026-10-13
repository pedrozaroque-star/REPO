/**
 * @module app/api/delivery-armor/audit/route
 * @description Endpoint de mutación para registrar cuatro controles rápidos, evidencia según riesgo y la liberación validada al chofer.
 *
 * @businessRules
 *   - Prohíbe columnas generadas en payloads de mutación.
 *   - Valida que el colaborador tenga un registro de RONOS válido.
 *   - POST: Guarda progreso de empaque y fotos.
 *   - PUT: Registra la entrega final al chofer con PIN de RONOS del colaborador.
 *
 * @dataFlow
 *   Client Tablet -> POST / PUT -> saveAuditProgress() / confirmHandoffToDriver() -> delivery_packing_audits -> Response JSON.
 */

import { NextRequest, NextResponse } from 'next/server'
import { saveAuditProgress, confirmHandoffToDriver } from '@/lib/delivery-armor'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      storeId,
      store_id,
      toastOrderGuid,
      order_guid,
      toastDisplayNumber,
      ticket_number,
      platform,
      diningOptionGuid,
      diningOptionName,
      dining_option_name,
      customerName,
      customer_name,
      orderOpenedAt,
      opened_at,
      itemsJson,
      items_ordered,
      matchedItems,
      matchCompleted,
      photoOpenUrl,
      photo_open_content_url,
      photoSealedUrl,
      photo_sealed_bag_url,
      packerRonosUserId,
      packer_employee_id,
      packerRonosName,
      packer_name,
      packerPin,
      packer_pin,
      quickChecks,
      quick_checks,
      expectedBagCount,
      expected_bag_count,
      confirmedBagCount,
      confirmed_bag_count,
      riskLevel,
      risk_level,
      riskReasons,
      risk_reasons,
      evidencePolicy,
      evidence_policy
    } = body

    const targetStoreId = Number(storeId || store_id)
    const targetOrderGuid = toastOrderGuid || order_guid
    const targetItems = itemsJson || items_ordered

    if (!targetStoreId || !targetOrderGuid || !targetItems) {
      return NextResponse.json({
        ok: false,
        error: 'Faltan campos obligatorios (storeId, toastOrderGuid, itemsJson).'
      }, { status: 400 })
    }

    const audit = await saveAuditProgress({
      storeId: targetStoreId,
      toastOrderGuid: targetOrderGuid,
      toastDisplayNumber: String(toastDisplayNumber || ticket_number || 'S/N'),
      platform: platform || 'OTHER',
      diningOptionGuid,
      diningOptionName: diningOptionName || dining_option_name,
      customerName: customerName || customer_name,
      orderOpenedAt: orderOpenedAt || opened_at,
      itemsJson: targetItems,
      matchedItems: Array.isArray(matchedItems) ? matchedItems : [],
      matchCompleted: matchCompleted !== undefined ? !!matchCompleted : (!!photoOpenUrl && !!photoSealedUrl),
      photoOpenUrl: photoOpenUrl || photo_open_content_url,
      photoSealedUrl: photoSealedUrl || photo_sealed_bag_url,
      packerRonosUserId: packerRonosUserId || packer_employee_id ? Number(packerRonosUserId || packer_employee_id) : undefined,
      packerRonosName: packerRonosName || packer_name,
      packerPin: packerPin || packer_pin,
      quickChecks: quickChecks || quick_checks || {},
      expectedBagCount: Number(expectedBagCount || expected_bag_count || 1),
      confirmedBagCount: Number(confirmedBagCount || confirmed_bag_count || 1),
      riskLevel: riskLevel || risk_level || 'NORMAL',
      riskReasons: Array.isArray(riskReasons || risk_reasons) ? (riskReasons || risk_reasons) : [],
      evidencePolicy: evidencePolicy || evidence_policy || 'NONE'
    })

    return NextResponse.json({
      ok: true,
      audit
    })
  } catch (err: any) {
    console.error('Error en POST /api/delivery-armor/audit:', err)
    return NextResponse.json({
      ok: false,
      error: err?.message || 'Error al guardar progreso de auditoría'
    }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      toastOrderGuid,
      order_guid,
      storeId,
      store_id,
      handedByRonosUserId,
      handedByRonosName,
      handedPin,
      handoff_pin,
      driverName,
      courier_name,
      driverConfirmed,
      courier_verified,
      verificationMethod,
      verification_method,
      courierOrderReference,
      courier_order_reference,
      livePickupConfirmed,
      live_pickup_confirmed
    } = body

    const targetOrderGuid = toastOrderGuid || order_guid
    const targetPin = String(handedPin || handoff_pin || '').trim()
    const targetStoreId = Number(storeId || store_id)

    if (!targetOrderGuid || !targetPin || !targetStoreId) {
      return NextResponse.json({
        ok: false,
        error: 'Faltan campos obligatorios para entrega al chofer (orderGuid, PIN).'
      }, { status: 400 })
    }

    const targetMethod = verificationMethod || verification_method
    if (!['DOORDASH_QR', 'PLATFORM_ORDER_ID', 'APP_ORDER_SCREEN'].includes(targetMethod)) {
      return NextResponse.json({ ok: false, error: 'Método de verificación del chofer inválido.' }, { status: 400 })
    }

    const audit = await confirmHandoffToDriver({
      toastOrderGuid: targetOrderGuid,
      storeId: targetStoreId,
      handedByRonosUserId: Number(handedByRonosUserId || 0),
      handedByRonosName: handedByRonosName || 'Colaborador',
      handedPin: targetPin,
      driverName: driverName || courier_name,
      driverConfirmed: driverConfirmed !== undefined ? !!driverConfirmed : !!courier_verified,
      verificationMethod: targetMethod as 'DOORDASH_QR' | 'PLATFORM_ORDER_ID' | 'APP_ORDER_SCREEN',
      courierOrderReference: String(courierOrderReference || courier_order_reference || ''),
      livePickupConfirmed: livePickupConfirmed !== undefined ? !!livePickupConfirmed : !!live_pickup_confirmed
    })

    return NextResponse.json({
      ok: true,
      audit
    })
  } catch (err: any) {
    console.error('Error en PUT /api/delivery-armor/audit:', err)
    return NextResponse.json({
      ok: false,
      error: err?.message || 'Error al registrar entrega al chofer'
    }, { status: 500 })
  }
}
