/**
 * @module api/order-ready/settings
 * @description Gestión de configuración global del Order Ready Board (voz, idioma y campanilla) sincronizada entre las 15 sucursales.
 *
 * @businessRules
 * - **Control de Acceso Estricto**:
 *   - Solo los usuarios con rol `admin` (`access.all === true`) pueden actualizar la configuración (PUT / PATCH).
 *   - Supervisores, managers y asistentes NO tienen permiso para cambiar la voz; cualquier intento de mutación devuelve 403 Forbidden.
 *   - Cualquier usuario autenticado (o pantalla en sucursal) puede consultar la configuración activa (GET).
 * - **Propagación Global a Nivel Cadena**:
 *   - Cuando el administrador cambia la voz en cualquier tienda, el registro `'global'` en `order_ready_settings` se actualiza y
 *     se transmite en tiempo real (Supabase Realtime) a todas las pantallas activas de todas las sucursales.
 *
 * @dataFlow
 * - Board -> GET /api/order-ready/settings -> consulta `order_ready_settings` en Supabase -> devuelve voz y flag `isAdmin`.
 * - Admin Board -> PUT /api/order-ready/settings (voice, voice_language) -> valida rol admin -> actualiza fila 'global' -> Supabase Realtime notifica a todas las pantallas.
 *
 * @notes
 * - La tabla cuenta con RLS habilitado y publicación Realtime en Postgres.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getOrderReadyAccess } from '@/lib/order-ready-access'
import { getServerUser } from '@/lib/auth-server'
import { isValidVoice, VoiceId, getAnnouncementSpeech } from '@/lib/order-ready-tts'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const access = await getOrderReadyAccess(request)
    const isAdmin = !!access?.all

    const { data: rows, error } = await supabaseAdmin
      .from('order_ready_settings')
      .select('*')
      .in('id', ['global', 'announcement_presets_global'])

    if (error) {
      console.error('[order-ready/settings] Error fetching settings:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const data = rows?.find((r: any) => r.id === 'global') || null
    const presetsRow = rows?.find((r: any) => r.id === 'announcement_presets_global') || null
    let presets: Record<string, any> | null = null
    if (presetsRow?.updated_by) {
      try {
        presets = JSON.parse(presetsRow.updated_by)
      } catch {
        presets = null
      }
    }

    const defaultSettings = {
      id: 'global',
      voice: 'Kore' as VoiceId,
      voice_language: 'bilingual',
      voice_volume: 1.0,
      voice_speed: 0.92,
      enable_chime: true
    }

    return NextResponse.json({
      success: true,
      settings: data || defaultSettings,
      presets,
      isAdmin
    })
  } catch (err: any) {
    console.error('[order-ready/settings] GET exception:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    // 1. Validar autenticación
    const access = await getOrderReadyAccess(request)
    if (!access) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const user = await getServerUser(request)
    const body = await request.json()

    // Si es guardado de plantillas de Anuncios al Comedor (permitido para gerentes, supervisores y admins con acceso al tablero)
    if (body?.presets && typeof body.presets === 'object') {
      const serialized = JSON.stringify(body.presets)
      const { error: presetErr } = await supabaseAdmin
        .from('order_ready_settings')
        .upsert({
          id: 'announcement_presets_global',
          voice: 'Kore',
          voice_language: 'bilingual',
          voice_volume: 1.0,
          voice_speed: 0.92,
          enable_chime: true,
          updated_at: new Date().toISOString(),
          updated_by: serialized
        })

      if (presetErr) {
        console.error('[order-ready/settings] Error saving presets:', presetErr)
        return NextResponse.json({ error: presetErr.message }, { status: 500 })
      }

      // Si viene texto para pre-generar en caché con la voz oficial Kore, generarlo de inmediato
      if (typeof body.pregenerateText === 'string' && body.pregenerateText.trim().length > 0) {
        const preLang = body.pregenerateLang === 'en' ? 'en' : 'es'
        try {
          await getAnnouncementSpeech(body.pregenerateText.trim(), preLang, 'Kore')
        } catch (ttsErr: any) {
          console.warn('[order-ready/settings] Advertencia pre-generando audio Kore de plantilla:', ttsErr?.message)
        }
      }

      return NextResponse.json({
        success: true,
        presets: body.presets,
        message: 'Plantilla de anuncio al comedor guardada y sincronizada con voz Kore'
      })
    }

    // 2. REGLA ESTRICTA: Solo admin puede cambiar la voz global
    if (!access.all) {
      return NextResponse.json(
        { error: 'Acceso denegado: solo los usuarios administradores pueden cambiar la voz del anunciador' },
        { status: 403 }
      )
    }

    const { voice, voice_language, enable_chime, voice_volume } = body

    if (voice !== undefined && !isValidVoice(voice)) {
      return NextResponse.json(
        { error: 'Voz inválida. Las opciones permitidas son: Kore, Aoede, Zephyr, Puck, Orus' },
        { status: 400 }
      )
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
      updated_by: user?.email || user?.name || 'admin'
    }

    if (voice !== undefined) updatePayload.voice = voice
    if (voice_language !== undefined) updatePayload.voice_language = voice_language
    if (typeof enable_chime === 'boolean') updatePayload.enable_chime = enable_chime
    if (typeof voice_volume === 'number') updatePayload.voice_volume = voice_volume

    const { data, error } = await supabaseAdmin
      .from('order_ready_settings')
      .upsert({ id: 'global', ...updatePayload })
      .select()
      .single()

    if (error) {
      console.error('[order-ready/settings] Error updating settings:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      settings: data,
      message: 'Configuración de voz actualizada globalmente para todas las sucursales'
    })
  } catch (err: any) {
    console.error('[order-ready/settings] PUT exception:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
