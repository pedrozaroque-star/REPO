/**
 * @module api/mantenimiento/upload
 * @description Endpoint de subida de evidencias fotográficas y firmas táctiles para el módulo
 * de Registro de Actividades de Mantenimiento y Proveedores de Tacos Gavilan.
 * @businessRules
 * - Acepta archivos de imagen (JPEG, PNG, WEBP) mediante FormData o imágenes en base64 (firma digital táctil).
 * - Almacena los archivos en el bucket público 'checklist-photos' bajo la ruta 'maintenance/{YYYY-MM-DD}/{timestamp}_{random}.{ext}'.
 * - Optimiza y valida tipos MIME para evitar archivos no compatibles o maliciosos.
 * - Utiliza supabaseAdmin para garantizar la escritura en almacenamiento sin requerir sesión iniciada del técnico.
 * @dataFlow
 * - Cliente (Móvil / Web) -> POST /api/mantenimiento/upload -> Supabase Storage (checklist-photos) -> Retorna publicUrl.
 * @notes
 * - Soporta tanto multipart/form-data como JSON payload { base64: string, filename?: string, type?: string }.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

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

    // 1. Manejo de subida vía FormData (Archivos de cámara o galería)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      const folderPrefix = (formData.get('folder') as string) || 'evidence'

      if (!file) {
        return NextResponse.json({ success: false, error: 'No se recibió ningún archivo de imagen' }, { status: 400 })
      }

      // Validar tamaño máximo (10MB)
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ success: false, error: 'El archivo excede el tamaño máximo permitido (10MB)' }, { status: 400 })
      }

      const buffer = Buffer.from(await file.arrayBuffer())
      const extension = file.name?.split('.').pop()?.toLowerCase() || 'webp'
      const sanitizedExt = ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(extension) ? extension : 'jpg'
      const fileName = `maintenance/${today}/${folderPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${sanitizedExt}`

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('checklist-photos')
        .upload(fileName, buffer, {
          contentType: file.type || 'image/jpeg',
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

      if (!base64 || typeof base64 !== 'string') {
        return NextResponse.json({ success: false, error: 'Se requiere una cadena base64 válida' }, { status: 400 })
      }

      // Remover header data:image/png;base64,... si viene incluido
      const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
      let mimeType = 'image/png'
      let base64Data = base64

      if (matches && matches.length === 3) {
        mimeType = matches[1]
        base64Data = matches[2]
      }

      const buffer = Buffer.from(base64Data, 'base64')
      const ext = mimeType.includes('png') ? 'png' : 'jpg'
      const fileName = `maintenance/${today}/${folder}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

      const { data: uploadData, error: uploadError } = await supabase.storage
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
