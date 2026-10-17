/**
 * @module api/mantenimiento/upload
 * @description Endpoint de subida de evidencias fotográficas, documentos PDF de facturas y firmas táctiles
 * para el módulo de Registro de Actividades de Mantenimiento y Proveedores de Tacos Gavilan.
 * @businessRules
 * - Acepta archivos de imagen (JPEG, PNG, WEBP, HEIC) y PDFs de facturas mediante FormData, o imágenes en base64 (firma digital táctil).
 * - Almacena los archivos en el bucket público 'checklist-photos' bajo la ruta 'maintenance/{YYYY-MM-DD}/{folder}_{timestamp}_{random}.{ext}'.
 * - Sanitiza el nombre de subcarpeta contra una lista blanca estricta para prevenir Path Traversal.
 * - Optimiza y valida tipos MIME y tamaños máximos (10MB en FormData, 5MB en Base64).
 * - Utiliza supabaseAdmin para garantizar la escritura en almacenamiento sin requerir sesión iniciada del técnico.
 * @dataFlow
 * - Cliente (Móvil / Web) -> POST /api/mantenimiento/upload -> Supabase Storage (checklist-photos) -> Retorna publicUrl.
 * @notes
 * - Soporta tanto multipart/form-data como JSON payload { base64: string, folder?: string }.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ALLOWED_FOLDERS = ['before', 'after', 'invoice', 'signatures', 'evidence']
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf']
const ALLOWED_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf'
]

/**
 * Obtiene la fecha de negocio oficial en California PST ('America/Los_Angeles')
 * con la frontera laboral de las 6:00 AM.
 */
function getBusinessDatePST(date = new Date()): string {
  const laDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const hour = laDate.getHours()
  if (hour < 6) {
    laDate.setDate(laDate.getDate() - 1)
  }
  const yyyy = laDate.getFullYear()
  const mm = String(laDate.getMonth() + 1).padStart(2, '0')
  const dd = String(laDate.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseAdminClient()
    const contentType = request.headers.get('content-type') || ''
    const today = getBusinessDatePST()

    // 1. Manejo de subida vía FormData (Archivos de cámara, galería o PDF de factura)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      const rawFolder = String(formData.get('folder') || 'evidence').trim().toLowerCase()
      const folderPrefix = ALLOWED_FOLDERS.includes(rawFolder) ? rawFolder : 'evidence'

      if (!file || file.size === 0) {
        return NextResponse.json({ success: false, error: 'No se recibió ningún archivo válido' }, { status: 400 })
      }

      // Validar tamaño máximo (10MB)
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ success: false, error: 'El archivo excede el tamaño máximo permitido (10MB)' }, { status: 400 })
      }

      const extension = file.name?.split('.').pop()?.toLowerCase() || ''
      const mime = (file.type || '').toLowerCase()

      const isAllowedMime = ALLOWED_MIMES.includes(mime)
      const isAllowedExt = ALLOWED_EXTENSIONS.includes(extension)

      if (!isAllowedMime && !isAllowedExt) {
        return NextResponse.json(
          { success: false, error: 'Formato de archivo no permitido. Usa JPG, PNG, WEBP, HEIC o PDF.' },
          { status: 400 }
        )
      }

      const isPdf = mime === 'application/pdf' || extension === 'pdf'
      const sanitizedExt = isPdf
        ? 'pdf'
        : ALLOWED_EXTENSIONS.includes(extension)
        ? extension
        : mime.includes('webp')
        ? 'webp'
        : mime.includes('png')
        ? 'png'
        : 'jpg'

      const finalContentType = isPdf
        ? 'application/pdf'
        : isAllowedMime
        ? mime
        : 'image/jpeg'

      const buffer = Buffer.from(await file.arrayBuffer())
      const fileName = `maintenance/${today}/${folderPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${sanitizedExt}`

      const { error: uploadError } = await supabase.storage
        .from('checklist-photos')
        .upload(fileName, buffer, {
          contentType: finalContentType,
          upsert: true
        })

      if (uploadError) {
        console.error('[mantenimiento/upload] Error al subir archivo:', uploadError)
        return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 })
      }

      const { data: urlData } = supabase.storage
        .from('checklist-photos')
        .getPublicUrl(fileName)

      return NextResponse.json({
        success: true,
        url: urlData.publicUrl,
        path: fileName
      })
    }

    // 2. Manejo de subida vía JSON (Base64 para firmas táctiles del encargado)
    if (contentType.includes('application/json')) {
      const body = await request.json()
      const { base64, folder = 'signatures' } = body
      const rawFolder = String(folder || 'signatures').trim().toLowerCase()
      const sanitizedFolder = ALLOWED_FOLDERS.includes(rawFolder) ? rawFolder : 'signatures'

      if (!base64 || typeof base64 !== 'string') {
        return NextResponse.json({ success: false, error: 'Se requiere una cadena base64 válida' }, { status: 400 })
      }

      // Remover header data:image/png;base64,... si viene incluido
      const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
      let rawMime = 'image/png'
      let base64Data = base64

      if (matches && matches.length === 3) {
        rawMime = matches[1].toLowerCase()
        base64Data = matches[2]
      }

      const mimeType = rawMime === 'image/jpeg' || rawMime === 'image/jpg' ? 'image/jpeg' : 'image/png'
      const buffer = Buffer.from(base64Data, 'base64')

      if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
        return NextResponse.json({ success: false, error: 'Tamaño de firma digital inválido (máx. 5MB)' }, { status: 400 })
      }

      const ext = mimeType === 'image/png' ? 'png' : 'jpg'
      const fileName = `maintenance/${today}/${sanitizedFolder}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('checklist-photos')
        .upload(fileName, buffer, {
          contentType: mimeType,
          upsert: true
        })

      if (uploadError) {
        console.error('[mantenimiento/upload] Error al subir base64:', uploadError)
        return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 })
      }

      const { data: urlData } = supabase.storage
        .from('checklist-photos')
        .getPublicUrl(fileName)

      return NextResponse.json({
        success: true,
        url: urlData.publicUrl,
        path: fileName
      })
    }

    return NextResponse.json({ success: false, error: 'Content-Type no soportado' }, { status: 415 })
  } catch (err: any) {
    console.error('[mantenimiento/upload] Excepción inesperada:', err)
    return NextResponse.json({ success: false, error: err.message || 'Error interno al procesar subida' }, { status: 500 })
  }
}
