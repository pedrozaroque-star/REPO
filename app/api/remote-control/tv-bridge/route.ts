/**
 * @module api/remote-control/tv-bridge
 * @description Bridge remoto ligero para TVs de Menú Digital (`/tv` y `/t/[screen]/[store]`) de las
 *              15 sucursales de Tacos Gavilan. Auto-registra cada pantalla TV en `remote_fleet_devices`,
 *              reporta la imagen activa y entrega comandos remotos (`refresh_menu`, `reload_page`,
 *              `switch_screen`, `set_blackout`, `show_overlay`, `clear_overlay`).
 *
 * @businessRules
 * - Protegido con `checkRateLimit` por IP y validación estricta de `storeCode` (15 tiendas oficiales) y `screenNumber` (`1..20`).
 * - No interfiere con Vercel Edge CDN de `/api/tv-update` (`s-maxage=300`).
 * - Devuelve el estado persistido de `desired_config` (`blackoutMode`, `overlayMessage`) para que la TV
 *   conserve avisos o modo mantenimiento tras un reinicio.
 *
 * @dataFlow
 * - Pantalla TV (`/tv`) cada 60s -> POST `/api/remote-control/tv-bridge` -> Supabase (`remote_fleet_devices`, `remote_fleet_commands`).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/auth-server'
import {
  buildDeviceKey,
  getRemoteStoreDisplayName,
  normalizeRemoteStoreCode,
  sanitizePlainOverlayText,
  TV_COMMANDS,
} from '@/lib/remote-control'
import {
  expireStaleCommands,
  extractClientIp,
  truncateCommandOutput,
} from '@/lib/remote-control-server'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_TV_CMD_SET = new Set<string>(TV_COMMANDS)

export async function POST(request: Request) {
  const ip = extractClientIp(request)
  const rl = checkRateLimit(`remote_tv_bridge:${ip}`, 150, 60_000)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Demasiadas peticiones TV bridge', retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || 'sync').trim().toLowerCase()
    const storeCode = normalizeRemoteStoreCode(body?.storeCode)
    const parsedScreen = parseInt(String(body?.screenNumber ?? '1'), 10)
    const screenNumber = Number.isFinite(parsedScreen) ? Math.min(Math.max(parsedScreen, 1), 20) : 1

    if (!storeCode) {
      return NextResponse.json({ error: 'storeCode inválido para TV' }, { status: 400 })
    }

    const deviceRole = `tv_screen_${screenNumber}`
    const deviceKey = buildDeviceKey(storeCode, 'tv_display', deviceRole)
    const nowIso = new Date().toISOString()

    let { data: device, error: findErr } = await supabaseAdmin
      .from('remote_fleet_devices')
      .select('*')
      .eq('device_key', deviceKey)
      .maybeSingle()

    if (findErr) throw findErr

    const rawTel = body?.telemetry && typeof body.telemetry === 'object' ? body.telemetry : {}
    const safeTelemetry = {
      screenNumber,
      activeImageUrl:
        typeof rawTel.activeImageUrl === 'string' ? rawTel.activeImageUrl.slice(0, 500) : null,
      isFullscreen: typeof rawTel.isFullscreen === 'boolean' ? rawTel.isFullscreen : null,
      screenResolution:
        typeof rawTel.screenResolution === 'string' ? rawTel.screenResolution.slice(0, 32) : null,
      userAgent: typeof rawTel.userAgent === 'string' ? rawTel.userAgent.slice(0, 220) : null,
    }

    if (!device) {
      const storeName = getRemoteStoreDisplayName(storeCode)
      const { data: created, error: insErr } = await supabaseAdmin
        .from('remote_fleet_devices')
        .insert({
          store_code: storeCode,
          device_type: 'tv_display',
          device_role: deviceRole,
          device_key: deviceKey,
          display_name: `${storeName} — TV Pantalla ${screenNumber}`,
          enrollment_status: 'enrolled',
          remote_tool_provider: 'none',
          desired_config: { screenNumber, blackoutMode: false, overlayMessage: null },
          telemetry: safeTelemetry,
          last_heartbeat_at: nowIso,
          last_ip: ip,
          updated_at: nowIso,
        })
        .select('*')
        .single()

      if (insErr) throw insErr
      device = created
    } else if (device.enrollment_status === 'revoked') {
      return NextResponse.json({ success: true, commands: [], state: {} })
    } else if (action === 'sync') {
      await supabaseAdmin
        .from('remote_fleet_devices')
        .update({
          telemetry: { ...(device.telemetry || {}), ...safeTelemetry },
          last_heartbeat_at: nowIso,
          last_ip: ip,
          updated_at: nowIso,
        })
        .eq('id', device.id)
    }

    if (action === 'ack') {
      const commandId = String(body?.commandId || '').trim()
      if (!UUID_REGEX.test(commandId)) {
        return NextResponse.json({ error: 'commandId inválido' }, { status: 400 })
      }
      const status = String(body?.status || 'succeeded').trim().toLowerCase()
      const finalStatus = status === 'failed' ? 'failed' : 'succeeded'

      await supabaseAdmin
        .from('remote_fleet_commands')
        .update({
          status: finalStatus,
          completed_at: nowIso,
          result_exit_code: finalStatus === 'succeeded' ? 0 : 1,
          result_output: truncateCommandOutput(body?.output, 2000),
          error_message: body?.errorMessage ? truncateCommandOutput(body.errorMessage, 1000) : null,
        })
        .eq('id', commandId)
        .eq('device_id', device.id)

      await supabaseAdmin
        .from('remote_fleet_devices')
        .update({
          last_heartbeat_at: nowIso,
          last_command_ack_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', device.id)

      return NextResponse.json({ success: true })
    }

    await expireStaleCommands(device.id)

    const { data: pending, error: cmdErr } = await supabaseAdmin
      .from('remote_fleet_commands')
      .select('id, command_type, payload, created_at, expires_at')
      .eq('device_id', device.id)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: true })
      .limit(5)

    if (cmdErr) throw cmdErr

    const safeCommands = (pending || []).filter((c) => ALLOWED_TV_CMD_SET.has(c.command_type))
    if (safeCommands.length > 0) {
      await supabaseAdmin
        .from('remote_fleet_commands')
        .update({ status: 'dispatched', dispatched_at: nowIso })
        .in('id', safeCommands.map((c) => c.id))
        .eq('status', 'pending')
    }

    const dc = (device.desired_config || {}) as Record<string, any>
    return NextResponse.json({
      success: true,
      deviceId: device.id,
      commands: safeCommands,
      state: {
        blackoutMode: Boolean(dc.blackoutMode),
        overlayMessage: sanitizePlainOverlayText(dc.overlayMessage, 280) || null,
      },
    })
  } catch (err: any) {
    console.error('❌ [api/remote-control/tv-bridge] Error:', err)
    return NextResponse.json({ error: err?.message || 'Error en tv-bridge' }, { status: 500 })
  }
}
