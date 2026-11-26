/**
 * @module api/remote-control/devices/[id]
 * @description Actualiza configuración, enlaces de Action1/RustDesk/Fully Kiosk, políticas de Watchdog
 *              o elimina un dispositivo del Centro de Control Remoto.
 *
 * @businessRules
 * - Acceso exclusivo para administradores activos (`requireActiveAdmin`).
 * - Si se actualiza `desiredConfig` en una PC Windows enrolada, encola opcionalmente `sync_watchdog_config`
 *   para sincronizar la política localmente sin reiniciar el servicio.
 *
 * @dataFlow
 * - UI `/admin/control-remoto` -> PATCH/DELETE `/api/remote-control/devices/[id]` -> Supabase (`remote_fleet_devices`).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  isSafeHttpOrHttpsUrl,
  sanitizePcWatchdogConfig,
  type RemoteToolProvider,
} from '@/lib/remote-control'
import { requireActiveAdmin, stripDeviceSecrets } from '@/lib/remote-control-server'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_PROVIDERS = new Set<RemoteToolProvider>([
  'action1',
  'rustdesk',
  'fully_kiosk',
  'chrome_rdp',
  'meshcentral',
  'none',
])

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireActiveAdmin(request)
  if (!auth.authorized) return auth.response!

  try {
    const resolved = await Promise.resolve(context.params)
    const id = String(resolved?.id || '').trim()
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'ID de dispositivo inválido' }, { status: 400 })
    }

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('remote_fleet_devices')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!existing) {
      return NextResponse.json({ error: 'Dispositivo no encontrado' }, { status: 404 })
    }

    const body = await request.json()
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }

    if (typeof body?.displayName === 'string' && body.displayName.trim()) {
      updates.display_name = body.displayName.trim().slice(0, 120)
    }

    if (typeof body?.remoteToolProvider === 'string') {
      const p = body.remoteToolProvider.trim() as RemoteToolProvider
      if (!ALLOWED_PROVIDERS.has(p)) {
        return NextResponse.json({ error: 'Proveedor remoto inválido' }, { status: 400 })
      }
      updates.remote_tool_provider = p
    }

    if (body?.remoteToolUrl !== undefined) {
      const rawUrl = typeof body.remoteToolUrl === 'string' ? body.remoteToolUrl.trim() : ''
      if (rawUrl && !isSafeHttpOrHttpsUrl(rawUrl)) {
        return NextResponse.json({ error: 'URL remota inválida (debe iniciar con http:// o https://)' }, { status: 400 })
      }
      updates.remote_tool_url = rawUrl || null
    }

    if (body?.remoteToolDeviceId !== undefined) {
      updates.remote_tool_device_id =
        typeof body.remoteToolDeviceId === 'string'
          ? body.remoteToolDeviceId.trim().slice(0, 120) || null
          : null
    }

    if (body?.notes !== undefined) {
      updates.notes =
        typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) || null : null
    }

    let watchdogSynced = false
    if (body?.desiredConfig && typeof body.desiredConfig === 'object') {
      if (existing.device_type === 'windows_pc') {
        const cleanWd = sanitizePcWatchdogConfig({
          ...(existing.desired_config || {}),
          ...body.desiredConfig,
        })
        updates.desired_config = cleanWd
        watchdogSynced = true
      } else {
        updates.desired_config = {
          ...(existing.desired_config || {}),
          ...body.desiredConfig,
        }
      }
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('remote_fleet_devices')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single()

    if (updateErr) throw updateErr

    // Si es PC Windows enrolada y cambio configuracion de Watchdog, encolar sync rapido
    if (watchdogSynced && existing.enrollment_status === 'enrolled') {
      await supabaseAdmin.from('remote_fleet_commands').insert({
        device_id: existing.id,
        store_code: existing.store_code,
        device_type: 'windows_pc',
        command_type: 'sync_watchdog_config',
        payload: { watchdog: updates.desired_config },
        status: 'pending',
        requested_by_user_id: auth.userId || null,
        requested_by_name: auth.userName || 'Admin',
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      })
    }

    return NextResponse.json({
      success: true,
      device: stripDeviceSecrets(updated),
    })
  } catch (err: any) {
    console.error('❌ [api/remote-control/devices/[id] PATCH] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error actualizando dispositivo' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireActiveAdmin(request)
  if (!auth.authorized) return auth.response!

  try {
    const resolved = await Promise.resolve(context.params)
    const id = String(resolved?.id || '').trim()
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'ID de dispositivo inválido' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('remote_fleet_devices')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('❌ [api/remote-control/devices/[id] DELETE] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error eliminando dispositivo' },
      { status: 500 }
    )
  }
}
