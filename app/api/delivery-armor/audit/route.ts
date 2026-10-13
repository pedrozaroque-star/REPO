/**
 * @module app/api/delivery-armor/audit/route
 * @description Endpoint de mutación para registrar el progreso del Checklist de Coincidencia (Match 100%), las fotos de evidencia y la entrega al chofer.
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
import { saveAuditProgress, confirmHandoffToDriver, verifyRonosPin } from '@/lib/delivery-armor'

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
      packer_pin
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
      packerPin: packerPin || packer_pin
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
      courier_verified
    } = body

    const targetOrderGuid = toastOrderGuid || order_guid
    const targetPin = String(handedPin || handoff_pin || '').trim()
    const targetStoreId = Number(storeId || store_id || 6)

    if (!targetOrderGuid || !targetPin) {
      return NextResponse.json({
        ok: false,
        error: 'Faltan campos obligatorios para entrega al chofer (orderGuid, PIN).'
      }, { status: 400 })
    }

    let finalUserId = handedByRonosUserId ? Number(handedByRonosUserId) : undefined
    let finalUserName = handedByRonosName

    // Si no tenemos el ID de RONOS, validarlo en tiempo real con el PIN
    if (!finalUserId || !finalUserName) {
      const pinCheck = await verifyRonosPin(targetStoreId, targetPin)
      if (!pinCheck.valid || !pinCheck.employeeUserId) {
        return NextResponse.json({
          ok: false,
          error: pinCheck.error || 'PIN de colaborador no válido en RONOS para registrar la custodia.'
        }, { status: 401 })
      }
      finalUserId = pinCheck.employeeUserId
      finalUserName = pinCheck.fullName
    }

    const audit = await confirmHandoffToDriver({
      toastOrderGuid: targetOrderGuid,
      handedByRonosUserId: finalUserId,
      handedByRonosName: finalUserName || 'Colaborador',
      handedPin: targetPin,
      driverName: driverName || courier_name,
      driverConfirmed: driverConfirmed !== undefined ? !!driverConfirmed : !!courier_verified
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
