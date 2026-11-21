/**
 * @module app/api/delivery-armor/upload-photo/route
 * @description Endpoint para recibir y almacenar fotografías de evidencia (Foto 1: Contenido abierto / Foto 2: Bolsa sellada).
 *   - Almacena las imágenes en el bucket público 'delivery-evidence' de Supabase Storage.
 *   - Optimiza y genera URLs públicas permanentes asociadas a la orden.
 *
 * @businessRules
 *   - Las fotos no deben exceder 10MB.
 *   - Se admiten formatos estándar de imagen (JPEG, PNG, WEBP).
 *
 * @dataFlow
 *   Client Tablet Camera -> FormData (file, type, orderGuid) -> Supabase Storage -> Public URL -> Response JSON.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyStaffAuth } from '@/lib/auth-server'
import { touchActiveStorePinSession } from '@/lib/delivery-armor'

export async function POST(req: NextRequest) {
  try {
    const staffAuth = verifyStaffAuth(req, { allowCron: false })

    const formData = await req.formData().catch(() => null)
    if (!formData) {
      if (!staffAuth.authorized) {
        return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })
      }
      return NextResponse.json({ ok: false, error: 'Formato multipart/form-data inválido.' }, { status: 400 })
    }
    const file = formData.get('file') as File | null
    const type = (formData.get('type') as string) || 'sealed'
    const orderGuid = String(formData.get('orderGuid') || '')
    const storeId = String(formData.get('storeId') || '')
    const sessionToken = String(
      formData.get('sessionToken') ||
      formData.get('session_token') ||
      req.headers.get('x-packer-session') ||
      ''
    ).trim()

    if (!staffAuth.authorized) {
      if (!/^\d+$/.test(storeId) || !sessionToken) {
        return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })
      }
      const packerCheck = await touchActiveStorePinSession(parseInt(storeId, 10), sessionToken)
      if (!packerCheck.valid) {
        return NextResponse.json({ ok: false, error: 'Sesión de empacador inválida o expirada' }, { status: 401 })
      }
    }

    if (!file) {
      return NextResponse.json({ ok: false, error: 'No se envió ningún archivo de imagen.' }, { status: 400 })
    }
    if (type !== 'sealed' || !/^\d+$/.test(storeId) || !/^[a-zA-Z0-9-]{8,80}$/.test(orderGuid)) {
      return NextResponse.json({ ok: false, error: 'Metadatos de evidencia inválidos.' }, { status: 400 })
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: 'La evidencia debe ser JPG, PNG o WEBP y no exceder 10 MB.' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Extensión del archivo
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const filename = `${storeId}/${orderGuid}_${type}_${Date.now()}.${ext}`

    const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
      .from('delivery-evidence')
      .upload(filename, buffer, {
        contentType: file.type || 'image/jpeg',
        upsert: false
      })

    if (uploadErr) {
      console.error('Error subiendo imagen a Supabase Storage:', uploadErr)
      return NextResponse.json({ ok: false, error: `Fallo al subir evidencia: ${uploadErr.message}` }, { status: 500 })
    }

    // Obtener URL pública
    const { data: publicUrlData } = supabaseAdmin.storage
      .from('delivery-evidence')
      .getPublicUrl(uploadData.path)

    return NextResponse.json({
      ok: true,
      publicUrl: publicUrlData.publicUrl,
      path: uploadData.path
    })
  } catch (err: any) {
    console.error('Error en /api/delivery-armor/upload-photo:', err)
    return NextResponse.json({
      ok: false,
      error: 'Error al procesar fotografía de evidencia'
    }, { status: 500 })
  }
}
