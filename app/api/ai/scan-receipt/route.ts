/**
 * @module api/ai/scan-receipt
 * @description Escáner multimodal con salida estructurada JSON (`gemini-3.8-flash`) para extraer automáticamente
 * proveedor, número de factura/recibo, fecha, subtotal, impuestos, total en USD y categoría de gasto (`parking`,
 * `toll`, `maintenance_invoice`, etc.) desde fotografías o documentos PDF.
 *
 * @businessRules
 * - En módulos internos como Millas (`/miles`) o Admin Mantenimiento (`/admin/mantenimiento`), valida sesión de
 *   personal con `verifyStaffAuth` y acepta imagen o PDF directo (`<= 4 MB`) o URL confiable de Supabase Storage.
 * - En el portal público QR de técnicos (`/mantenimiento/registro`), solo acepta URLs ya alojadas en el bucket
 *   oficial `checklist-photos/maintenance/` de este proyecto Supabase (previniendo SSRF y uso externo indebido)
 *   bajo límite de tasa por IP (`checkPublicAiRateLimit`).
 * - Todos los montos se devuelven en dólares estadounidenses (`USD`) listos para poblar formularios sin tocar
 *   columnas autocalculadas de PostgreSQL (`mileage_value`, `total_reimbursement`).
 *
 * @dataFlow
 * - Archivo imagen/PDF o `fileUrl` validado -> `POST /api/ai/scan-receipt` -> `scanReceiptOrInvoiceWithGemini()`
 *   -> `{ success: true, receipt: ScannedReceiptData }`.
 *
 * @notes
 * - Soporta `image/jpeg`, `image/png`, `image/webp`, `image/heic` y `application/pdf`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import {
  checkPublicAiRateLimit,
  fetchTrustedMaintenanceAssetAsBase64,
  normalizeMediaMimeType,
  scanReceiptOrInvoiceWithGemini,
} from '@/lib/gemini-interactions'

export const maxDuration = 60

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
])

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

export async function POST(req: NextRequest) {
  const auth = await verifyStaffAuth(req)
  const isStaff = auth.authorized

  try {
    const contentType = req.headers.get('content-type') || ''
    let base64Data = ''
    let mimeType = 'image/jpeg'
    let contextHint: 'mileage' | 'maintenance' | 'general' = 'general'
    let fileUrl = ''

    if (contentType.includes('multipart/form-data')) {
      if (!isStaff) {
        return NextResponse.json(
          { success: false, error: 'Autenticación requerida para escaneo directo de archivos.' },
          { status: 401 }
        )
      }

      const formData = await req.formData()
      const file = formData.get('file')
      const rawHint = String(formData.get('contextHint') || 'general').trim()
      if (rawHint === 'mileage' || rawHint === 'maintenance') {
        contextHint = rawHint
      }

      if (!file || typeof (file as Blob).arrayBuffer !== 'function') {
        return NextResponse.json(
          { success: false, error: 'No se recibió imagen ni PDF para escanear.' },
          { status: 400 }
        )
      }

      const blob = file as Blob
      if (blob.size === 0 || blob.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { success: false, error: 'El archivo está vacío o excede el límite de 4 MB.' },
          { status: 400 }
        )
      }

      const fileName = String((file as any)?.name || '').toLowerCase()
      const inferredFromExt = fileName.endsWith('.pdf')
        ? 'application/pdf'
        : fileName.endsWith('.heic')
          ? 'image/heic'
          : fileName.endsWith('.heif')
            ? 'image/heif'
            : fileName.endsWith('.png')
              ? 'image/png'
              : fileName.endsWith('.webp')
                ? 'image/webp'
                : fileName.endsWith('.gif')
                  ? 'image/gif'
                  : 'image/jpeg'
      mimeType = normalizeMediaMimeType(blob.type || inferredFromExt, inferredFromExt)

      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        return NextResponse.json(
          { success: false, error: 'Formato no soportado. Usa imagen (JPG, PNG, WebP, HEIC) o PDF.' },
          { status: 400 }
        )
      }

      base64Data = Buffer.from(await blob.arrayBuffer()).toString('base64')
    } else {
      const body = await req.json().catch(() => ({}))
      fileUrl = String(body?.fileUrl || '').trim()
      const rawHint = String(body?.contextHint || 'general').trim()
      if (rawHint === 'mileage' || rawHint === 'maintenance') {
        contextHint = rawHint
      }

      if (fileUrl) {
        if (!isStaff) {
          const ip = getClientIp(req)
          if (!checkPublicAiRateLimit(`scan:${ip}`, 15, 10 * 60 * 1000)) {
            return NextResponse.json(
              { success: false, error: 'Demasiados escaneos seguidos. Intenta de nuevo en unos minutos.' },
              { status: 429 }
            )
          }
          contextHint = 'maintenance'
        }
        try {
          const asset = await fetchTrustedMaintenanceAssetAsBase64(fileUrl, MAX_UPLOAD_BYTES)
          base64Data = asset.base64Data
          mimeType = asset.mimeType
        } catch (assetErr: any) {
          return NextResponse.json(
            {
              success: false,
              error: assetErr?.message || 'URL de archivo inválida o fuera del límite permitido (máx. 4 MB).',
            },
            { status: 400 }
          )
        }
      } else {
        if (!isStaff) {
          return NextResponse.json(
            { success: false, error: 'No autorizado.' },
            { status: 401 }
          )
        }
        base64Data = String(body?.base64Data || '').replace(/^data:[^;]+;base64,/, '').trim()
        mimeType = normalizeMediaMimeType(String(body?.mimeType || 'image/jpeg'), 'image/jpeg')
        if (!base64Data || !ALLOWED_MIME_TYPES.has(mimeType)) {
          return NextResponse.json(
            { success: false, error: 'Datos de recibo/factura inválidos.' },
            { status: 400 }
          )
        }
        const approxBytes = Math.ceil((base64Data.length * 3) / 4)
        if (approxBytes > MAX_UPLOAD_BYTES) {
          return NextResponse.json(
            { success: false, error: 'El archivo excede el límite de 4 MB.' },
            { status: 400 }
          )
        }
      }
    }

    const receipt = await scanReceiptOrInvoiceWithGemini({
      base64Data,
      mimeType,
      contextHint,
    })

    return NextResponse.json({
      success: true,
      receipt,
    })
  } catch (err: any) {
    console.error('[POST /api/ai/scan-receipt] Error:', err)
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'No se pudo analizar el recibo o factura con IA.',
      },
      { status: 500 }
    )
  }
}
