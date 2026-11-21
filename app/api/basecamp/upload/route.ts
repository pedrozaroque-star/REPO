/**
 * @module api/basecamp/upload
 * @description Endpoint POST (`multipart/form-data`) para subir fotos, capturas de pantalla y archivos adjuntos
 *              (PDF, Excel, Word, imágenes, etc.) desde el editor enriquecido de To-dos, Comentarios y Mensajes
 *              del módulo Basecamp hacia Supabase Storage (`checklist-photos/basecamp-uploads/...`).
 *
 * @businessRules
 * - Requiere sesión activa de personal autenticado (`verifyStaffAuth`, validando cookie `httpOnly` `teg_token`
 *   o header `Authorization: Bearer`), evitando fallos de RLS en navegadores con `localStorage` desactualizado.
 * - Tamaño máximo por archivo: 25 MB.
 * - Almacena en el bucket público `checklist-photos` usando `supabaseAdmin` (`service_role`) y retorna la URL
 *   pública permanente para previsualización instantánea en TEG y posterior espejado a Basecamp 3 API.
 *
 * @dataFlow
 * - Browser (`FormData` con `file` + `folder`) -> `verifyStaffAuth` -> `supabaseAdmin.storage.upload` -> `{ success, url, filename, contentType, size }`
 *
 * @notes
 * - Soporta carga por botón (`Image` / `Paperclip`), pegado desde portapapeles (`Ctrl+V`) y arrastrar/soltar (`Drag & Drop`).
 */

import { NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

const MIME_FALLBACK_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

export async function POST(request: Request) {
  const staffAuth = verifyStaffAuth(request, { allowCron: false })
  if (!staffAuth.authorized) {
    return staffAuth.response!
  }

  try {
    const formData = await request.formData()
    const rawFile = formData.get('file')

    if (!rawFile || typeof (rawFile as any).arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'Missing file in form data' }, { status: 400 })
    }

    const file = rawFile as File
    if (file.size === 0) {
      return NextResponse.json({ error: 'Empty file is not allowed' }, { status: 400 })
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'File exceeds maximum 25 MB limit' }, { status: 413 })
    }

    const rawFolder = String(formData.get('folder') || 'todos')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 64) || 'todos'

    const originalName = (file.name || 'attachment').trim() || 'attachment'
    const contentType = (file.type || 'application/octet-stream').trim() || 'application/octet-stream'
    const nameParts = originalName.split('.')
    const rawExt = nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''
    const cleanExt =
      rawExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 10) ||
      MIME_FALLBACK_EXT[contentType.toLowerCase()] ||
      'bin'

    const safeSlug = originalName
      .replace(/\.[^.]+$/, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'file'

    const storagePath = `basecamp-uploads/${rawFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeSlug}.${cleanExt}`
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const { error: uploadError } = await supabaseAdmin.storage
      .from('checklist-photos')
      .upload(storagePath, buffer, {
        contentType,
        cacheControl: '3600',
        upsert: false,
      })

    if (uploadError) {
      console.error('❌ [Basecamp Upload] Supabase Storage upload error:', uploadError.message)
      return NextResponse.json({ error: uploadError.message || 'Storage upload failed' }, { status: 500 })
    }

    const { data: pubData } = supabaseAdmin.storage.from('checklist-photos').getPublicUrl(storagePath)
    if (!pubData?.publicUrl) {
      return NextResponse.json({ error: 'Could not generate public URL for uploaded file' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      url: pubData.publicUrl,
      storagePath,
      filename: originalName,
      contentType,
      size: buffer.length,
    })
  } catch (err: any) {
    console.error('❌ [Basecamp Upload] Unexpected error:', err?.message || err)
    return NextResponse.json({ error: err?.message || 'Unexpected upload error' }, { status: 500 })
  }
}
