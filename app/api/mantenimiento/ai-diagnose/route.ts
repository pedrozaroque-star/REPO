/**
 * @module api/mantenimiento/ai-diagnose
 * @description Diagnóstico visual inteligente (`gemini-3.8-flash` + JSON Schema) para fotografías de equipos,
 * placas metálicas de datos (marca, modelo, número de serie) y pantallas con códigos de error en Mantenimiento.
 *
 * @businessRules
 * - Compatible tanto con técnicos externos en el portal QR público (`/mantenimiento/registro`) como con gerentes/admins
 *   en `/admin/mantenimiento`.
 * - En llamadas públicas sin sesión (`!auth.authorized`), exige estrictamente que `fileUrl` pertenezca al bucket
 *   oficial `checklist-photos/maintenance/` de Tacos Gavilan (`fetchTrustedMaintenanceAssetAsBase64`) y aplica
 *   límite de tasa por IP (`checkPublicAiRateLimit`).
 * - Mapea automáticamente la categoría y el tipo de servicio a los catálogos oficiales de `/api/mantenimiento`
 *   y entrega el resumen técnico en ambos idiomas (`es` y `en`).
 *
 * @dataFlow
 * - Foto subida a `/api/mantenimiento/upload` (`fileUrl`) -> `POST /api/mantenimiento/ai-diagnose`
 *   -> `diagnoseEquipmentPhotoWithGemini()` -> `{ success: true, diagnosis }`.
 *
 * @notes
 * - Jamás inventa números de serie o modelos si no son legibles en la fotografía.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import {
  checkPublicAiRateLimit,
  diagnoseEquipmentPhotoWithGemini,
  fetchTrustedMaintenanceAssetAsBase64,
  normalizeMediaMimeType,
} from '@/lib/gemini-interactions'

export const maxDuration = 60

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

export async function POST(req: NextRequest) {
  const auth = await verifyStaffAuth(req)
  const isStaff = auth.authorized

  try {
    const body = await req.json().catch(() => ({}))
    const fileUrl = String(body?.fileUrl || '').trim()

    let base64Data = ''
    let mimeType = 'image/jpeg'

    if (fileUrl) {
      if (!isStaff) {
        const ip = getClientIp(req)
        if (!checkPublicAiRateLimit(`diag:${ip}`, 20, 10 * 60 * 1000)) {
          return NextResponse.json(
            { success: false, error: 'Demasiados diagnósticos seguidos. Espera unos minutos.' },
            { status: 429 }
          )
        }
      }
      let asset: { base64Data: string; mimeType: string }
      try {
        asset = await fetchTrustedMaintenanceAssetAsBase64(fileUrl, MAX_IMAGE_BYTES)
      } catch (assetErr: any) {
        return NextResponse.json(
          {
            success: false,
            error: assetErr?.message || 'URL de fotografía inválida o fuera del límite permitido (máx. 4 MB).',
          },
          { status: 400 }
        )
      }
      if (asset.mimeType === 'application/pdf') {
        return NextResponse.json(
          { success: false, error: 'El diagnóstico visual de equipos requiere una fotografía (JPG, PNG, WebP, HEIC).' },
          { status: 400 }
        )
      }
      base64Data = asset.base64Data
      mimeType = asset.mimeType
    } else if (isStaff && body?.base64Data) {
      base64Data = String(body.base64Data).replace(/^data:[^;]+;base64,/, '').trim()
      mimeType = normalizeMediaMimeType(String(body.mimeType || 'image/jpeg'), 'image/jpeg')
      const approxBytes = Math.ceil((base64Data.length * 3) / 4)
      if (!base64Data || approxBytes > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { success: false, error: 'Imagen vacía o mayor a 4 MB.' },
          { status: 400 }
        )
      }
    } else {
      return NextResponse.json(
        { success: false, error: 'Se requiere una fotografía subida de mantenimiento.' },
        { status: 400 }
      )
    }

    const diagnosis = await diagnoseEquipmentPhotoWithGemini({
      base64Data,
      mimeType,
    })

    return NextResponse.json({
      success: true,
      diagnosis,
    })
  } catch (err: any) {
    console.error('[POST /api/mantenimiento/ai-diagnose] Error:', err)
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'No se pudo completar el diagnóstico visual con IA.',
      },
      { status: 500 }
    )
  }
}
